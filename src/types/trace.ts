/**
 * Trace schema — every adjudication MUST produce a Trace Object.
 *
 * The trace is the audit spine for Claim Clarity / DualPay:
 * - what inputs were used
 * - which rules fired
 * - how line-level math was calculated
 * - what source evidence supported each value
 * - which versions were pinned at runtime
 */

export interface TraceObject {
  trace_id: string;
  run_id: string;
  claim_id: string;
  timestamp: string;

  // Trace schema metadata
  trace_schema_version?: string;

  // Version pins
  rule_set_version: string;
  plan_version: string;
  contract_version: string;
  calc_policy_version: string;

  // Inputs snapshot
  inputs_snapshot_hash: string;
  snapshot_ref: string;

  // Rule firings ordered by execution
  rule_firings: RuleFiring[];

  // Math steps per line
  math_steps: MathStep[];

  // Source badges per key value
  source_badges: SourceBadge[];

  // Trace quality summary
  trace_quality?: TraceQuality;
}

export interface TraceQuality {
  rules_fired: number;
  math_steps: number;
  source_badges: number;
  avg_source_confidence: number;
  has_math: boolean;
  has_rules: boolean;
  has_sources: boolean;
}

export interface RuleFiring {
  order: number;
  rule_id: string;
  category: RuleCategory;
  inputs_used: Record<string, unknown>;
  outputs: Record<string, unknown>;
  explanation_fragment_ids: string[];
}

export type RuleCategory =
  | 'eligibility'
  | 'coverage'
  | 'cob_primacy'
  | 'pricing'
  | 'deductible'
  | 'coinsurance'
  | 'copay'
  | 'benefit_limit'
  | 'cob_allocation'
  | 'denial'
  | 'adjustment'
  | 'recoverability'
  | 'appeal_readiness'
  | 'evidence'
  | 'payer_behavior';

export interface MathStep {
  line_id: string;
  billed: number;
  allowed: number;
  deductible: number;
  coinsurance: number;
  copay: number;
  plan_paid: number;
  member_responsibility: number;
  cob_prior_paid?: number;
  cob_adjustment?: number;
}

export interface SourceBadge {
  field_path: string;
  source_type:
    | 'plan'
    | 'contract'
    | 'prior_eob'
    | 'attestation'
    | 'verification'
    | '835'
    | 'ocr'
    | 'payer_portal'
    | 'manual'
    | 'clinical_record'
    | 'clearinghouse'
    | 'system';
  confidence: number;
  document_ref?: string;
}

// Explainability fragment library
export interface ExplanationFragment {
  fragment_id: string;
  internal_code: string;
  lens: 'member' | 'provider' | 'employer' | 'regulator';
  locale: string;
  text: string;
  detail_level: 0 | 1 | 2 | 3;
}

// CARC/RARC mapping
export interface CARCRARCMapping {
  external_carc: string;
  external_rarc?: string;
  group_code?: string;
  internal_reason_code: string;
  fragment_ids: Record<string, string[]>;
}