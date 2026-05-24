/**
 * Claim Clarity — Operational Intelligence types
 *
 * Layered on top of the DualPay adjudication primitives. These types
 * describe the operational reimbursement view: denials, payer responses,
 * timeline events, appeals, evidence readiness, recovery barriers,
 * payer behavior, and prioritized work-queue items.
 */

export type DenialCategory =
  | 'authorization'
  | 'eligibility'
  | 'cob'
  | 'modifier'
  | 'duplicate'
  | 'medical_necessity'
  | 'missing_documentation'
  | 'timely_filing'
  | 'contractual'
  | 'bundled'
  | 'coding'
  | 'coverage'
  | 'underpayment'
  | 'coordination_of_benefits'
  | 'benefit_limit'
  | 'medical_record_request'
  | 'unknown';

export type DenialSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

export type WorkflowOwner =
  | 'biller'
  | 'coder'
  | 'auth_team'
  | 'clinical'
  | 'appeals'
  | 'cob_team'
  | 'eligibility'
  | 'payer_relations'
  | 'supervisor'
  | 'unassigned';

export type AgingBucket =
  | '0-30'
  | '31-60'
  | '61-90'
  | '91-120'
  | '120+';

export type ReimbursementState =
  | 'submitted'
  | 'pending_payer'
  | 'partially_paid'
  | 'denied'
  | 'paid'
  | 'appealing'
  | 'resolved'
  | 'written_off'
  | 'corrected'
  | 'resubmitted';

export type GroupCode =
  | 'CO'
  | 'PR'
  | 'OA'
  | 'PI'
  | 'CR';

export type EvidenceStatus =
  | 'present'
  | 'missing'
  | 'requested'
  | 'verified'
  | 'stale'
  | 'not_required';

export type EvidenceType =
  | 'primary_eob'
  | 'secondary_eob'
  | 'authorization'
  | 'referral'
  | 'medical_record'
  | 'operative_note'
  | 'clinical_note'
  | 'lab_result'
  | 'eligibility_snapshot'
  | 'benefit_verification'
  | 'coordination_of_benefits'
  | 'invoice'
  | 'claim_form'
  | 'payer_policy'
  | 'contract'
  | 'appeal_letter'
  | 'other';

export interface EvidenceRequirement {
  evidence_id: string;
  label: string;
  type: EvidenceType;
  status: EvidenceStatus;
  required_for: 'appeal' | 'resubmission' | 'correction' | 'audit' | 'payment_posting';
  source?: 'edi' | 'portal' | 'document' | 'manual' | 'system';
  document_ref?: string;
  last_verified_at?: string;
  confidence?: number; // 0-1
  blocking: boolean;
}

export interface DenialEvent {
  denial_id: string;
  claim_id: string;
  line_id?: string;
  occurred_at: string;

  carc_code: string;
  rarc_code?: string;
  group_code: GroupCode;

  amount_cents: number;

  category: DenialCategory;
  severity: DenialSeverity;

  recoverability_score: number; // 0-100

  root_cause: string;
  recommended_action: string;
  workflow_owner: WorkflowOwner;

  appeal_eligible: boolean;
  correction_eligible?: boolean;
  resubmission_eligible?: boolean;

  evidence_required: string[];

  payer_message?: string;

  policy_ref?: string;
  trace_ref?: string;
}

export interface PayerResponse {
  response_id: string;
  claim_id: string;
  payer_id: string;
  payer_name: string;
  received_at: string;

  response_type:
    | 'EOB_835'
    | 'DENIAL'
    | 'REQUEST_INFO'
    | 'PARTIAL_PAY'
    | 'ADJUSTMENT'
    | 'ACK';

  billed_cents: number;
  allowed_cents: number;
  paid_cents: number;
  patient_resp_cents: number;
  adjustment_cents: number;

  source:
    | 'edi_835'
    | 'portal'
    | 'fax'
    | 'manual'
    | 'api';

  trace_ref?: string;
  raw_ref?: string;
}

export type TimelineKind =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'DENIED'
  | 'PARTIAL_PAY'
  | 'PAID'
  | 'APPEAL_FILED'
  | 'APPEAL_DECISION'
  | 'INFO_REQUESTED'
  | 'INFO_PROVIDED'
  | 'RESUBMITTED'
  | 'CORRECTED'
  | 'NOTE_ADDED'
  | 'STATUS_CHANGED'
  | 'ESCALATED'
  | 'EVIDENCE_ATTACHED'
  | 'WORKQUEUE_ASSIGNED';

export interface ReimbursementTimelineEvent {
  event_id: string;
  claim_id: string;
  occurred_at: string;
  kind: TimelineKind;
  actor: string;
  description: string;
  amount_cents?: number;
  trace_ref?: string;
}

export type AppealStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'denied'
  | 'partial'
  | 'withdrawn';

export interface Appeal {
  appeal_id: string;
  claim_id: string;
  denial_id?: string;

  status: AppealStatus;
  level: 1 | 2 | 3;

  filed_at?: string;
  decision_at?: string;
  due_at?: string;

  amount_in_dispute_cents: number;
  amount_recovered_cents?: number;

  evidence_attached: string[];
  rationale: string;

  appeal_readiness_score: number; // 0-100
  packet_ref?: string;
}

export type WorkQueueId =
  | 'unresolved_denials'
  | 'high_value'
  | 'appeals_in_progress'
  | 'missing_docs'
  | 'stalled'
  | 'escalation'
  | 'aging'
  | 'payer_follow_up'
  | 'underpayment_review'
  | 'cob_review'
  | 'timely_filing_risk';

export interface WorkQueueAssignment {
  queue: WorkQueueId;
  assigned_to?: string;
  sla_due_at: string;
  last_action_at: string;
  notes: string;
  priority?: DenialSeverity;
}

export interface RecoveryIntelligence {
  score: number;
  tier: 'HIGH' | 'MEDIUM' | 'LOW';

  appeal_readiness: number;
  documentation_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  economic_priority: 'LOW' | 'MEDIUM' | 'HIGH';

  recovery_barriers: string[];
  next_best_actions: string[];

  recommended_path: string;
  headline: string;
}

export interface ClaimIntel {
  payer_id: string;
  payer_name: string;
  payer_class:
    | 'commercial'
    | 'medicare'
    | 'medicaid'
    | 'workers_comp'
    | 'self_pay';

  submitted_at: string;

  aging_days: number;
  aging_bucket: AgingBucket;

  reimbursement_state: ReimbursementState;

  expected_reimbursement_cents: number;
  actual_reimbursement_cents: number;
  underpayment_cents: number;
  amount_at_risk_cents: number;

  recoverability_score: number; // 0-100

  severity: DenialSeverity;
  workflow_owner: WorkflowOwner;

  sla_due_at: string;

  is_escalated: boolean;
  is_high_value: boolean;
  is_stalled: boolean;

  denial_events: DenialEvent[];
  payer_responses: PayerResponse[];
  timeline: ReimbursementTimelineEvent[];
  appeals: Appeal[];

  evidence_missing: string[];
  evidence_requirements?: EvidenceRequirement[];

  recovery_intelligence?: RecoveryIntelligence;

  notes: string[];

  queues: WorkQueueId[];
}

export interface PayerProfile {
  payer_id: string;
  payer_name: string;
  payer_class: ClaimIntel['payer_class'];

  avg_days_to_pay: number;
  denial_rate: number; // 0-1
  appeal_overturn_rate: number; // 0-1

  first_pass_resolution_rate?: number; // 0-1
  documentation_request_rate?: number; // 0-1
  timely_filing_denial_rate?: number; // 0-1
  underpayment_rate?: number; // 0-1

  total_claims: number;
  total_paid_cents: number;
  total_outstanding_cents: number;

  last_updated_at?: string;
}