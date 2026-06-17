import type { ClaimIntel } from '@/types/clarity';
import type { Claim } from '@/types/claim';

export type RecoveryTier = 'HIGH' | 'MEDIUM' | 'LOW';

export type RecoveryFactorWeight =
  | 'baseline'
  | 'adjust'
  | 'risk'
  | 'readiness'
  | 'economic';

export interface RecoveryFactor {
  label: string;
  detail: string;
  delta: number;
  weight: RecoveryFactorWeight;
}

export interface RecoveryExplanation {
  score: number;
  tier: RecoveryTier;
  headline: string;
  factors: RecoveryFactor[];
  recommended_path: string;
  appeal_readiness: number;
  documentation_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  economic_priority: 'LOW' | 'MEDIUM' | 'HIGH';
  recovery_barriers: string[];
  next_best_actions: string[];
}

type C = Claim & { intel: ClaimIntel };

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

const tierFor = (score: number): RecoveryTier =>
  score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

function documentationRisk(missingCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (missingCount === 0) return 'LOW';
  if (missingCount <= 2) return 'MEDIUM';
  return 'HIGH';
}

function economicPriority(amountAtRiskCents: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (amountAtRiskCents >= 250_000) return 'HIGH';
  if (amountAtRiskCents >= 50_000) return 'MEDIUM';
  return 'LOW';
}

function baseScore(claim: C): RecoveryFactor {
  const { intel } = claim;
  const primary = intel.denial_events[0];

  if (intel.reimbursement_state === 'paid' || intel.reimbursement_state === 'resolved') {
    return {
      label: 'Current state',
      detail: 'Claim is already paid or resolved.',
      delta: 100,
      weight: 'baseline',
    };
  }

  if (intel.denial_events.length === 0) {
    return {
      label: 'Current state',
      detail: 'No active denial is recorded; recovery depends on payer follow-up.',
      delta: 55,
      weight: 'baseline',
    };
  }

  const avg = Math.round(
    intel.denial_events.reduce((sum, denial) => sum + denial.recoverability_score, 0) /
      intel.denial_events.length,
  );

  return {
    label: 'Denial profile',
    detail: primary
      ? `Baseline from ${primary.category.replace(/_/g, ' ')} denial (${primary.carc_code}${
          primary.rarc_code ? `/${primary.rarc_code}` : ''
        }).`
      : 'Baseline from denial mix.',
    delta: avg,
    weight: 'baseline',
  };
}

function agingFactor(days: number): RecoveryFactor {
  if (days > 180) {
    return {
      label: 'Aging',
      detail: `${days}d aged — severe deadline and payer leverage risk.`,
      delta: -35,
      weight: 'risk',
    };
  }

  if (days > 120) {
    return {
      label: 'Aging',
      detail: `${days}d aged — likely timely filing or appeal-window pressure.`,
      delta: -25,
      weight: 'risk',
    };
  }

  if (days > 90) {
    return {
      label: 'Aging',
      detail: `${days}d aged — escalation should be prioritized.`,
      delta: -15,
      weight: 'risk',
    };
  }

  if (days > 60) {
    return {
      label: 'Aging',
      detail: `${days}d aged — delay is beginning to reduce recovery leverage.`,
      delta: -8,
      weight: 'risk',
    };
  }

  if (days > 30) {
    return {
      label: 'Aging',
      detail: `${days}d aged — still workable, but should not sit idle.`,
      delta: -3,
      weight: 'adjust',
    };
  }

  return {
    label: 'Aging',
    detail: `${days}d aged — fresh recovery window.`,
    delta: 5,
    weight: 'readiness',
  };
}

function documentationFactor(intel: ClaimIntel): RecoveryFactor {
  const missing = intel.evidence_missing ?? [];

  if (missing.length > 0) {
    return {
      label: 'Documentation',
      detail: `${missing.length} blocking item(s) missing: ${missing.slice(0, 3).join(', ')}`,
      delta: -10 * Math.min(missing.length, 4),
      weight: 'risk',
    };
  }

  const appealEligible = intel.denial_events.some((d) => d.appeal_eligible);

  return {
    label: 'Documentation',
    detail: appealEligible
      ? 'Required appeal evidence appears available.'
      : 'No evidence gap detected.',
    delta: appealEligible ? 8 : 4,
    weight: 'readiness',
  };
}

function appealHistoryFactors(intel: ClaimIntel): RecoveryFactor[] {
  const denied = intel.appeals.filter((a) => a.status === 'denied').length;
  const won = intel.appeals.filter((a) => a.status === 'approved' || a.status === 'partial').length;
  const active = intel.appeals.filter((a) =>
    ['draft', 'submitted', 'in_review'].includes(a.status),
  ).length;

  const factors: RecoveryFactor[] = [];

  if (denied > 0) {
    factors.push({
      label: 'Appeal history',
      detail: `${denied} prior denied appeal(s) — next level requires stronger evidence.`,
      delta: -12 * Math.min(denied, 3),
      weight: 'risk',
    });
  }

  if (won > 0) {
    factors.push({
      label: 'Appeal precedent',
      detail: `${won} successful appeal outcome(s) attached to this claim context.`,
      delta: 8,
      weight: 'readiness',
    });
  }

  if (active > 0) {
    factors.push({
      label: 'Open appeal',
      detail: `${active} active appeal(s) — avoid duplicate effort and monitor payer response.`,
      delta: -3,
      weight: 'adjust',
    });
  }

  return factors;
}

function payerFactor(intel: ClaimIntel): RecoveryFactor | null {
  switch (intel.payer_class) {
    case 'medicare':
      return {
        label: 'Payer behavior',
        detail: 'Medicare profile — policy-based path is more predictable.',
        delta: 4,
        weight: 'adjust',
      };
    case 'medicaid':
      return {
        label: 'Payer behavior',
        detail: 'Medicaid profile — documentation and timing friction expected.',
        delta: -6,
        weight: 'risk',
      };
    case 'commercial':
      return {
        label: 'Payer behavior',
        detail: 'Commercial profile — recovery depends on contract terms and evidence quality.',
        delta: 2,
        weight: 'adjust',
      };
    case 'workers_comp':
      return {
        label: 'Payer behavior',
        detail: 'Workers comp profile — recovery may require case-specific documentation.',
        delta: -2,
        weight: 'adjust',
      };
    case 'self_pay':
      return {
        label: 'Payer behavior',
        detail: 'Self-pay profile — payer appeal path is limited.',
        delta: -10,
        weight: 'risk',
      };
    default:
      return null;
  }
}

function economicFactor(claim: C): RecoveryFactor {
  const atRisk = claim.intel.amount_at_risk_cents;

  if (atRisk >= 500_000) {
    return {
      label: 'Economic priority',
      detail: 'Very high dollars at risk — executive escalation is justified.',
      delta: 8,
      weight: 'economic',
    };
  }

  if (atRisk >= 250_000) {
    return {
      label: 'Economic priority',
      detail: 'High-dollar recovery candidate.',
      delta: 6,
      weight: 'economic',
    };
  }

  if (atRisk >= 50_000) {
    return {
      label: 'Economic priority',
      detail: 'Meaningful recovery value.',
      delta: 3,
      weight: 'economic',
    };
  }

  if (atRisk > 0 && atRisk < 20_000) {
    return {
      label: 'Economic priority',
      detail: 'Low-dollar claim — validate effort before deeper pursuit.',
      delta: -4,
      weight: 'economic',
    };
  }

  return {
    label: 'Economic priority',
    detail: 'No material dollars currently at risk.',
    delta: 0,
    weight: 'economic',
  };
}

function eligibilityFactor(intel: ClaimIntel): RecoveryFactor | null {
  const primary = intel.denial_events[0];
  if (!primary) return null;

  if (primary.correction_eligible || primary.resubmission_eligible) {
    return {
      label: 'Recovery path',
      detail: 'Correction or resubmission path exists before formal appeal.',
      delta: 6,
      weight: 'readiness',
    };
  }

  if (primary.appeal_eligible) {
    return {
      label: 'Recovery path',
      detail: 'Appeal path exists for the primary denial.',
      delta: 4,
      weight: 'readiness',
    };
  }

  return {
    label: 'Recovery path',
    detail: 'No clear appeal, correction, or resubmission path is marked.',
    delta: -12,
    weight: 'risk',
  };
}

function buildRecoveryBarriers(claim: C): string[] {
  const { intel } = claim;
  const barriers: string[] = [];

  if (intel.aging_days > 120) barriers.push('Aging / timely filing risk');
  if (intel.evidence_missing.length > 0) barriers.push('Missing documentation');
  if (intel.appeals.some((a) => a.status === 'denied')) barriers.push('Prior denied appeal history');
  if (
    intel.denial_events.some(
      (d) => !d.appeal_eligible && !d.correction_eligible && !d.resubmission_eligible,
    )
  ) {
    barriers.push('No obvious appeal/correction/resubmission path');
  }
  if (intel.amount_at_risk_cents > 0 && intel.amount_at_risk_cents < 20_000) {
    barriers.push('Low recovery ROI');
  }
  if (intel.payer_class === 'medicaid') barriers.push('Payer class may require stricter documentation');

  return barriers;
}

function buildNextBestActions(claim: C, tier: RecoveryTier): string[] {
  const { intel } = claim;
  const primary = intel.denial_events[0];
  const actions: string[] = [];

  if (intel.evidence_missing.length > 0) {
    actions.push(`Collect missing evidence: ${intel.evidence_missing.slice(0, 3).join(', ')}`);
  }

  if (intel.aging_days > 90) {
    actions.push('Escalate immediately due to aging pressure.');
  }

  if (primary?.correction_eligible || primary?.resubmission_eligible) {
    actions.push('Correct and resubmit before formal appeal.');
  } else if (primary?.appeal_eligible) {
    const nextLevel = intel.appeals.length > 0 ? `Level ${Math.min(3, intel.appeals.length + 1)}` : 'Level 1';
    actions.push(`Prepare ${nextLevel} appeal packet.`);
  } else if (primary) {
    actions.push('Validate whether payer-specific recovery path exists.');
  }

  if (intel.amount_at_risk_cents >= 250_000) {
    actions.push('Route to senior recovery owner due to high claim value.');
  }

  if (tier === 'LOW' && actions.length === 0) {
    actions.push('Perform cost-of-pursuit review before additional recovery effort.');
  }

  return actions.length ? actions : ['Continue standard recovery workflow.'];
}

export function explainRecoverability(claim: C): RecoveryExplanation {
  const { intel } = claim;
  const factors: RecoveryFactor[] = [baseScore(claim)];

  factors.push(agingFactor(intel.aging_days));
  factors.push(documentationFactor(intel));
  factors.push(...appealHistoryFactors(intel));
  factors.push(economicFactor(claim));

  const pf = payerFactor(intel);
  if (pf) factors.push(pf);

  const path = eligibilityFactor(intel);
  if (path) factors.push(path);

  const raw = factors.reduce((sum, factor) => sum + factor.delta, 0);
  const score = clamp(raw);
  const tier = tierFor(score);

  const docRisk = documentationRisk(intel.evidence_missing.length);
  const econPriority = economicPriority(intel.amount_at_risk_cents);

  const primary = intel.denial_events[0];

  const appealReadiness = clamp(
    score +
      (docRisk === 'LOW' ? 10 : docRisk === 'MEDIUM' ? -5 : -20) +
      (primary?.appeal_eligible ? 8 : primary?.correction_eligible || primary?.resubmission_eligible ? 2 : -8),
  );

  const recovery_barriers = buildRecoveryBarriers(claim);
  const next_best_actions = buildNextBestActions(claim, tier);

  const headline =
    tier === 'HIGH'
      ? 'Strong recovery candidate — pursue actively.'
      : tier === 'MEDIUM'
        ? 'Recoverable with focused effort.'
        : 'Low recovery probability — validate barriers and cost-of-pursuit.';

  const recommended_path =
    tier === 'HIGH'
      ? primary?.correction_eligible || primary?.resubmission_eligible
        ? 'Correct and resubmit through the fastest payer-accepted path.'
        : primary?.appeal_eligible
          ? `File ${
              intel.appeals.length > 0 ? `Level ${Math.min(3, intel.appeals.length + 1)}` : 'Level 1'
            } appeal with complete evidence packet.`
          : 'Escalate for payer-specific recovery review.'
      : tier === 'MEDIUM'
        ? 'Close documentation gaps, verify deadlines, then appeal or resubmit.'
        : intel.aging_days > 120
          ? 'Likely write-off candidate unless timely filing proof or payer exception exists.'
          : 'Perform cost-of-pursuit review before deeper recovery work.';

  return {
    score,
    tier,
    headline,
    factors,
    recommended_path,
    appeal_readiness: appealReadiness,
    documentation_risk: docRisk,
    economic_priority: econPriority,
    recovery_barriers,
    next_best_actions,
  };
}