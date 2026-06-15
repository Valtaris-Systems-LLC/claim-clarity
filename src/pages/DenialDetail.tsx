import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useClarityData,
  formatCents,
  relativeTime,
  slaStatus,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  Panel,
  SeverityBadge,
  StateBadge,
  OwnerChip,
  RecoverabilityBar,
  AgingChip,
  QueueChip,
  EmptyState,
  ScrollBody,
} from '@/components/clarity/primitives';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import { explainRecoverability } from '@/engine/recoverability';
import { nextBestAction, URGENCY_CLS, URGENCY_LABEL } from '@/engine/next-action';
import { recommendPlaybook, EFFORT_CLS } from '@/engine/playbooks';
import { buildPayerProfiles, DIFFICULTY_CLS } from '@/engine/payer-profile';
import {
  ArrowLeft,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Clock,
  Zap,
  Building2,
  FileText,
  ShieldCheck,
  ClipboardList,
  Activity,
  Target,
  Sparkles,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

export default function DenialDetail() {
  const { claimId } = useParams();
  const { data: claims, isLoading } = useClarityData();

  const claim = useMemo(
    () => claims?.find((c) => c.claim_id === claimId),
    [claims, claimId],
  );

  const payerProfile = useMemo(() => {
    if (!claims || !claim) return null;
    return buildPayerProfiles(claims).find((p) => p.payer_id === claim.intel.payer_id) ?? null;
  }, [claims, claim]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (!claim) {
    return (
      <EmptyState
        title="Claim not found"
        body="The claim ID does not exist in the operational dataset."
        icon={<AlertOctagon className="h-5 w-5" />}
      />
    );
  }

  const primaryDenial = claim.intel.denial_events[0];
  const recovery = explainRecoverability(claim);
  const action = nextBestAction(claim, primaryDenial);
  const playbook = primaryDenial ? recommendPlaybook(claim, primaryDenial) : null;
  const sla = slaStatus(claim.intel.sla_due_at);

  const expectedRecovery =
    playbook?.expected_recovery_cents ??
    Math.round(claim.intel.amount_at_risk_cents * recovery.score / 100);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${claim.claim_id} · Recovery Case File`}
        subtitle={`${claim.intel.payer_name} → ${claim.provider_name} · ${claim.facility_name ?? 'No facility'}`}
        actions={
          <Link
            to="/denials"
            className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Denials
          </Link>
        }
      />

      <div className="px-5 py-3 border-b bg-card flex items-center gap-3 flex-wrap">
        <StateBadge state={claim.intel.reimbursement_state} />
        <SeverityBadge severity={claim.intel.severity} />
        <AgingChip bucket={claim.intel.aging_bucket} />
        <OwnerChip owner={claim.intel.workflow_owner} />
        <SlaChip label={sla.label} tone={sla.tone} />

        <div className="ml-auto flex items-center gap-1.5">
          {claim.intel.queues.map((q) => (
            <QueueChip key={q} queue={q} />
          ))}
        </div>
      </div>

      <ScrollBody>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <CaseMetric label="Case Value" value={formatCents(claim.intel.amount_at_risk_cents)} tone="negative" />
            <CaseMetric label="Expected Recovery" value={`≈${formatCents(expectedRecovery)}`} tone="positive" />
            <CaseMetric label="Recovery Odds" value={`${recovery.score}%`} />
            <CaseMetric label="Appeal Readiness" value={`${recovery.appeal_readiness}%`} />
          </div>

          <Panel title="Recovery Command Card">
            <div className="grid grid-cols-[1fr_260px] gap-4 items-start">
              <div>
                <div className="flex items-start gap-2">
                  <Zap className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <div className="text-[16px] font-semibold text-foreground">
                      {action.headline}
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">
                      {action.owner} · {action.effort_minutes}m · confidence {action.confidence}%
                    </div>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5 text-[12px] text-muted-foreground">
                  {action.why.map((why, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      <span>{why}</span>
                    </li>
                  ))}
                </ul>

                {action.blockers.length > 0 && (
                  <div className="mt-3 rounded border border-status-denied/25 bg-status-denied/5 p-2.5">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-status-denied mb-1">
                      Blockers
                    </div>
                    <ul className="text-[11.5px] text-muted-foreground space-y-1">
                      {action.blockers.map((blocker) => (
                        <li key={blocker}>• {blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded border bg-muted/30 p-3 space-y-2">
                <CommandRow label="Expected value" value={`≈${formatCents(action.expected_value_cents)}`} tone="positive" />
                <CommandRow label="Probability" value={`${Math.round(action.expected_probability * 100)}%`} />
                <CommandRow label="Urgency" value={URGENCY_LABEL[action.urgency]} badge={URGENCY_CLS[action.urgency]} />

                <Link
                  to={`/packet/${claim.claim_id}`}
                  className="mt-2 w-full h-9 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90"
                >
                  <Send className="h-3.5 w-3.5" />
                  Generate Appeal Packet
                </Link>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              <RootCausePanel claim={claim} />
              <EvidencePanel claim={claim} />
              <TimelinePanel claim={claim} />
              <AppealWorkspace claim={claim} />
            </div>

            <div className="space-y-4">
              <FinancialPanel claim={claim} />
              {playbook && <CompactPlaybook recommendation={playbook} />}
              {payerProfile && <CompactPayerProfile profile={payerProfile} />}
              <PayerResponsesPanel claim={claim} />
            </div>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function RootCausePanel({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  const recovery = explainRecoverability(claim);
  const primary = claim.intel.denial_events[0];

  return (
    <Panel
      title="Root Cause Analysis"
      action={<span className="font-mono text-[11px] text-muted-foreground">Score {recovery.score}</span>}
    >
      {primary ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[14px] font-semibold text-foreground">
                CARC {primary.carc_code}
                {primary.rarc_code && <span className="text-muted-foreground"> / {primary.rarc_code}</span>}
              </div>
              <div className="text-[13px] text-foreground mt-1">{primary.root_cause}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {CATEGORY_LABEL[primary.category] ?? primary.category}
              </div>
            </div>
            <SeverityBadge severity={primary.severity} />
          </div>

          <RecoverabilityBar score={recovery.score} />

          <div className="divide-y rounded border bg-muted/20">
            {recovery.factors.map((factor, i) => (
              <div key={i} className="grid grid-cols-[130px_1fr_60px] gap-3 px-3 py-2 text-[12px]">
                <div>
                  <div className="font-medium text-foreground">{factor.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase">{factor.weight}</div>
                </div>
                <div className="text-muted-foreground">{factor.detail}</div>
                <div
                  className={`font-mono text-right flex items-center justify-end gap-1 ${
                    factor.delta > 0 ? 'amount-positive' : factor.delta < 0 ? 'amount-negative' : 'text-muted-foreground'
                  }`}
                >
                  {factor.delta > 0 ? <TrendingUp className="h-3 w-3" /> : factor.delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                  {factor.delta > 0 ? `+${factor.delta}` : factor.delta}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded bg-accent/40 border border-primary/15 p-2.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-primary mb-1">
              Recommended Path
            </div>
            <div className="text-[12px] text-foreground">{recovery.recommended_path}</div>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground italic">
          No denial event recorded.
        </div>
      )}
    </Panel>
  );
}

function EvidencePanel({
  claim,
}: {
  claim: Parameters<typeof nextBestAction>[0];
}) {
  const primary = claim.intel.denial_events[0];
  const playbook = primary ? recommendPlaybook(claim, primary) : null;

  const evidence = Array.from(
    new Set([
      ...(primary?.evidence_required ?? []),
      ...(playbook?.playbook.required_evidence ?? []),
      ...claim.intel.evidence_missing,
    ]),
  );

  return (
    <Panel title="Evidence Center">
      {evidence.length === 0 ? (
        <div className="text-[12px] text-muted-foreground italic">
          No evidence requirements detected.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {evidence.map((item) => {
            const missing = claim.intel.evidence_missing.some((m) =>
              m.toLowerCase().includes(item.toLowerCase().split(' ')[0]),
            );

            return (
              <div key={item} className="flex items-center gap-2 rounded border bg-muted/30 p-2">
                {missing ? (
                  <XCircle className="h-4 w-4 text-status-denied" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-status-paid" />
                )}
                <div className="text-[12px] text-foreground">{item}</div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function TimelinePanel({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  return (
    <Panel title="Recovery Timeline">
      {claim.intel.timeline.length === 0 ? (
        <div className="text-[12px] text-muted-foreground italic">No timeline events recorded.</div>
      ) : (
        <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
          {claim.intel.timeline.map((event) => (
            <li key={event.event_id} className="relative">
              <span className="absolute -left-[18px] top-1.5 h-3 w-3 rounded-full bg-card border-2 border-primary" />
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[12.5px] text-foreground">{event.description}</div>
                  <div className="text-[10.5px] text-muted-foreground font-mono">
                    {event.actor} · {relativeTime(event.occurred_at)}
                  </div>
                </div>
                {event.amount_cents !== undefined && (
                  <span className="font-mono text-[12px] tabular-nums">
                    {formatCents(event.amount_cents)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function AppealWorkspace({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  const recovery = explainRecoverability(claim);
  const current = claim.intel.appeals[0];

  return (
    <Panel title="Appeal Workspace">
      <div className="grid grid-cols-4 gap-2">
        <MiniMetric label="Appeal level" value={current ? `Level ${current.level}` : 'Not started'} />
        <MiniMetric label="Status" value={current?.status ?? 'none'} />
        <MiniMetric label="Readiness" value={`${recovery.appeal_readiness}%`} />
        <MiniMetric label="Packet" value={recovery.documentation_risk === 'LOW' ? 'Ready' : 'Blocked'} />
      </div>

      {current && (
        <div className="mt-3 rounded border bg-muted/30 p-2.5">
          <div className="text-[12px] text-foreground">{current.rationale}</div>
          <div className="mt-1.5 text-[11px] font-mono text-muted-foreground">
            Dispute: {formatCents(current.amount_in_dispute_cents)}
            {current.amount_recovered_cents ? ` · Recovered: ${formatCents(current.amount_recovered_cents)}` : ''}
          </div>
        </div>
      )}
    </Panel>
  );
}

function FinancialPanel({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  return (
    <Panel title="Financial Position">
      <div className="space-y-1.5 text-[12px]">
        <CommandRow label="Billed" value={formatCents(claim.total_billed)} />
        <CommandRow label="Expected" value={formatCents(claim.intel.expected_reimbursement_cents)} />
        <CommandRow label="Actual" value={formatCents(claim.intel.actual_reimbursement_cents)} tone="positive" />
        <CommandRow label="At risk" value={formatCents(claim.intel.amount_at_risk_cents)} tone="negative" />
        <CommandRow label="Underpayment" value={formatCents(claim.intel.underpayment_cents)} tone={claim.intel.underpayment_cents > 0 ? 'negative' : undefined} />
      </div>
    </Panel>
  );
}

function CompactPlaybook({
  recommendation,
}: {
  recommendation: NonNullable<ReturnType<typeof recommendPlaybook>>;
}) {
  return (
    <Panel
      title="Recovery Playbook"
      action={<span className={`pill border ${EFFORT_CLS[recommendation.effort]}`}>{recommendation.effort}</span>}
    >
      <div className="flex items-start gap-2">
        <ClipboardList className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <div className="text-[13px] font-semibold text-foreground">
            {recommendation.playbook.title}
          </div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">
            {recommendation.playbook.summary}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <MiniMetric label="Probability" value={`${Math.round(recommendation.expected_recovery_probability * 100)}%`} />
        <MiniMetric label="Value" value={formatCents(recommendation.expected_recovery_cents)} />
      </div>

      <div className="mt-3 space-y-1.5">
        {recommendation.playbook.steps.slice(0, 3).map((step) => (
          <div key={step.order} className="rounded border bg-muted/30 p-2 text-[11.5px]">
            <span className="font-medium text-foreground">{step.order}. {step.action}</span>
            <div className="text-[10.5px] text-muted-foreground">{step.owner}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CompactPayerProfile({
  profile,
}: {
  profile: ReturnType<typeof buildPayerProfiles>[number];
}) {
  return (
    <Panel
      title="Payer Intelligence"
      action={<span className={`pill border ${DIFFICULTY_CLS[profile.difficulty_tier]}`}>{profile.difficulty_tier}</span>}
    >
      <div className="flex items-start gap-2 mb-3">
        <Building2 className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <div className="text-[13px] font-semibold text-foreground">{profile.payer_name}</div>
          <div className="text-[10.5px] font-mono text-muted-foreground uppercase">
            {profile.payer_class} · {profile.total_claims} claims
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniMetric label="Denial rate" value={`${Math.round(profile.denial_rate * 100)}%`} />
        <MiniMetric label="Appeal win" value={`${Math.round(profile.appeal_success_rate * 100)}%`} />
        <MiniMetric label="Avg aging" value={`${profile.avg_aging_days}d`} />
        <MiniMetric label="At risk" value={formatCents(profile.total_at_risk_cents)} />
      </div>
    </Panel>
  );
}

function PayerResponsesPanel({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  return (
    <Panel title="Payer Responses">
      {claim.intel.payer_responses.length === 0 ? (
        <div className="text-[12px] text-muted-foreground italic">No payer responses recorded.</div>
      ) : (
        <div className="space-y-2">
          {claim.intel.payer_responses.map((response) => (
            <div key={response.response_id} className="rounded border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-foreground">
                  {response.response_type}
                </span>
                <span className="text-[10.5px] text-muted-foreground font-mono">
                  {relativeTime(response.received_at)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Allowed {formatCents(response.allowed_cents)} · Paid {formatCents(response.paid_cents)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CaseMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const cls =
    tone === 'positive'
      ? 'amount-positive'
      : tone === 'negative'
        ? 'amount-negative'
        : 'text-foreground';

  return (
    <div className="rounded border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[18px] font-semibold tabular-nums mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function CommandRow({
  label,
  value,
  tone,
  badge,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  badge?: string;
}) {
  const valueCls =
    tone === 'positive'
      ? 'amount-positive'
      : tone === 'negative'
        ? 'amount-negative'
        : 'text-foreground';

  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <span className={`pill border ${badge}`}>{value}</span>
      ) : (
        <span className={`font-mono tabular-nums ${valueCls}`}>{value}</span>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-[12px] font-semibold text-foreground mt-0.5 capitalize">
        {value}
      </div>
    </div>
  );
}

function SlaChip({
  label,
  tone,
}: {
  label: string;
  tone: 'ok' | 'warn' | 'breach';
}) {
  const cls =
    tone === 'breach'
      ? 'text-status-denied'
      : tone === 'warn'
        ? 'text-status-pending'
        : 'text-status-paid';

  return (
    <span className={`text-[11px] font-mono flex items-center gap-1 ${cls}`}>
      <Clock className="h-3 w-3" />
      SLA · {label}
    </span>
  );
}