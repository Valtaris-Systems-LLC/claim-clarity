import { describe, it, expect, beforeEach } from 'vitest';
import {
  adjudicateClaim,
  resetIdCounter,
  sortLines,
  calculateAllowed,
  initSessionAccumulator,
} from '@/engine/calculation-engine';
import { hashInputs } from '@/engine/trace-builder';
import { determineCOBPrimacy, birthdayRule, calculateCOBAllocation } from '@/engine/cob-rules';
import type {
  ClaimLine,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
} from '@/types/claim';

function makeClaimLine(overrides: Partial<ClaimLine> = {}): ClaimLine {
  return {
    line_id: 'line_1',
    claim_id: 'claim_1',
    service_date: '2024-03-15',
    claim_line_number: 1,
    procedure_code: '99213',
    diagnosis_codes: ['J06.9'],
    billed_amount: 15000,
    units: 1,
    place_of_service: '11',
    ...overrides,
  };
}

function makeAccumulators(overrides: Partial<MemberAccumulators> = {}): MemberAccumulators {
  return {
    member_id: 'mem_1',
    plan_year: 2024,
    individual_deductible_used: 0,
    individual_deductible_max: 100000,
    family_deductible_used: 0,
    family_deductible_max: 300000,
    individual_oop_used: 0,
    individual_oop_max: 500000,
    family_oop_used: 0,
    family_oop_max: 1000000,
    benefit_limits: [],
    ...overrides,
  };
}

function makeContract(overrides: Partial<ContractTerms> = {}): ContractTerms {
  const fs = new Map<string, number>();

  fs.set('99213', 12000);
  fs.set('99214', 18000);
  fs.set('99215', 25000);

  return {
    contract_id: 'contract_1',
    contract_version: '1.0',
    provider_npi: '1234567890',
    effective_date: '2024-01-01',
    term_date: '2024-12-31',
    fee_schedule_id: 'fs_1',
    fee_schedule: fs,
    reimbursement_method: 'fee_schedule',
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanBenefits> = {}): PlanBenefits {
  return {
    plan_id: 'plan_1',
    plan_version: '1.0',
    plan_name: 'Gold PPO',
    plan_year: 2024,
    deductible_individual: 100000,
    deductible_family: 300000,
    oop_max_individual: 500000,
    oop_max_family: 1000000,
    coinsurance_rate: 0.2,
    cob_policy: 'standard',
    covered_services: [],
    ...overrides,
  };
}

describe('CalculationEngine', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('sortLines', () => {
    it('sorts by service_date then line_number', () => {
      const lines = [
        makeClaimLine({ line_id: 'c', service_date: '2024-03-16', claim_line_number: 1 }),
        makeClaimLine({ line_id: 'a', service_date: '2024-03-15', claim_line_number: 2 }),
        makeClaimLine({ line_id: 'b', service_date: '2024-03-15', claim_line_number: 1 }),
      ];

      const sorted = sortLines(lines);

      expect(sorted.map((line) => line.line_id)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('calculateAllowed', () => {
    it('uses fee schedule to determine allowed', () => {
      const line = makeClaimLine({
        billed_amount: 15000,
        procedure_code: '99213',
      });

      const contract = makeContract();

      expect(calculateAllowed(line, contract)).toBe(12000);
    });

    it('caps allowed at billed amount if fee > billed', () => {
      const line = makeClaimLine({
        billed_amount: 5000,
        procedure_code: '99213',
      });

      const contract = makeContract();

      expect(calculateAllowed(line, contract)).toBe(5000);
    });

    it('returns 0 for non-covered procedure', () => {
      const line = makeClaimLine({ procedure_code: 'ZZZZ' });
      const contract = makeContract();

      expect(calculateAllowed(line, contract)).toBe(0);
    });
  });

  describe('accumulator initialization', () => {
    it('does not allow negative remaining accumulator values', () => {
      const acc = initSessionAccumulator(
        makeAccumulators({
          individual_deductible_used: 125000,
          individual_deductible_max: 100000,
          individual_oop_used: 600000,
          individual_oop_max: 500000,
        }),
      );

      expect(acc.deductible_remaining).toBe(0);
      expect(acc.oop_remaining).toBe(0);
    });
  });

  describe('Single-payer adjudication', () => {
    it('applies deductible + coinsurance correctly for single line', () => {
      const lines = [makeClaimLine()];
      const acc = makeAccumulators();
      const contract = makeContract();
      const plan = makePlan({ coinsurance_rate: 0.2 });

      const { run, trace } = adjudicateClaim(lines, acc, contract, plan);

      expect(run.line_results).toHaveLength(1);

      const result = run.line_results[0];

      expect(result.allowed).toBe(12000);
      expect(result.deductible_applied).toBe(12000);
      expect(result.coinsurance).toBe(0);
      expect(result.plan_paid).toBe(0);
      expect(result.member_responsibility).toBe(12000);

      expect(trace.trace_id).toBeTruthy();
      expect(trace.rule_firings.length).toBeGreaterThan(0);
      expect(trace.math_steps).toHaveLength(1);
      expect(trace.plan_version).toBe('1.0');
    });

    it('cross-line accumulator: Line 2 sees deductible used by Line 1', () => {
      const lines = [
        makeClaimLine({
          line_id: 'L1',
          claim_line_number: 1,
          procedure_code: '99214',
          billed_amount: 20000,
        }),
        makeClaimLine({
          line_id: 'L2',
          claim_line_number: 2,
          procedure_code: '99215',
          billed_amount: 30000,
        }),
      ];

      const acc = makeAccumulators({ individual_deductible_used: 80000 });
      const contract = makeContract();
      const plan = makePlan({ coinsurance_rate: 0.2 });

      const { run } = adjudicateClaim(lines, acc, contract, plan);

      const l1 = run.line_results.find((result) => result.line_id === 'L1')!;
      const l2 = run.line_results.find((result) => result.line_id === 'L2')!;

      expect(l1.allowed).toBe(18000);
      expect(l1.deductible_applied).toBe(18000);
      expect(l1.coinsurance).toBe(0);
      expect(l1.plan_paid).toBe(0);

      expect(l2.allowed).toBe(25000);
      expect(l2.deductible_applied).toBe(2000);
      expect(l2.coinsurance).toBe(4600);
      expect(l2.plan_paid).toBe(18400);
      expect(l2.member_responsibility).toBe(6600);

      expect(run.line_processing_order).toEqual(['L1', 'L2']);
    });

    it('enforces the remaining out-of-pocket maximum on member responsibility', () => {
      const lines = [
        makeClaimLine({
          line_id: 'OOP1',
          procedure_code: '99215',
          billed_amount: 30000,
        }),
      ];

      const acc = makeAccumulators({
        individual_deductible_used: 100000,
        individual_oop_used: 498000,
        individual_oop_max: 500000,
      });

      const contract = makeContract();
      const plan = makePlan({ coinsurance_rate: 0.2 });

      const { run, trace } = adjudicateClaim(lines, acc, contract, plan);

      const result = run.line_results[0];

      expect(result.allowed).toBe(25000);
      expect(result.member_responsibility).toBe(2000);
      expect(result.plan_paid).toBe(23000);
      expect(run.total_member_responsibility).toBe(2000);
      expect(run.total_plan_paid).toBe(23000);
      expect(run.final_accumulator.oop_remaining).toBe(0);

      const oopAdjustment = result.adjustments.find(
        (adjustment) => adjustment.reason_code === 'OOP_MAX_PROTECTION',
      );

      expect(oopAdjustment).toBeTruthy();
      expect(oopAdjustment?.amount).toBe(3000);

      const oopRule = trace.rule_firings.find(
        (rule) => rule.rule_id === 'OOP_MAX_001',
      );

      expect(oopRule).toBeTruthy();
      expect(oopRule?.outputs.member_responsibility).toBe(2000);
      expect(oopRule?.outputs.shifted_to_plan).toBe(3000);

      const mathStep = trace.math_steps[0];

      expect(mathStep.member_responsibility).toBe(2000);
      expect(mathStep.plan_paid).toBe(23000);
    });

    it('denies non-covered service', () => {
      const lines = [
        makeClaimLine({
          procedure_code: 'ZZZZ',
          billed_amount: 50000,
        }),
      ];

      const { run } = adjudicateClaim(
        lines,
        makeAccumulators(),
        makeContract(),
        makePlan(),
      );

      expect(run.line_results[0].status).toBe('denied');
      expect(run.line_results[0].member_responsibility).toBe(50000);
      expect(run.line_results[0].plan_paid).toBe(0);
    });
  });

  describe('Multi-payer COB adjudication', () => {
    it('standard COB: secondary pays remaining after primary', () => {
      const lines = [
        makeClaimLine({
          line_id: 'L1',
          procedure_code: '99214',
          billed_amount: 20000,
        }),
      ];

      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract();
      const plan = makePlan({
        coinsurance_rate: 0.2,
        cob_policy: 'standard',
      });

      const priorOutcomes: PriorPayerOutcome[] = [
        {
          payer_id: 'primary_plan',
          payer_name: 'Primary Insurance Co',
          claim_line_id: 'L1',
          billed: 20000,
          allowed: 17000,
          paid: 13600,
          patient_responsibility: 3400,
          adjustments: [
            {
              carc_code: '45',
              amount: 3000,
              group_code: 'CO',
            },
          ],
          source: 'edi_835',
          confidence: 1.0,
        },
      ];

      const { run, trace } = adjudicateClaim(
        lines,
        acc,
        contract,
        plan,
        priorOutcomes,
      );

      const result = run.line_results[0];

      expect(result.allowed).toBe(18000);
      expect(result.cob_allocations.length).toBeGreaterThan(0);
      expect(result.cob_allocations[0].paid).toBe(13600);
      expect(result.cob_allocations[0].adjustment).toBe(1000);
      expect(result.plan_paid).toBe(3520);
      expect(result.member_responsibility).toBe(880);
      const cobRules = trace.rule_firings.filter(
        (rule) => rule.category === 'cob_allocation',
      );

      expect(cobRules.length).toBeGreaterThan(0);
    });

    it('non-duplication COB: no payment when primary paid >= secondary allowed', () => {
      const lines = [
        makeClaimLine({
          line_id: 'L1',
          procedure_code: '99213',
          billed_amount: 15000,
        }),
      ];

      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract();
      const plan = makePlan({ cob_policy: 'non_duplication' });

      const priorOutcomes: PriorPayerOutcome[] = [
        {
          payer_id: 'primary_plan',
          payer_name: 'Primary Insurance',
          claim_line_id: 'L1',
          billed: 15000,
          allowed: 14000,
          paid: 14000,
          patient_responsibility: 0,
          adjustments: [],
          source: 'edi_835',
          confidence: 1.0,
        },
      ];

      const { run } = adjudicateClaim(
        lines,
        acc,
        contract,
        plan,
        priorOutcomes,
      );

      const result = run.line_results[0];

      expect(result.allowed).toBe(12000);
      expect(result.cob_allocations[0].method).toBe('non_duplication');
    });
  });

  describe('COB Primacy Rules', () => {
    it('birthday rule: earlier birthday is primary', () => {
      const result = determineCOBPrimacy(
        [
          {
            payer_id: 'p1',
            payer_name: 'P1',
            coverage_type: 'medical',
          },
        ],
        {
          member_dob: '1985-03-15',
          spouse_dob: '1985-07-20',
        },
        [birthdayRule],
      );

      expect(result).not.toBeNull();
      expect(result!.primary_payer_id).toBe('member_plan');
      expect(result!.rationale).toContain('Birthday Rule');
    });

    it('birthday rule: spouse earlier', () => {
      const result = determineCOBPrimacy(
        [
          {
            payer_id: 'p1',
            payer_name: 'P1',
            coverage_type: 'medical',
          },
        ],
        {
          member_dob: '1985-09-01',
          spouse_dob: '1985-02-14',
        },
        [birthdayRule],
      );

      expect(result!.primary_payer_id).toBe('spouse_plan');
    });
  });

  describe('Trace integrity', () => {
    it('every adjudication produces a complete trace', () => {
      const lines = [
        makeClaimLine({
          line_id: 'L1',
          claim_line_number: 1,
        }),
        makeClaimLine({
          line_id: 'L2',
          claim_line_number: 2,
          procedure_code: '99214',
          billed_amount: 20000,
        }),
      ];

      const { trace } = adjudicateClaim(
        lines,
        makeAccumulators(),
        makeContract(),
        makePlan(),
      );

      expect(trace.trace_id).toBeTruthy();
      expect(trace.run_id).toBeTruthy();
      expect(trace.claim_id).toBe('claim_1');
      expect(trace.rule_set_version).toBeTruthy();
      expect(trace.plan_version).toBe('1.0');
      expect(trace.contract_version).toBe('1.0');
      expect(trace.calc_policy_version).toBeTruthy();
      expect(trace.inputs_snapshot_hash).toBeTruthy();
      expect(trace.inputs_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(trace.snapshot_ref).toContain(trace.run_id);
      expect(trace.snapshot_ref).toContain(trace.inputs_snapshot_hash);

      expect(trace.math_steps).toHaveLength(2);
      expect(trace.math_steps[0].line_id).toBe('L1');
      expect(trace.math_steps[1].line_id).toBe('L2');

      expect(trace.rule_firings.length).toBeGreaterThan(0);

      for (let i = 1; i < trace.rule_firings.length; i++) {
        expect(trace.rule_firings[i].order).toBeGreaterThanOrEqual(
          trace.rule_firings[i - 1].order,
        );
      }

      for (const step of trace.math_steps) {
        expect(step.plan_paid + step.member_responsibility).toBeLessThanOrEqual(
          step.allowed + 1,
        );
      }
    });

    it('hashInputs returns deterministic SHA-256 fingerprints independent of object key order', () => {
      const a = hashInputs({
        plan: {
          id: 'p1',
          version: '1.0',
        },
        contract: {
          id: 'c1',
          version: '1.0',
        },
      });

      const b = hashInputs({
        contract: {
          version: '1.0',
          id: 'c1',
        },
        plan: {
          version: '1.0',
          id: 'p1',
        },
      });

      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});