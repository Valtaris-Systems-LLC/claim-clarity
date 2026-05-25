import { useQuery } from '@tanstack/react-query';
import { loadClaims, seedIfEmpty } from '@/data/repository';
import type { Claim } from '@/types/claim';
import type {
  ClaimIntel,
  WorkQueueId,
  DenialEvent,
  DenialSeverity,
  WorkflowOwner,
} from '@/types/clarity';

export interface ClarityClaim extends Claim {
  intel: ClaimIntel;
}

export interface ClaritySummary {
  total_claims: number;
  total_at_risk_cents: number;
  total_expected_reimbursement_cents: number;
  total_actual_reimbursement_cents: number;
  total_underpayment_cents: number;
  denial_count: number;
  appeal_count: number;
  escalated_count: number;
  stalled_count: number;
  high_value_count: number;
  missing_docs_count: number;
  overdue_sla_count: number;
  avg_recoverability: number;
}

export interface QueueSummary {
  queue: WorkQueueId;
  count: number;
  at_risk_cents: number;
  avg_recoverability: number;
}

export interface OwnerSummary {
  owner: WorkflowOwner;
  count: number;
  at_risk_cents: number;
  critical_count: number;
  high_count: number;
}

export function useClarityData() {
  return useQuery({
    queryKey: ['clarity-claims'],
    queryFn: async () => {
      await seedIfEmpty();

      const claims = await loadClaims();

      return claims.filter((claim): claim is ClarityClaim => !!claim.intel);
    },
    staleTime: 60_000,
  });
}

export function selectByQueue(claims: ClarityClaim[], queue: WorkQueueId): ClarityClaim[] {
  return claims.filter((claim) => claim.intel.queues.includes(queue));
}

export function allDenials(
  claims: ClarityClaim[],
): { claim: ClarityClaim; denial: DenialEvent }[] {
  const out: { claim: ClarityClaim; denial: DenialEvent }[] = [];

  for (const claim of claims) {
    for (const denial of claim.intel.denial_events) {
      out.push({ claim, denial });
    }
  }

  return out;
}

export function summarizeClarity(claims: ClarityClaim[]): ClaritySummary {
  const totalRecoverability = claims.reduce(
    (sum, claim) => sum + claim.intel.recoverability_score,
    0,
  );

  return {
    total_claims: claims.length,

    total_at_risk_cents: claims.reduce(
      (sum, claim) => sum + claim.intel.amount_at_risk_cents,
      0,
    ),

    total_expected_reimbursement_cents: claims.reduce(
      (sum, claim) => sum + claim.intel.expected_reimbursement_cents,
      0,
    ),

    total_actual_reimbursement_cents: claims.reduce(
      (sum, claim) => sum + claim.intel.actual_reimbursement_cents,
      0,
    ),

    total_underpayment_cents: claims.reduce(
      (sum, claim) => sum + claim.intel.underpayment_cents,
      0,
    ),

    denial_count: claims.reduce(
      (sum, claim) => sum + claim.intel.denial_events.length,
      0,
    ),

    appeal_count: claims.reduce(
      (sum, claim) => sum + claim.intel.appeals.length,
      0,
    ),

    escalated_count: claims.filter((claim) => claim.intel.is_escalated).length,
    stalled_count: claims.filter((claim) => claim.intel.is_stalled).length,
    high_value_count: claims.filter((claim) => claim.intel.is_high_value).length,
    missing_docs_count: claims.filter((claim) => claim.intel.evidence_missing.length > 0).length,
    overdue_sla_count: claims.filter((claim) => slaStatus(claim.intel.sla_due_at).tone === 'breach').length,

    avg_recoverability: claims.length
      ? Math.round(totalRecoverability / claims.length)
      : 0,
  };
}

export function queueSummary(claims: ClarityClaim[]): QueueSummary[] {
  const queues = new Map<WorkQueueId, ClarityClaim[]>();

  for (const claim of claims) {
    for (const queue of claim.intel.queues) {
      const list = queues.get(queue) ?? [];
      list.push(claim);
      queues.set(queue, list);
    }
  }

  return [...queues.entries()]
    .map(([queue, list]) => ({
      queue,
      count: list.length,
      at_risk_cents: list.reduce(
        (sum, claim) => sum + claim.intel.amount_at_risk_cents,
        0,
      ),
      avg_recoverability: list.length
        ? Math.round(
            list.reduce((sum, claim) => sum + claim.intel.recoverability_score, 0) /
              list.length,
          )
        : 0,
    }))
    .sort((a, b) => b.at_risk_cents - a.at_risk_cents);
}

export function ownerSummary(claims: ClarityClaim[]): OwnerSummary[] {
  const owners = new Map<WorkflowOwner, ClarityClaim[]>();

  for (const claim of claims) {
    const owner = claim.intel.workflow_owner;
    const list = owners.get(owner) ?? [];
    list.push(claim);
    owners.set(owner, list);
  }

  return [...owners.entries()]
    .map(([owner, list]) => ({
      owner,
      count: list.length,
      at_risk_cents: list.reduce(
        (sum, claim) => sum + claim.intel.amount_at_risk_cents,
        0,
      ),
      critical_count: list.filter((claim) => claim.intel.severity === 'critical').length,
      high_count: list.filter((claim) => claim.intel.severity === 'high').length,
    }))
    .sort((a, b) => b.at_risk_cents - a.at_risk_cents);
}

export function severityRank(severity: DenialSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

export function sortByOperationalPriority(claims: ClarityClaim[]): ClarityClaim[] {
  return [...claims].sort((a, b) => {
    const severityDelta = severityRank(b.intel.severity) - severityRank(a.intel.severity);
    if (severityDelta !== 0) return severityDelta;

    const riskDelta = b.intel.amount_at_risk_cents - a.intel.amount_at_risk_cents;
    if (riskDelta !== 0) return riskDelta;

    return b.intel.recoverability_score - a.intel.recoverability_score;
  });
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);

  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCentsCompact(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = abs / 100;

  if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `${sign}$${(dollars / 1_000).toFixed(1)}K`;

  return `${sign}$${dollars.toFixed(0)}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();

  if (!Number.isFinite(then)) return 'unknown';

  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 0) return 'scheduled';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

  return `${Math.floor(diff / 86400)}d ago`;
}

export function slaStatus(due: string): {
  label: string;
  tone: 'ok' | 'warn' | 'breach';
} {
  const dueAt = new Date(due).getTime();

  if (!Number.isFinite(dueAt)) {
    return { label: 'No SLA', tone: 'warn' };
  }

  const ms = dueAt - Date.now();
  const hours = ms / 3_600_000;

  if (hours < 0) {
    const daysOverdue = Math.max(1, Math.abs(Math.round(hours / 24)));
    return { label: `${daysOverdue}d overdue`, tone: 'breach' };
  }

  if (hours < 48) {
    return { label: `${Math.round(hours)}h left`, tone: 'warn' };
  }

  const days = Math.round(hours / 24);
  return { label: `${days}d left`, tone: 'ok' };
}