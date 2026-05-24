import type {
  TraceObject,
  RuleFiring,
  RuleCategory,
  MathStep,
  SourceBadge,
} from '@/types/trace';
import type { PlanBenefits, ContractTerms } from '@/types/claim';
import { generateId } from './calculation-engine';

const RULE_SET_VERSION = '1.0.0';
const CALC_POLICY_VERSION = '1.0.0';
const TRACE_SCHEMA_VERSION = '1.1.0';

export function createRuleFiring(
  order: number,
  ruleId: string,
  category: RuleCategory,
  inputsUsed: Record<string, unknown>,
  outputs: Record<string, unknown>,
  fragmentIds: string[],
): RuleFiring {
  return {
    order,
    rule_id: ruleId,
    category,
    inputs_used: inputsUsed,
    outputs,
    explanation_fragment_ids: fragmentIds,
  };
}

export function createMathStep(
  lineId: string,
  billed: number,
  allowed: number,
  deductible: number,
  coinsurance: number,
  copay: number,
  planPaid: number,
  memberResp: number,
  cobPriorPaid?: number,
  cobAdj?: number,
): MathStep {
  return {
    line_id: lineId,
    billed: roundMoney(billed),
    allowed: roundMoney(allowed),
    deductible: roundMoney(deductible),
    coinsurance: roundMoney(coinsurance),
    copay: roundMoney(copay),
    plan_paid: roundMoney(planPaid),
    member_responsibility: roundMoney(memberResp),
    cob_prior_paid: cobPriorPaid === undefined ? undefined : roundMoney(cobPriorPaid),
    cob_adjustment: cobAdj === undefined ? undefined : roundMoney(cobAdj),
  };
}

export function createSourceBadge(
  fieldPath: string,
  sourceType: SourceBadge['source_type'],
  confidence: number,
  documentRef?: string,
): SourceBadge {
  return {
    field_path: fieldPath,
    source_type: sourceType,
    confidence: clamp(confidence, 0, 1),
    document_ref: documentRef,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function roundMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    return normalize(Object.fromEntries(value));
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

export function hashInputs(inputs: unknown): string {
  const str = stableStringify(inputs);

  let hash = 2166136261;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildTraceQuality(
  ruleFirings: RuleFiring[],
  mathSteps: MathStep[],
  sourceBadges: SourceBadge[],
) {
  const sourceConfidence =
    sourceBadges.length > 0
      ? sourceBadges.reduce((sum, badge) => sum + badge.confidence, 0) / sourceBadges.length
      : 0;

  return {
    rules_fired: ruleFirings.length,
    math_steps: mathSteps.length,
    source_badges: sourceBadges.length,
    avg_source_confidence: Math.round(sourceConfidence * 100) / 100,
    has_math: mathSteps.length > 0,
    has_rules: ruleFirings.length > 0,
    has_sources: sourceBadges.length > 0,
  };
}

export function buildTrace(
  runId: string,
  claimId: string,
  plan: PlanBenefits,
  contract: ContractTerms,
  ruleFirings: RuleFiring[],
  mathSteps: MathStep[],
  sourceBadges: SourceBadge[] = [],
): TraceObject {
  const traceId = generateId('trace');

  const inputsHash = hashInputs({
    plan,
    contract,
    rule_set_version: RULE_SET_VERSION,
    calc_policy_version: CALC_POLICY_VERSION,
  });

  const orderedRuleFirings = [...ruleFirings].sort((a, b) => a.order - b.order);
  const normalizedMathSteps = mathSteps.map((step) =>
    createMathStep(
      step.line_id,
      step.billed,
      step.allowed,
      step.deductible,
      step.coinsurance,
      step.copay,
      step.plan_paid,
      step.member_responsibility,
      step.cob_prior_paid,
      step.cob_adjustment,
    ),
  );

  const quality = buildTraceQuality(orderedRuleFirings, normalizedMathSteps, sourceBadges);

  return {
    trace_id: traceId,
    run_id: runId,
    claim_id: claimId,
    timestamp: new Date().toISOString(),

    rule_set_version: RULE_SET_VERSION,
    plan_version: plan.plan_version,
    contract_version: contract.contract_version,
    calc_policy_version: CALC_POLICY_VERSION,

    inputs_snapshot_hash: inputsHash,
    snapshot_ref: `snapshots/${runId}/${inputsHash}`,

    rule_firings: orderedRuleFirings,
    math_steps: normalizedMathSteps,
    source_badges: sourceBadges,

    trace_schema_version: TRACE_SCHEMA_VERSION,
    trace_quality: quality,
  } as TraceObject;
}