import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  formatCents,
  formatCentsCompact,
  slaStatus,
} from '@/hooks/use-clarity-data';
import { PageHeader, KpiStrip, ScrollBody, Panel } from '@/components/clarity/primitives';
import { detectLeakPatterns, PATTERN_LABEL } from '@/engine/leak-detection';
import { buildPayerProfiles, DIFFICULTY_CLS } from '@/engine/payer-profile';
import { buildForecast } from '@/engine/forecasting';
import { explainRecoverability } from '@/engine/recoverability';
import {
  Loader2,
  TrendingUp,
  Target,
  AlertOctagon,
  Gavel,
  Users,
  ArrowRight,
  ShieldAlert,
  FileWarning,
} from 'lucide-react';

export default function ExecutiveCommand() {
  const { data: claims, isLoading } = useClarityData();

  const data = useMemo(() => {
    if (!claims) return null;

    const atRisk = claims.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
    const appeals = claims.flatMap((c) => c.intel.appeals);
    const denials = claims.flatMap((c) => c.intel.denial_events);
    const decided = appeals.filter((a) => ['approved', 'denied', 'partial'].includes(a.status));
    const wins = decided.filter((a) => a.status === 'approved' || a.status === 'partial');
    const recovered = appeals.reduce((s, a) => s + (a.amount_recovered_cents ?? 0), 0);
    const winRate = decided.length ? wins.length / decided.length : 0;

    const fc = buildForecast(claims);
    const patterns = detectLeakPatterns(claims).slice(0, 4);
    const payers = buildPayerProfiles(claims).slice(0, 5);

    const blockedClaims = claims.filter((c) => c.intel.evidence_missing.length > 0);
    const blockedCents = blockedClaims.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);

    const slaBreaches = claims.filter(
      (c) =>
        c.intel.amount_at_risk_cents > 0 &&
        slaStatus(c.intel.sla_due_at).tone === 'breach',
    );

    const agingRisk = claims.filter(
      (c) => c.intel.amount_at_risk_cents > 0 && c.intel.aging_days >= 90,
    );

    const executiveAlerts = [
      {
        label: 'SLA breaches require attention',
        value: `${slaBreaches.length} claims`,
        dollars: slaBreaches.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0),
        link: '/queues/aging',
        tone: 'negative' as const,
      },
      {
        label: 'Documentation gaps blocking recovery',
        value: `${blockedClaims.length} claims`,
        dollars: blockedCents,
        link: '/evidence',
        tone: 'pending' as const,
      },
      {
        label: 'Aging claims at timely-filing risk',
        value: `${agingRisk.length} claims`,
        dollars: agingRisk.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0),
        link: '/queues/timely_filing_risk',
        tone: 'negative' as const,
      },
    ].filter((a) => a.dollars > 0 || Number.parseInt(a.value) > 0);

    const topOpportunities = claims
      .filter(
        (c) =>
          c.intel.amount_at_risk_cents > 0 &&
          c.intel.reimbursement_state !== 'paid' &&
          c.intel.reimbursement_state !== 'resolved' &&
          c.intel.reimbursement_state !== 'written_off',
      )
      .map((claim) => {
        const recovery = explainRecoverability(claim);
        const expected = Math.round(claim.intel.amount_at_risk_cents * recovery.score / 100);
        return { claim, recovery, expected };
      })
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 6);

    return {
      atRisk,
      recovered,
      winRate,
      fc,
      patterns,
      payers,
      denials,
      appeals,
      blockedCents,
      executiveAlerts,
      topOpportunities,
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

  const efficiency = data.fc.total_at_risk_cents
    ? data.fc.total_expected_recovery_cents / data.fc.total_at_risk_cents
    : 0;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Executive Recovery Command Center"
        subtitle="Board-level recovery view: dollars at risk, expected recovery, blockers, payer friction, and operational action."
      />

      <KpiStrip
        tiles={[
          { label: 'Revenue at Risk', value: formatCentsCompact(data.atRisk), tone: 'amount-negative' },
          { label: 'Expected Recovery', value: formatCentsCompact(data.fc.total_expected_recovery_cents), tone: 'amount-positive' },
          { label: 'Next 30 Days', value: formatCentsCompact(data.fc.monthly_projection_cents), tone: 'amount-positive' },
          { label: 'Blocked by Docs', value: formatCentsCompact(data.blockedCents), tone: 'text-status-pending' },
          { label: 'Recovery Efficiency', value: `${(efficiency * 100).toFixed(0)}%`, tone: 'text-status-cob' },
          { label: 'Appeal Win Rate', value: `${(data.winRate * 100).toFixed(0)}%`, tone: 'text-status-cob' },
        ]}
      />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel
              title="Top Executive Recovery Opportunities"
              action={
                <Link to="/today" className="text-[11.5px] text-primary hover:underline inline-flex items-center gap-1">
                  Work today <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="divide-y -mx-4 -my-4">
                {data.topOpportunities.map(({ claim, recovery, expected }) => (
                  <Link
                    key={claim.claim_id}
                    to={`/denials/${claim.claim_id}`}
                    className="grid grid-cols-[120px_1fr_140px_110px_130px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40"
                  >
                    <span className="font-mono text-[12px] font-semibold text-primary">
                      {claim.claim_id}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-foreground truncate">{claim.intel.payer_name}</div>
                      <div className="text-[10.5px] text-muted-foreground truncate">{claim.provider_name}</div>
                    </div>
                    <span className="font-mono text-[12px] text-right amount-negative">
                      {formatCents(claim.intel.amount_at_risk_cents)}
                    </span>
                    <span className="font-mono text-[11.5px] text-right text-muted-foreground">
                      {recovery.score}% rec.
                    </span>
                    <span className="font-mono text-[12px] text-right amount-positive">
                      ≈{formatCents(expected)}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel
              title="Recovery Timeline"
              action={
                <Link to="/forecast" className="text-[11.5px] text-primary hover:underline inline-flex items-center gap-1">
                  Forecast <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="space-y-2">
                {data.fc.buckets.map((bucket) => {
                  const max = Math.max(1, ...data.fc.buckets.map((x) => x.expected_recovery_cents));
                  return (
                    <div key={bucket.label} className="grid grid-cols-[160px_1fr_120px] gap-3 items-center text-[12px]">
                      <span className="text-foreground">{bucket.label}</span>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-status-paid/60"
                          style={{ width: `${(bucket.expected_recovery_cents / max) * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-right tabular-nums amount-positive">
                        {formatCents(bucket.expected_recovery_cents)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="Top Leakage Patterns"
              action={
                <Link to="/leak" className="text-[11.5px] text-primary hover:underline inline-flex items-center gap-1">
                  Leak module <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="divide-y -mx-4 -my-4">
                {data.patterns.map((pattern) => (
                  <div key={pattern.pattern_id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-foreground">{pattern.title}</div>
                        <div className="text-[10.5px] text-muted-foreground font-mono">
                          {PATTERN_LABEL[pattern.kind]} · {pattern.claim_count} claims
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[12.5px] amount-negative tabular-nums">
                          {formatCents(pattern.estimated_leakage_cents)}
                        </div>
                        <div className="text-[10.5px] amount-positive font-mono">
                          ≈{formatCents(pattern.recoverable_cents)} recoverable
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Executive Alerts" action={<ShieldAlert className="h-4 w-4 text-status-denied" />}>
              <div className="space-y-2">
                {data.executiveAlerts.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground italic">No executive alerts.</div>
                ) : (
                  data.executiveAlerts.map((alert) => (
                    <Link
                      key={alert.label}
                      to={alert.link}
                      className="block rounded border bg-muted/30 p-2.5 hover:bg-muted/60"
                    >
                      <div className="flex items-start gap-2">
                        <FileWarning
                          className={`h-3.5 w-3.5 mt-0.5 ${
                            alert.tone === 'negative' ? 'text-status-denied' : 'text-status-pending'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-foreground">{alert.label}</div>
                          <div className="text-[10.5px] font-mono text-muted-foreground">
                            {alert.value} · {formatCentsCompact(alert.dollars)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Payer Risk">
              <div className="space-y-2">
                {data.payers.map((payer) => (
                  <Link key={payer.payer_id} to="/payers" className="block rounded border bg-muted/30 p-2.5 hover:bg-muted/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-foreground truncate">
                        {payer.payer_name}
                      </span>
                      <span className={`pill border ${DIFFICULTY_CLS[payer.difficulty_tier]}`}>
                        {payer.difficulty_tier}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-1 text-[10.5px] font-mono text-muted-foreground">
                      <span>Coll. <b className="text-foreground">{(payer.collection_rate * 100).toFixed(0)}%</b></span>
                      <span>Den. <b className="text-status-denied">{(payer.denial_rate * 100).toFixed(0)}%</b></span>
                      <span>Risk <b className="amount-negative">{formatCentsCompact(payer.total_at_risk_cents)}</b></span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Operational Footprint">
              <div className="space-y-1.5 text-[12px]">
                <Row icon={<AlertOctagon className="h-3.5 w-3.5 text-status-denied" />} label="Open denials" value={String(data.denials.length)} link="/denials" />
                <Row icon={<Gavel className="h-3.5 w-3.5 text-status-cob" />} label="Active appeals" value={String(data.appeals.length)} link="/appeals" />
                <Row icon={<Target className="h-3.5 w-3.5 text-primary" />} label="Pipeline value" value={formatCentsCompact(data.fc.total_expected_recovery_cents)} link="/pipeline" />
                <Row icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />} label="Team workload" value={`${Math.round(data.fc.workload_minutes_total / 60)}h`} link="/team" />
                <Row icon={<TrendingUp className="h-3.5 w-3.5 text-status-paid" />} label="Monthly proj." value={formatCentsCompact(data.fc.monthly_projection_cents)} link="/forecast" />
              </div>
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
  link,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  link?: string;
}) {
  const inner = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-mono text-foreground text-right">{value}</span>
    </div>
  );

  return link ? (
    <Link to={link} className="block hover:bg-muted/40 -mx-1 px-1 py-0.5 rounded">
      {inner}
    </Link>
  ) : (
    inner
  );
}