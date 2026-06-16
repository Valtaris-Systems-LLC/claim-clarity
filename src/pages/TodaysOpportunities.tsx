import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  formatCents,
  formatCentsCompact,
  slaStatus,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  KpiStrip,
  ScrollBody,
  Panel,
  SeverityBadge,
  AgingChip,
  RecoverabilityBar,
  OwnerChip,
  EmptyState,
} from '@/components/clarity/primitives';
import { explainRecoverability } from '@/engine/recoverability';
import { nextBestAction, actionLabel } from '@/engine/next-action';
import { recommendPlaybook } from '@/engine/playbooks';
import { Loader2, Target, Clock, ArrowRight, Zap } from 'lucide-react';
import { useAssignments } from '@/hooks/use-assignments';

export default function TodaysOpportunities() {
  const { data: claims, isLoading } = useClarityData();
  const { get, setStatus } = useAssignments();

  const ranked = useMemo(() => {
    if (!claims) return [];

    return claims
      .filter(
        (claim) =>
          claim.intel.amount_at_risk_cents > 0 &&
          claim.intel.reimbursement_state !== 'paid' &&
          claim.intel.reimbursement_state !== 'resolved' &&
          claim.intel.reimbursement_state !== 'written_off',
      )
      .map((claim) => {
        const recovery = explainRecoverability(claim);
        const primary = claim.intel.denial_events[0];
        const action = nextBestAction(claim, primary);
        const playbook = primary ? recommendPlaybook(claim, primary) : null;

        const expectedRecover =
          playbook?.expected_recovery_cents ??
          Math.round(claim.intel.amount_at_risk_cents * recovery.score / 100);

        const sla = slaStatus(claim.intel.sla_due_at);
        const slaWeight =
          sla.tone === 'breach' ? 2.5 : sla.tone === 'warn' ? 1.5 : 1;

        const severityWeight =
          claim.intel.severity === 'critical'
            ? 2
            : claim.intel.severity === 'high'
              ? 1.5
              : claim.intel.severity === 'medium'
                ? 1.1
                : 1;

        const docPenalty = claim.intel.evidence_missing.length > 0 ? 0.75 : 1;

        const priority =
          expectedRecover *
          (recovery.score / 100) *
          slaWeight *
          severityWeight *
          docPenalty;

        return {
          claim,
          recovery,
          action,
          playbook,
          expectedRecover,
          priority,
          sla,
        };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 20);
  }, [claims]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const probableRecovery = ranked.reduce((sum, row) => sum + row.expectedRecover, 0);
  const totalAtRisk = ranked.reduce((sum, row) => sum + row.claim.intel.amount_at_risk_cents, 0);
  const slaBreaches = ranked.filter((row) => row.sla.tone === 'breach').length;
  const highProbability = ranked.filter((row) => row.recovery.tier === 'HIGH').length;
  const appealReady = ranked.filter(
    (row) =>
      row.claim.intel.denial_events.some((denial) => denial.appeal_eligible) &&
      row.claim.intel.evidence_missing.length === 0,
  ).length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Today's Recovery Opportunities"
        subtitle="Highest-value work ranked by recoverable dollars, recoverability, severity, SLA pressure, and blockers."
      />

      <KpiStrip
        tiles={[
          { label: 'Work Today', value: String(ranked.length) },
          {
            label: 'Probable Recovery',
            value: formatCentsCompact(probableRecovery),
            tone: 'amount-positive',
            sub: 'expected value',
          },
          {
            label: 'Total At Risk',
            value: formatCentsCompact(totalAtRisk),
            tone: 'amount-negative',
          },
          {
            label: 'Appeal Ready',
            value: String(appealReady),
            tone: 'text-status-paid',
          },
          {
            label: 'High Probability',
            value: String(highProbability),
            tone: 'text-status-paid',
          },
          {
            label: 'SLA Breaches',
            value: String(slaBreaches),
            tone: slaBreaches > 0 ? 'text-status-denied' : 'text-status-paid',
          },
        ]}
      />

      <ScrollBody>
        <div className="p-5">
          {ranked.length === 0 ? (
            <EmptyState
              title="Inbox zero"
              body="Nothing prioritized for recovery work right now."
              icon={<Target className="h-5 w-5" />}
            />
          ) : (
            <Panel title={`Priority Worklist — ${ranked.length} claims`} dense>
              <div className="divide-y">
                <div className="grid grid-cols-[36px_110px_1fr_120px_110px_110px_130px_140px_170px_130px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <span>#</span>
                  <span>Claim</span>
                  <span>Payer / Owner</span>
                  <span>Action</span>
                  <span>Recov.</span>
                  <span>Severity</span>
                  <span>Aging</span>
                  <span className="text-right">At Risk</span>
                  <span className="text-right">Expected</span>
                  <span>SLA / Status</span>
                </div>

                {ranked.map((row, index) => {
                  const assignment = get(row.claim.claim_id);
                  const slaCls =
                    row.sla.tone === 'breach'
                      ? 'text-status-denied'
                      : row.sla.tone === 'warn'
                        ? 'text-status-pending'
                        : 'text-status-paid';

                  return (
                    <div
                      key={row.claim.claim_id}
                      className="grid grid-cols-[36px_110px_1fr_120px_110px_110px_130px_140px_170px_130px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <Link
                        to={`/denials/${row.claim.claim_id}`}
                        className="font-mono text-[12px] font-semibold text-primary hover:underline"
                      >
                        {row.claim.claim_id}
                      </Link>

                      <div className="min-w-0 flex items-center gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] truncate text-foreground">
                            {row.claim.intel.payer_name}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground truncate">
                            {row.claim.provider_name}
                          </div>
                        </div>
                        <OwnerChip owner={row.claim.intel.workflow_owner} />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-[11px] text-foreground truncate">
                          <Zap className="h-3 w-3 text-primary shrink-0" />
                          {actionLabel(row.action.kind)}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {row.action.owner}
                        </div>
                      </div>

                      <div>
                        <RecoverabilityBar score={row.recovery.score} />
                        <div className="text-[9.5px] font-mono uppercase mt-0.5 text-muted-foreground">
                          {row.recovery.tier}
                        </div>
                      </div>

                      <SeverityBadge severity={row.claim.intel.severity} />
                      <AgingChip bucket={row.claim.intel.aging_bucket} />

                      <span className="font-mono text-[12.5px] text-right tabular-nums amount-negative">
                        {formatCents(row.claim.intel.amount_at_risk_cents)}
                      </span>

                      <div className="text-right">
                        <div className="font-mono text-[12.5px] tabular-nums amount-positive">
                          ≈{formatCents(row.expectedRecover)}
                        </div>
                        {row.claim.intel.evidence_missing.length > 0 && (
                          <div className="text-[10px] text-status-pending">
                            {row.claim.intel.evidence_missing.length} doc gap
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-mono flex items-center gap-1 ${slaCls}`}>
                          <Clock className="h-3 w-3" />
                          {row.sla.label}
                        </span>

                        <button
                          onClick={() =>
                            setStatus(
                              row.claim.claim_id,
                              assignment.status === 'in_progress' ? 'open' : 'in_progress',
                            )
                          }
                          className={`ml-auto text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded border ${
                            assignment.status === 'in_progress'
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-input text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {assignment.status === 'in_progress' ? 'Working' : 'Start'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          <div className="mt-4 flex justify-end">
            <Link
              to="/denials"
              className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Open full denial intelligence
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}