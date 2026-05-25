import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useClarityData,
  allDenials,
  formatCents,
  formatCentsCompact,
  relativeTime,
  slaStatus,
} from '@/hooks/use-clarity-data';
import {
  PageHeader,
  KpiStrip,
  ScrollBody,
  SeverityBadge,
  OwnerChip,
  RecoverabilityBar,
  EmptyState,
} from '@/components/clarity/primitives';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import { nextBestAction, actionLabel } from '@/engine/next-action';
import { recommendPlaybook } from '@/engine/playbooks';
import type { DenialCategory, DenialSeverity } from '@/types/clarity';
import {
  AlertOctagon,
  Filter,
  Loader2,
  Search,
  Target,
  Clock,
  Zap,
  FileText,
} from 'lucide-react';
import { useAssignments } from '@/hooks/use-assignments';

const CATEGORIES: ('all' | DenialCategory)[] = [
  'all',
  'authorization',
  'eligibility',
  'cob',
  'coordination_of_benefits',
  'modifier',
  'duplicate',
  'medical_necessity',
  'missing_documentation',
  'medical_record_request',
  'timely_filing',
  'contractual',
  'bundled',
  'coding',
  'coverage',
  'benefit_limit',
  'underpayment',
  'unknown',
];

const SEVS: ('all' | DenialSeverity)[] = [
  'all',
  'critical',
  'high',
  'medium',
  'low',
];

type RecBand = 'all' | 'high' | 'medium' | 'low';

function recoveryBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export default function DenialIntelligence() {
  const { data: claims, isLoading } = useClarityData();
  const { get, assign, assignees } = useAssignments();

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [severity, setSeverity] = useState<(typeof SEVS)[number]>('all');
  const [recBand, setRecBand] = useState<RecBand>('all');
  const [appealOnly, setAppealOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [highRecoveryView, setHighRecoveryView] = useState(false);

  const denials = useMemo(
    () => (claims ? allDenials(claims) : []),
    [claims],
  );

  const enriched = useMemo(() => {
    return denials.map(({ claim, denial }) => {
      const nba = nextBestAction(claim, denial);
      const playbook = recommendPlaybook(claim, denial);
      const expectedRecover =
        playbook?.expected_recovery_cents ??
        Math.round(denial.amount_cents * denial.recoverability_score / 100);

      return {
        claim,
        denial,
        nba,
        playbook,
        expectedRecover,
        band: recoveryBand(denial.recoverability_score),
      };
    });
  }, [denials]);

  const filtered = useMemo(() => {
    return enriched
      .filter(({ claim, denial, expectedRecover, band, nba, playbook }) => {
        if (category !== 'all' && denial.category !== category) return false;
        if (severity !== 'all' && denial.severity !== severity) return false;
        if (appealOnly && !denial.appeal_eligible) return false;
        if (recBand !== 'all' && band !== recBand) return false;

        if (highRecoveryView) {
          if (expectedRecover < 50_000 || denial.recoverability_score < 60) {
            return false;
          }
        }

        if (query) {
          const q = query.toLowerCase();

          const haystack = [
            claim.claim_id,
            claim.intel.payer_name,
            claim.provider_name,
            denial.carc_code,
            denial.rarc_code,
            denial.root_cause,
            denial.recommended_action,
            nba.headline,
            actionLabel(nba.kind),
            playbook?.playbook.title,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!haystack.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => b.expectedRecover - a.expectedRecover);
  }, [
    enriched,
    category,
    severity,
    recBand,
    appealOnly,
    query,
    highRecoveryView,
  ]);

  const kpis = useMemo(() => {
    const atRisk = denials.reduce((sum, item) => sum + item.denial.amount_cents, 0);

    const critical = denials.filter(
      (item) => item.denial.severity === 'critical',
    ).length;

    const highRecoverability = denials
      .filter((item) => item.denial.recoverability_score >= 60)
      .reduce((sum, item) => sum + item.denial.amount_cents, 0);

    const expectedRecovery = enriched.reduce(
      (sum, item) => sum + item.expectedRecover,
      0,
    );

    const appealEligible = denials.filter(
      (item) => item.denial.appeal_eligible,
    ).length;

    return {
      atRisk,
      critical,
      highRecoverability,
      expectedRecovery,
      appealEligible,
      total: denials.length,
    };
  }, [denials, enriched]);

  if (isLoading) {
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
        title="Denial Command Center"
        subtitle="CARC/RARC-driven denial taxonomy with recoverability scoring, next best action, playbooks, routing, and ownership."
        actions={
          <button
            onClick={() => setHighRecoveryView((v) => !v)}
            className={`h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border transition-colors ${
              highRecoveryView
                ? 'bg-status-paid text-white border-status-paid'
                : 'bg-card text-foreground hover:bg-muted'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
            High Recovery Opportunities
          </button>
        }
      />

      <KpiStrip
        tiles={[
          { label: 'Open Denials', value: String(kpis.total) },
          {
            label: 'Critical Severity',
            value: String(kpis.critical),
            tone: 'text-status-denied',
          },
          {
            label: 'Appeal Eligible',
            value: String(kpis.appealEligible),
            tone: 'text-status-pending',
          },
          {
            label: 'At-Risk Reimbursement',
            value: formatCents(kpis.atRisk),
            tone: 'amount-negative',
          },
          {
            label: 'High Recoverability',
            value: formatCents(kpis.highRecoverability),
            tone: 'amount-positive',
            sub: 'denials with ≥60% recovery',
          },
          {
            label: 'Expected Recovery',
            value: formatCentsCompact(kpis.expectedRecovery),
            tone: 'amount-positive',
            sub: 'playbook-weighted estimate',
          },
        ]}
      />

      <div className="px-5 py-3 border-b bg-card flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search claim, payer, CARC, root cause, action…"
            className="w-full h-8 pl-8 pr-3 text-[12.5px] rounded-md bg-muted/60 border border-transparent focus:bg-card focus:border-input focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <FilterSelect
          label="Category"
          value={category}
          onChange={(value) => setCategory(value as never)}
          options={CATEGORIES.map((c) => ({
            value: c,
            label: c === 'all' ? 'All categories' : CATEGORY_LABEL[c] ?? c,
          }))}
        />

        <FilterSelect
          label="Severity"
          value={severity}
          onChange={(value) => setSeverity(value as never)}
          options={SEVS.map((s) => ({
            value: s,
            label: s === 'all' ? 'All severities' : s,
          }))}
        />

        <FilterSelect
          label="Recoverability"
          value={recBand}
          onChange={(value) => setRecBand(value as RecBand)}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'high', label: 'HIGH (≥65)' },
            { value: 'medium', label: 'MEDIUM (35-64)' },
            { value: 'low', label: 'LOW (<35)' },
          ]}
        />

        <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={appealOnly}
            onChange={(event) => setAppealOnly(event.target.checked)}
          />
          Appeal-eligible only
        </label>

        <span className="text-[11px] font-mono text-muted-foreground ml-auto">
          {filtered.length} of {denials.length}
        </span>
      </div>

      <ScrollBody>
        {filtered.length === 0 ? (
          <EmptyState
            title="No denials match filters"
            body="Loosen the filters or clear the search query."
            icon={<AlertOctagon className="h-5 w-5" />}
          />
        ) : (
          <div className="divide-y bg-card">
            <div className="sticky top-0 z-10 grid grid-cols-[110px_75px_1.2fr_120px_100px_105px_120px_160px_160px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
              <span>Claim</span>
              <span>CARC</span>
              <span>Root Cause</span>
              <span>Category</span>
              <span>Severity</span>
              <span>Owner</span>
              <span>Recov.</span>
              <span className="text-right">At Risk · Expected</span>
              <span>Action · Assignee</span>
            </div>

            {filtered.map(({ claim, denial, nba, playbook, expectedRecover }) => {
              const sla = slaStatus(claim.intel.sla_due_at);
              const slaCls =
                sla.tone === 'breach'
                  ? 'text-status-denied'
                  : sla.tone === 'warn'
                    ? 'text-status-pending'
                    : 'text-status-paid';

              const assignment = get(claim.claim_id);

              return (
                <div
                  key={denial.denial_id}
                  className="grid grid-cols-[110px_75px_1.2fr_120px_100px_105px_120px_160px_160px] gap-3 items-center px-5 py-2.5 hover:bg-muted/40"
                >
                  <Link to={`/denials/${claim.claim_id}`}>
                    <div className="font-mono text-[12px] font-semibold text-primary hover:underline">
                      {claim.claim_id}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground truncate">
                      {claim.intel.payer_name}
                    </div>
                  </Link>

                  <div>
                    <div className="font-mono text-[12px] font-semibold text-foreground">
                      {denial.carc_code}
                    </div>
                    {denial.rarc_code && (
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {denial.rarc_code}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[12.5px] text-foreground truncate">
                      {denial.root_cause}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground truncate font-mono">
                      {relativeTime(denial.occurred_at)} ·{' '}
                      {denial.appeal_eligible ? 'appeal eligible' : 'not appealable'}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground truncate flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {nba.headline}
                    </div>
                  </div>

                  <span className="text-[11.5px] text-muted-foreground">
                    {CATEGORY_LABEL[denial.category] ?? denial.category}
                  </span>

                  <SeverityBadge severity={denial.severity} />
                  <OwnerChip owner={denial.workflow_owner} />
                  <RecoverabilityBar score={denial.recoverability_score} />

                  <div className="text-right">
                    <div className="font-mono text-[12px] amount-negative tabular-nums">
                      {formatCents(denial.amount_cents)}
                    </div>
                    <div className="font-mono text-[11px] amount-positive tabular-nums">
                      ≈{formatCents(expectedRecover)}
                    </div>
                    {playbook && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {Math.round(playbook.expected_recovery_probability * 100)}% · {playbook.effort}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className={`text-[11px] font-mono flex items-center gap-1 ${slaCls}`}>
                      <Clock className="h-3 w-3" />
                      {sla.label}
                    </span>

                    <span className="text-[10.5px] text-muted-foreground flex items-center gap-1 truncate">
                      <FileText className="h-3 w-3" />
                      {actionLabel(nba.kind)}
                    </span>

                    <select
                      value={assignment.assignee ?? ''}
                      onChange={(event) =>
                        assign(claim.claim_id, event.target.value || undefined)
                      }
                      onClick={(event) => event.stopPropagation()}
                      className="h-6 text-[10.5px] rounded border bg-card px-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollBody>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Filter className="h-3 w-3" />
      {label}

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 px-2 text-[11.5px] rounded border bg-card focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}