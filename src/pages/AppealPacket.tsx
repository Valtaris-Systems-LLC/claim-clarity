import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useClarityData, formatCents } from '@/hooks/use-clarity-data';
import {
  PageHeader,
  Panel,
  ScrollBody,
  EmptyState,
  SeverityBadge,
  RecoverabilityBar,
} from '@/components/clarity/primitives';
import { recommendPlaybook, EFFORT_CLS } from '@/engine/playbooks';
import { findRequirementsFor } from '@/engine/payer-requirements';
import { nextBestAction, URGENCY_CLS, URGENCY_LABEL } from '@/engine/next-action';
import { explainRecoverability } from '@/engine/recoverability';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText,
  Send,
  Inbox,
  ClipboardList,
  ShieldCheck,
  Zap,
  AlertTriangle,
  Download,
  Printer,
  Scale,
} from 'lucide-react';
import type { ClarityClaim } from '@/hooks/use-clarity-data';

type ChecklistItem = {
  label: string;
  ok: boolean;
  detail?: string;
  severity?: 'required' | 'warning' | 'info';
};

export default function AppealPacket() {
  const { claimId } = useParams();
  const { data: claims, isLoading } = useClarityData();

  const claim = useMemo(
    () => claims?.find((c) => c.claim_id === claimId),
    [claims, claimId],
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (!claimId) return <PacketPicker claims={claims ?? []} />;

  if (!claim) {
    return (
      <EmptyState
        title="Claim not found"
        body="Pick a claim from the packet builder."
        icon={<AlertCircle className="h-5 w-5" />}
      />
    );
  }

  const primary = claim.intel.denial_events[0];
  const playbook = primary ? recommendPlaybook(claim, primary) : null;
  const requirements = claims ? findRequirementsFor(claim.intel.payer_id, claims) : undefined;
  const action = nextBestAction(claim, primary);
  const recovery = explainRecoverability(claim);

  const requiredEvidence = Array.from(
    new Set([
      ...(primary?.evidence_required ?? []),
      ...(playbook?.playbook.required_evidence ?? []),
      ...(requirements?.required_documents ?? []),
    ]),
  );

  const expectedRecovery =
    playbook?.expected_recovery_cents ?? action.expected_value_cents;

  const checklist: ChecklistItem[] = [
    {
      label: 'Denial details captured',
      ok: Boolean(primary),
      detail: primary
        ? `${primary.carc_code}${primary.rarc_code ? `/${primary.rarc_code}` : ''} · ${
            CATEGORY_LABEL[primary.category] ?? primary.category
          }`
        : 'No denial on record',
      severity: 'required',
    },
    {
      label: 'Claim summary attached',
      ok: true,
      detail: `${claim.lines.length} line(s) · ${formatCents(claim.total_billed)} billed`,
      severity: 'required',
    },
    {
      label: 'Required evidence present',
      ok: claim.intel.evidence_missing.length === 0,
      detail:
        claim.intel.evidence_missing.length === 0
          ? 'All required evidence appears on file'
          : `${claim.intel.evidence_missing.length} item(s) missing`,
      severity: 'required',
    },
    {
      label: 'Payer requirements surfaced',
      ok: Boolean(requirements),
      detail: requirements
        ? `${requirements.payer_name} · L1 ${requirements.appeal_deadlines.level_1_days}d`
        : 'No payer requirement profile found',
      severity: 'warning',
    },
    {
      label: 'Appeal rationale drafted',
      ok: Boolean(playbook),
      detail: playbook
        ? `${playbook.playbook.title} · ${Math.round(
            playbook.expected_recovery_probability * 100,
          )}% expected recovery`
        : 'No playbook matched',
      severity: 'required',
    },
    {
      label: 'Within timely filing window',
      ok: !requirements || claim.intel.aging_days <= requirements.timely_filing_days,
      detail: requirements
        ? `${claim.intel.aging_days}d aged / ${requirements.timely_filing_days}d timely filing window`
        : 'No payer window available',
      severity: 'required',
    },
    {
      label: 'Next best action generated',
      ok: Boolean(action),
      detail: action.headline,
      severity: 'info',
    },
  ];

  const passing = checklist.filter((item) => item.ok).length;
  const requiredFailures = checklist.filter(
    (item) => item.severity === 'required' && !item.ok,
  ).length;

  const verdict =
    requiredFailures === 0 && passing === checklist.length
      ? 'COMPLETE'
      : requiredFailures <= 1
        ? 'MISSING_REQUIREMENTS'
        : 'INCOMPLETE';

  const verdictCls =
    verdict === 'COMPLETE'
      ? 'bg-status-paid/15 text-status-paid border-status-paid/30'
      : verdict === 'MISSING_REQUIREMENTS'
        ? 'bg-status-pending/15 text-status-pending border-status-pending/30'
        : 'bg-status-denied/15 text-status-denied border-status-denied/30';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Appeal Packet · ${claim.claim_id}`}
        subtitle={`${claim.intel.payer_name} · ${claim.provider_name}`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/packet"
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Packets
            </Link>

            <Link
              to={`/denials/${claim.claim_id}`}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground"
            >
              Open Claim
            </Link>
          </div>
        }
      />

      <div className="px-5 py-3 border-b bg-card flex items-center gap-3">
        <span className={`pill border text-[11px] ${verdictCls}`}>
          {verdict === 'COMPLETE' ? (
            <CheckCircle2 className="h-3 w-3 mr-1" />
          ) : verdict === 'INCOMPLETE' ? (
            <XCircle className="h-3 w-3 mr-1" />
          ) : (
            <AlertCircle className="h-3 w-3 mr-1" />
          )}
          Packet Readiness: {verdict.replace(/_/g, ' ')}
        </span>

        <span className="text-[12px] text-muted-foreground font-mono">
          {passing}/{checklist.length} requirements met
        </span>

        <div className="ml-auto flex items-center gap-2">
          {primary && <SeverityBadge severity={primary.severity} />}
          {primary && (
            <div className="w-32">
              <RecoverabilityBar score={primary.recoverability_score} />
            </div>
          )}

          <button className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 border bg-card hover:bg-muted text-foreground">
            <Printer className="h-3.5 w-3.5" />
            Preview
          </button>

          <button
            disabled={verdict !== 'COMPLETE'}
            className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            <Send className="h-3.5 w-3.5" />
            Submit Appeal
          </button>
        </div>
      </div>

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Packet Executive Summary">
              <div className="grid grid-cols-4 gap-3">
                <Metric label="At Risk" value={formatCents(claim.intel.amount_at_risk_cents)} tone="negative" />
                <Metric label="Expected Recovery" value={formatCents(expectedRecovery)} tone="positive" />
                <Metric label="Aging" value={`${claim.intel.aging_days}d`} />
                <Metric label="Readiness" value={`${passing}/${checklist.length}`} />
              </div>

              <div className="mt-3 rounded bg-accent/40 border border-primary/15 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                  Recommended Filing Path
                </div>
                <div className="text-[12.5px] text-foreground">
                  {recovery.recommended_path}
                </div>
              </div>
            </Panel>

            <Panel title="Submission Checklist">
              <ul className="divide-y -mx-4 -my-4">
                {checklist.map((item) => (
                  <li key={item.label} className="px-4 py-2.5 flex items-start gap-3">
                    {item.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-status-paid mt-0.5" />
                    ) : item.severity === 'warning' ? (
                      <AlertTriangle className="h-4 w-4 text-status-pending mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-status-denied mt-0.5" />
                    )}

                    <div className="flex-1">
                      <div className="text-[12.5px] text-foreground font-medium">
                        {item.label}
                      </div>
                      {item.detail && (
                        <div className="text-[11px] text-muted-foreground">
                          {item.detail}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            {primary && (
              <Panel title="Denial Basis">
                <div className="grid grid-cols-4 gap-3 text-[12px]">
                  <Field
                    label="CARC / RARC"
                    value={`${primary.carc_code}${primary.rarc_code ? ` / ${primary.rarc_code}` : ''}`}
                    mono
                  />
                  <Field label="Category" value={CATEGORY_LABEL[primary.category] ?? primary.category} />
                  <Field label="Group Code" value={primary.group_code} mono />
                  <Field label="Amount" value={formatCents(primary.amount_cents)} mono />
                </div>

                <div className="mt-3 rounded bg-muted/40 p-2.5 text-[12px] text-foreground">
                  <span className="font-semibold">Root cause: </span>
                  {primary.root_cause}
                </div>

                {primary.payer_message && (
                  <div className="mt-2 text-[11.5px] italic text-muted-foreground">
                    "{primary.payer_message}"
                  </div>
                )}
              </Panel>
            )}

            <Panel title="Appeal Rationale">
              {playbook ? (
                <div className="text-[12.5px] text-foreground space-y-3">
                  <p>{playbook.playbook.appeal_strategy}</p>

                  <div className="rounded bg-accent/40 border border-primary/15 p-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                      Expected Recovery
                    </div>
                    <div className="text-[13px] font-mono">
                      {Math.round(playbook.expected_recovery_probability * 100)}% probability · ≈
                      {formatCents(playbook.expected_recovery_cents)}
                    </div>
                  </div>

                  {recovery.recovery_barriers.length > 0 && (
                    <div className="rounded border bg-muted/30 p-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Recovery Barriers
                      </div>
                      <ul className="space-y-1 text-[11.5px] text-muted-foreground">
                        {recovery.recovery_barriers.map((barrier) => (
                          <li key={barrier}>• {barrier}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground italic">
                  No playbook matched this denial.
                </div>
              )}
            </Panel>

            {playbook && (
              <Panel
                title="Operational Playbook"
                action={
                  <span className={`pill border ${EFFORT_CLS[playbook.effort]}`}>
                    {playbook.effort} · {playbook.estimated_minutes}m
                  </span>
                }
              >
                <div className="space-y-2">
                  {playbook.playbook.steps.map((step) => (
                    <div key={step.order} className="rounded border bg-muted/30 p-2.5">
                      <div className="text-[12.5px] font-medium text-foreground">
                        {step.order}. {step.action}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {step.owner} · {step.rationale}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Claim Summary">
              <div className="grid grid-cols-4 gap-3 text-[12px]">
                <Field label="Member" value={claim.member_id} mono />
                <Field label="Provider NPI" value={claim.provider_npi} mono />
                <Field
                  label="DOS"
                  value={`${claim.service_date_from.slice(0, 10)} → ${claim.service_date_to.slice(0, 10)}`}
                  mono
                />
                <Field label="Type" value={claim.claim_type} />
              </div>

              <div className="mt-3 border rounded">
                <div className="grid grid-cols-[80px_100px_1fr_80px_120px] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                  <span>Line</span>
                  <span>CPT</span>
                  <span>Diagnoses</span>
                  <span>Units</span>
                  <span className="text-right">Billed</span>
                </div>

                {claim.lines.map((line) => (
                  <div
                    key={line.line_id}
                    className="grid grid-cols-[80px_100px_1fr_80px_120px] gap-2 px-3 py-1.5 text-[11.5px] border-b last:border-b-0"
                  >
                    <span className="font-mono">{line.claim_line_number}</span>
                    <span className="font-mono">
                      {line.procedure_code}
                      {line.procedure_modifier && `-${line.procedure_modifier}`}
                    </span>
                    <span className="font-mono text-muted-foreground truncate">
                      {line.diagnosis_codes.join(', ')}
                    </span>
                    <span className="font-mono">{line.units}</span>
                    <span className="font-mono text-right tabular-nums">
                      {formatCents(line.billed_amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel
              title="Next Best Action"
              action={
                <span className={`pill border ${URGENCY_CLS[action.urgency]}`}>
                  {URGENCY_LABEL[action.urgency]}
                </span>
              }
            >
              <div className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <div className="text-[13px] font-semibold text-foreground">
                    {action.headline}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5 uppercase tracking-wider">
                    {action.owner} · {action.effort_minutes}m
                  </div>
                </div>
              </div>

              <ul className="mt-2 space-y-1 text-[11.5px]">
                {action.why.map((why) => (
                  <li key={why} className="flex items-start gap-1.5 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <span>{why}</span>
                  </li>
                ))}
              </ul>

              {action.blockers.length > 0 && (
                <div className="mt-2 rounded bg-status-denied/5 border border-status-denied/20 p-2">
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

              <div className="mt-2 pt-2 border-t flex justify-between text-[11px] font-mono">
                <span className="text-muted-foreground">Expected value</span>
                <span className="amount-positive">≈{formatCents(action.expected_value_cents)}</span>
              </div>
            </Panel>

            <Panel title="Required Evidence">
              {requiredEvidence.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No specific evidence requirements found.
                </div>
              ) : (
                <ul className="text-[12px] space-y-1.5">
                  {requiredEvidence.map((evidence) => {
                    const missing = claim.intel.evidence_missing.some((m) =>
                      m.toLowerCase().includes(evidence.toLowerCase().split(' ')[0]),
                    );

                    return (
                      <li key={evidence} className="flex items-center gap-2">
                        {missing ? (
                          <XCircle className="h-3.5 w-3.5 text-status-denied" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-status-paid" />
                        )}
                        <span className={missing ? 'text-status-denied' : 'text-foreground'}>
                          {evidence}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            {requirements && (
              <Panel title={`Payer Requirements · ${requirements.payer_name}`}>
                <div className="space-y-1.5 text-[11.5px]">
                  <Row label="Timely filing" value={`${requirements.timely_filing_days}d`} />
                  <Row label="Level 1 window" value={`${requirements.appeal_deadlines.level_1_days}d`} />
                  <Row label="Level 2 window" value={`${requirements.appeal_deadlines.level_2_days}d`} />
                  <Row label="Overturn rate" value={`${Math.round(requirements.overturn_rate * 100)}%`} />
                  <Row
                    label="Preferred channel"
                    value={requirements.submission_channels.find((c) => c.preferred)?.channel ?? 'portal'}
                  />
                </div>

                {requirements.notes.length > 0 && (
                  <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground space-y-1">
                    {requirements.notes.map((note) => (
                      <div key={note} className="flex items-start gap-1">
                        <FileText className="h-3 w-3 mt-0.5" />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            <Panel title="Packet Contents">
              <div className="space-y-2 text-[12px]">
                <PacketItem icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Claim summary" ok />
                <PacketItem icon={<AlertCircle className="h-3.5 w-3.5" />} label="Denial detail" ok={Boolean(primary)} />
                <PacketItem icon={<ClipboardList className="h-3.5 w-3.5" />} label="Appeal rationale" ok={Boolean(playbook)} />
                <PacketItem icon={<FileText className="h-3.5 w-3.5" />} label="Evidence checklist" ok={requiredEvidence.length > 0} />
                <PacketItem icon={<Scale className="h-3.5 w-3.5" />} label="Payer requirements" ok={Boolean(requirements)} />
              </div>
            </Panel>

            <Panel title="Packet Actions">
              <div className="space-y-1.5">
                <button className="w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 border bg-card hover:bg-muted text-foreground">
                  <Download className="h-3.5 w-3.5" />
                  Export packet
                </button>
                <button className="w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 border bg-card hover:bg-muted text-foreground">
                  <Printer className="h-3.5 w-3.5" />
                  Print packet
                </button>
              </div>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function PacketPicker({ claims }: { claims: ClarityClaim[] }) {
  const list = useMemo(
    () =>
      claims
        .filter((claim) => claim.intel.denial_events.length > 0)
        .sort((a, b) => b.intel.amount_at_risk_cents - a.intel.amount_at_risk_cents)
        .slice(0, 30),
    [claims],
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Appeal Packet Builder"
        subtitle="Select a denied claim to assemble its appeal packet."
      />

      <ScrollBody>
        <div className="p-5">
          {list.length === 0 ? (
            <EmptyState
              title="No claims to package"
              body="No active denials to build packets for."
              icon={<Inbox className="h-5 w-5" />}
            />
          ) : (
            <Panel title={`Build-ready claims (${list.length})`} dense>
              <div className="divide-y">
                <div className="grid grid-cols-[110px_1fr_140px_140px_90px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <span>Claim</span>
                  <span>Payer</span>
                  <span className="text-right">At Risk</span>
                  <span className="text-right">Expected</span>
                  <span></span>
                </div>

                {list.map((claim) => {
                  const primary = claim.intel.denial_events[0];
                  const playbook = primary ? recommendPlaybook(claim, primary) : null;
                  const expected =
                    playbook?.expected_recovery_cents ??
                    Math.round(claim.intel.amount_at_risk_cents * claim.intel.recoverability_score / 100);

                  return (
                    <Link
                      key={claim.claim_id}
                      to={`/packet/${claim.claim_id}`}
                      className="grid grid-cols-[110px_1fr_140px_140px_90px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40 text-[12.5px]"
                    >
                      <span className="font-mono font-semibold text-foreground">
                        {claim.claim_id}
                      </span>
                      <span className="text-foreground truncate">
                        {claim.intel.payer_name}
                      </span>
                      <span className="font-mono text-right tabular-nums amount-negative">
                        {formatCents(claim.intel.amount_at_risk_cents)}
                      </span>
                      <span className="font-mono text-right tabular-nums amount-positive">
                        ≈{formatCents(expected)}
                      </span>
                      <span className="text-[11px] text-primary justify-self-end">
                        Build →
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      </ScrollBody>
    </div>
  );
}

function PacketItem({
  icon,
  label,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded border bg-muted/30 p-2">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        {label}
      </div>
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-status-paid" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-status-denied" />
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-[12.5px] text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
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
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums mt-0.5 ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}