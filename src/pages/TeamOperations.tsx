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
import { useAssignments } from '@/hooks/use-assignments';
import { aggregateTeam } from '@/engine/team-ops';
import { ASSIGNEES } from '@/lib/assignments';
import {
  Loader2,
  Users,
  UserPlus,
  AlertOctagon,
  Target,
  Activity,
  TrendingUp,
} from 'lucide-react';

export default function TeamOperations() {
  const { data: claims, isLoading } = useClarityData();
  const { store, assign } = useAssignments();

  const team = useMemo(() => {
    if (!claims) return null;
    return aggregateTeam(claims, store);
  }, [claims, store]);

  if (isLoading || !team) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const autoAssign = () => {
    team.unassigned.forEach((claim, index) => {
      assign(claim.claim_id, ASSIGNEES[index % ASSIGNEES.length]);
    });
  };

  const totalActive = team.members.reduce((sum, member) => sum + member.active_count, 0);
  const totalResolved = team.members.reduce((sum, member) => sum + member.resolved_count, 0);
  const totalRecovered = team.members.reduce((sum, member) => sum + member.recovered_cents, 0);
  const totalRisk = team.members.reduce((sum, member) => sum + member.total_at_risk_cents, 0) + team.unassigned_at_risk_cents;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Team Operations"
        subtitle="Recovery team workload, overdue SLAs, expected recovery, workload pressure, and unassigned backlog."
        actions={
          <button
            onClick={autoAssign}
            disabled={team.unassigned.length === 0}
            className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Auto-assign backlog
          </button>
        }
      />

      <KpiStrip
        tiles={[
          { label: 'Team Members', value: String(team.members.length || ASSIGNEES.length) },
          { label: 'Active Assignments', value: String(totalActive) },
          {
            label: 'Overdue Items',
            value: String(team.overdue_total),
            tone: team.overdue_total > 0 ? 'text-status-denied' : 'text-status-paid',
          },
          {
            label: 'Total At Risk',
            value: formatCentsCompact(totalRisk),
            tone: 'amount-negative',
          },
          {
            label: 'Expected Recovery',
            value: formatCentsCompact(team.total_expected_recovery_cents),
            tone: 'amount-positive',
          },
          {
            label: 'Recovered to Date',
            value: formatCentsCompact(totalRecovered),
            tone: 'amount-positive',
          },
          {
            label: 'Unassigned Backlog',
            value: `${team.unassigned.length} · ${formatCentsCompact(team.unassigned_at_risk_cents)}`,
            tone: 'text-status-pending',
          },
        ]}
      />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title={`Recovery Team Performance (${team.members.length})`} dense>
              {team.members.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No assignments yet"
                    body="Assign claims from the worklist or use Auto-assign to get started."
                    icon={<Users className="h-5 w-5" />}
                  />
                </div>
              ) : (
                <div className="divide-y">
                  <div className="grid grid-cols-[1fr_70px_70px_70px_70px_95px_120px_140px_140px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <span>Member</span>
                    <span>Active</span>
                    <span>Working</span>
                    <span>Resolved</span>
                    <span>Overdue</span>
                    <span>Pressure</span>
                    <span>Avg Recov.</span>
                    <span className="text-right">At Risk</span>
                    <span className="text-right">Expected Rec.</span>
                  </div>

                  {team.members.map((member) => (
                    <div
                      key={member.assignee}
                      className="grid grid-cols-[1fr_70px_70px_70px_70px_95px_120px_140px_140px] gap-3 items-center px-4 py-2.5 text-[12.5px]"
                    >
                      <div>
                        <div className="text-foreground font-medium">{member.assignee}</div>
                        <div className="text-[10.5px] font-mono text-muted-foreground">
                          {member.snoozed_count} snoozed · {member.critical_count} critical · score {member.priority_score}
                        </div>
                      </div>

                      <span className="font-mono">{member.active_count}</span>
                      <span className="font-mono text-status-cob">{member.in_progress_count}</span>
                      <span className="font-mono text-status-paid">{member.resolved_count}</span>
                      <span className={`font-mono ${member.overdue_count > 0 ? 'text-status-denied' : 'text-muted-foreground'}`}>
                        {member.overdue_count}
                      </span>

                      <span className={`pill border ${workloadCls(member.workload_tier)}`}>
                        {member.workload_tier}
                      </span>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${
                              member.avg_recoverability >= 60
                                ? 'bg-status-paid'
                                : member.avg_recoverability >= 35
                                  ? 'bg-status-pending'
                                  : 'bg-status-denied'
                            }`}
                            style={{ width: `${member.avg_recoverability}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px]">{member.avg_recoverability}</span>
                      </div>

                      <span className="font-mono text-right tabular-nums amount-negative">
                        {formatCents(member.total_at_risk_cents)}
                      </span>
                      <span className="font-mono text-right tabular-nums amount-positive">
                        ≈{formatCents(member.expected_recovery_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Unassigned Backlog (${team.unassigned.length})`} dense>
              {team.unassigned.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Backlog empty"
                    body="Every recoverable claim has an owner."
                    icon={<Users className="h-5 w-5" />}
                  />
                </div>
              ) : (
                <div className="divide-y">
                  <div className="grid grid-cols-[110px_1fr_120px_110px_120px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <span>Claim</span>
                    <span>Payer</span>
                    <span className="text-right">At Risk</span>
                    <span>Aging</span>
                    <span>Severity</span>
                  </div>

                  {team.unassigned.slice(0, 30).map((claim) => (
                    <Link
                      key={claim.claim_id}
                      to={`/denials/${claim.claim_id}`}
                      className="grid grid-cols-[110px_1fr_120px_110px_120px] gap-3 items-center px-4 py-2 hover:bg-muted/40 text-[12px]"
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
                      <span className="font-mono text-muted-foreground">
                        {claim.intel.aging_days}d
                      </span>
                      <span className={severityTextCls(claim.intel.severity)}>
                        {claim.intel.severity}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Roster">
              <ul className="space-y-1.5 text-[12.5px]">
                {ASSIGNEES.map((assignee) => {
                  const member = team.members.find((m) => m.assignee === assignee);

                  return (
                    <li key={assignee} className="flex items-center justify-between gap-2">
                      <span className="text-foreground truncate">{assignee}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {member?.active_count ?? 0}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel title="Workload Focus">
              {team.members.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">
                  No team workload yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {team.members.slice(0, 5).map((member) => (
                    <div key={member.assignee} className="rounded border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-semibold text-foreground">
                          {member.assignee}
                        </span>
                        <span className={`pill border ${workloadCls(member.workload_tier)}`}>
                          {member.workload_tier}
                        </span>
                      </div>

                      <ul className="space-y-1 text-[11px] text-muted-foreground">
                        {member.recommended_focus.slice(0, 3).map((focus) => (
                          <li key={focus} className="flex items-start gap-1.5">
                            <Target className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                            <span>{focus}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Ops Signals">
              <div className="space-y-2 text-[12px]">
                <Signal
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label="Resolved"
                  value={String(totalResolved)}
                />
                <Signal
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="Unassigned Expected"
                  value={formatCentsCompact(team.unassigned_expected_recovery_cents)}
                  tone="positive"
                />
                <Signal
                  icon={<AlertOctagon className="h-3.5 w-3.5" />}
                  label="Overdue"
                  value={String(team.overdue_total)}
                  tone={team.overdue_total > 0 ? 'negative' : 'positive'}
                />
              </div>
            </Panel>

            {team.overdue_total > 0 && (
              <div className="rounded border bg-status-denied/5 border-status-denied/30 p-3 flex items-start gap-2">
                <AlertOctagon className="h-4 w-4 text-status-denied mt-0.5" />
                <div className="text-[12px] text-foreground">
                  <div className="font-semibold">
                    {team.overdue_total} overdue item(s) across the team.
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Review the worklist and re-prioritize or escalate stalled claims.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function workloadCls(tier: string): string {
  switch (tier) {
    case 'OVERLOADED':
      return 'bg-status-denied/15 text-status-denied border-status-denied/30';
    case 'HIGH':
      return 'bg-status-pending/15 text-status-pending border-status-pending/30';
    case 'NORMAL':
      return 'bg-status-cob/10 text-status-cob border-status-cob/30';
    default:
      return 'bg-status-paid/10 text-status-paid border-status-paid/30';
  }
}

function severityTextCls(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-status-denied font-semibold capitalize';
    case 'high':
      return 'text-status-pending font-semibold capitalize';
    default:
      return 'text-muted-foreground capitalize';
  }
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
  tone?: 'positive' | 'negative';
}) {
  const valueCls =
    tone === 'positive'
      ? 'amount-positive'
      : tone === 'negative'
        ? 'amount-negative'
        : 'text-foreground';

  return (
    <div className="flex items-center justify-between rounded border bg-muted/30 p-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-mono font-semibold ${valueCls}`}>{value}</span>
    </div>
  );
}