import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  relativeTime,
  formatCents,
} from '@/hooks/use-clarity-data';
import { PageHeader, ScrollBody, Panel, EmptyState } from '@/components/clarity/primitives';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import { Loader2, ShieldCheck, AlertOctagon, Clock, FileText } from 'lucide-react';

export default function AuditTrace() {
  const { data: claims, isLoading } = useClarityData();

  const events = useMemo(() => {
    if (!claims) return [];

    return claims
      .flatMap((claim) =>
        claim.intel.timeline.map((event) => ({
          ...event,
          claim,
          payer: claim.intel.payer_name,
          state: claim.intel.reimbursement_state,
          severity: claim.intel.severity,
          atRisk: claim.intel.amount_at_risk_cents,
        })),
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 150);
  }, [claims]);

  const denialEvents = useMemo(() => {
    if (!claims) return [];

    return claims
      .flatMap((claim) =>
        claim.intel.denial_events.map((denial) => ({
          claim,
          denial,
        })),
      )
      .sort((a, b) => b.denial.occurred_at.localeCompare(a.denial.occurred_at))
      .slice(0, 50);
  }, [claims]);

  const summary = useMemo(() => {
    const totalEvents = events.length;
    const escalated = claims?.filter((c) => c.intel.is_escalated).length ?? 0;
    const totalAtRisk = claims?.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0) ?? 0;
    const missingEvidence = claims?.filter((c) => c.intel.evidence_missing.length > 0).length ?? 0;

    return { totalEvents, escalated, totalAtRisk, missingEvidence };
  }, [claims, events.length]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        title="No audit events"
        body="No reimbursement timeline events have been recorded yet."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Audit & Trace"
        subtitle="Immutable operational event log across claims, denials, appeals, evidence, and reimbursement states."
      />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title={`Recent Operational Events (${events.length})`} dense>
              <div className="divide-y -mx-4 -my-4 text-[12px]">
                <div className="grid grid-cols-[130px_130px_1fr_160px_120px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <span>When</span>
                  <span>Kind</span>
                  <span>Description</span>
                  <span>Payer / Actor</span>
                  <span>Claim</span>
                </div>

                {events.map((event) => (
                  <div
                    key={event.event_id}
                    className="grid grid-cols-[130px_130px_1fr_160px_120px] gap-3 items-center px-4 py-2 hover:bg-muted/40"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {relativeTime(event.occurred_at)}
                    </span>

                    <span className="font-mono text-[11px] font-semibold text-foreground">
                      {event.kind}
                    </span>

                    <div className="min-w-0">
                      <div className="text-foreground truncate">{event.description}</div>
                      {event.amount_cents !== undefined && (
                        <div className="font-mono text-[10.5px] amount-negative">
                          {formatCents(event.amount_cents)}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-muted-foreground truncate">{event.payer}</div>
                      <div className="text-[10.5px] text-muted-foreground truncate">
                        {event.actor}
                      </div>
                    </div>

                    <Link
                      to={`/denials/${event.claim_id}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      {event.claim_id}
                    </Link>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={`Denial Trace (${denialEvents.length})`} dense>
              {denialEvents.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No denial trace"
                    body="No denial events exist in the current dataset."
                    icon={<AlertOctagon className="h-5 w-5" />}
                  />
                </div>
              ) : (
                <div className="divide-y -mx-4 -my-4 text-[12px]">
                  <div className="grid grid-cols-[110px_90px_150px_1fr_120px_120px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <span>Claim</span>
                    <span>CARC</span>
                    <span>Category</span>
                    <span>Root Cause</span>
                    <span>Recoverability</span>
                    <span className="text-right">At Risk</span>
                  </div>

                  {denialEvents.map(({ claim, denial }) => (
                    <Link
                      key={denial.denial_id}
                      to={`/denials/${claim.claim_id}`}
                      className="grid grid-cols-[110px_90px_150px_1fr_120px_120px] gap-3 items-center px-4 py-2 hover:bg-muted/40"
                    >
                      <span className="font-mono text-primary font-semibold">
                        {claim.claim_id}
                      </span>

                      <span className="font-mono text-foreground">
                        {denial.carc_code}
                        {denial.rarc_code ? `/${denial.rarc_code}` : ''}
                      </span>

                      <span className="text-muted-foreground truncate">
                        {CATEGORY_LABEL[denial.category] ?? denial.category}
                      </span>

                      <span className="text-foreground truncate">
                        {denial.root_cause}
                      </span>

                      <span className="font-mono text-muted-foreground">
                        {denial.recoverability_score}%
                      </span>

                      <span className="font-mono text-right amount-negative">
                        {formatCents(denial.amount_cents)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Audit Summary">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Events" value={String(summary.totalEvents)} />
                <Metric label="Escalated" value={String(summary.escalated)} tone="negative" />
                <Metric label="At Risk" value={formatCents(summary.totalAtRisk)} tone="negative" />
                <Metric label="Missing Evidence" value={String(summary.missingEvidence)} tone="pending" />
              </div>
            </Panel>

            <Panel title="Trace Guarantees">
              <div className="space-y-2 text-[12px]">
                <TraceGuarantee
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  label="Event timeline preserved"
                />
                <TraceGuarantee
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="SLA and aging context retained"
                />
                <TraceGuarantee
                  icon={<AlertOctagon className="h-3.5 w-3.5" />}
                  label="Denial root cause traceable"
                />
                <TraceGuarantee
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Evidence gaps auditable"
                />
              </div>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'negative' | 'positive' | 'pending';
}) {
  const cls =
    tone === 'negative'
      ? 'amount-negative'
      : tone === 'positive'
        ? 'amount-positive'
        : tone === 'pending'
          ? 'text-status-pending'
          : 'text-foreground';

  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-[13px] font-semibold mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function TraceGuarantee({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded border bg-muted/30 p-2 text-foreground">
      {icon}
      {label}
    </div>
  );
}