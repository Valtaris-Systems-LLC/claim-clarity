/**
 * Denial Intelligence Engine
 *
 * Maps CARC/RARC codes to operational denial categories, severity,
 * recoverability scoring, recommended actions, evidence requirements,
 * work queues, and owner routing.
 *
 * Pure functions only — no I/O, deterministic, suitable for batch scoring
 * or live triage.
 */

import type {
  ClaimIntel,
  DenialCategory,
  DenialEvent,
  DenialSeverity,
  WorkflowOwner,
  WorkQueueId,
  AgingBucket,
} from '@/types/clarity';

// ── CARC/RARC taxonomy ────────────────────────────────────────

export interface DenialTaxonomyEntry {
  carc: string;
  rarc?: string;
  category: DenialCategory;
  base_recoverability: number;
  workflow_owner: WorkflowOwner;
  appeal_eligible: boolean;
  correction_eligible?: boolean;
  resubmission_eligible?: boolean;
  evidence_required: string[];
  description: string;
  recommended_action: string;
  policy_hint?: string;
}

export const DENIAL_TAXONOMY: DenialTaxonomyEntry[] = [
  // Authorization
  {
    carc: '197',
    category: 'authorization',
    base_recoverability: 75,
    workflow_owner: 'auth_team',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: true,
    evidence_required: ['Prior authorization number', 'Medical records', 'Auth request documentation'],
    description: 'Precertification, authorization, or notification is absent.',
    recommended_action: 'Verify whether authorization was obtained. If yes, attach auth reference and resubmit. If not, evaluate retro-auth or appeal path.',
    policy_hint: 'Prior authorization rules',
  },
  {
    carc: '198',
    category: 'authorization',
    base_recoverability: 60,
    workflow_owner: 'auth_team',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: true,
    evidence_required: ['Authorization number', 'Service documentation', 'Medical necessity support'],
    description: 'Precertification or authorization limit was exceeded.',
    recommended_action: 'Request extension or appeal with documentation supporting medical necessity of extended services.',
    policy_hint: 'Authorization extension policy',
  },

  // Eligibility
  {
    carc: '27',
    category: 'eligibility',
    base_recoverability: 35,
    workflow_owner: 'eligibility',
    appeal_eligible: false,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Eligibility verification', 'Member ID card copy'],
    description: 'Expenses were incurred after coverage terminated.',
    recommended_action: 'Re-verify coverage dates. If coverage exists under another plan, redirect to correct payer.',
    policy_hint: 'Eligibility dates',
  },
  {
    carc: '31',
    category: 'eligibility',
    base_recoverability: 40,
    workflow_owner: 'eligibility',
    appeal_eligible: false,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Eligibility verification screenshot', 'Corrected subscriber/member demographics'],
    description: 'Patient cannot be identified as the insured member.',
    recommended_action: 'Confirm member ID, DOB, subscriber, and relationship. Resubmit with corrected demographics.',
    policy_hint: 'Member matching rules',
  },

  // COB
  {
    carc: '22',
    category: 'cob',
    base_recoverability: 85,
    workflow_owner: 'cob_team',
    appeal_eligible: false,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Primary EOB', 'COB questionnaire'],
    description: 'Claim may be covered by another payer under coordination of benefits.',
    recommended_action: 'Obtain primary EOB and resubmit as secondary with COB allocation.',
    policy_hint: 'COB order of benefits',
  },
  {
    carc: '23',
    category: 'cob',
    base_recoverability: 80,
    workflow_owner: 'cob_team',
    appeal_eligible: false,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Primary EOB'],
    description: 'Prior payer adjudication affects this payer’s liability.',
    recommended_action: 'Confirm primary EOB is attached and re-run secondary adjudication.',
    policy_hint: 'Prior payer offset',
  },

  // Modifier
  {
    carc: '4',
    category: 'modifier',
    base_recoverability: 70,
    workflow_owner: 'coder',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Operative note', 'Procedure documentation'],
    description: 'Procedure code is inconsistent with the modifier used or required modifier is missing.',
    recommended_action: 'Coder review: correct modifier and resubmit or appeal with documentation.',
    policy_hint: 'Modifier validation',
  },
  {
    carc: '4',
    rarc: 'M77',
    category: 'modifier',
    base_recoverability: 78,
    workflow_owner: 'coder',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Operative note'],
    description: 'Missing, incomplete, or invalid modifier.',
    recommended_action: 'Add appropriate modifier per CPT/payer rules and resubmit.',
    policy_hint: 'Modifier M77',
  },

  // Duplicate
  {
    carc: '18',
    category: 'duplicate',
    base_recoverability: 20,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: ['Original claim ID', 'Proof of distinct service'],
    description: 'Exact duplicate claim or service.',
    recommended_action: 'Verify prior submission. If true duplicate, write off. If distinct, appeal with proof and appropriate modifier.',
    policy_hint: 'Duplicate claim logic',
  },

  // Medical necessity
  {
    carc: '50',
    category: 'medical_necessity',
    base_recoverability: 55,
    workflow_owner: 'clinical',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: ['Clinical notes', 'Lab results', 'Imaging reports', 'LCD/NCD citation', 'Letter of medical necessity'],
    description: 'Service was denied as not medically necessary.',
    recommended_action: 'Clinical appeal with full chart, supporting policy, and physician letter of medical necessity.',
    policy_hint: 'Medical necessity policy',
  },

  // Missing documentation
  {
    carc: '16',
    rarc: 'N657',
    category: 'missing_documentation',
    base_recoverability: 80,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Operative note', 'Pathology report'],
    description: 'Claim/service lacks information needed for adjudication.',
    recommended_action: 'Identify missing document from payer message, attach, and resubmit within timely filing window.',
    policy_hint: 'Missing document request',
  },
  {
    carc: '16',
    category: 'missing_documentation',
    base_recoverability: 75,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Requested documentation per payer'],
    description: 'Claim lacks required information or contains a submission error.',
    recommended_action: 'Review payer message and resubmit with missing information.',
    policy_hint: 'Claim completion requirements',
  },

  // Timely filing
  {
    carc: '29',
    category: 'timely_filing',
    base_recoverability: 15,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: ['Proof of original submission', 'Clearinghouse acknowledgement'],
    description: 'Time limit for filing has expired.',
    recommended_action: 'If proof of timely original submission exists, appeal with clearinghouse confirmation. Otherwise consider write-off.',
    policy_hint: 'Timely filing limit',
  },

  // Contractual
  {
    carc: '45',
    category: 'contractual',
    base_recoverability: 0,
    workflow_owner: 'biller',
    appeal_eligible: false,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: [],
    description: 'Charge exceeds fee schedule or contracted amount.',
    recommended_action: 'Contractual write-off per fee schedule unless underpayment logic indicates payer paid below contract.',
    policy_hint: 'Contract fee schedule',
  },

  // Bundled
  {
    carc: '97',
    category: 'bundled',
    base_recoverability: 45,
    workflow_owner: 'coder',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Operative note', 'NCCI edit research'],
    description: 'Benefit is included in allowance for another service.',
    recommended_action: 'Verify bundling. If services are distinct, append correct modifier with supporting documentation.',
    policy_hint: 'NCCI bundling',
  },

  // Coding
  {
    carc: '11',
    category: 'coding',
    base_recoverability: 65,
    workflow_owner: 'coder',
    appeal_eligible: true,
    correction_eligible: true,
    resubmission_eligible: true,
    evidence_required: ['Operative note', 'ICD-10 documentation'],
    description: 'Diagnosis is inconsistent with procedure.',
    recommended_action: 'Coder review: align diagnosis with procedure and payer medical policy. Resubmit corrected claim.',
    policy_hint: 'Diagnosis/procedure compatibility',
  },

  // Coverage
  {
    carc: '96',
    rarc: 'N20',
    category: 'coverage',
    base_recoverability: 25,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: ['SPD excerpt', 'Plan benefits'],
    description: 'Non-covered charge.',
    recommended_action: 'Verify benefits. If covered per plan document, appeal with SPD/benefit reference. Otherwise patient bill or write off.',
    policy_hint: 'Benefit coverage',
  },

  // Underpayment marker
  {
    carc: 'UNDERPAY',
    category: 'underpayment',
    base_recoverability: 70,
    workflow_owner: 'biller',
    appeal_eligible: true,
    correction_eligible: false,
    resubmission_eligible: false,
    evidence_required: ['Contract fee schedule', 'EOB'],
    description: 'Paid amount appears below expected contractual rate.',
    recommended_action: 'Open underpayment recovery: cite contract terms and request reprocessing.',
    policy_hint: 'Contract underpayment',
  },
];

export function lookupDenialEntry(carc: string, rarc?: string): DenialTaxonomyEntry | undefined {
  const exact = DENIAL_TAXONOMY.find((entry) => entry.carc === carc && entry.rarc === rarc);
  if (exact) return exact;

  return DENIAL_TAXONOMY.find((entry) => entry.carc === carc && !entry.rarc);
}

// ── Scoring ───────────────────────────────────────────────────

export function computeSeverity(amountAtRiskCents: number, recoverability: number): DenialSeverity {
  const dollars = amountAtRiskCents / 100;

  if (dollars >= 25_000 && recoverability >= 40) return 'critical';
  if (dollars >= 10_000 && recoverability >= 50) return 'critical';
  if (dollars >= 5_000 && recoverability >= 50) return 'critical';
  if (dollars >= 5_000) return 'high';
  if (dollars >= 1_500 && recoverability >= 40) return 'high';
  if (dollars >= 500) return 'medium';

  return 'low';
}

export function adjustRecoverability(
  base: number,
  agingDays: number,
  priorAppealsDenied: number,
  missingEvidenceCount = 0,
): number {
  let score = base;

  if (agingDays > 180) score -= 35;
  else if (agingDays > 120) score -= 25;
  else if (agingDays > 90) score -= 15;
  else if (agingDays > 60) score -= 8;
  else if (agingDays > 30) score -= 3;
  else score += 4;

  score -= priorAppealsDenied * 12;
  score -= Math.min(4, missingEvidenceCount) * 6;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}

export function deriveQueues(
  intel: Pick<
    ClaimIntel,
    | 'reimbursement_state'
    | 'amount_at_risk_cents'
    | 'underpayment_cents'
    | 'evidence_missing'
    | 'appeals'
    | 'aging_days'
    | 'is_escalated'
    | 'is_stalled'
    | 'denial_events'
  >,
): WorkQueueId[] {
  const queues: WorkQueueId[] = [];

  if (
    intel.denial_events.length > 0 &&
    intel.reimbursement_state !== 'resolved' &&
    intel.reimbursement_state !== 'paid'
  ) {
    queues.push('unresolved_denials');
  }

  if (intel.amount_at_risk_cents >= 250_000) queues.push('high_value');

  if (intel.underpayment_cents > 0) queues.push('underpayment_review');

  if (intel.denial_events.some((event) => event.category === 'cob')) queues.push('cob_review');

  if (
    intel.appeals.some(
      (appeal) =>
        appeal.status === 'submitted' ||
        appeal.status === 'in_review' ||
        appeal.status === 'draft',
    )
  ) {
    queues.push('appeals_in_progress');
  }

  if (intel.evidence_missing.length > 0) queues.push('missing_docs');
  if (intel.is_stalled) queues.push('stalled');
  if (intel.is_escalated) queues.push('escalation');
  if (intel.aging_days >= 60) queues.push('aging');
  if (intel.aging_days >= 100) queues.push('timely_filing_risk');

  if (intel.reimbursement_state === 'pending_payer' && intel.aging_days >= 21) {
    queues.push('payer_follow_up');
  }

  return Array.from(new Set(queues));
}

export function computeSlaDueAt(submittedAt: string, severity: DenialSeverity): string {
  const baseDays = severity === 'critical' ? 2 : severity === 'high' ? 5 : severity === 'medium' ? 10 : 21;
  const date = new Date(submittedAt);
  date.setDate(date.getDate() + baseDays);
  return date.toISOString();
}

export function scoreDenial(args: {
  denial_id: string;
  claim_id: string;
  line_id?: string;
  occurred_at: string;
  carc: string;
  rarc?: string;
  group_code: DenialEvent['group_code'];
  amount_cents: number;
  payer_message?: string;
  aging_days: number;
  prior_appeals_denied?: number;
  missing_evidence_count?: number;
}): DenialEvent {
  const entry =
    lookupDenialEntry(args.carc, args.rarc) ?? {
      carc: args.carc,
      category: 'unknown' as DenialCategory,
      base_recoverability: 30,
      workflow_owner: 'biller' as WorkflowOwner,
      appeal_eligible: true,
      correction_eligible: false,
      resubmission_eligible: false,
      evidence_required: ['Payer message review'],
      description: `Unmapped denial CARC ${args.carc}${args.rarc ? ` / RARC ${args.rarc}` : ''}`,
      recommended_action: 'Research payer denial reason and determine correction, appeal, or write-off path.',
      policy_hint: 'Unmapped payer reason',
    };

  const recoverability = adjustRecoverability(
    entry.base_recoverability,
    args.aging_days,
    args.prior_appeals_denied ?? 0,
    args.missing_evidence_count ?? 0,
  );

  const severity = computeSeverity(args.amount_cents, recoverability);

  return {
    denial_id: args.denial_id,
    claim_id: args.claim_id,
    line_id: args.line_id,
    occurred_at: args.occurred_at,
    carc_code: args.carc,
    rarc_code: args.rarc,
    group_code: args.group_code,
    amount_cents: args.amount_cents,
    category: entry.category,
    severity,
    recoverability_score: recoverability,
    root_cause: entry.description,
    recommended_action: entry.recommended_action,
    workflow_owner: entry.workflow_owner,
    appeal_eligible: entry.appeal_eligible,
    correction_eligible: entry.correction_eligible,
    resubmission_eligible: entry.resubmission_eligible,
    evidence_required: entry.evidence_required,
    payer_message: args.payer_message,
    policy_ref: entry.policy_hint,
  };
}

export const CATEGORY_LABEL: Record<DenialCategory, string> = {
  authorization: 'Authorization',
  eligibility: 'Eligibility',
  cob: 'Coordination of Benefits',
  modifier: 'Modifier',
  duplicate: 'Duplicate',
  medical_necessity: 'Medical Necessity',
  missing_documentation: 'Missing Documentation',
  timely_filing: 'Timely Filing',
  contractual: 'Contractual',
  bundled: 'Bundled / NCCI',
  coding: 'Coding',
  coverage: 'Coverage',
  underpayment: 'Underpayment',
  coordination_of_benefits: 'Coordination of Benefits',
  benefit_limit: 'Benefit Limit',
  medical_record_request: 'Medical Record Request',
  unknown: 'Unknown',
};

export const SEVERITY_LABEL: Record<DenialSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const QUEUE_LABEL: Record<WorkQueueId, string> = {
  unresolved_denials: 'Unresolved Denials',
  high_value: 'High-Value Claims',
  appeals_in_progress: 'Appeals in Progress',
  missing_docs: 'Missing Documentation',
  stalled: 'Stalled Reimbursements',
  escalation: 'Escalation Required',
  aging: 'Aging Claims',
  payer_follow_up: 'Payer Follow-up',
  underpayment_review: 'Underpayment Review',
  cob_review: 'COB Review',
  timely_filing_risk: 'Timely Filing Risk',
};

export const OWNER_LABEL: Record<WorkflowOwner, string> = {
  biller: 'Billing',
  coder: 'Coding',
  auth_team: 'Authorization',
  clinical: 'Clinical',
  appeals: 'Appeals',
  cob_team: 'COB',
  eligibility: 'Eligibility',
  payer_relations: 'Payer Relations',
  supervisor: 'Supervisor',
  unassigned: 'Unassigned',
};