import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  formatCentsCompact,
  slaStatus,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  KpiStrip,
  ScrollBody,
  SeverityBadge,
  RecoverabilityBar,
  OwnerChip,
} from '@/components/clarity/primitives';
import { useAssignments } from '@/hooks/use-assignments';
import { explainRecoverability } from '@/engine/recoverability';
import { nextBestAction, actionLabel } from '@/engine/next-action';
import type { ClarityClaim } from '@/hooks/use-clarity-data';
import { Loader2, Clock, Zap, AlertTriangle } from 'lucide-react';

type Stage =
  | 'Denied'
  | 'Assigned'
  | 'Evidence'
  | 'Appeal Drafting'
  | 'Submitted'
  | 'Payer Review'
  | 'Recovered'
  | 'Lost';

const STAGES: Stage[] = [
  'Denied',
  'Assigned',
  'Evidence',
  'Appeal Drafting',
  'Submitted',
  'Payer Review',
  'Recovered',
  'Lost',
];

const STAGE_TONE: Record<Stage, string> = {
  Denied: 'border-status-denied/40 bg-status-denied/5',
  Assigned: 'border-muted-foreground/30 bg-muted/30',
  Evidence: 'border-status-pending/30 bg-status-pending/5',
  'Appeal Drafting': 'border-status-cob/30 bg-status-cob/5',
  Submitted: 'border-status-cob/40 bg-status-cob/10',
  'Payer Review': 'border-status-pending/40 bg-status-pending/10',
  Recovered: 'border-status-paid/40 bg-status-paid/10',
  Lost: 'border-status-denied/40 bg-status-denied/10',
};

function classifyStage(claim: ClarityClaim, assigned: boolean): Stage {
  const intel = claim.intel;

  if (
    intel.reimbursement_state === 'paid' ||
    intel.reimbursement_state === 'resolved' ||
    intel.appeals.some((appeal) => appeal.status === 'approved' || appeal.status === 'partial')
  ) {
    return 'Recovered';
  }

  if (
    intel.reimbursement_state === 'written_off' ||
    (intel.appeals.length > 0 && intel.appeals.every((appeal) => appeal.status === 'denied'))
  ) {
    return 'Lost';
  }

  if (intel.appeals.some((appeal) => appeal.status === 'in_review')) return 'Payer Review';
  if (intel.appeals.some((appeal) => appeal.status === 'submitted')) return 'Submitted';
  if (intel.appeals.some((appeal) => appeal.status === 'draft')) return 'Appeal Drafting';
  if (intel.evidence_missing.length > 0) return 'Evidence';
  if (assigned) return 'Assigned';

  return 'Denied';
}

export default function RecoveryPipeline() {
  const { data: claims, isLoading } = useClarityData();
  const { store } = useAssignments();

  const grouped = useMemo(() => {
    const out = Object.fromEntries(STAGES.map((stage) => [stage, []])) as Record<
      Stage,
      Array<{
        claim: ClarityClaim;
        expected: number;
        recoveryScore: number;
        action: string;
      }>
    >;

    if (!claims) return out;

    for (const claim of claims) {
      const assigned = Boolean(store[claim.claim_id]?.assignee);
      const stage = classifyStage(claim, assigned);
      const recovery = explainRecoverability(claim);
      const action = nextBestAction(claim, claim.intel.denial_events[0]);

      out[stage].push({
        claim,
        expected: Math.round(claim.intel.amount_at_risk_cents * recovery.score / 100),
        recoveryScore: recovery.score,
        action: actionLabel(action.kind),
      });
    }

    for (const stage of STAGES) {
      out[stage].sort((a, b) => b.expected - a.expected);
    }

    return out;
  }, [claims, store]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const totals = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      grouped[stage].reduce((sum, row) => sum + row.claim.intel.amount_at_risk_cents, 0),
    ]),
  ) as Record<Stage, number>;

  const expectedTotals = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      grouped[stage].reduce((sum, row) => sum + row.expected, 0),
    ]),
  ) as Record<Stage, number>;

  const activeStages = STAGES.filter((stage) => stage !== 'Recovered' && stage !== 'Lost');

  const pipelineValue = activeStages.reduce((sum, stage) => sum + totals[stage], 0);
  const expectedPipeline = activeStages.reduce((sum, stage) => sum + expectedTotals[stage], 0);
  const recovered = totals.Recovered;
  const lost = totals.Lost;
  const blockedDocs = grouped.Evidence.reduce(
    (sum, row) => sum + row.claim.intel.amount_at_risk_cents,
    0,
  );
  const slaBreaches = activeStages.reduce(
    (sum, stage) =>
      sum +
      grouped[stage].filter((row) => slaStatus(row.claim.intel.sla_due_at).tone === 'breach')
        .length,
    0,
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Recovery Pipeline"
        subtitle="Kanban view of revenue moving from denial to recovery, with blockers, expected value, and next action."
      />

      <KpiStrip
        tiles={[
          {
            label: 'Pipeline Value',
            value: formatCentsCompact(pipelineValue),
            tone: 'amount-negative',
          },
          {
            label: 'Expected Recovery',
            value: formatCentsCompact(expectedPipeline),
            tone: 'amount-positive',
          },
          {
            label: 'Blocked by Evidence',
            value: formatCentsCompact(blockedDocs),
            tone: blockedDocs > 0 ? 'text-status-pending' : 'text-status-paid',
          },
          {
            label: 'Recovered',
            value: formatCentsCompact(recovered),
            tone: 'amount-positive',
          },
          {
            label: 'Lost',
            value: formatCentsCompact(lost),
            tone: lost > 0 ? 'amount-negative' : 'text-muted-foreground',
          },
          {
            label: 'SLA Breaches',
            value: String(slaBreaches),
            tone: slaBreaches > 0 ? 'text-status-denied' : 'text-status-paid',
          },
        ]}
      />

      <ScrollBody>
        <div className="p-4">
          <div className="grid grid-cols-8 gap-2 min-h-[540px]">
            {STAGES.map((stage) => (
              <div
                key={stage}
                className={`flex flex-col rounded border-t-2 ${STAGE_TONE[stage]} min-h-[500px]`}
              >
                <div className="px-2 py-2 border-b bg-card">
                  <div className="flex items-center justify-between">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-foreground">
                      {stage}
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {grouped[stage].length}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="text-[10.5px] font-mono amount-negative">
                      {formatCentsCompact(totals[stage])}
                    </div>
                    <div className="text-[10.5px] font-mono amount-positive">
                      ≈{formatCentsCompact(expectedTotals[stage])}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {grouped[stage].slice(0, 50).map(({ claim, expected, recoveryScore, action }) => {
                    const sla = slaStatus(claim.intel.sla_due_at);
                    const slaCls =
                      sla.tone === 'breach'
                        ? 'text-status-denied'
                        : sla.tone === 'warn'
                          ? 'text-status-pending'
                          : 'text-status-paid';

                    const hasDocGap = claim.intel.evidence_missing.length > 0;

                    return (
                      <Link
                        key={claim.claim_id}
                        to={`/denials/${claim.claim_id}`}
                        className="block rounded border bg-card p-2 hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <span className="font-mono text-[10.5px] font-semibold text-foreground truncate">
                            {claim.claim_id}
                          </span>
                          <SeverityBadge severity={claim.intel.severity} />
                        </div>

                        <div className="text-[10.5px] text-muted-foreground truncate">
                          {claim.intel.payer_name}
                        </div>

                        <div className="mt-1">
                          <RecoverabilityBar score={recoveryScore} />
                        </div>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="font-mono text-[10.5px] tabular-nums amount-negative">
                            {formatCentsCompact(claim.intel.amount_at_risk_cents)}
                          </span>
                          <span className="font-mono text-[10.5px] tabular-nums amount-positive">
                            ≈{formatCentsCompact(expected)}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-1">
                          <span className={`text-[9.5px] font-mono flex items-center gap-0.5 ${slaCls}`}>
                            <Clock className="h-2.5 w-2.5" />
                            {claim.intel.aging_days}d
                          </span>

                          {hasDocGap ? (
                            <span className="text-[9.5px] text-status-pending flex items-center gap-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              docs
                            </span>
                          ) : (
                            <span className="text-[9.5px] text-muted-foreground flex items-center gap-0.5 truncate">
                              <Zap className="h-2.5 w-2.5" />
                              {action}
                            </span>
                          )}
                        </div>

                        {store[claim.claim_id]?.assignee && (
                          <div className="mt-1">
                            <OwnerChip owner={claim.intel.workflow_owner} />
                          </div>
                        )}
                      </Link>
                    );
                  })}

                  {grouped[stage].length === 0 && (
                    <div className="text-center text-[11px] text-muted-foreground py-6 italic">
                      —
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}