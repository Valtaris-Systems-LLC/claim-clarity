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

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;

  const withOne = bytes.length + 1;
  const paddedLength = Math.ceil((withOne + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);

  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;

  view.setUint32(paddedLength - 8, high);
  view.setUint32(paddedLength - 4, low);

  const h = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const w = new Array<number>(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }

    for (let i = 16; i < 64; i++) {
      const s0 =
        rightRotate(w[i - 15], 7) ^
        rightRotate(w[i - 15], 18) ^
        (w[i - 15] >>> 3);

      const s1 =
        rightRotate(w[i - 2], 17) ^
        rightRotate(w[i - 2], 19) ^
        (w[i - 2] >>> 10);

      w[i] = (((w[i - 16] + s0) >>> 0) + ((w[i - 7] + s1) >>> 0)) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function hashInputs(inputs: unknown): string {
  return sha256(stableStringify(inputs));
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