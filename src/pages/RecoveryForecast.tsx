import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  formatCents,
  formatCentsCompact,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  KpiStrip,
  ScrollBody,
  Panel,
  EmptyState,
} from '@/components/clarity/primitives';
import { buildForecast } from '@/engine/forecasting';
import { nextBestAction, actionLabel } from '@/engine/next-action';
import { explainRecoverability } from '@/engine/recoverability';
import {
  Loader2,
  TrendingUp,
  Calendar,
  Clock,
  Info,
  ArrowRight,
  AlertTriangle,
  Zap,
} from 'lucide-react';

export default function RecoveryForecast() {
  const { data: claims, isLoading } = useClarityData();

  const data = useMemo(() => {
    if (!claims) return null;

    const fc = buildForecast(claims);

    const active = claims.filter(
      (claim) =>
        claim.intel.amount_at_risk_cents > 0 &&
        claim.intel.reimbursement_state !== 'paid' &&
        claim.intel.reimbursement_state !== 'resolved' &&
        claim.intel.reimbursement_state !== 'written_off',
    );

    const readyNow = active
      .map((claim) => {
        const recovery = explainRecoverability(claim);
        const action = nextBestAction(claim, claim.intel.denial_events[0]);
        const expected = Math.round(
          claim.intel.amount_at_risk_cents * recovery.score / 100,
        );

        return { claim, recovery, action, expected };
      })
      .filter(
        (row) =>
          row.expected > 0 &&
          row.claim.intel.evidence_missing.length === 0 &&
          row.recovery.score >= 50,
      )
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 8);

    const blocked = active.filter((claim) => claim.intel.evidence_missing.length > 0);
    const blockedCents = blocked.reduce(
      (sum, claim) => sum + claim.intel.amount_at_risk_cents,
      0,
    );

    const agingRisk = active.filter((claim) => claim.intel.aging_days >= 90);
    const agingRiskCents = agingRisk.reduce(
      (sum, claim) => sum + claim.intel.amount_at_risk_cents,
      0,
    );

    const highConfidence = active.filter(
      (claim) => explainRecoverability(claim).tier === 'HIGH',
    );

    return {
      fc,
      active,
      readyNow,
      blocked,
      blockedCents,
      agingRisk,
      agingRiskCents,
      highConfidence,
    };
  }, [claims]);

  if (isLoading || !data) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const { fc } = data;
  const maxBucket = Math.max(1, ...fc.buckets.map((b) => b.expected_recovery_cents));
  const hoursTotal = Math.round(fc.workload_minutes_total / 60);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Recovery Forecast"
        subtitle="Expected recoverable revenue, timing, blockers, workload, and claims ready to move now."
      />

      <KpiStrip
        tiles={[
          {
            label: 'Total At Risk',
            value: formatCentsCompact(fc.total_at_risk_cents),
            tone: 'amount-negative',
          },
          {
            label: 'Expected Recovery',
            value: formatCentsCompact(fc.total_expected_recovery_cents),
            tone: 'amount-positive',
          },
          {
            label: 'Next 30 Days',
            value: formatCentsCompact(fc.monthly_projection_cents),
            tone: 'amount-positive',
          },
          {
            label: 'Blocked by Docs',
            value: formatCentsCompact(data.blockedCents),
            tone: data.blockedCents > 0 ? 'text-status-pending' : 'text-status-paid',
          },
          {
            label: 'Aging Risk',
            value: formatCentsCompact(data.agingRiskCents),
            tone: data.agingRiskCents > 0 ? 'text-status-denied' : 'text-status-paid',
          },
          {
            label: 'Workload',
            value: `${hoursTotal}h`,
            sub: 'estimated effort',
          },
        ]}
      />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Recovery Timeline">
              {fc.buckets.length === 0 ? (
                <EmptyState
                  title="No forecastable recovery"
                  body="No active recoverable claims are currently in the pipeline."
                  icon={<TrendingUp className="h-5 w-5" />}
                />
              ) : (
                <div className="space-y-3">
                  {fc.buckets.map((bucket) => (
                    <div
                      key={bucket.label}
                      className="grid grid-cols-[160px_1fr_140px_110px] gap-3 items-center"
                    >
                      <div>
                        <div className="text-[12.5px] font-medium text-foreground">
                          {bucket.label}
                        </div>
                        <div className="text-[10.5px] font-mono text-muted-foreground">
                          {bucket.claim_count} claims ·{' '}
                          {Math.round(bucket.appeal_workload_minutes / 60)}h work
                        </div>
                      </div>

                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-status-paid/60"
                          style={{
                            width: `${(bucket.expected_recovery_cents / maxBucket) * 100}%`,
                          }}
                        />
                      </div>

                      <span className="font-mono text-[13px] text-right tabular-nums amount-positive">
                        {formatCents(bucket.expected_recovery_cents)}
                      </span>

                      <span
                        className="text-[10.5px] font-mono text-muted-foreground truncate"
                        title={bucket.drivers.join(', ')}
                      >
                        {bucket.drivers[0] ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Ready-to-Recover Now"
              action={
                <Link
                  to="/today"
                  className="text-[11.5px] text-primary hover:underline inline-flex items-center gap-1"
                >
                  Work today
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {data.readyNow.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No high-confidence claims are fully ready yet.
                </div>
              ) : (
                <div className="divide-y -mx-4 -my-4">
                  {data.readyNow.map(({ claim, action, expected }) => (
                    <Link
                      key={claim.claim_id}
                      to={`/denials/${claim.claim_id}`}
                      className="grid grid-cols-[120px_1fr_130px_130px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40"
                    >
                      <span className="font-mono text-[12px] font-semibold text-primary">
                        {claim.claim_id}
                      </span>

                      <div className="min-w-0">
                        <div className="text-[12.5px] text-foreground truncate">
                          {claim.intel.payer_name}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground flex items-center gap-1 truncate">
                          <Zap className="h-3 w-3" />
                          {actionLabel(action.kind)}
                        </div>
                      </div>

                      <span className="font-mono text-[12px] text-right tabular-nums amount-positive">
                        ≈{formatCents(expected)}
                      </span>

                      <span className="text-[10.5px] text-muted-foreground truncate">
                        {action.owner}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Bucket Drivers">
              <div className="space-y-2.5">
                {fc.buckets.map((bucket) => (
                  <div key={bucket.label} className="rounded border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-medium text-foreground">
                        {bucket.label}
                      </span>
                      <span className="font-mono text-[11.5px] amount-positive">
                        ≈{formatCents(bucket.expected_recovery_cents)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {bucket.drivers.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground italic">
                          No top drivers identified.
                        </span>
                      ) : (
                        bucket.drivers.map((driver) => (
                          <span
                            key={driver}
                            className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-card border text-foreground"
                          >
                            {driver}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Forecast Summary" action={<TrendingUp className="h-4 w-4 text-status-paid" />}>
              <div className="space-y-2 text-[12px]">
                <Row
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label="Next 30 days"
                  value={formatCents(fc.monthly_projection_cents)}
                  tone="amount-positive"
                />
                <Row
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="Total expected"
                  value={formatCents(fc.total_expected_recovery_cents)}
                  tone="amount-positive"
                />
                <Row
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Workload"
                  value={`${hoursTotal}h`}
                />
                <Row
                  label="Recovery rate"
                  value={`${(fc.expected_recovery_rate * 100).toFixed(1)}%`}
                />
                <Row
                  label="High-confidence claims"
                  value={String(data.highConfidence.length)}
                  tone="text-status-paid"
                />
              </div>
            </Panel>

            <Panel title="Forecast Blockers" action={<AlertTriangle className="h-4 w-4 text-status-pending" />}>
              <div className="space-y-2 text-[12px]">
                <Row
                  label="Claims blocked by docs"
                  value={String(data.blocked.length)}
                  tone={data.blocked.length > 0 ? 'text-status-pending' : 'text-status-paid'}
                />
                <Row
                  label="Blocked dollars"
                  value={formatCents(data.blockedCents)}
                  tone={data.blockedCents > 0 ? 'amount-negative' : 'amount-positive'}
                />
                <Row
                  label="Aging-risk claims"
                  value={String(data.agingRisk.length)}
                  tone={data.agingRisk.length > 0 ? 'text-status-denied' : 'text-status-paid'}
                />
                <Row
                  label="Aging-risk dollars"
                  value={formatCents(data.agingRiskCents)}
                  tone={data.agingRiskCents > 0 ? 'amount-negative' : 'amount-positive'}
                />
              </div>
            </Panel>

            <Panel title="Assumptions" action={<Info className="h-4 w-4 text-muted-foreground" />}>
              <ul className="space-y-1.5 text-[11.5px] text-muted-foreground">
                {fc.assumptions.map((assumption, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={`font-mono text-right ${tone ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}