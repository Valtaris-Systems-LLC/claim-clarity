/**
 * COB (Coordination of Benefits) Rules Engine
 * 
 * Implements configurable rule-pack modules for COB primacy determination
 * and secondary allocation calculations.
 */

import type { PriorPayerOutcome, COBAllocation, COBPolicyType, OHIIndicator } from '@/types/claim';
import type { RuleFiring } from '@/types/trace';
import { createRuleFiring } from './trace-builder';

// COB Primacy Rule Pack
export interface COBPrimacyRule {
  rule_id: string;
  name: string;
  priority: number; // lower = evaluated first
  evaluate: (indicators: OHIIndicator[], context: PrimacyContext) => PrimacyResult | null;
}

export interface PrimacyContext {
  member_dob?: string;
  spouse_dob?: string;
  custody_decree?: boolean;
  custodial_parent_payer_id?: string;
  employment_status?: string;
  coverage_start_dates?: Map<string, string>;
  msp_type?: string;
}

export interface PrimacyResult {
  primary_payer_id: string;
  secondary_payer_id: string;
  rationale: string;
  rule_id: string;
}

// Built-in rule packs
export const birthdayRule: COBPrimacyRule = {
  rule_id: 'COB_BIRTHDAY_001',
  name: 'Birthday Rule',
  priority: 10,
  evaluate: (_indicators, context) => {
    if (!context.member_dob || !context.spouse_dob) return null;
    const memberMonth = new Date(context.member_dob).getMonth();
    const memberDay = new Date(context.member_dob).getDate();
    const spouseMonth = new Date(context.spouse_dob).getMonth();
    const spouseDay = new Date(context.spouse_dob).getDate();

    if (memberMonth < spouseMonth || (memberMonth === spouseMonth && memberDay <= spouseDay)) {
      return {
        primary_payer_id: 'member_plan',
        secondary_payer_id: 'spouse_plan',
        rationale: 'Member birthday earlier in calendar year (Birthday Rule)',
        rule_id: 'COB_BIRTHDAY_001',
      };
    }
    return {
      primary_payer_id: 'spouse_plan',
      secondary_payer_id: 'member_plan',
      rationale: 'Spouse birthday earlier in calendar year (Birthday Rule)',
      rule_id: 'COB_BIRTHDAY_001',
    };
  },
};

export const lengthOfCoverageRule: COBPrimacyRule = {
  rule_id: 'COB_LENGTH_001',
  name: 'Length of Coverage',
  priority: 20,
  evaluate: (_indicators, context) => {
    if (!context.coverage_start_dates || context.coverage_start_dates.size < 2) return null;
    const entries = Array.from(context.coverage_start_dates.entries());
    entries.sort((a, b) => a[1].localeCompare(b[1]));
    return {
      primary_payer_id: entries[0][0],
      secondary_payer_id: entries[1][0],
      rationale: `Longer coverage period determines primacy (${entries[0][0]} started ${entries[0][1]})`,
      rule_id: 'COB_LENGTH_001',
    };
  },
};

/**
 * Determine COB primacy order using rule packs
 */
export function determineCOBPrimacy(
  indicators: OHIIndicator[],
  context: PrimacyContext,
  rulePacks: COBPrimacyRule[] = [birthdayRule, lengthOfCoverageRule],
  ruleFirings: RuleFiring[] = []
): PrimacyResult | null {
  const sorted = [...rulePacks].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const result = rule.evaluate(indicators, context);
    if (result) {
      ruleFirings.push(createRuleFiring(
        ruleFirings.length,
        rule.rule_id,
        'cob_primacy',
        { indicators: indicators.map(i => i.payer_id), context_keys: Object.keys(context) },
        { primary: result.primary_payer_id, secondary: result.secondary_payer_id },
        [`frag_cob_${rule.rule_id.toLowerCase()}`]
      ));
      return result;
    }
  }
  return null;
}

/**
 * Calculate COB allocation for secondary payer
 */
export function calculateCOBAllocation(
  allowed: number,
  priorOutcomes: PriorPayerOutcome[],
  cobPolicy: COBPolicyType
): {
  total_prior_paid: number;
  adjustment: number;
  allocations: COBAllocation[];
} {
  const totalPriorPaid = priorOutcomes.reduce((sum, po) => sum + po.paid, 0);
  const totalPriorPatientResp = priorOutcomes.reduce(
    (sum, po) => sum + po.patient_responsibility,
    0,
  );

  const allocations: COBAllocation[] = [];

  let secondaryPayable = 0;

  if (cobPolicy === 'standard') {
    secondaryPayable = Math.min(
      Math.max(0, allowed - totalPriorPaid),
      Math.max(0, totalPriorPatientResp),
    );
  } else if (cobPolicy === 'non_duplication') {
    secondaryPayable = Math.max(0, allowed - totalPriorPaid);
  } else if (cobPolicy === 'maintenance_of_benefits') {
    secondaryPayable = Math.max(0, allowed - totalPriorPaid);
  }

  const adjustment = Math.max(0, allowed - totalPriorPaid - secondaryPayable);

  for (const po of priorOutcomes) {
    allocations.push({
      payer_id: po.payer_id,
      payer_order: 1,
      allowed: po.allowed,
      paid: po.paid,
      adjustment,
      method: cobPolicy,
    });
  }

  return {
    total_prior_paid: totalPriorPaid,
    adjustment,
    allocations,
  };
}
