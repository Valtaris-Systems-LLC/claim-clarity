/**
 * Payer Intelligence — derives operational profiles per payer
 * from observed claim activity.
 *
 * Purpose:
 * - Identify payer friction patterns
 * - Surface top denial reasons
 * - Track appeal behavior
 * - Estimate collection difficulty
 * - Produce payer-specific operational guidance
 */

import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialCategory } from '@/types/clarity';

export type DifficultyTier =
  | 'EASY'
  | 'MODERATE'
  | 'DIFFICULT'
  | 'PUNITIVE';

export interface PayerProfileSummary {
  payer_id: string;
  payer_name: string;
  payer_class: ClaimIntel['payer_class'];

  total_claims: number;

  denial_rate: number;
  appeal_count: number;
  appeal_success_rate: number;

  avg_turnaround_days: number;
  avg_aging_days: number;

  total_billed_cents: number;
  total_paid_cents: number;
  total_at_risk_cents: number;
  total_underpayment_cents: number;

  collection_rate: number;
  at_risk_rate: number;
  underpayment_rate: number;

  top_denial_reasons: Array<{
    category: DenialCategory;
    count: number;
    sampleMessage?: string;
  }>;

  documentation_requirements: string[];

  difficulty_score: number;
  difficulty_tier: DifficultyTier;
  difficulty_drivers: string[];

  playbook_notes: string[];
  operational_recommendations: string[];
}

type ClaimWithIntel = Claim & { intel: ClaimIntel };

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function tierFromScore(score: number): DifficultyTier {
  if (score >= 75) return 'PUNITIVE';
  if (score >= 50) return 'DIFFICULT';
  if (score >= 25) return 'MODERATE';
  return 'EASY';
}

function buildDifficultyScore(args: {
  denialRate: number;
  appealSuccessRate: number;
  avgTurnaroundDays: number;
  atRiskCents: number;
  underpaymentCents: number;
  payerClass: ClaimIntel['payer_class'];
}): { score: number; drivers: string[] } {
  let score = 0;
  const drivers: string[] = [];

  if (args.denialRate >= 0.4) {
    score += 30;
    drivers.push(`High denial rate (${pct(args.denialRate)})`);
  } else if (args.denialRate >= 0.2) {
    score += 15;
    drivers.push(`Elevated denial rate (${pct(args.denialRate)})`);
  }

  if (args.appealSuccessRate > 0 && args.appealSuccessRate < 0.4) {
    score += 20;
    drivers.push(`Low appeal overturn rate (${pct(args.appealSuccessRate)})`);
  } else if (args.appealSuccessRate >= 0.65) {
    score -= 8;
    drivers.push(`Strong appeal overturn rate (${pct(args.appealSuccessRate)})`);
  }

  if (args.avgTurnaroundDays >= 45) {
    score += 20;
    drivers.push(`Slow turnaround (${args.avgTurnaroundDays}d avg)`);
  } else if (args.avgTurnaroundDays >= 28) {
    score += 10;
    drivers.push(`Moderate turnaround (${args.avgTurnaroundDays}d avg)`);
  }

  if (args.atRiskCents >= 500_000) {
    score += 15;
    drivers.push(`Heavy at-risk dollar concentration (${dollars(args.atRiskCents)})`);
  }

  if (args.underpaymentCents >= 100_000) {
    score += 12;
    drivers.push(`Meaningful underpayment exposure (${dollars(args.underpaymentCents)})`);
  }

  if (args.payerClass === 'medicaid') {
    score += 10;
    drivers.push('Medicaid program complexity');
  }

  if (args.payerClass === 'medicare') {
    score -= 4;
    drivers.push('Predictable Medicare policy framework');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score: finalScore,
    drivers: drivers.length ? drivers : ['Operationally clean payer'],
  };
}

function buildPlaybookNotes(args: {
  denialRate: number;
  topReasons: Array<{ category: DenialCategory; count: number; sampleMessage?: string }>;
  documentationRequirements: string[];
  appealSuccessRate: number;
  underpaymentCents: number;
}): string[] {
  const notes: string[] = [];

  if (args.denialRate >= 0.2) {
    notes.push('Review claim intake and scrubber logic before submission for this payer.');
  }

  if (args.topReasons.some((r) => r.category === 'cob')) {
    notes.push('Require primary EOB / COB evidence earlier in workflow.');
  }

  if (args.topReasons.some((r) => r.category === 'authorization')) {
    notes.push('Verify authorization capture before claim submission.');
  }

  if (args.topReasons.some((r) => r.category === 'missing_documentation')) {
    notes.push('Create payer-specific documentation checklist.');
  }

  if (args.documentationRequirements.length > 4) {
    notes.push('Payer appears documentation-heavy; prebuild evidence packets.');
  }

  if (args.appealSuccessRate >= 0.6) {
    notes.push('Appeals are worthwhile for this payer when evidence is complete.');
  }

  if (args.underpaymentCents > 0) {
    notes.push('Monitor contractual underpayment variance on paid claims.');
  }

  return notes.length ? notes : ['No special payer playbook needed yet.'];
}

function buildOperationalRecommendations(profile: {
  difficulty_tier: DifficultyTier;
  denial_rate: number;
  total_at_risk_cents: number;
  total_underpayment_cents: number;
  top_denial_reasons: Array<{ category: DenialCategory; count: number; sampleMessage?: string }>;
}): string[] {
  const recs: string[] = [];

  if (profile.difficulty_tier === 'PUNITIVE' || profile.difficulty_tier === 'DIFFICULT') {
    recs.push('Assign payer to dedicated owner for weekly review.');
  }

  if (profile.total_at_risk_cents >= 250_000) {
    recs.push('Escalate high-dollar inventory for manager review.');
  }

  if (profile.total_underpayment_cents > 0) {
    recs.push('Run underpayment audit against contract terms.');
  }

  if (profile.top_denial_reasons.some((r) => r.category === 'authorization')) {
    recs.push('Audit authorization workflow for this payer.');
  }

  if (profile.top_denial_reasons.some((r) => r.category === 'cob')) {
    recs.push('Improve COB intake and primary payer evidence capture.');
  }

  if (profile.denial_rate < 0.1 && profile.total_at_risk_cents < 50_000) {
    recs.push('Maintain standard monitoring cadence.');
  }

  return recs.length ? recs : ['Continue standard payer monitoring.'];
}

export function buildPayerProfiles(claims: ClaimWithIntel[]): PayerProfileSummary[] {
  const groups = new Map<string, ClaimWithIntel[]>();

  for (const claim of claims) {
    const key = claim.intel.payer_id || claim.intel.payer_name || 'unknown';
    const list = groups.get(key) ?? [];
    list.push(claim);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([id, list]) => {
      const sample = list[0].intel;

      const billed = list.reduce((sum, claim) => sum + claim.total_billed, 0);
      const paid = list.reduce((sum, claim) => sum + claim.intel.actual_reimbursement_cents, 0);
      const atRisk = list.reduce((sum, claim) => sum + claim.intel.amount_at_risk_cents, 0);
      const underpayment = list.reduce((sum, claim) => sum + claim.intel.underpayment_cents, 0);

      const deniedClaims = list.filter((claim) => claim.intel.denial_events.length > 0);
      const denialRate = safeRate(deniedClaims.length, list.length);

      const appeals = list.flatMap((claim) => claim.intel.appeals);
      const decidedAppeals = appeals.filter(
        (appeal) =>
          appeal.status === 'approved' ||
          appeal.status === 'denied' ||
          appeal.status === 'partial',
      );

      const wonAppeals = decidedAppeals.filter(
        (appeal) => appeal.status === 'approved' || appeal.status === 'partial',
      );

      const appealSuccessRate = safeRate(wonAppeals.length, decidedAppeals.length);

      const avgTurnaroundDays = Math.round(
        list.reduce((sum, claim) => sum + claim.intel.aging_days, 0) / Math.max(1, list.length),
      );

      const reasonCount = new Map<DenialCategory, { count: number; msg?: string }>();

      for (const claim of list) {
        for (const denial of claim.intel.denial_events) {
          const current = reasonCount.get(denial.category) ?? {
            count: 0,
            msg: denial.payer_message,
          };

          current.count += 1;

          if (!current.msg && denial.payer_message) {
            current.msg = denial.payer_message;
          }

          reasonCount.set(denial.category, current);
        }
      }

      const topDenialReasons = [...reasonCount.entries()]
        .map(([category, value]) => ({
          category,
          count: value.count,
          sampleMessage: value.msg,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const docs = new Set<string>();

      for (const claim of list) {
        for (const denial of claim.intel.denial_events) {
          denial.evidence_required.forEach((evidence) => docs.add(evidence));
        }

        for (const missing of claim.intel.evidence_missing) {
          docs.add(missing);
        }

        for (const requirement of claim.intel.evidence_requirements ?? []) {
          if (requirement.blocking) docs.add(requirement.label);
        }
      }

      const documentationRequirements = [...docs].slice(0, 10);

      const difficulty = buildDifficultyScore({
        denialRate,
        appealSuccessRate,
        avgTurnaroundDays,
        atRiskCents: atRisk,
        underpaymentCents: underpayment,
        payerClass: sample.payer_class,
      });

      const difficultyTier = tierFromScore(difficulty.score);

      const baseProfile = {
        payer_id: id,
        payer_name: sample.payer_name,
        payer_class: sample.payer_class,

        total_claims: list.length,

        denial_rate: denialRate,
        appeal_count: appeals.length,
        appeal_success_rate: appealSuccessRate,

        avg_turnaround_days: avgTurnaroundDays,
        avg_aging_days: avgTurnaroundDays,

        total_billed_cents: billed,
        total_paid_cents: paid,
        total_at_risk_cents: atRisk,
        total_underpayment_cents: underpayment,

        collection_rate: safeRate(paid, billed),
        at_risk_rate: safeRate(atRisk, billed),
        underpayment_rate: safeRate(underpayment, billed),

        top_denial_reasons: topDenialReasons,

        documentation_requirements: documentationRequirements,

        difficulty_score: difficulty.score,
        difficulty_tier: difficultyTier,
        difficulty_drivers: difficulty.drivers,

        playbook_notes: buildPlaybookNotes({
          denialRate,
          topReasons: topDenialReasons,
          documentationRequirements,
          appealSuccessRate,
          underpaymentCents: underpayment,
        }),

        operational_recommendations: [] as string[],
      };

      return {
        ...baseProfile,
        operational_recommendations: buildOperationalRecommendations(baseProfile),
      };
    })
    .sort((a, b) => b.total_at_risk_cents - a.total_at_risk_cents);
}

export const DIFFICULTY_CLS: Record<DifficultyTier, string> = {
  EASY: 'bg-status-paid/10 text-status-paid border-status-paid/30',
  MODERATE: 'bg-status-pending/10 text-status-pending border-status-pending/30',
  DIFFICULT: 'bg-status-adjusted/15 text-status-adjusted border-status-adjusted/30',
  PUNITIVE: 'bg-status-denied/15 text-status-denied border-status-denied/30',
};

export const DIFFICULTY_LABEL: Record<DifficultyTier, string> = {
  EASY: 'Easy',
  MODERATE: 'Moderate',
  DIFFICULT: 'Difficult',
  PUNITIVE: 'Punitive',
};