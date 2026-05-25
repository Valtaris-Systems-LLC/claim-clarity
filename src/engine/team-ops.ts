/**
 * Team Operations aggregator.
 *
 * Combines client-side assignment store with claim intel to produce
 * per-assignee workload, overdue counts, recovery outcomes, capacity
 * pressure, and unassigned backlog.
 */

import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialSeverity } from '@/types/clarity';
import type { Assignment } from '@/lib/assignments';
import { explainRecoverability } from './recoverability';

export interface TeamMemberStats {
  assignee: string;

  active_count: number;
  in_progress_count: number;
  snoozed_count: number;
  resolved_count: number;
  overdue_count: number;

  critical_count: number;
  high_count: number;

  total_at_risk_cents: number;
  expected_recovery_cents: number;
  recovered_cents: number;

  avg_recoverability: number;

  workload_tier: 'LOW' | 'NORMAL' | 'HIGH' | 'OVERLOADED';
  priority_score: number;
  recommended_focus: string[];
}

export interface TeamAggregate {
  members: TeamMemberStats[];
  unassigned: ClaimWithIntel[];
  unassigned_at_risk_cents: number;
  unassigned_expected_recovery_cents: number;
  overdue_total: number;
  total_expected_recovery_cents: number;
}

type ClaimWithIntel = Claim & { intel: ClaimIntel };

function isOpenRecoveryClaim(claim: ClaimWithIntel): boolean {
  return (
    claim.intel.amount_at_risk_cents > 0 &&
    claim.intel.reimbursement_state !== 'paid' &&
    claim.intel.reimbursement_state !== 'resolved' &&
    claim.intel.reimbursement_state !== 'written_off'
  );
}

function isOverdue(claim: ClaimWithIntel, assignment?: Assignment): boolean {
  if (assignment?.status === 'resolved') return false;
  const due = new Date(claim.intel.sla_due_at).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function severityCount(claims: ClaimWithIntel[], severity: DenialSeverity): number {
  return claims.filter((claim) => claim.intel.severity === severity).length;
}

function workloadTier(active: number, overdue: number): TeamMemberStats['workload_tier'] {
  if (active >= 20 || overdue >= 8) return 'OVERLOADED';
  if (active >= 12 || overdue >= 4) return 'HIGH';
  if (active >= 5) return 'NORMAL';
  return 'LOW';
}

function buildRecommendedFocus(args: {
  overdue: number;
  critical: number;
  high: number;
  totalRisk: number;
  avgRecoverability: number;
  snoozed: number;
}): string[] {
  const recs: string[] = [];

  if (args.overdue > 0) recs.push('Clear overdue SLA items first.');
  if (args.critical > 0) recs.push('Prioritize critical severity claims.');
  if (args.totalRisk >= 500_000) recs.push('Review high-dollar exposure.');
  if (args.avgRecoverability >= 70) recs.push('Push high-recoverability claims into appeal/resubmission.');
  if (args.snoozed > 3) recs.push('Review snoozed claims for stale follow-up.');

  return recs.length ? recs : ['Maintain current recovery cadence.'];
}

function expectedRecovery(claim: ClaimWithIntel): number {
  const exp = explainRecoverability(claim);
  return Math.round(claim.intel.amount_at_risk_cents * (exp.score / 100));
}

export function aggregateTeam(
  claims: ClaimWithIntel[],
  assignments: Record<string, Assignment>,
): TeamAggregate {
  const byAssignee = new Map<string, ClaimWithIntel[]>();
  const unassigned: ClaimWithIntel[] = [];

  for (const claim of claims) {
    const assignment = assignments[claim.claim_id];

    if (!assignment?.assignee) {
      if (isOpenRecoveryClaim(claim)) unassigned.push(claim);
      continue;
    }

    const list = byAssignee.get(assignment.assignee) ?? [];
    list.push(claim);
    byAssignee.set(assignment.assignee, list);
  }

  const members: TeamMemberStats[] = [...byAssignee.entries()]
    .map(([assignee, list]) => {
      let inProgress = 0;
      let snoozed = 0;
      let resolved = 0;
      let overdue = 0;

      let totalRisk = 0;
      let expected = 0;
      let recovered = 0;
      let recoverabilitySum = 0;

      for (const claim of list) {
        const assignment = assignments[claim.claim_id];

        if (assignment?.status === 'in_progress') inProgress++;
        if (assignment?.status === 'snoozed') snoozed++;
        if (assignment?.status === 'resolved') resolved++;
        if (isOverdue(claim, assignment)) overdue++;

        totalRisk += claim.intel.amount_at_risk_cents;

        const recovery = explainRecoverability(claim);
        expected += Math.round(claim.intel.amount_at_risk_cents * (recovery.score / 100));
        recoverabilitySum += recovery.score;

        recovered += claim.intel.appeals.reduce(
          (sum, appeal) => sum + (appeal.amount_recovered_cents ?? 0),
          0,
        );
      }

      const critical = severityCount(list, 'critical');
      const high = severityCount(list, 'high');
      const avgRecoverability = list.length ? Math.round(recoverabilitySum / list.length) : 0;

      const priorityScore =
        overdue * 20 +
        critical * 18 +
        high * 10 +
        Math.round(totalRisk / 100_000) +
        Math.round(expected / 100_000);

      return {
        assignee,
        active_count: list.length,
        in_progress_count: inProgress,
        snoozed_count: snoozed,
        resolved_count: resolved,
        overdue_count: overdue,

        critical_count: critical,
        high_count: high,

        total_at_risk_cents: totalRisk,
        expected_recovery_cents: expected,
        recovered_cents: recovered,
        avg_recoverability: avgRecoverability,

        workload_tier: workloadTier(list.length, overdue),
        priority_score: priorityScore,
        recommended_focus: buildRecommendedFocus({
          overdue,
          critical,
          high,
          totalRisk,
          avgRecoverability,
          snoozed,
        }),
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score);

  const unassignedExpected = unassigned.reduce(
    (sum, claim) => sum + expectedRecovery(claim),
    0,
  );

  return {
    members,
    unassigned,
    unassigned_at_risk_cents: unassigned.reduce(
      (sum, claim) => sum + claim.intel.amount_at_risk_cents,
      0,
    ),
    unassigned_expected_recovery_cents: unassignedExpected,
    overdue_total: members.reduce((sum, member) => sum + member.overdue_count, 0),
    total_expected_recovery_cents:
      members.reduce((sum, member) => sum + member.expected_recovery_cents, 0) +
      unassignedExpected,
  };
}