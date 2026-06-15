/**
 * Trace schema — every adjudication MUST produce a Trace Object.
 */

export interface TraceObject {
  trace_id: string;
  run_id: string;
  claim_id: string;
  timestamp: string;

  trace_schema_version?: string;

  rule_set_version: string;
  plan_version: string;
  contract_version: string;
  calc_policy_version: string;

  inputs_snapshot_hash: string;
  snapshot_ref: string;

  rule_firings: RuleFiring[];
  math_steps: MathStep[];
  source_badges: SourceBadge[];

  trace_quality?: TraceQuality;
  replay_metadata?: ReplayMetadata;
}

export interface ReplayMetadata {
  replayable: boolean;
  replay_blockers: string[];
  input_scope: 'partial' | 'full';
  deterministic_ids: boolean;
  deterministic_timestamps: boolean;
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
  | 'payer_behavior'
  | 'replay'
  | 'audit';

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

export interface ExplanationFragment {
  fragment_id: string;
  internal_code: string;
  lens: 'member' | 'provider' | 'employer' | 'regulator';
  locale: string;
  text: string;
  detail_level: 0 | 1 | 2 | 3;
}

export interface CARCRARCMapping {
  external_carc: string;
  external_rarc?: string;
  group_code?: string;
  internal_reason_code: string;
  fragment_ids: Record<string, string[]>;
}