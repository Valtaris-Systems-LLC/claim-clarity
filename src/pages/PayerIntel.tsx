import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  formatCents,
  formatCentsCompact,
} from '@/hooks/use-clarity-data';
import { PageHeader, ScrollBody, Panel, EmptyState } from '@/components/clarity/primitives';
import {
  buildPayerProfiles,
  DIFFICULTY_CLS,
  DIFFICULTY_LABEL,
  type PayerProfileSummary,
} from '@/engine/payer-profile';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import {
  Loader2,
  Building2,
  FileText,
  ClipboardList,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  Target,
} from 'lucide-react';

export default function PayerIntel() {
  const { data: claims, isLoading } = useClarityData();

  const profiles = useMemo(
    () => (claims ? buildPayerProfiles(claims) : []),
    [claims],
  );

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = profiles.find((p) => p.payer_id === selectedId) ?? profiles[0];

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (!selected) {
    return (
      <EmptyState
        title="No payer profiles"
        body="No payer activity exists in the current dataset."
        icon={<Building2 className="h-5 w-5" />}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Payer Intelligence Hub"
        subtitle="Payer behavior, denial mix, collection difficulty, underpayment exposure, and operational guidance."
      />

      <ScrollBody>
        <div className="grid grid-cols-[340px_1fr] gap-4 p-5">
          <div className="space-y-2">
            {profiles.map((payer) => (
              <button
                key={payer.payer_id}
                onClick={() => setSelectedId(payer.payer_id)}
                className={`w-full text-left rounded border p-3 transition-colors ${
                  selected.payer_id === payer.payer_id
                    ? 'bg-primary/5 border-primary/30'
                    : 'bg-card hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12.5px] font-semibold text-foreground truncate">
                    {payer.payer_name}
                  </span>
                  <span className={`pill border ${DIFFICULTY_CLS[payer.difficulty_tier]}`}>
                    {payer.difficulty_tier}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10.5px] font-mono text-muted-foreground">
                  <span>Claims <b className="text-foreground">{payer.total_claims}</b></span>
                  <span>
                    Denials{' '}
                    <b className={payer.denial_rate >= 0.3 ? 'text-status-denied' : 'text-foreground'}>
                      {(payer.denial_rate * 100).toFixed(0)}%
                    </b>
                  </span>
                  <span>TAT <b className="text-foreground">{payer.avg_turnaround_days}d</b></span>
                </div>

                <div className="mt-1 text-[10.5px] font-mono text-muted-foreground flex items-center justify-between">
                  <span>
                    Risk <span className="amount-negative">{formatCentsCompact(payer.total_at_risk_cents)}</span>
                  </span>
                  <span>
                    Paid <span className="amount-positive">{formatCentsCompact(payer.total_paid_cents)}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>

          <PayerDetail profile={selected} />
        </div>
      </ScrollBody>
    </div>
  );
}

function PayerDetail({ profile }: { profile: PayerProfileSummary }) {
  const topReason = profile.top_denial_reasons[0];

  return (
    <div className="space-y-4">
      <Panel
        title={profile.payer_name}
        action={
          <span className={`pill border ${DIFFICULTY_CLS[profile.difficulty_tier]}`}>
            {DIFFICULTY_LABEL[profile.difficulty_tier]} · {profile.difficulty_score}
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Collection Rate" value={`${(profile.collection_rate * 100).toFixed(1)}%`} tone={profile.collection_rate >= 0.9 ? 'positive' : 'pending'} />
          <Stat label="Denial Rate" value={`${(profile.denial_rate * 100).toFixed(0)}%`} tone={profile.denial_rate >= 0.3 ? 'negative' : 'neutral'} />
          <Stat label="Appeal Win" value={`${(profile.appeal_success_rate * 100).toFixed(0)}%`} tone={profile.appeal_success_rate >= 0.5 ? 'positive' : 'pending'} />
          <Stat label="Avg Aging" value={`${profile.avg_aging_days}d`} />
          <Stat label="Billed" value={formatCentsCompact(profile.total_billed_cents)} />
          <Stat label="Collected" value={formatCentsCompact(profile.total_paid_cents)} tone="positive" />
          <Stat label="At Risk" value={formatCentsCompact(profile.total_at_risk_cents)} tone="negative" />
          <Stat label="Underpayment" value={formatCentsCompact(profile.total_underpayment_cents)} tone={profile.total_underpayment_cents > 0 ? 'pending' : 'neutral'} />
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-4">
        <Panel title="Payer Snapshot">
          <div className="space-y-2 text-[12px]">
            <InsightRow icon={<Building2 className="h-3.5 w-3.5" />} label="Payer class" value={profile.payer_class} />
            <InsightRow icon={<Target className="h-3.5 w-3.5" />} label="Claims observed" value={String(profile.total_claims)} />
            <InsightRow icon={<TrendingDown className="h-3.5 w-3.5" />} label="Top denial" value={topReason ? CATEGORY_LABEL[topReason.category] : 'None'} />
          </div>
        </Panel>

        <Panel title="Risk Mix">
          <div className="space-y-3">
            <RiskRow label="At-risk rate" value={profile.at_risk_rate} />
            <RiskRow label="Underpayment rate" value={profile.underpayment_rate} />
            <RiskRow label="Denial rate" value={profile.denial_rate} />
          </div>
        </Panel>

        <Panel title="Action Guidance">
          <div className="space-y-2">
            {profile.operational_recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-2 text-[12px] text-foreground">
                <ShieldAlert className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Panel title="Top Denial Reasons">
          {profile.top_denial_reasons.length === 0 ? (
            <div className="text-[12px] text-muted-foreground italic">
              No denials recorded for this payer.
            </div>
          ) : (
            <ul className="space-y-2">
              {profile.top_denial_reasons.map((reason) => (
                <li key={reason.category} className="rounded border bg-muted/30 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-foreground">
                      {CATEGORY_LABEL[reason.category] ?? reason.category}
                    </span>
                    <span className="font-mono text-[11px] text-status-denied">
                      {reason.count}
                    </span>
                  </div>

                  {reason.sampleMessage && (
                    <div className="text-[10.5px] text-muted-foreground italic mt-0.5">
                      "{reason.sampleMessage}"
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Documentation Requirements">
          {profile.documentation_requirements.length === 0 ? (
            <div className="text-[12px] text-muted-foreground italic">
              No payer-specific documentation pattern detected.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {profile.documentation_requirements.map((doc) => (
                <li key={doc} className="flex items-center gap-2 text-[12px] text-foreground">
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  {doc}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Playbook Notes">
        <div className="grid grid-cols-2 gap-2">
          {profile.playbook_notes.map((note, i) => (
            <div key={i} className="rounded border bg-muted/30 p-2 flex items-start gap-2">
              <ClipboardList className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <span className="text-[12px] text-muted-foreground">{note}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Difficulty Profile">
        <div className="flex items-start gap-3">
          <Building2 className="h-5 w-5 text-primary mt-0.5" />

          <div className="flex-1">
            <div className="text-[12.5px] text-foreground">
              {profile.payer_name} is rated <b>{profile.difficulty_tier}</b> based on denial rate, appeal behavior, turnaround, at-risk concentration, underpayments, and payer class.
            </div>

            <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
              {profile.difficulty_drivers.map((driver, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                  {driver}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Link
          to="/payer-requirements"
          className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"
        >
          Open payer requirements
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function RiskRow({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 30 ? 'bg-status-denied' : pct >= 15 ? 'bg-status-pending' : 'bg-status-paid';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] font-mono text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
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
  tone?: 'positive' | 'negative' | 'pending' | 'neutral';
}) {
  const cls =
    tone === 'positive'
      ? 'amount-positive'
      : tone === 'negative'
        ? 'amount-negative'
        : tone === 'pending'
          ? 'text-status-pending'
          : 'text-foreground';

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-[14px] font-semibold tabular-nums mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function InsightRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border bg-muted/30 p-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono text-foreground capitalize">{value}</span>
    </div>
  );
}