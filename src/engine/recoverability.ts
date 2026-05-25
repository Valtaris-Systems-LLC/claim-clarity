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

const tierFor = (score: number): RecoveryTier =>
  score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

function documentationRisk(missingCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (missingCount === 0) return 'LOW';
  if (missingCount <= 2) return 'MEDIUM';
  return 'HIGH';
}

function economicPriority(totalBilled: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (totalBilled >= 250_000) return 'HIGH';
  if (totalBilled >= 50_000) return 'MEDIUM';
  return 'LOW';
}

function payerBehaviorAdjust(intel: ClaimIntel): RecoveryFactor | null {
  if (intel.payer_class === 'medicaid') {
    return {
      label: 'Payer behavior',
      detail: 'Medicaid payer class — stricter documentation and slower turnaround expected.',
      delta: -6,
      weight: 'risk',
    };
  }

  if (intel.payer_class === 'medicare') {
    return {
      label: 'Payer behavior',
      detail: 'Medicare payer class — more predictable policy-based adjudication patterns.',
      delta: 4,
      weight: 'adjust',
    };
  }

  if (intel.payer_class === 'commercial') {
    return {
      label: 'Payer behavior',
      detail: 'Commercial payer class — recovery depends heavily on contract terms and documentation completeness.',
      delta: 2,
      weight: 'adjust',
    };
  }

  return null;
}

function agingFactor(days: number): RecoveryFactor {
  if (days > 180) {
    return {
      label: 'Aging',
      detail: `${days}d — severely aged; timely filing or appeal deadline risk is high.`,
      delta: -35,
      weight: 'risk',
    };
  }

  if (days > 120) {
    return {
      label: 'Aging',
      detail: `${days}d — past common timely filing windows for many payers.`,
      delta: -25,
      weight: 'risk',
    };
  }

  if (days > 90) {
    return {
      label: 'Aging',
      detail: `${days}d — appeal window narrowing; escalation should be prioritized.`,
      delta: -15,
      weight: 'risk',
    };
  }

  if (days > 60) {
    return {
      label: 'Aging',
      detail: `${days}d — recovery still possible, but delay is starting to reduce leverage.`,
      delta: -8,
      weight: 'risk',
    };
  }

  if (days > 30) {
    return {
      label: 'Aging',
      detail: `${days}d — within standard recovery window, but should not sit idle.`,
      delta: -3,
      weight: 'adjust',
    };
  }

  return {
    label: 'Aging',
    detail: `${days}d — fresh claim; full recovery window likely available.`,
    delta: 5,
    weight: 'readiness',
  };
}

function appealHistoryFactors(intel: ClaimIntel): RecoveryFactor[] {
  const priorDenied = intel.appeals.filter((a) => a.status === 'denied').length;
  const priorApproved = intel.appeals.filter(
    (a) => a.status === 'approved' || a.status === 'partial',
  ).length;
  const active = intel.appeals.filter(
    (a) => a.status === 'draft' || a.status === 'submitted' || a.status === 'in_review',
  ).length;

  const factors: RecoveryFactor[] = [];

  if (priorDenied > 0) {
    factors.push({
      label: 'Appeal history',
      detail: `${priorDenied} prior denied appeal(s) — next-level recovery requires stronger evidence.`,
      delta: -12 * Math.min(priorDenied, 3),
      weight: 'risk',
    });
  }

  if (priorApproved > 0) {
    factors.push({
      label: 'Appeal precedent',
      detail: `${priorApproved} prior successful appeal outcome(s) — favorable pattern exists for this claim context.`,
      delta: 6,
      weight: 'readiness',
    });
  }

  if (active > 0) {
    factors.push({
      label: 'Open appeal activity',
      detail: `${active} active appeal(s) — avoid duplicate effort and monitor payer response.`,
      delta: -3,
      weight: 'adjust',
    });
  }

  return factors;
}

function documentationFactors(intel: ClaimIntel, appealEligible: boolean): RecoveryFactor[] {
  const missing = intel.evidence_missing ?? [];

  if (missing.length > 0) {
    return [
      {
        label: 'Documentation gap',
        detail: `${missing.length} required item(s) missing: ${missing.slice(0, 3).join(', ')}`,
        delta: -10 * Math.min(missing.length, 4),
        weight: 'risk',
      },
    ];
  }

  if (appealEligible) {
    return [
      {
        label: 'Documentation readiness',
        detail: 'Required appeal evidence appears present.',
        delta: 8,
        weight: 'readiness',
      },
    ];
  }

  return [
    {
      label: 'Documentation status',
      detail: 'No documentation gap detected.',
      delta: 4,
      weight: 'readiness',
    },
  ];
}

function claimValueFactor(totalBilled: number): RecoveryFactor {
  if (totalBilled >= 500_000) {
    return {
      label: 'Claim value',
      detail: 'Very high-value claim — executive escalation is economically justified.',
      delta: 8,
      weight: 'economic',
    };
  }

  if (totalBilled >= 250_000) {
    return {
      label: 'Claim value',
      detail: 'High-value claim — prioritize recovery workflow.',
      delta: 6,
      weight: 'economic',
    };
  }

  if (totalBilled >= 50_000) {
    return {
      label: 'Claim value',
      detail: 'Meaningful recovery value — normal appeal effort justified.',
      delta: 3,
      weight: 'economic',
    };
  }

  if (totalBilled < 20_000) {
    return {
      label: 'Claim value',
      detail: 'Low-dollar claim — confirm appeal effort is worth the operational cost.',
      delta: -4,
      weight: 'economic',
    };
  }

  return {
    label: 'Claim value',
    detail: 'Moderate claim value — standard recovery workflow applies.',
    delta: 0,
    weight: 'economic',
  };
}

function buildRecoveryBarriers(claim: Claim & { intel: ClaimIntel }): string[] {
  const intel = claim.intel;
  const barriers: string[] = [];

  if (intel.aging_days > 120) barriers.push('Aging / timely filing risk');
  if ((intel.evidence_missing ?? []).length > 0) barriers.push('Missing documentation');
  if (intel.appeals.some((a) => a.status === 'denied')) barriers.push('Prior denied appeal history');
  if (intel.denial_events.some((d) => !d.appeal_eligible && !d.correction_eligible && !d.resubmission_eligible)) {
    barriers.push('No obvious appeal/correction/resubmission path');
  }
  if (claim.total_billed < 20_000) barriers.push('Low appeal ROI');
  if (intel.payer_class === 'medicaid') barriers.push('Payer class may require stricter documentation');

  return barriers;
}

function buildNextBestActions(claim: Claim & { intel: ClaimIntel }, tier: RecoveryTier): string[] {
  const intel = claim.intel;
  const primary = intel.denial_events[0];
  const missing = intel.evidence_missing ?? [];
  const actions: string[] = [];

  if (missing.length > 0) {
    actions.push(`Collect missing evidence: ${missing.slice(0, 3).join(', ')}`);
  }

  if (intel.aging_days > 90) {
    actions.push('Escalate immediately due to aging pressure.');
  }

  if (primary?.appeal_eligible) {
    const nextLevel =
      intel.appeals.length > 0
        ? `Level ${Math.min(3, intel.appeals.length + 1)}`
        : 'Level 1';

    actions.push(`Prepare ${nextLevel} appeal packet.`);
  } else if (primary?.correction_eligible || primary?.resubmission_eligible) {
    actions.push('Correct and resubmit before entering formal appeal workflow.');
  } else if (primary) {
    actions.push('Validate whether correction/resubmission is available before appeal effort.');
  }

  if (claim.total_billed >= 250_000) {
    actions.push('Route to senior recovery owner due to high claim value.');
  }

  if (tier === 'LOW' && actions.length === 0) {
    actions.push('Perform cost-of-pursuit review before additional work.');
  }

  return actions.length > 0 ? actions : ['Continue standard recovery workflow.'];
}

export function explainRecoverability(claim: Claim & { intel: ClaimIntel }): RecoveryExplanation {
  const intel = claim.intel;
  const factors: RecoveryFactor[] = [];
  const primary = intel.denial_events[0];

  const baseFromDenials =
    intel.denial_events.length > 0
      ? Math.round(
          intel.denial_events.reduce(
            (sum, denial) => sum + denial.recoverability_score,
            0,
          ) / intel.denial_events.length,
        )
      : intel.reimbursement_state === 'paid'
        ? 100
        : 60;

  factors.push({
    label: 'Denial type',
    detail: primary
      ? `Baseline for ${primary.category.replace(/_/g, ' ')} (${primary.carc_code}${
          primary.rarc_code ? `/${primary.rarc_code}` : ''
        })`
      : 'No active denial — clean or unresolved adjudication context.',
    delta: baseFromDenials,
    weight: 'baseline',
  });

  factors.push(agingFactor(intel.aging_days));
  factors.push(...appealHistoryFactors(intel));
  factors.push(...documentationFactors(intel, Boolean(primary?.appeal_eligible)));
  factors.push(claimValueFactor(claim.total_billed));

  const payerFactor = payerBehaviorAdjust(intel);
  if (payerFactor) factors.push(payerFactor);

  const raw = factors.reduce((sum, factor) => sum + factor.delta, 0);
  const score = clamp(raw);
  const tier = tierFor(score);

  const docRisk = documentationRisk((intel.evidence_missing ?? []).length);
  const econPriority = economicPriority(claim.total_billed);

  const appealReadiness = clamp(
    score +
      (docRisk === 'LOW' ? 10 : docRisk === 'MEDIUM' ? -5 : -20) +
      (primary?.appeal_eligible ? 8 : primary?.correction_eligible || primary?.resubmission_eligible ? 2 : -5),
  );

  const recovery_barriers = buildRecoveryBarriers(claim);
  const next_best_actions = buildNextBestActions(claim, tier);

  const headline =
    tier === 'HIGH'
      ? 'Strong recovery candidate — pursue actively.'
      : tier === 'MEDIUM'
        ? 'Recoverable with effort — prioritize documentation, timing, and payer-specific requirements.'
        : 'Low recovery probability — validate deadlines, evidence gaps, and cost-of-pursuit before deeper work.';

  const recommended_path =
    tier === 'HIGH'
      ? primary?.appeal_eligible
        ? `File ${
            intel.appeals.length > 0
              ? `Level ${Math.min(3, intel.appeals.length + 1)}`
              : 'Level 1'
          } appeal with evidence packet.`
        : primary?.correction_eligible || primary?.resubmission_eligible
          ? 'Correct and resubmit through the fastest payer-accepted path.'
          : 'Escalate for payer-specific recovery review.'
      : tier === 'MEDIUM'
        ? 'Close documentation gaps, verify deadlines, then appeal or resubmit.'
        : intel.aging_days > 120
          ? 'Likely write-off candidate unless timely filing proof or payer exception exists.'
          : 'Perform cost-of-pursuit review before additional recovery effort.';

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