import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialEvent, WorkflowOwner } from '@/types/clarity';
import { explainRecoverability } from './recoverability';
import { recommendPlaybook } from './playbooks';
import { slaStatus } from '@/hooks/use-clarity-data';

export type ActionKind =
  | 'gather_authorization'
  | 'request_documentation'
  | 'correct_and_resubmit'
  | 'obtain_primary_eob'
  | 'file_appeal'
  | 'peer_to_peer'
  | 'escalate_internal'
  | 'escalate_payer_rep'
  | 'underpayment_dispute'
  | 'close_writeoff'
  | 'monitor';

export type ActionUrgency = 'now' | 'this_week' | 'this_month' | 'when_able';

export interface NextBestAction {
  kind: ActionKind;
  headline: string;
  owner: string;
  owner_key?: WorkflowOwner;
  why: string[];
  expected_value_cents: number;
  expected_probability: number;
  evidence_refs: string[];
  urgency: ActionUrgency;
  effort_minutes: number;
  confidence: number;
  blockers: string[];
  success_criteria: string[];
}

type C = Claim & { intel: ClaimIntel };

const KIND_LABEL: Record<ActionKind, string> = {
  gather_authorization: 'Gather Authorization',
  request_documentation: 'Request Documentation',
  correct_and_resubmit: 'Correct & Resubmit',
  obtain_primary_eob: 'Obtain Primary EOB',
  file_appeal: 'File Appeal',
  peer_to_peer: 'Schedule Peer-to-Peer',
  escalate_internal: 'Escalate Internally',
  escalate_payer_rep: 'Escalate to Payer Rep',
  underpayment_dispute: 'Open Underpayment Dispute',
  close_writeoff: 'Close — Write Off',
  monitor: 'Monitor',
};

export function actionLabel(kind: ActionKind): string {
  return KIND_LABEL[kind];
}

function dollars(cents: number): string {
  return Math.round(cents / 100).toLocaleString();
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function confidenceFromSignals(args: {
  probability: number;
  evidenceMissing: number;
  agingDays: number;
  hasPlaybook: boolean;
  hasDenial: boolean;
  hasClearPath: boolean;
}): number {
  let score = args.probability * 100;

  if (args.hasPlaybook) score += 8;
  if (args.hasDenial) score += 6;
  if (args.hasClearPath) score += 5;
  if (args.evidenceMissing > 0) score -= Math.min(25, args.evidenceMissing * 7);
  if (args.agingDays > 120) score -= 18;
  else if (args.agingDays > 90) score -= 10;

  return Math.max(5, Math.min(99, Math.round(score)));
}

function buildBlockers(intel: ClaimIntel, primary?: DenialEvent): string[] {
  const blockers: string[] = [];

  if (intel.evidence_missing.length > 0) {
    blockers.push(`Missing evidence: ${intel.evidence_missing.slice(0, 3).join(', ')}`);
  }

  if (intel.aging_days > 120) {
    blockers.push('Claim is beyond 120 days and may face timely filing or appeal-window limits.');
  }

  if (
    primary &&
    !primary.appeal_eligible &&
    !primary.correction_eligible &&
    !primary.resubmission_eligible
  ) {
    blockers.push('Denial is not marked appeal, correction, or resubmission eligible.');
  }

  if (intel.appeals.some((appeal) => appeal.status === 'denied')) {
    blockers.push('Prior denied appeal raises the evidence threshold.');
  }

  return blockers;
}

function baseSuccessCriteria(kind: ActionKind): string[] {
  switch (kind) {
    case 'gather_authorization':
      return ['Authorization reference found or retro-auth request submitted.', 'Auth evidence attached to packet.'];
    case 'request_documentation':
      return ['All required evidence attached.', 'Claim ready for appeal, correction, or resubmission.'];
    case 'correct_and_resubmit':
      return ['Corrected claim submitted.', 'New payer acknowledgement received.'];
    case 'obtain_primary_eob':
      return ['Primary EOB attached.', 'Secondary COB resubmission can proceed.'];
    case 'file_appeal':
      return ['Appeal packet submitted.', 'Tracking date and payer confirmation captured.'];
    case 'peer_to_peer':
      return ['Peer-to-peer scheduled.', 'Clinical rationale documented.'];
    case 'escalate_internal':
      return ['Operations lead assigned.', 'Follow-up owner and deadline documented.'];
    case 'escalate_payer_rep':
      return ['Payer representative contacted.', 'Case reference and next response date captured.'];
    case 'underpayment_dispute':
      return ['Contract variance documented.', 'Reprocessing request sent to payer.'];
    case 'close_writeoff':
      return ['Write-off reason documented.', 'No remaining recovery path exists.'];
    case 'monitor':
      return ['Next follow-up date set.', 'Claim remains in active monitoring queue.'];
  }
}

function wrap(
  payload: Omit<NextBestAction, 'confidence' | 'blockers' | 'success_criteria'>,
  ctx: {
    intel: ClaimIntel;
    primary?: DenialEvent;
    probability: number;
    hasPlaybook: boolean;
  },
): NextBestAction {
  const hasClearPath = Boolean(
    ctx.primary?.appeal_eligible ||
      ctx.primary?.correction_eligible ||
      ctx.primary?.resubmission_eligible ||
      payload.kind === 'underpayment_dispute' ||
      payload.kind === 'monitor',
  );

  return {
    ...payload,
    expected_probability: clampProbability(payload.expected_probability),
    confidence: confidenceFromSignals({
      probability: ctx.probability,
      evidenceMissing: ctx.intel.evidence_missing.length,
      agingDays: ctx.intel.aging_days,
      hasPlaybook: ctx.hasPlaybook,
      hasDenial: Boolean(ctx.primary),
      hasClearPath,
    }),
    blockers: buildBlockers(ctx.intel, ctx.primary),
    success_criteria: baseSuccessCriteria(payload.kind),
  };
}

function urgencyFromSlaAndRisk(intel: ClaimIntel): ActionUrgency {
  const sla = slaStatus(intel.sla_due_at);

  if (sla.tone === 'breach') return 'now';
  if (intel.is_escalated || intel.is_stalled) return 'now';
  if (intel.severity === 'critical') return 'now';
  if (sla.tone === 'warn') return 'this_week';
  if (intel.aging_days >= 90) return 'this_week';
  if (intel.amount_at_risk_cents >= 250_000) return 'this_week';

  return 'this_month';
}

export function nextBestAction(claim: C, denial?: DenialEvent): NextBestAction {
  const intel = claim.intel;
  const primary = denial ?? intel.denial_events[0];
  const recovery = explainRecoverability(claim);
  const playbook = primary ? recommendPlaybook(claim, primary) : null;

  const probability = clampProbability(
    playbook?.expected_recovery_probability ??
      (primary ? primary.recoverability_score / 100 : recovery.score / 100),
  );

  const expectedValue = Math.round(intel.amount_at_risk_cents * probability);
  const urgency = urgencyFromSlaAndRisk(intel);
  const hasPlaybook = Boolean(playbook);
  const why: string[] = [];

  if (!primary) {
    return wrap(
      {
        kind: 'monitor',
        headline: intel.is_stalled
          ? 'Follow up with payer — clean claim is stalled.'
          : 'Monitor payer response.',
        owner: 'Billing',
        owner_key: 'biller',
        why: [
          'No denial event is recorded.',
          `Current reimbursement state: ${intel.reimbursement_state}.`,
          intel.is_stalled ? 'Claim is flagged as stalled.' : 'No corrective action is needed yet.',
        ],
        expected_value_cents: 0,
        expected_probability: 0,
        evidence_refs: [],
        urgency: intel.is_stalled || intel.aging_days >= 21 ? 'this_week' : 'when_able',
        effort_minutes: intel.is_stalled ? 15 : 5,
      },
      { intel, primary, probability: 0, hasPlaybook: false },
    );
  }

  if (intel.underpayment_cents > 0) {
    why.push(`Paid amount is $${dollars(intel.underpayment_cents)} below expected reimbursement.`);
    why.push('Underpayment recovery can proceed as a contract/reprocessing dispute.');
    why.push('Contract, EOB, and variance calculation should be attached.');

    return wrap(
      {
        kind: 'underpayment_dispute',
        headline: 'Open underpayment dispute — cite contract variance.',
        owner: 'Contract Management',
        owner_key: 'payer_relations',
        why,
        expected_value_cents: intel.underpayment_cents,
        expected_probability: 0.7,
        evidence_refs: ['Contract fee schedule', 'EOB / 835', 'Variance calculation'],
        urgency: urgency === 'when_able' ? 'this_week' : urgency,
        effort_minutes: 25,
      },
      { intel, primary, probability: 0.7, hasPlaybook },
    );
  }

  if (
    primary.category === 'timely_filing' &&
    intel.aging_days > 120 &&
    intel.evidence_missing.length > 0
  ) {
    why.push(`Claim is ${intel.aging_days}d old and faces deadline pressure.`);
    why.push('Proof of timely original submission is missing.');
    why.push('Recovery path is weak unless submission proof exists.');

    return wrap(
      {
        kind: 'close_writeoff',
        headline: 'Review for write-off unless timely filing proof exists.',
        owner: 'Billing Lead',
        owner_key: 'supervisor',
        why,
        expected_value_cents: Math.round(intel.amount_at_risk_cents * 0.05),
        expected_probability: 0.05,
        evidence_refs: ['Proof of timely original submission', 'Clearinghouse acknowledgement'],
        urgency: 'this_week',
        effort_minutes: 8,
      },
      { intel, primary, probability: 0.05, hasPlaybook },
    );
  }

  if (primary.category === 'contractual' && intel.underpayment_cents <= 0) {
    why.push('Adjustment appears contractual.');
    why.push('No underpayment variance is detected.');
    why.push('Appeal is not indicated unless contract evidence shows payer error.');

    return wrap(
      {
        kind: 'close_writeoff',
        headline: 'Post contractual adjustment — no appeal indicated.',
        owner: 'Billing',
        owner_key: 'biller',
        why,
        expected_value_cents: 0,
        expected_probability: 0,
        evidence_refs: ['Contract fee schedule'],
        urgency: 'when_able',
        effort_minutes: 3,
      },
      { intel, primary, probability: 0, hasPlaybook },
    );
  }

  if (primary.category === 'cob' || primary.category === 'coordination_of_benefits') {
    why.push('Denial indicates coordination-of-benefits friction.');
    why.push('Secondary payment cannot proceed without primary payer allocation.');
    why.push(`Expected recovery probability is ${Math.round(probability * 100)}%.`);

    return wrap(
      {
        kind: 'obtain_primary_eob',
        headline: 'Obtain primary EOB, then resubmit as secondary.',
        owner: 'COB Team',
        owner_key: 'cob_team',
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: ['Primary EOB', 'COB questionnaire', ...primary.evidence_required],
        urgency,
        effort_minutes: 40,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  if (primary.category === 'authorization') {
    why.push('Denial code indicates missing, expired, or exceeded authorization.');
    why.push('Authorization denials are often recoverable if auth evidence exists.');
    if (urgency === 'now') why.push('SLA/aging pressure makes this an immediate action.');

    return wrap(
      {
        kind: 'gather_authorization',
        headline: 'Find existing auth; if absent, file retro-auth or appeal.',
        owner: 'Authorization Team',
        owner_key: 'auth_team',
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: ['Prior authorization number', 'Medical records', 'Auth request documentation'],
        urgency,
        effort_minutes: 30,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  if (intel.evidence_missing.length > 0) {
    why.push(`${intel.evidence_missing.length} evidence item(s) missing.`);
    why.push('Recovery path is blocked until documentation is complete.');
    if (recovery.tier === 'HIGH') why.push('Recoverability tier is HIGH — documentation chase is economically justified.');

    return wrap(
      {
        kind: 'request_documentation',
        headline: 'Close documentation gaps before recovery action.',
        owner: primary.workflow_owner === 'clinical' ? 'Clinical / HIM' : 'Billing / HIM',
        owner_key: primary.workflow_owner === 'clinical' ? 'clinical' : 'biller',
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: intel.evidence_missing,
        urgency,
        effort_minutes: 25,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  if (
    primary.category === 'coding' ||
    primary.category === 'modifier' ||
    primary.category === 'eligibility' ||
    primary.correction_eligible ||
    primary.resubmission_eligible
  ) {
    why.push(`${primary.category.replace(/_/g, ' ')} issue has a correction/resubmission path.`);
    why.push('Corrected resubmission is faster than formal appeal when payer accepts it.');
    why.push('Action preserves appeal/filing window if submitted quickly.');

    return wrap(
      {
        kind: 'correct_and_resubmit',
        headline: `Correct and resubmit claim (${primary.category.replace(/_/g, ' ')}).`,
        owner: primary.workflow_owner,
        owner_key: primary.workflow_owner,
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: primary.evidence_required,
        urgency,
        effort_minutes: 22,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  if (primary.category === 'medical_necessity' && intel.appeals.some((a) => a.status === 'denied')) {
    why.push('Medical necessity was already denied at a prior appeal level.');
    why.push('Peer-to-peer may create a stronger clinical record.');
    why.push('Clinical evidence should be organized before outreach.');

    return wrap(
      {
        kind: 'peer_to_peer',
        headline: 'Request peer-to-peer review.',
        owner: 'Clinical',
        owner_key: 'clinical',
        why,
        expected_value_cents: Math.round(intel.amount_at_risk_cents * 0.45),
        expected_probability: 0.45,
        evidence_refs: ['Complete clinical chart', 'LCD/NCD citation', 'Letter of medical necessity'],
        urgency,
        effort_minutes: 60,
      },
      { intel, primary, probability: 0.45, hasPlaybook },
    );
  }

  if ((urgency === 'now' || intel.is_stalled) && intel.amount_at_risk_cents >= 500_000) {
    why.push(`High-value claim with $${dollars(intel.amount_at_risk_cents)} at risk.`);
    why.push(intel.is_stalled ? 'Claim is flagged as stalled.' : 'SLA/aging pressure requires escalation.');
    why.push('Manager review should trigger payer rep engagement if needed.');

    return wrap(
      {
        kind: 'escalate_internal',
        headline: 'Escalate to reimbursement operations lead.',
        owner: 'Reimbursement Manager',
        owner_key: 'supervisor',
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: ['Claim summary', 'Denial detail', 'Recovery score'],
        urgency: 'now',
        effort_minutes: 10,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  if (primary.appeal_eligible) {
    const level = Math.min(3, intel.appeals.length + 1);

    why.push(`Appeal eligible per ${primary.carc_code}${primary.rarc_code ? `/${primary.rarc_code}` : ''}.`);
    why.push(`Expected recovery probability is ${Math.round(probability * 100)}%.`);
    why.push('Required evidence appears complete.');

    return wrap(
      {
        kind: 'file_appeal',
        headline: `File Level ${level} appeal with evidence packet.`,
        owner: 'Appeals',
        owner_key: 'appeals',
        why,
        expected_value_cents: expectedValue,
        expected_probability: probability,
        evidence_refs: primary.evidence_required,
        urgency,
        effort_minutes: playbook?.estimated_minutes ?? 45,
      },
      { intel, primary, probability, hasPlaybook },
    );
  }

  return wrap(
    {
      kind: 'monitor',
      headline: 'Monitor — no automated recovery action recommended.',
      owner: 'Billing',
      owner_key: 'biller',
      why: [
        'Denial is not appeal-eligible.',
        'No documentation gap, correction path, COB issue, or underpayment signal was detected.',
      ],
      expected_value_cents: 0,
      expected_probability: probability,
      evidence_refs: [],
      urgency: 'when_able',
      effort_minutes: 5,
    },
    { intel, primary, probability, hasPlaybook },
  );
}

export const URGENCY_CLS: Record<ActionUrgency, string> = {
  now: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  this_week: 'bg-status-pending/15 text-status-pending border-status-pending/30',
  this_month: 'bg-status-cob/10 text-status-cob border-status-cob/30',
  when_able: 'bg-muted text-muted-foreground border-border',
};

export const URGENCY_LABEL: Record<ActionUrgency, string> = {
  now: 'Now',
  this_week: 'This Week',
  this_month: 'This Month',
  when_able: 'When Able',
};