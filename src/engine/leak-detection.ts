/**
 * Revenue Leak Engine
 *
 * Aggregates claim-level signals into operational patterns:
 *  - recurring denial reasons (CARC/category)
 *  - payer-specific concentration
 *  - authorization gaps
 *  - documentation gaps
 *  - coding issues
 *  - workflow bottlenecks
 *
 * Each pattern carries an estimated leakage value and root cause
 * narrative so operations can act on it.
 */
import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialCategory } from '@/types/clarity';
import { CATEGORY_LABEL } from './denial-intelligence';

export type LeakPatternKind =
  | 'recurring_denial'
  | 'payer_concentration'
  | 'auth_gap'
  | 'documentation_gap'
  | 'coding_issue'
  | 'workflow_bottleneck';

export interface LeakPattern {
  pattern_id: string;
  kind: LeakPatternKind;
  title: string;
  root_cause: string;
  estimated_leakage_cents: number;
  recoverable_cents: number;
  claim_count: number;
  affected_claims: string[];
  recommendation: string;
}

type C = Claim & { intel: ClaimIntel };

function recurringByCategory(claims: C[]): LeakPattern[] {
  const byCat = new Map<DenialCategory, { claims: Set<string>; leak: number; rec: number; sampleCARC: string }>();
  for (const c of claims) {
    for (const d of c.intel.denial_events) {
      const cur = byCat.get(d.category) ?? { claims: new Set(), leak: 0, rec: 0, sampleCARC: d.carc_code };
      cur.claims.add(c.claim_id);
      cur.leak += d.amount_cents;
      if (d.recoverability_score >= 50) cur.rec += d.amount_cents;
      byCat.set(d.category, cur);
    }
  }
  return [...byCat.entries()]
    .filter(([, v]) => v.claims.size >= 2)
    .map(([cat, v]) => ({
      pattern_id: `pat-cat-${cat}`,
      kind: 'recurring_denial' as const,
      title: `Recurring ${CATEGORY_LABEL[cat]} denials`,
      root_cause: `${v.claims.size} claims denied for ${CATEGORY_LABEL[cat].toLowerCase()} (sample CARC ${v.sampleCARC}). Suggests an upstream process failure.`,
      estimated_leakage_cents: v.leak,
      recoverable_cents: v.rec,
      claim_count: v.claims.size,
      affected_claims: [...v.claims],
      recommendation: recommendationForCategory(cat),
    }))
    .sort((a, b) => b.estimated_leakage_cents - a.estimated_leakage_cents);
}

function recommendationForCategory(cat: DenialCategory): string {
  switch (cat) {
    case 'authorization':
      return 'Tighten pre-auth workflow: confirm auth captured before scheduling for affected service types.';
    case 'missing_documentation':
      return 'Standardize documentation checklists at point of service; block submission if mandatory fields missing.';
    case 'coding':
      return 'Coder QA review on affected procedure codes; refresh LCD/NCCI guidance.';
    case 'modifier':
      return 'Coder education on modifier 25/59 application; auto-suggest modifiers in claim scrubber.';
    case 'medical_necessity':
      return 'Engage clinical to template LMN; cite supporting LCDs at submission.';
    case 'timely_filing':
      return 'Audit clearinghouse pipeline for stuck claims; widen daily submission monitor.';
    case 'cob':
    case 'coordination_of_benefits':
      return 'COB verification at intake; persist primary EOB before secondary submission.';
    case 'eligibility':
      return 'Run real-time 270/271 at every check-in; flag termed coverage before service.';
    case 'duplicate':
      return 'Add pre-submission duplicate scrubber; require modifier 76/77 with documentation when re-billing.';
    case 'bundled':
      return 'NCCI edit check in scrubber; bundle-aware billing rules.';
    case 'underpayment':
      return 'Compare 835 paid amount to contract fee schedule; auto-open underpayment recovery cases.';
    case 'contractual':
      return 'No recovery — verify fee schedule current; renegotiate at contract cycle.';
    case 'coverage':
      return 'SPD review on affected service lines; align patient financial counseling.';
    case 'benefit_limit':
      return 'Validate accumulator history and plan maximums; appeal only if the payer misapplied the benefit limit.';
    case 'medical_record_request':
      return 'Create medical-record request queue; attach records and track payer response deadlines.';
    case 'unknown':
      return 'Research payer message, classify the denial, then route to the matching recovery playbook.';
  }
}

function payerConcentration(claims: C[]): LeakPattern[] {
  const m = new Map<string, { name: string; claims: Set<string>; leak: number; rec: number }>();
  for (const c of claims) {
    if (c.intel.amount_at_risk_cents <= 0) continue;
    const cur = m.get(c.intel.payer_id) ?? { name: c.intel.payer_name, claims: new Set(), leak: 0, rec: 0 };
    cur.claims.add(c.claim_id);
    cur.leak += c.intel.amount_at_risk_cents;
    if (c.intel.recoverability_score >= 50) cur.rec += c.intel.amount_at_risk_cents;
    m.set(c.intel.payer_id, cur);
  }
  return [...m.entries()]
    .filter(([, v]) => v.leak >= 100_000) // >$1000
    .map(([id, v]) => ({
      pattern_id: `pat-payer-${id}`,
      kind: 'payer_concentration' as const,
      title: `Concentration risk — ${v.name}`,
      root_cause: `${v.name} represents $${(v.leak / 100).toLocaleString()} across ${v.claims.size} at-risk claims.`,
      estimated_leakage_cents: v.leak,
      recoverable_cents: v.rec,
      claim_count: v.claims.size,
      affected_claims: [...v.claims],
      recommendation: `Schedule payer JOC; review provider contract and recurring denial themes specific to ${v.name}.`,
    }))
    .sort((a, b) => b.estimated_leakage_cents - a.estimated_leakage_cents);
}

function workflowBottlenecks(claims: C[]): LeakPattern[] {
  const stalled = claims.filter(c => c.intel.is_stalled);
  if (stalled.length === 0) return [];
  const leak = stalled.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
  return [{
    pattern_id: 'pat-wf-stalled',
    kind: 'workflow_bottleneck',
    title: `${stalled.length} stalled claims awaiting payer response`,
    root_cause: 'Claims with no payer movement past expected SLA. Indicates broken follow-up cadence.',
    estimated_leakage_cents: leak,
    recoverable_cents: leak,
    claim_count: stalled.length,
    affected_claims: stalled.map(c => c.claim_id),
    recommendation: 'Open payer follow-up tickets; escalate via provider services line.',
  }];
}

export function detectLeakPatterns(claims: C[]): LeakPattern[] {
  return [
    ...recurringByCategory(claims),
    ...payerConcentration(claims),
    ...workflowBottlenecks(claims),
  ];
}

export const PATTERN_LABEL: Record<LeakPatternKind, string> = {
  recurring_denial: 'Recurring Denial',
  payer_concentration: 'Payer Concentration',
  auth_gap: 'Authorization Gap',
  documentation_gap: 'Documentation Gap',
  coding_issue: 'Coding Issue',
  workflow_bottleneck: 'Workflow Bottleneck',
};
