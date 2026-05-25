import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useClarityData, formatCents } from '@/hooks/use-clarity-data';
import {
  PageHeader,
  KpiStrip,
  ScrollBody,
  Panel,
  EmptyState,
} from '@/components/clarity/primitives';
import { recommendPlaybook } from '@/engine/playbooks';
import { findRequirementsFor } from '@/engine/payer-requirements';
import {
  FolderOpen,
  Loader2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Clock,
} from 'lucide-react';

const EVIDENCE_TAXONOMY = [
  { id: 'medical_records', label: 'Medical Records' },
  { id: 'authorizations', label: 'Authorizations' },
  { id: 'primary_eob', label: 'Primary EOB / COB' },
  { id: 'clinical_notes', label: 'Clinical Notes' },
  { id: 'contract_docs', label: 'Contract / Fee Schedule' },
  { id: 'submission_proof', label: 'Timely Filing Proof' },
  { id: 'appeal_letter', label: 'Appeal Letter' },
];

export default function EvidenceVault() {
  const { data: claims, isLoading } = useClarityData();

  const summary = useMemo(() => {
    if (!claims) return null;

    const claimsWithGaps = claims.filter((claim) => claim.intel.evidence_missing.length > 0);

    const exposedCents = claimsWithGaps.reduce(
      (sum, claim) => sum + claim.intel.amount_at_risk_cents,
      0,
    );

    const requiredItems = claims.reduce((sum, claim) => {
      const primary = claim.intel.denial_events[0];
      const playbook = primary ? recommendPlaybook(claim, primary) : null;
      const reqs = findRequirementsFor(claim.intel.payer_id, claims);

      const allRequired = new Set<string>([
        ...(primary?.evidence_required ?? []),
        ...(playbook?.playbook.required_evidence ?? []),
        ...(reqs?.required_documents ?? []),
      ]);

      return sum + allRequired.size;
    }, 0);

    const missingItems = claims.reduce(
      (sum, claim) => sum + claim.intel.evidence_missing.length,
      0,
    );

    const completeness =
      requiredItems === 0
        ? 1
        : Math.max(0, 1 - missingItems / Math.max(1, requiredItems));

    const counts = new Map<string, number>();

    for (const claim of claims) {
      for (const evidence of claim.intel.evidence_missing) {
        counts.set(evidence, (counts.get(evidence) ?? 0) + 1);
      }
    }

    const topMissing = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const appealBlocked = claims.filter(
      (claim) =>
        claim.intel.denial_events.some((denial) => denial.appeal_eligible) &&
        claim.intel.evidence_missing.length > 0,
    );

    const highValueBlocked = claimsWithGaps.filter(
      (claim) => claim.intel.amount_at_risk_cents >= 250_000,
    );

    return {
      claimsWithGaps,
      exposedCents,
      completeness,
      missingItems,
      requiredItems,
      topMissing,
      appealBlocked,
      highValueBlocked,
    };
  }, [claims]);

  if (isLoading || !summary) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Evidence Vault"
        subtitle="Track required, missing, and blocking evidence across active claims, appeals, payer requirements, and recovery packets."
      />

      <KpiStrip
        tiles={[
          {
            label: 'Completeness',
            value: `${(summary.completeness * 100).toFixed(0)}%`,
            tone: summary.completeness >= 0.8 ? 'text-status-paid' : 'text-status-pending',
          },
          {
            label: 'Claims w/ Gaps',
            value: String(summary.claimsWithGaps.length),
            tone: summary.claimsWithGaps.length > 0 ? 'text-status-denied' : 'text-status-paid',
          },
          {
            label: 'Missing Items',
            value: `${summary.missingItems} / ${summary.requiredItems}`,
          },
          {
            label: 'Appeals Blocked',
            value: String(summary.appealBlocked.length),
            tone: summary.appealBlocked.length > 0 ? 'text-status-pending' : 'text-status-paid',
          },
          {
            label: 'High-Value Blocked',
            value: String(summary.highValueBlocked.length),
            tone: summary.highValueBlocked.length > 0 ? 'text-status-denied' : 'text-status-paid',
          },
          {
            label: 'Revenue Exposed',
            value: formatCents(summary.exposedCents),
            tone: 'amount-negative',
          },
        ]}
      />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title={`Claims with Evidence Gaps (${summary.claimsWithGaps.length})`} dense>
              {summary.claimsWithGaps.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No evidence gaps"
                    body="All required documentation is on file."
                    icon={<CheckCircle2 className="h-5 w-5" />}
                  />
                </div>
              ) : (
                <div className="divide-y">
                  <div className="grid grid-cols-[120px_1fr_1fr_120px_120px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <span>Claim</span>
                    <span>Payer</span>
                    <span>Missing Evidence</span>
                    <span>Blocked</span>
                    <span className="text-right">At Risk</span>
                  </div>

                  {summary.claimsWithGaps.map((claim) => {
                    const blockedAppeal = claim.intel.denial_events.some(
                      (denial) => denial.appeal_eligible,
                    );

                    return (
                      <Link
                        key={claim.claim_id}
                        to={`/denials/${claim.claim_id}`}
                        className="grid grid-cols-[120px_1fr_1fr_120px_120px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40"
                      >
                        <span className="font-mono text-[12px] font-semibold text-foreground">
                          {claim.claim_id}
                        </span>

                        <span className="text-[12px] text-foreground truncate">
                          {claim.intel.payer_name}
                        </span>

                        <div className="flex flex-wrap gap-1">
                          {claim.intel.evidence_missing.slice(0, 4).map((evidence) => (
                            <span
                              key={evidence}
                              className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border bg-status-denied/10 text-status-denied border-status-denied/30"
                            >
                              <AlertTriangle className="inline h-2.5 w-2.5 mr-0.5" />
                              {evidence}
                            </span>
                          ))}

                          {claim.intel.evidence_missing.length > 4 && (
                            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">
                              +{claim.intel.evidence_missing.length - 4}
                            </span>
                          )}
                        </div>

                        <span
                          className={`text-[11px] font-semibold ${
                            blockedAppeal ? 'text-status-pending' : 'text-muted-foreground'
                          }`}
                        >
                          {blockedAppeal ? 'Appeal' : 'Workflow'}
                        </span>

                        <span className="font-mono text-[12.5px] text-right tabular-nums amount-negative">
                          {formatCents(claim.intel.amount_at_risk_cents)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Most-Missing Evidence Types">
              {summary.topMissing.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No missing evidence patterns detected.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {summary.topMissing.map(([label, count]) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 p-2 rounded border bg-muted/30"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0 text-[12px] text-foreground truncate">
                        {label}
                      </div>
                      <span className="font-mono text-[11px] text-status-denied">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Evidence Taxonomy">
              <ul className="space-y-1.5">
                {EVIDENCE_TAXONOMY.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-[12.5px]">
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-foreground">{item.label}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Vault Health">
              <div className="space-y-1.5 text-[12px]">
                <Row label="Documents indexed" value="14,832" />
                <Row label="OCR coverage" value="98%" tone="text-status-paid" />
                <Row label="Expiring this week" value="6" tone="text-status-pending" />
                <Row label="Avg attach latency" value="2.4s" />
              </div>
            </Panel>

            <Panel title="Operational Signals">
              <div className="space-y-2 text-[12px]">
                <Signal
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  label="Appeal blocked by missing docs"
                  value={String(summary.appealBlocked.length)}
                  tone={summary.appealBlocked.length > 0 ? 'pending' : 'positive'}
                />
                <Signal
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="High-value evidence gaps"
                  value={String(summary.highValueBlocked.length)}
                  tone={summary.highValueBlocked.length > 0 ? 'negative' : 'positive'}
                />
                <Signal
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Readiness rate"
                  value={`${(summary.completeness * 100).toFixed(0)}%`}
                  tone={summary.completeness >= 0.8 ? 'positive' : 'pending'}
                />
              </div>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-[11.5px] ${tone ?? 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

function Signal({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'pending';
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
    <div className="flex items-center justify-between rounded border bg-muted/30 p-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-mono font-semibold ${cls}`}>{value}</span>
    </div>
  );
}