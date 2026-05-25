/**
 * Recovery Playbook Engine
 *
 * For every denial category, a playbook defines the recommended
 * sequence of operational moves, required evidence, appeal strategy,
 * effort estimate, and expected recovery probability.
 */

import type { DenialCategory, DenialEvent, ClaimIntel } from '@/types/clarity';
import type { Claim } from '@/types/claim';

export type Effort = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PlaybookStep {
  order: number;
  action: string;
  owner: string;
  rationale: string;
}

export interface Playbook {
  category: DenialCategory;
  title: string;
  summary: string;
  base_recovery_probability: number;
  effort: Effort;
  estimated_minutes: number;
  required_evidence: string[];
  appeal_strategy: string;
  steps: PlaybookStep[];
  escalation_path: string;
}

const PB = (p: Playbook): Playbook => p;

export const PLAYBOOKS: Record<DenialCategory, Playbook> = {
  authorization: PB({
    category: 'authorization',
    title: 'Missing / Invalid Authorization',
    summary: 'Recover claims denied for missing precertification by surfacing existing auth or filing a retro-auth.',
    base_recovery_probability: 0.72,
    effort: 'MEDIUM',
    estimated_minutes: 35,
    required_evidence: ['Prior authorization number', 'Auth request documentation', 'Medical records supporting necessity'],
    appeal_strategy: 'Reconsideration with attached auth reference; if no auth exists, file retro-auth with clinical justification before formal appeal.',
    steps: [
      { order: 1, action: 'Search EMR and payer portal for existing auth covering DOS.', owner: 'Authorization Team', rationale: 'Many auth denials are administrative.' },
      { order: 2, action: 'Attach authorization reference and resubmit corrected claim.', owner: 'Billing', rationale: 'Fastest recovery path.' },
      { order: 3, action: 'If no auth exists, request retro-auth with clinical documentation.', owner: 'Clinical Liaison', rationale: 'Creates an appealable administrative record.' },
    ],
    escalation_path: 'Escalate to payer provider rep after failed retro-auth or repeated denial.',
  }),

  medical_necessity: PB({
    category: 'medical_necessity',
    title: 'Medical Necessity Denial',
    summary: 'Clinical appeal supported by LCD/NCD citations, payer policy, and physician rationale.',
    base_recovery_probability: 0.55,
    effort: 'HIGH',
    estimated_minutes: 90,
    required_evidence: ['Complete clinical chart', 'Physician letter of medical necessity', 'LCD/NCD citation', 'Payer medical policy'],
    appeal_strategy: 'Submit clinical appeal; if denied, escalate to peer-to-peer review.',
    steps: [
      { order: 1, action: 'Pull complete clinical chart.', owner: 'Clinical Liaison', rationale: 'Partial documentation weakens the appeal.' },
      { order: 2, action: 'Cite applicable LCD/NCD or payer policy.', owner: 'Clinical', rationale: 'Policy citation creates objective appeal footing.' },
      { order: 3, action: 'Submit physician-supported appeal packet.', owner: 'Appeals', rationale: 'Medical necessity denials need clinical authority.' },
    ],
    escalation_path: 'Peer-to-peer review, external review, or payer medical director escalation.',
  }),

  timely_filing: PB({
    category: 'timely_filing',
    title: 'Timely Filing',
    summary: 'Recoverable only when proof of timely original submission exists.',
    base_recovery_probability: 0.18,
    effort: 'LOW',
    estimated_minutes: 15,
    required_evidence: ['Clearinghouse acknowledgement', 'Original claim image', 'Payer EDI receipt'],
    appeal_strategy: 'Appeal only with proof of original timely submission.',
    steps: [
      { order: 1, action: 'Pull clearinghouse acknowledgement.', owner: 'Billing', rationale: 'Proof is required to overturn filing denial.' },
      { order: 2, action: 'Appeal with EDI receipt if available.', owner: 'Appeals', rationale: 'Payer denial can be reversed with submission proof.' },
      { order: 3, action: 'If no proof exists, write off and root-cause.', owner: 'Billing Lead', rationale: 'Low ROI without evidence.' },
    ],
    escalation_path: 'Provider rep dispute if payer denies receipt despite clearinghouse proof.',
  }),

  missing_documentation: PB({
    category: 'missing_documentation',
    title: 'Documentation Deficiency',
    summary: 'Identify missing documentation, attach it, and resubmit within the filing window.',
    base_recovery_probability: 0.8,
    effort: 'LOW',
    estimated_minutes: 20,
    required_evidence: ['Requested documentation per payer', 'Operative note', 'Itemized bill', 'Medical records'],
    appeal_strategy: 'Corrected resubmission is preferred before formal appeal.',
    steps: [
      { order: 1, action: 'Read payer message/RARC to identify exact missing item.', owner: 'Billing', rationale: 'Avoids guessing.' },
      { order: 2, action: 'Retrieve documentation from HIM/EMR.', owner: 'HIM', rationale: 'Evidence completion is the blocker.' },
      { order: 3, action: 'Resubmit corrected claim with attachment.', owner: 'Billing', rationale: 'Usually faster than appeal.' },
    ],
    escalation_path: 'Escalate to payer rep if corrected claim is rejected again.',
  }),

  medical_record_request: PB({
    category: 'medical_record_request',
    title: 'Medical Record Request',
    summary: 'Payer requested records before adjudication can continue.',
    base_recovery_probability: 0.78,
    effort: 'MEDIUM',
    estimated_minutes: 30,
    required_evidence: ['Medical records', 'Clinical notes', 'Operative note', 'Payer request letter'],
    appeal_strategy: 'Not an appeal yet — complete the record request and track response.',
    steps: [
      { order: 1, action: 'Identify requested record scope.', owner: 'HIM', rationale: 'Over/under-sending records can delay payment.' },
      { order: 2, action: 'Attach records with claim and payer request reference.', owner: 'Billing', rationale: 'Creates clean audit trail.' },
      { order: 3, action: 'Set payer follow-up date.', owner: 'Billing', rationale: 'Record requests can stall without follow-up.' },
    ],
    escalation_path: 'Escalate to payer rep if no adjudication after records are supplied.',
  }),

  coding: PB({
    category: 'coding',
    title: 'Coding Error',
    summary: 'Coder review of diagnosis/procedure alignment, then corrected resubmission.',
    base_recovery_probability: 0.68,
    effort: 'MEDIUM',
    estimated_minutes: 30,
    required_evidence: ['Operative note', 'ICD-10 documentation', 'Coding worksheet'],
    appeal_strategy: 'Corrected claim first; appeal only if corrected claim is rejected.',
    steps: [
      { order: 1, action: 'Review diagnosis/procedure linkage.', owner: 'Coding QA', rationale: 'Most coding denials are correctable.' },
      { order: 2, action: 'Resubmit corrected claim.', owner: 'Billing', rationale: 'Avoids unnecessary appeal queue.' },
      { order: 3, action: 'Appeal with coder narrative if rejected.', owner: 'Appeals', rationale: 'Creates payer-facing rationale.' },
    ],
    escalation_path: 'Compliance review for repeated payer disagreement.',
  }),

  eligibility: PB({
    category: 'eligibility',
    title: 'Eligibility Dispute',
    summary: 'Re-verify coverage, correct demographics, or redirect to correct payer.',
    base_recovery_probability: 0.35,
    effort: 'LOW',
    estimated_minutes: 18,
    required_evidence: ['Eligibility verification', 'Member ID card', 'Subscriber confirmation'],
    appeal_strategy: 'Eligibility appeals rarely succeed; correction or redirection is usually better.',
    steps: [
      { order: 1, action: 'Re-run eligibility for DOS.', owner: 'Eligibility', rationale: 'Verifies coverage reality.' },
      { order: 2, action: 'Correct member/subscriber data.', owner: 'Billing', rationale: 'Fixes demographic mismatch.' },
      { order: 3, action: 'Redirect to active payer if terminated.', owner: 'Patient Access', rationale: 'Protects timely filing.' },
    ],
    escalation_path: 'Patient Access workflow review.',
  }),

  cob: PB({
    category: 'cob',
    title: 'Coordination of Benefits',
    summary: 'Obtain primary EOB and resubmit as secondary with proper COB allocation.',
    base_recovery_probability: 0.82,
    effort: 'MEDIUM',
    estimated_minutes: 40,
    required_evidence: ['Primary EOB', 'COB questionnaire', 'Coverage hierarchy verification'],
    appeal_strategy: 'COB denials typically resolve through secondary resubmission with primary EOB.',
    steps: [
      { order: 1, action: 'Identify primary payer.', owner: 'COB', rationale: 'COB denial usually means payer order is unresolved.' },
      { order: 2, action: 'Obtain primary EOB.', owner: 'COB', rationale: 'Required for secondary adjudication.' },
      { order: 3, action: 'Resubmit secondary claim with primary allocation.', owner: 'Billing', rationale: 'Triggers secondary payment logic.' },
    ],
    escalation_path: 'Payer rep escalation if secondary denies despite valid primary EOB.',
  }),

  coordination_of_benefits: PB({
    category: 'coordination_of_benefits',
    title: 'Coordination of Benefits',
    summary: 'Resolve payer primacy and submit primary EOB for secondary adjudication.',
    base_recovery_probability: 0.82,
    effort: 'MEDIUM',
    estimated_minutes: 40,
    required_evidence: ['Primary EOB', 'COB questionnaire', 'Coverage hierarchy verification'],
    appeal_strategy: 'Resolve COB documentation before formal appeal.',
    steps: [
      { order: 1, action: 'Confirm payer order.', owner: 'COB', rationale: 'Primacy controls adjudication.' },
      { order: 2, action: 'Attach primary EOB.', owner: 'COB', rationale: 'Secondary payer needs prior payer result.' },
      { order: 3, action: 'Resubmit with COB allocation.', owner: 'Billing', rationale: 'Best recovery path.' },
    ],
    escalation_path: 'Escalate persistent COB mismatch to payer rep.',
  }),

  modifier: PB({
    category: 'modifier',
    title: 'Modifier Error',
    summary: 'Coder review for correct modifier and corrected resubmission.',
    base_recovery_probability: 0.74,
    effort: 'LOW',
    estimated_minutes: 22,
    required_evidence: ['Operative note', 'CPT modifier guidance', 'NCCI edit lookup'],
    appeal_strategy: 'Resubmit corrected with appropriate modifier before appeal.',
    steps: [
      { order: 1, action: 'Confirm correct modifier.', owner: 'Coding', rationale: 'Most modifier denials are clerical or rule-based.' },
      { order: 2, action: 'Resubmit corrected claim.', owner: 'Billing', rationale: 'Faster than appeal.' },
    ],
    escalation_path: 'Coding compliance review for repeated payer disagreement.',
  }),

  duplicate: PB({
    category: 'duplicate',
    title: 'Duplicate Claim',
    summary: 'Confirm true duplicate vs distinct repeat service.',
    base_recovery_probability: 0.3,
    effort: 'LOW',
    estimated_minutes: 12,
    required_evidence: ['Original claim ID', 'Service documentation proving distinct event'],
    appeal_strategy: 'Only pursue if documentation proves service is distinct.',
    steps: [
      { order: 1, action: 'Compare against prior submission.', owner: 'Billing', rationale: 'Determines true duplicate.' },
      { order: 2, action: 'If distinct, resubmit with appropriate modifier/documentation.', owner: 'Coding', rationale: 'Creates payable distinction.' },
      { order: 3, action: 'If true duplicate, write off.', owner: 'Billing Lead', rationale: 'No recovery path.' },
    ],
    escalation_path: 'None unless payer incorrectly groups separate services.',
  }),

  contractual: PB({
    category: 'contractual',
    title: 'Contractual Adjustment',
    summary: 'Write off unless paid amount is below contract.',
    base_recovery_probability: 0.05,
    effort: 'LOW',
    estimated_minutes: 5,
    required_evidence: ['Contract fee schedule'],
    appeal_strategy: 'No appeal unless underpayment is detected.',
    steps: [
      { order: 1, action: 'Verify payment against contract.', owner: 'Contract Mgmt', rationale: 'Separates correct adjustment from underpayment.' },
      { order: 2, action: 'Post adjustment or open underpayment dispute.', owner: 'Billing', rationale: 'Correct closure path.' },
    ],
    escalation_path: 'Contracting review for systemic variance.',
  }),

  bundled: PB({
    category: 'bundled',
    title: 'NCCI Bundling',
    summary: 'If clinically distinct, append correct modifier with documentation.',
    base_recovery_probability: 0.48,
    effort: 'MEDIUM',
    estimated_minutes: 30,
    required_evidence: ['Operative note', 'NCCI edit research', 'Anatomic / temporal distinction notes'],
    appeal_strategy: 'Corrected resubmission with unbundling rationale.',
    steps: [
      { order: 1, action: 'Confirm whether edit is overrideable.', owner: 'Coding QA', rationale: 'Some edits cannot be overridden.' },
      { order: 2, action: 'Append appropriate modifier with documentation.', owner: 'Coding', rationale: 'Supports distinct service.' },
      { order: 3, action: 'Resubmit corrected claim.', owner: 'Billing', rationale: 'Best first action.' },
    ],
    escalation_path: 'Compliance review for systemic bundling disputes.',
  }),

  coverage: PB({
    category: 'coverage',
    title: 'Non-Covered Service',
    summary: 'Verify plan benefit language and appeal only when plan supports coverage.',
    base_recovery_probability: 0.25,
    effort: 'MEDIUM',
    estimated_minutes: 30,
    required_evidence: ['Summary Plan Description excerpt', 'Plan benefit grid'],
    appeal_strategy: 'Appeal with plan document support; otherwise bill patient or write off.',
    steps: [
      { order: 1, action: 'Pull SPD/benefit evidence.', owner: 'Billing', rationale: 'Coverage is governed by plan language.' },
      { order: 2, action: 'Appeal if benefit language supports coverage.', owner: 'Appeals', rationale: 'Plan-document appeals are strongest.' },
      { order: 3, action: 'Route to patient responsibility/write-off if excluded.', owner: 'Billing', rationale: 'Avoids limbo.' },
    ],
    escalation_path: 'External review for plan-document disputes.',
  }),

  benefit_limit: PB({
    category: 'benefit_limit',
    title: 'Benefit Limit',
    summary: 'Validate whether the plan limit was applied correctly.',
    base_recovery_probability: 0.22,
    effort: 'MEDIUM',
    estimated_minutes: 25,
    required_evidence: ['Benefit maximum', 'Accumulator history', 'Plan document'],
    appeal_strategy: 'Appeal only if payer misapplied accumulator or limit.',
    steps: [
      { order: 1, action: 'Verify benefit maximum and accumulator.', owner: 'Billing', rationale: 'Determines if limit is real.' },
      { order: 2, action: 'Appeal with accumulator evidence if incorrect.', owner: 'Appeals', rationale: 'Shows payer math error.' },
      { order: 3, action: 'Close if benefit exhausted correctly.', owner: 'Billing', rationale: 'No recovery path.' },
    ],
    escalation_path: 'Plan sponsor/payer rep if accumulator mismatch persists.',
  }),

  underpayment: PB({
    category: 'underpayment',
    title: 'Underpayment Recovery',
    summary: 'Cite contract fee schedule and request reprocessing for variance.',
    base_recovery_probability: 0.7,
    effort: 'MEDIUM',
    estimated_minutes: 25,
    required_evidence: ['Contract fee schedule', 'EOB / 835', 'Variance calculation'],
    appeal_strategy: 'Contractual dispute, not clinical appeal.',
    steps: [
      { order: 1, action: 'Compute contracted allowable vs paid.', owner: 'Contract Mgmt', rationale: 'Quantifies dispute.' },
      { order: 2, action: 'Submit underpayment dispute.', owner: 'Billing', rationale: 'Requests reprocessing.' },
      { order: 3, action: 'Escalate if not reprocessed in 30 days.', owner: 'Revenue Cycle Lead', rationale: 'Prevents aging underpayments.' },
    ],
    escalation_path: 'JOC / payer contracting team for recurring variance.',
  }),

  unknown: PB({
    category: 'unknown',
    title: 'Unmapped Denial',
    summary: 'Research payer message and classify before pursuing.',
    base_recovery_probability: 0.3,
    effort: 'MEDIUM',
    estimated_minutes: 20,
    required_evidence: ['Payer message', 'EOB / 835', 'Claim image'],
    appeal_strategy: 'Do not appeal blindly; classify root cause first.',
    steps: [
      { order: 1, action: 'Review payer message and EOB detail.', owner: 'Billing', rationale: 'Unknown denials need classification.' },
      { order: 2, action: 'Map to operational category.', owner: 'Billing Lead', rationale: 'Routes work correctly.' },
      { order: 3, action: 'Apply matching playbook.', owner: 'Assigned Owner', rationale: 'Prevents generic appeals.' },
    ],
    escalation_path: 'Add mapping to denial taxonomy once root cause is confirmed.',
  }),
};

export interface PlaybookRecommendation {
  playbook: Playbook;
  expected_recovery_probability: number;
  adjustment_factors: Array<{ label: string; delta: number; detail: string }>;
  effort: Effort;
  estimated_minutes: number;
  identified_gaps: string[];
  confidence_band: 'LOW' | 'MEDIUM' | 'HIGH';
  expected_recovery_cents: number;
}

export function recommendPlaybook(
  claim: Claim & { intel: ClaimIntel },
  denial?: DenialEvent,
): PlaybookRecommendation | null {
  const primary = denial ?? claim.intel.denial_events[0];
  if (!primary) return null;

  const pb = PLAYBOOKS[primary.category] ?? PLAYBOOKS.unknown;
  const adjustments: PlaybookRecommendation['adjustment_factors'] = [];

  let probability = pb.base_recovery_probability;

  if (claim.intel.aging_days > 120) {
    adjustments.push({ label: 'Aging', delta: -0.2, detail: `${claim.intel.aging_days} days old` });
    probability -= 0.2;
  } else if (claim.intel.aging_days > 90) {
    adjustments.push({ label: 'Aging', delta: -0.1, detail: `${claim.intel.aging_days} days old` });
    probability -= 0.1;
  } else if (claim.intel.aging_days < 30) {
    adjustments.push({ label: 'Aging', delta: 0.05, detail: 'Fresh claim with full appeal window' });
    probability += 0.05;
  }

  const evidenceMissing = claim.intel.evidence_missing.length;

  if (evidenceMissing > 0) {
    const penalty = Math.min(0.2, evidenceMissing * 0.05);
    adjustments.push({ label: 'Evidence Gap', delta: -penalty, detail: `${evidenceMissing} evidence item(s) missing` });
    probability -= penalty;
  } else {
    adjustments.push({ label: 'Evidence Complete', delta: 0.05, detail: 'Required documentation already present' });
    probability += 0.05;
  }

  const priorDenied = claim.intel.appeals.filter((a) => a.status === 'denied').length;
  const priorApproved = claim.intel.appeals.filter((a) => a.status === 'approved').length;

  if (priorDenied > 0) {
    const penalty = Math.min(0.3, priorDenied * 0.1);
    adjustments.push({ label: 'Appeal Fatigue', delta: -penalty, detail: `${priorDenied} prior denied appeal(s)` });
    probability -= penalty;
  }

  if (priorApproved > 0) {
    const boost = Math.min(0.15, priorApproved * 0.05);
    adjustments.push({ label: 'Historical Success', delta: boost, detail: `${priorApproved} successful appeal(s)` });
    probability += boost;
  }

  if (claim.intel.amount_at_risk_cents >= 500_000) {
    adjustments.push({ label: 'High Value Claim', delta: 0.05, detail: 'Operational priority and management attention' });
    probability += 0.05;
  }

  if (claim.intel.payer_class === 'medicare') {
    adjustments.push({ label: 'Payer Behavior', delta: 0.03, detail: 'Medicare adjudication tends to be predictable' });
    probability += 0.03;
  }

  if (claim.intel.payer_class === 'medicaid') {
    adjustments.push({ label: 'Payer Behavior', delta: -0.05, detail: 'Medicaid often requires additional documentation' });
    probability -= 0.05;
  }

  if (claim.intel.payer_class === 'commercial') {
    adjustments.push({ label: 'Payer Behavior', delta: 0.02, detail: 'Commercial payer appeal paths available' });
    probability += 0.02;
  }

  if (primary.recoverability_score >= 80) {
    adjustments.push({ label: 'Recoverability', delta: 0.05, detail: 'Strong denial recovery profile' });
    probability += 0.05;
  }

  if (primary.recoverability_score <= 25) {
    adjustments.push({ label: 'Recoverability', delta: -0.1, detail: 'Historically difficult denial type' });
    probability -= 0.1;
  }

  probability = Math.max(0, Math.min(1, probability));

  const identified_gaps = pb.required_evidence.filter((req) =>
    claim.intel.evidence_missing.some((missing) =>
      missing.toLowerCase().includes(req.split(' ')[0].toLowerCase()),
    ),
  );

  const confidence_band =
    probability >= 0.7 ? 'HIGH' : probability >= 0.4 ? 'MEDIUM' : 'LOW';

  return {
    playbook: pb,
    expected_recovery_probability: probability,
    adjustment_factors: adjustments,
    effort: pb.effort,
    estimated_minutes: pb.estimated_minutes,
    identified_gaps,
    confidence_band,
    expected_recovery_cents: Math.round(claim.intel.amount_at_risk_cents * probability),
  };
}

export const EFFORT_CLS: Record<Effort, string> = {
  LOW: 'bg-status-paid/10 text-status-paid border-status-paid/30',
  MEDIUM: 'bg-status-pending/10 text-status-pending border-status-pending/30',
  HIGH: 'bg-status-denied/10 text-status-denied border-status-denied/30',
};