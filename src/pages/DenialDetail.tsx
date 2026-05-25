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
  FileText,
  CheckCircle2,
  Send,
  Loader2,
  Clock,
  TrendingUp,
  TrendingDown as TrendDownIcon,
  Sparkles,
  Zap,
  ShieldAlert,
  Building2,
  ListChecks,
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
  const playbook = primaryDenial ? recommendPlaybook(claim, primaryDenial) : null;
  const sla = slaStatus(claim.intel.sla_due_at);

  const slaToneCls =
    sla.tone === 'breach'
      ? 'text-status-denied'
      : sla.tone === 'warn'
        ? 'text-status-pending'
        : 'text-status-paid';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${claim.claim_id} · Denial Drilldown`}
        subtitle={`${claim.intel.payer_name} → ${claim.provider_name} (${claim.facility_name ?? 'No facility'}) · ${claim.lines.length} service line${claim.lines.length !== 1 ? 's' : ''}`}
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

        {claim.intel.is_escalated && <span className="status-denied">Escalated</span>}

        <span className={`text-[11px] font-mono flex items-center gap-1 ${slaToneCls}`}>
          <Clock className="h-3 w-3" />
          SLA · {sla.label}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {claim.intel.queues.map((q) => (
            <QueueChip key={q} queue={q} />
          ))}
        </div>
      </div>

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Reimbursement Position">
              <div className="grid grid-cols-4 gap-4">
                <Money label="Billed" value={formatCents(claim.total_billed)} />
                <Money label="Expected" value={formatCents(claim.intel.expected_reimbursement_cents)} />
                <Money label="Actual" value={formatCents(claim.intel.actual_reimbursement_cents)} tone="positive" />
                <Money label="At Risk" value={formatCents(claim.intel.amount_at_risk_cents)} tone="negative" />
              </div>

              <div className="mt-4 pt-3 border-t flex items-center gap-4 text-[11.5px] text-muted-foreground">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider mb-1">Recoverability</div>
                  <RecoverabilityBar score={claim.intel.recoverability_score} />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider">Underpayment</div>
                  <div className="font-mono text-[13px] text-foreground">
                    {formatCents(claim.intel.underpayment_cents)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider">Aging</div>
                  <div className="font-mono text-[13px] text-foreground">
                    {claim.intel.aging_days}d
                  </div>
                </div>
              </div>
            </Panel>

            <RecoverabilityExplainer claim={claim} />

            {playbook && <PlaybookPanel recommendation={playbook} />}

            <Panel title={`Denial Events (${claim.intel.denial_events.length})`}>
              {claim.intel.denial_events.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No denials recorded — claim cleanly adjudicated.
                </div>
              ) : (
                <div className="divide-y -mx-4 -my-4">
                  {claim.intel.denial_events.map((d) => (
                    <div key={d.denial_id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="font-mono text-[14px] font-semibold text-foreground shrink-0">
                          {d.carc_code}
                          {d.rarc_code && <span className="text-muted-foreground">/{d.rarc_code}</span>}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-foreground">
                            {d.root_cause}
                          </div>

                          {d.payer_message && (
                            <div className="text-[11.5px] text-muted-foreground italic mt-0.5">
                              "{d.payer_message}"
                            </div>
                          )}
                        </div>

                        <SeverityBadge severity={d.severity} />
                      </div>

                      <div className="grid grid-cols-[1fr_1fr_1fr_120px] gap-3 items-center pt-1">
                        <KV label="Category" value={CATEGORY_LABEL[d.category] ?? d.category} />
                        <KV label="Owner" value={d.workflow_owner} />
                        <KV label="Group" value={d.group_code} mono />

                        <div className="text-right">
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                            At Risk
                          </div>
                          <div className="font-mono text-[12.5px] amount-negative tabular-nums">
                            {formatCents(d.amount_cents)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">
                            Recoverability
                          </div>
                          <RecoverabilityBar score={d.recoverability_score} />
                        </div>

                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">
                            Appeal Eligible
                          </div>
                          <span
                            className={
                              d.appeal_eligible
                                ? 'text-status-paid text-[12px] font-medium'
                                : 'text-muted-foreground text-[12px]'
                            }
                          >
                            {d.appeal_eligible ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>

                      <div className="rounded bg-accent/40 border border-primary/15 p-2.5 mt-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                          Recommended Action
                        </div>
                        <div className="text-[12px] text-foreground">
                          {d.recommended_action}
                        </div>
                      </div>

                      {d.evidence_required.length > 0 && (
                        <div className="text-[11.5px] text-muted-foreground">
                          <span className="font-semibold text-foreground">Evidence required: </span>
                          {d.evidence_required.join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Reimbursement Timeline">
              {claim.intel.timeline.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No timeline events recorded yet.
                </div>
              ) : (
                <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
                  {claim.intel.timeline.map((event) => (
                    <li key={event.event_id} className="relative">
                      <span className="absolute -left-[18px] top-1.5 h-3 w-3 rounded-full bg-card border-2 border-primary" />

                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12.5px] text-foreground">
                            {event.description}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground font-mono">
                            {event.actor} · {relativeTime(event.occurred_at)}
                          </div>
                        </div>

                        {event.amount_cents !== undefined && (
                          <span className="font-mono text-[12px] text-foreground tabular-nums shrink-0">
                            {formatCents(event.amount_cents)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <NextActionPanel claim={claim} />

            {payerProfile && <PayerProfilePanel profile={payerProfile} />}

            <Panel title="Quick Actions">
              <div className="space-y-1.5">
                <Link
                  to={`/packet/${claim.claim_id}`}
                  className="w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-3.5 w-3.5" />
                  Build Appeal Packet
                </Link>

                <ActionBtn icon={<FileText className="h-3.5 w-3.5" />} label="Attach Evidence" />
                <ActionBtn icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Mark Resolved" />
                <ActionBtn icon={<AlertOctagon className="h-3.5 w-3.5" />} label="Escalate" tone="danger" />
              </div>
            </Panel>

            {claim.intel.evidence_missing.length > 0 && (
              <Panel title="Missing Evidence">
                <ul className="space-y-1.5 text-[12px]">
                  {claim.intel.evidence_missing.map((evidence) => (
                    <li key={evidence} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-denied shrink-0" />
                      <span className="text-foreground">{evidence}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Payer Responses">
              {claim.intel.payer_responses.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No payer responses recorded.
                </div>
              ) : (
                <div className="space-y-2 text-[12px]">
                  {claim.intel.payer_responses.map((response) => (
                    <div key={response.response_id} className="rounded border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {response.response_type}
                        </span>
                        <span className="text-[10.5px] text-muted-foreground font-mono">
                          {relativeTime(response.received_at)}
                        </span>
                      </div>

                      <div className="text-[11.5px] text-muted-foreground">
                        {response.payer_name} · {response.source}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-1.5 text-[11px] font-mono tabular-nums">
                        <span>
                          Allowed <b className="text-foreground">{formatCents(response.allowed_cents)}</b>
                        </span>
                        <span>
                          Paid <b className="text-foreground">{formatCents(response.paid_cents)}</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {claim.intel.appeals.length > 0 && (
              <Panel title={`Appeals (${claim.intel.appeals.length})`}>
                <div className="space-y-2 text-[12px]">
                  {claim.intel.appeals.map((appeal) => (
                    <div key={appeal.appeal_id} className="rounded border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          Level {appeal.level} · {appeal.status}
                        </span>
                        <span className="text-[10.5px] text-muted-foreground font-mono">
                          {appeal.filed_at ? relativeTime(appeal.filed_at) : 'unfiled'}
                        </span>
                      </div>

                      <div className="text-[11.5px] text-foreground">
                        {appeal.rationale}
                      </div>

                      <div className="mt-1.5 text-[11px] font-mono">
                        Disputed <b>{formatCents(appeal.amount_in_dispute_cents)}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Money({
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
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-[16px] font-semibold tabular-nums mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-[12px] text-foreground ${mono ? 'font-mono' : ''} capitalize`}>
        {value}
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: 'primary' | 'danger';
}) {
  const cls =
    tone === 'primary'
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : tone === 'danger'
        ? 'border bg-card text-status-denied hover:bg-status-denied/5'
        : 'border bg-card text-foreground hover:bg-muted';

  return (
    <button
      className={`w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 transition-colors ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function RecoverabilityExplainer({
  claim,
}: {
  claim: Parameters<typeof explainRecoverability>[0];
}) {
  const exp = explainRecoverability(claim);

  const tierCls =
    exp.tier === 'HIGH'
      ? 'bg-status-paid/10 text-status-paid border-status-paid/30'
      : exp.tier === 'MEDIUM'
        ? 'bg-status-pending/10 text-status-pending border-status-pending/30'
        : 'bg-status-denied/10 text-status-denied border-status-denied/30';

  return (
    <Panel
      title="Recoverability Engine"
      action={<span className={`pill border ${tierCls}`}>{exp.tier} · {exp.score}</span>}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <Sparkles className="h-4 w-4 text-primary mt-0.5" />
        <div className="text-[12.5px] text-foreground">{exp.headline}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-[11px]">
        <MiniMetric label="Appeal readiness" value={`${exp.appeal_readiness}%`} />
        <MiniMetric label="Doc risk" value={exp.documentation_risk} />
        <MiniMetric label="Economic priority" value={exp.economic_priority} />
      </div>

      {exp.recovery_barriers.length > 0 && (
        <div className="mb-3 rounded bg-muted/40 border p-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Recovery Barriers
          </div>
          <ul className="space-y-1 text-[11.5px] text-muted-foreground">
            {exp.recovery_barriers.map((barrier) => (
              <li key={barrier}>• {barrier}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        {exp.factors.map((factor, i) => (
          <div
            key={i}
            className="grid grid-cols-[140px_1fr_70px] gap-3 items-center text-[12px] py-1 border-b last:border-b-0 border-border/60"
          >
            <div>
              <div className="text-foreground font-medium">{factor.label}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {factor.weight}
              </div>
            </div>

            <div className="text-muted-foreground text-[11.5px]">
              {factor.detail}
            </div>

            <div
              className={`text-right font-mono tabular-nums text-[12px] flex items-center justify-end gap-1 ${
                factor.delta > 0
                  ? 'amount-positive'
                  : factor.delta < 0
                    ? 'amount-negative'
                    : 'text-muted-foreground'
              }`}
            >
              {factor.delta > 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : factor.delta < 0 ? (
                <TrendDownIcon className="h-3 w-3" />
              ) : null}
              {factor.delta > 0 ? `+${factor.delta}` : factor.delta}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded bg-accent/40 border border-primary/15 p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
          Recommended Recovery Path
        </div>
        <div className="text-[12px] text-foreground">{exp.recommended_path}</div>
      </div>
    </Panel>
  );
}

function NextActionPanel({
  claim,
}: {
  claim: Parameters<typeof nextBestAction>[0];
}) {
  const action = nextBestAction(claim);

  return (
    <Panel
      title="Next Best Action"
      action={<span className={`pill border ${URGENCY_CLS[action.urgency]}`}>{URGENCY_LABEL[action.urgency]}</span>}
    >
      <div className="flex items-start gap-2 mb-2">
        <Zap className="h-4 w-4 text-primary mt-0.5" />

        <div>
          <div className="text-[13px] font-semibold text-foreground">
            {action.headline}
          </div>
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">
            {action.owner} · {action.effort_minutes}m · confidence {action.confidence}%
          </div>
        </div>
      </div>

      <ul className="space-y-1 text-[11.5px] mb-2">
        {action.why.map((why, i) => (
          <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
            <span>{why}</span>
          </li>
        ))}
      </ul>

      {action.blockers.length > 0 && (
        <div className="mb-2 rounded bg-status-denied/5 border border-status-denied/20 p-2">
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

      <div className="pt-2 border-t flex items-center justify-between text-[11px] font-mono">
        <span className="text-muted-foreground">
          Expected · {Math.round(action.expected_probability * 100)}%
        </span>
        <span className="amount-positive">
          ≈{formatCents(action.expected_value_cents)}
        </span>
      </div>
    </Panel>
  );
}

function PlaybookPanel({
  recommendation,
}: {
  recommendation: NonNullable<ReturnType<typeof recommendPlaybook>>;
}) {
  const effortCls = EFFORT_CLS[recommendation.effort];

  return (
    <Panel
      title="Recovery Playbook"
      action={<span className={`pill border ${effortCls}`}>{recommendation.effort} · {recommendation.estimated_minutes}m</span>}
    >
      <div className="flex items-start gap-2 mb-3">
        <ListChecks className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <div className="text-[13px] font-semibold text-foreground">
            {recommendation.playbook.title}
          </div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">
            {recommendation.playbook.summary}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MiniMetric label="Expected recovery" value={`${Math.round(recommendation.expected_recovery_probability * 100)}%`} />
        <MiniMetric label="Estimated value" value={formatCents(recommendation.expected_recovery_cents)} />
      </div>

      <div className="space-y-2">
        {recommendation.playbook.steps.map((step) => (
          <div key={step.order} className="rounded border bg-muted/30 p-2">
            <div className="text-[12px] font-medium text-foreground">
              {step.order}. {step.action}
            </div>
            <div className="text-[10.5px] text-muted-foreground mt-0.5">
              {step.owner} · {step.rationale}
            </div>
          </div>
        ))}
      </div>

      {recommendation.identified_gaps.length > 0 && (
        <div className="mt-3 rounded bg-status-denied/5 border border-status-denied/20 p-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-status-denied mb-1">
            Playbook Gaps
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {recommendation.identified_gaps.join(' · ')}
          </div>
        </div>
      )}
    </Panel>
  );
}

function PayerProfilePanel({
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
          <div className="text-[13px] font-semibold text-foreground">
            {profile.payer_name}
          </div>
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
            {profile.payer_class} · {profile.total_claims} claims observed
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MiniMetric label="Denial rate" value={`${Math.round(profile.denial_rate * 100)}%`} />
        <MiniMetric label="Appeal win" value={`${Math.round(profile.appeal_success_rate * 100)}%`} />
        <MiniMetric label="Avg aging" value={`${profile.avg_aging_days}d`} />
        <MiniMetric label="At risk" value={formatCents(profile.total_at_risk_cents)} />
      </div>

      {profile.difficulty_drivers.length > 0 && (
        <div className="rounded bg-muted/40 border p-2 mb-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Difficulty Drivers
          </div>
          <ul className="space-y-1 text-[11.5px] text-muted-foreground">
            {profile.difficulty_drivers.slice(0, 4).map((driver) => (
              <li key={driver}>• {driver}</li>
            ))}
          </ul>
        </div>
      )}

      {profile.operational_recommendations.length > 0 && (
        <div className="rounded bg-accent/40 border border-primary/15 p-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-primary mb-1">
            Operational Guidance
          </div>
          <ul className="space-y-1 text-[11.5px] text-foreground">
            {profile.operational_recommendations.slice(0, 3).map((rec) => (
              <li key={rec}>• {rec}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-[12.5px] font-semibold text-foreground mt-0.5">
        {value}
      </div>
    </div>
  );
}