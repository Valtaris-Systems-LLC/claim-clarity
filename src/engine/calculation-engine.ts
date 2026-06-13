/**
 * DualPay Calculation Engine — Pure Functions
 *
 * All calculations are deterministic, traceable, and produce
 * structured Trace Objects for every adjudication.
 */

import type {
  ClaimLine,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
  AdjudicationLineResult,
  AdjudicationRun,
  SessionAccumulator,
  AdjustmentDetail,
  COBAllocation,
} from '@/types/claim';
import type { TraceObject, MathStep, RuleFiring } from '@/types/trace';
import { buildTrace, createRuleFiring, createMathStep } from './trace-builder';
import { calculateCOBAllocation } from './cob-rules';

const CALC_POLICY_VERSION = '1.0.0';

let idCounter = 0;

export function generateId(prefix: string): string {
  idCounter++;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function sortLines(lines: ClaimLine[]): ClaimLine[] {
  return [...lines].sort((a, b) => {
    const dateComp = a.service_date.localeCompare(b.service_date);
    if (dateComp !== 0) return dateComp;
    return a.claim_line_number - b.claim_line_number;
  });
}

export function initSessionAccumulator(accumulators: MemberAccumulators): SessionAccumulator {
  return {
    deductible_remaining: Math.max(
      0,
      accumulators.individual_deductible_max - accumulators.individual_deductible_used,
    ),
    oop_remaining: Math.max(
      0,
      accumulators.individual_oop_max - accumulators.individual_oop_used,
    ),
    benefit_limits_remaining: new Map(
      accumulators.benefit_limits.map((bl) => [
        bl.benefit_category,
        Math.max(0, bl.max - bl.used),
      ]),
    ),
    lines_processed: [],
  };
}

export function calculateAllowed(line: ClaimLine, contract: ContractTerms): number {
  if (contract.reimbursement_method === 'fee_schedule') {
    const scheduled = contract.fee_schedule.get(line.procedure_code);

    if (scheduled !== undefined) {
      return Math.min(line.billed_amount, scheduled * line.units);
    }

    return 0;
  }

  if (contract.reimbursement_method === 'percent_of_billed') {
    return Math.round(line.billed_amount * (contract.percent_of_billed ?? 1));
  }

  return line.billed_amount;
}

export function roundCents(amount: number): number {
  return Math.round(amount);
}

export function adjudicateLine(
  line: ClaimLine,
  sessionAcc: SessionAccumulator,
  contract: ContractTerms,
  plan: PlanBenefits,
  priorOutcomes: PriorPayerOutcome[],
  ruleFirings: RuleFiring[],
  mathSteps: MathStep[],
): { result: AdjudicationLineResult; nextAcc: SessionAccumulator } {
  const adjustments: AdjustmentDetail[] = [];
  const cobAllocations: COBAllocation[] = [];

  const allowed = calculateAllowed(line, contract);

  ruleFirings.push(
    createRuleFiring(
      ruleFirings.length,
      'PRICING_001',
      'pricing',
      { billed: line.billed_amount, procedure: line.procedure_code },
      { allowed },
      ['frag_pricing_fee_schedule'],
    ),
  );

  if (allowed === 0) {
    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'DENIAL_001',
        'denial',
        { procedure: line.procedure_code },
        { denied: true, reason: 'not_in_fee_schedule' },
        ['frag_denial_non_covered'],
      ),
    );

    const result: AdjudicationLineResult = {
      line_id: line.line_id,
      claim_id: line.claim_id,
      allowed: 0,
      deductible_applied: 0,
      coinsurance: 0,
      copay: 0,
      plan_paid: 0,
      member_responsibility: line.billed_amount,
      adjustments: [
        {
          reason_code: 'NON_COVERED',
          amount: line.billed_amount,
          category: 'non_covered',
        },
      ],
      cob_allocations: [],
      status: 'denied',
      denial_reasons: ['Service not covered under contract'],
    };

    mathSteps.push(
      createMathStep(
        line.line_id,
        line.billed_amount,
        0,
        0,
        0,
        0,
        0,
        line.billed_amount,
      ),
    );

    return {
      result,
      nextAcc: {
        ...sessionAcc,
        lines_processed: [...sessionAcc.lines_processed, line.line_id],
      },
    };
  }

  const contractualAdj = line.billed_amount - allowed;

  if (contractualAdj > 0) {
    adjustments.push({
      reason_code: 'CONTRACTUAL',
      amount: contractualAdj,
      category: 'contractual',
    });
  }

  const linePrior = priorOutcomes.filter((po) => po.claim_line_id === line.line_id);
  let cobPriorPaid = 0;
  let cobAdjustment = 0;

  if (linePrior.length > 0) {
    const cobResult = calculateCOBAllocation(allowed, linePrior, plan.cob_policy);

    cobPriorPaid = cobResult.total_prior_paid;
    cobAdjustment = cobResult.adjustment;
    cobAllocations.push(...cobResult.allocations);

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'COB_ALLOC_001',
        'cob_allocation',
        {
          allowed,
          prior_outcomes: linePrior.map((payer) => ({
            payer: payer.payer_id,
            paid: payer.paid,
          })),
        },
        {
          cob_prior_paid: cobPriorPaid,
          cob_adjustment: cobAdjustment,
          method: plan.cob_policy,
        },
        ['frag_cob_secondary_calc'],
      ),
    );

    if (cobAdjustment > 0) {
      adjustments.push({
        reason_code: 'COB_ADJUSTMENT',
        amount: cobAdjustment,
        category: 'cob',
      });
    }
  }

  const amountForCostSharing = Math.max(0, allowed - cobPriorPaid - cobAdjustment);

  const deductibleApplicable = Math.min(
    amountForCostSharing,
    Math.max(0, sessionAcc.deductible_remaining),
  );

  const afterDeductible = amountForCostSharing - deductibleApplicable;

  if (deductibleApplicable > 0) {
    adjustments.push({
      reason_code: 'DEDUCTIBLE',
      amount: deductibleApplicable,
      category: 'deductible',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'DEDUCTIBLE_001',
        'deductible',
        {
          amount: amountForCostSharing,
          deductible_remaining: sessionAcc.deductible_remaining,
        },
        { deductible_applied: deductibleApplicable },
        ['frag_deductible_applied'],
      ),
    );
  }

  const coinsuranceBeforeOop = roundCents(afterDeductible * plan.coinsurance_rate);
  const planShareAfterCoins = afterDeductible - coinsuranceBeforeOop;

  if (coinsuranceBeforeOop > 0) {
    adjustments.push({
      reason_code: 'COINSURANCE',
      amount: coinsuranceBeforeOop,
      category: 'coinsurance',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'COINSURANCE_001',
        'coinsurance',
        {
          after_deductible: afterDeductible,
          rate: plan.coinsurance_rate,
        },
        { coinsurance: coinsuranceBeforeOop },
        ['frag_coinsurance_applied'],
      ),
    );
  }

  let copayBeforeOop = 0;

  if (plan.copay_amount && plan.copay_applies_to?.includes(line.procedure_code)) {
    copayBeforeOop = Math.min(plan.copay_amount, amountForCostSharing);

    adjustments.push({
      reason_code: 'COPAY',
      amount: copayBeforeOop,
      category: 'copay',
    });
  }

  const memberRespBeforeOop = roundCents(
    deductibleApplicable + coinsuranceBeforeOop + copayBeforeOop,
  );

  const memberResp = roundCents(
    Math.min(memberRespBeforeOop, Math.max(0, sessionAcc.oop_remaining)),
  );

  const oopOverflow = roundCents(Math.max(0, memberRespBeforeOop - memberResp));

  const coinsurance = coinsuranceBeforeOop;
  const copay = copayBeforeOop;

  const planPaid = roundCents(
    Math.max(0, amountForCostSharing - memberResp),
  );

  if (oopOverflow > 0) {
    adjustments.push({
      reason_code: 'OOP_MAX_PROTECTION',
      amount: oopOverflow,
      category: 'oop_max',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'OOP_MAX_001',
        'benefit_limit',
        {
          member_responsibility_before_oop: memberRespBeforeOop,
          oop_remaining: sessionAcc.oop_remaining,
        },
        {
          member_responsibility: memberResp,
          shifted_to_plan: oopOverflow,
        },
        ['frag_oop_max_enforced'],
      ),
    );
  }

  const nextAcc: SessionAccumulator = {
    deductible_remaining: Math.max(
      0,
      sessionAcc.deductible_remaining - deductibleApplicable,
    ),
    oop_remaining: Math.max(
      0,
      sessionAcc.oop_remaining - memberResp,
    ),
    benefit_limits_remaining: new Map(sessionAcc.benefit_limits_remaining),
    lines_processed: [...sessionAcc.lines_processed, line.line_id],
  };

  mathSteps.push(
    createMathStep(
      line.line_id,
      line.billed_amount,
      allowed,
      deductibleApplicable,
      coinsurance,
      copay,
      planPaid,
      memberResp,
      cobPriorPaid,
      cobAdjustment,
    ),
  );

  return {
    result: {
      line_id: line.line_id,
      claim_id: line.claim_id,
      allowed,
      deductible_applied: deductibleApplicable,
      coinsurance,
      copay,
      plan_paid: planPaid,
      member_responsibility: memberResp,
      adjustments,
      cob_allocations: cobAllocations,
      status: planPaid > 0 ? 'paid' : memberResp > 0 ? 'adjusted' : 'denied',
    },
    nextAcc,
  };
}

export function adjudicateClaim(
  lines: ClaimLine[],
  accumulators: MemberAccumulators,
  contract: ContractTerms,
  plan: PlanBenefits,
  priorOutcomes: PriorPayerOutcome[] = [],
  runId?: string,
): { run: AdjudicationRun; trace: TraceObject } {
  const rid = runId ?? generateId('run');
  const sortedLines = sortLines(lines);
  const lineOrder = sortedLines.map((line) => line.line_id);

  let sessionAcc = initSessionAccumulator(accumulators);
  const lineResults: AdjudicationLineResult[] = [];
  const ruleFirings: RuleFiring[] = [];
  const mathSteps: MathStep[] = [];

  for (const line of sortedLines) {
    const { result, nextAcc } = adjudicateLine(
      line,
      sessionAcc,
      contract,
      plan,
      priorOutcomes,
      ruleFirings,
      mathSteps,
    );

    lineResults.push(result);
    sessionAcc = nextAcc;
  }

  const totalPlanPaid = lineResults.reduce((sum, result) => sum + result.plan_paid, 0);

  const totalMemberResp = lineResults.reduce(
    (sum, result) => sum + result.member_responsibility,
    0,
  );

  const trace = buildTrace(
    rid,
    lines[0]?.claim_id ?? 'unknown',
    plan,
    contract,
    ruleFirings,
    mathSteps,
  );

  const run: AdjudicationRun = {
    run_id: rid,
    claim_id: lines[0]?.claim_id ?? 'unknown',
    timestamp: new Date().toISOString(),
    line_processing_order: lineOrder,
    line_results: lineResults,
    final_accumulator: sessionAcc,
    total_plan_paid: totalPlanPaid,
    total_member_responsibility: totalMemberResp,
    trace_id: trace.trace_id,
    calc_policy_version: CALC_POLICY_VERSION,
  };

  return { run, trace };
}