import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useClarityData,
  selectByQueue,
  formatCents,
  formatCentsCompact,
  slaStatus,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  ScrollBody,
  SeverityBadge,
  OwnerChip,
  AgingChip,
  EmptyState,
  RecoverabilityBar,
} from '@/components/clarity/primitives';
import { QUEUE_LABEL } from '@/engine/denial-intelligence';
import { nextBestAction } from '@/engine/next-action';
import { explainRecoverability } from '@/engine/recoverability';
import { useAssignments } from '@/hooks/use-assignments';
import type { WorkQueueId } from '@/types/clarity';
import { ListChecks, Loader2, ArrowLeft, Clock, Zap } from 'lucide-react';

const QUEUE_ORDER: WorkQueueId[] = [
  'unresolved_denials',
  'high_value',
  'appeals_in_progress',
  'escalation',
  'missing_docs',
  'cob_review',
  'underpayment_review',
  'timely_filing_risk',
  'aging',
  'stalled',
  'payer_follow_up',
];

export default function WorkQueues() {
  const { queueId } = useParams<{ queueId?: WorkQueueId }>();
  const { data: claims, isLoading } = useClarityData();

  if (isLoading || !claims) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (queueId) return <QueueDetail queueId={queueId} claims={claims} />;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Work Queues"
        subtitle="Operational queues ranked by revenue at risk, SLA pressure, severity, and ownership."
      />

      <ScrollBody>
        <div className="grid grid-cols-2 gap-4 p-5">
          {QUEUE_ORDER.map((q) => {
            const items = selectByQueue(claims, q);
            const atRisk = items.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
            const expected = items.reduce((s, c) => {
              const exp = explainRecoverability(c);
              return s + Math.round(c.intel.amount_at_risk_cents * exp.score / 100);
            }, 0);
            const breach = items.filter((c) => slaStatus(c.intel.sla_due_at).tone === 'breach').length;
            const critical = items.filter((c) => c.intel.severity === 'critical').length;

            return (
              <Link key={q} to={`/queues/${q}`} className="panel hover:border-primary/40 transition-colors">
                <div className="panel-header">
                  <span className="panel-title flex items-center gap-2">
                    <ListChecks className="h-3.5 w-3.5" />
                    {QUEUE_LABEL[q]}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{items.length}</span>
                </div>

                <div className="p-4 grid grid-cols-4 gap-3">
                  <Stat label="At Risk" value={formatCentsCompact(atRisk)} tone="negative" />
                  <Stat label="Expected" value={formatCentsCompact(expected)} tone="positive" />
                  <Stat label="Critical" value={String(critical)} tone={critical > 0 ? 'danger' : ''} />
                  <Stat label="SLA Breach" value={String(breach)} tone={breach > 0 ? 'danger' : ''} />
                </div>
              </Link>
            );
          })}
        </div>
      </ScrollBody>
    </div>
  );
}

function QueueDetail({
  queueId,
  claims,
}: {
  queueId: WorkQueueId;
  claims: NonNullable<ReturnType<typeof useClarityData>['data']>;
}) {
  const { get, assign, assignees } = useAssignments();

  const items = useMemo(() => selectByQueue(claims, queueId), [claims, queueId]);

  const sorted = useMemo(() => {
    const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

    return [...items].sort((a, b) => {
      const severityDelta = sevRank[a.intel.severity] - sevRank[b.intel.severity];
      if (severityDelta !== 0) return severityDelta;

      const riskDelta = b.intel.amount_at_risk_cents - a.intel.amount_at_risk_cents;
      if (riskDelta !== 0) return riskDelta;

      return new Date(a.intel.sla_due_at).getTime() - new Date(b.intel.sla_due_at).getTime();
    });
  }, [items]);

  if (!QUEUE_LABEL[queueId]) {
    return <EmptyState title="Unknown queue" icon={<ListChecks className="h-5 w-5" />} />;
  }

  const totalRisk = sorted.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
  const expected = sorted.reduce((s, c) => {
    const exp = explainRecoverability(c);
    return s + Math.round(c.intel.amount_at_risk_cents * exp.score / 100);
  }, 0);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={QUEUE_LABEL[queueId]}
        subtitle={`${items.length} item${items.length !== 1 ? 's' : ''} · ${formatCentsCompact(totalRisk)} at risk · ${formatCentsCompact(expected)} expected recovery.`}
        actions={
          <Link
            to="/queues"
            className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Queues
          </Link>
        }
      />

      <ScrollBody>
        {sorted.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            body="Nothing currently meets this queue's criteria."
            icon={<ListChecks className="h-5 w-5" />}
          />
        ) : (
          <div className="divide-y bg-card">
            <div className="sticky top-0 z-10 grid grid-cols-[110px_1fr_110px_95px_95px_100px_120px_145px_155px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
              <span>Claim</span>
              <span>Payer / Provider</span>
              <span>Owner</span>
              <span>Severity</span>
              <span>Aging</span>
              <span>Recover.</span>
              <span className="text-right">At Risk</span>
              <span>Next Action</span>
              <span>Assignee / SLA</span>
            </div>

            {sorted.map((c) => {
              const sla = slaStatus(c.intel.sla_due_at);
              const slaCls =
                sla.tone === 'breach'
                  ? 'text-status-denied'
                  : sla.tone === 'warn'
                    ? 'text-status-pending'
                    : 'text-status-paid';

              const action = nextBestAction(c);
              const assignment = get(c.claim_id);

              return (
                <Link
                  key={c.claim_id}
                  to={`/denials/${c.claim_id}`}
                  className="grid grid-cols-[110px_1fr_110px_95px_95px_100px_120px_145px_155px] gap-3 items-center px-5 py-2.5 hover:bg-muted/40 transition-colors"
                >
                  <span className="font-mono text-[12px] font-semibold text-foreground">
                    {c.claim_id}
                  </span>

                  <div className="min-w-0">
                    <div className="text-[12.5px] truncate text-foreground">{c.intel.payer_name}</div>
                    <div className="text-[10.5px] text-muted-foreground truncate">{c.provider_name}</div>
                  </div>

                  <OwnerChip owner={c.intel.workflow_owner} />
                  <SeverityBadge severity={c.intel.severity} />
                  <AgingChip bucket={c.intel.aging_bucket} />
                  <RecoverabilityBar score={c.intel.recoverability_score} />

                  <span className="font-mono text-[12.5px] amount-negative text-right tabular-nums">
                    {formatCents(c.intel.amount_at_risk_cents)}
                  </span>

                  <div className="min-w-0 text-[10.5px] text-muted-foreground flex items-start gap-1">
                    <Zap className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span className="truncate">{action.headline}</span>
                  </div>

                  <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
                    <select
                      value={assignment.assignee ?? ''}
                      onChange={(event) => assign(c.claim_id, event.target.value || undefined)}
                      className="h-6 text-[10.5px] rounded border bg-card px-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <span className={`text-[10.5px] font-mono flex items-center gap-1 ${slaCls}`}>
                      <Clock className="h-3 w-3" />
                      {sla.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </ScrollBody>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'negative' | 'positive' | 'danger' | '';
}) {
  const cls =
    tone === 'negative'
      ? 'amount-negative'
      : tone === 'positive'
        ? 'amount-positive'
        : tone === 'danger'
          ? 'text-status-denied'
          : 'text-foreground';

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}