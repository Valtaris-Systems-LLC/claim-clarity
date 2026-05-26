/**
 * Payer Requirement Profiles
 *
 * Static + derived profiles for each payer: appeal deadlines,
 * documentation expectations, submission channels, common denial
 * causes, historical overturn rates. Surfaced inside workflows
 * including packet builder, appeal drafting, and next-best-action.
 */

import type { Claim } from '@/types/claim';
import type { ClaimIntel } from '@/types/clarity';
import { buildPayerProfiles } from './payer-profile';

export interface PayerRequirements {
  payer_id: string;
  payer_name: string;
  payer_class: ClaimIntel['payer_class'];

  appeal_deadlines: {
    level_1_days: number;
    level_2_days: number;
    external_review_days: number;
  };

  submission_channels: Array<{
    channel: 'edi_837' | 'portal' | 'fax' | 'mail';
    preferred: boolean;
    address?: string;
  }>;

  documentation_expectations: string[];

  /**
   * Alias used by Appeal Packet Builder.
   * Keep this in sync with documentation_expectations.
   */
  required_documents: string[];

  common_denial_causes: string[];
  overturn_rate: number;
  timely_filing_days: number;
  notes: string[];
}

const STATIC_PROFILES: Record<string, Partial<PayerRequirements>> = {
  default_commercial: {
    appeal_deadlines: {
      level_1_days: 180,
      level_2_days: 60,
      external_review_days: 60,
    },
    submission_channels: [
      { channel: 'portal', preferred: true },
      { channel: 'fax', preferred: false },
      { channel: 'mail', preferred: false },
    ],
    documentation_expectations: [
      'Itemised bill',
      'Clinical notes',
      'Op note (surgical)',
      'Authorization reference',
    ],
    timely_filing_days: 365,
    notes: ['Confirm appeal level on payer portal before drafting.'],
  },

  default_medicare: {
    appeal_deadlines: {
      level_1_days: 120,
      level_2_days: 180,
      external_review_days: 60,
    },
    submission_channels: [
      { channel: 'mail', preferred: true, address: 'MAC Appeals (region-specific)' },
      { channel: 'portal', preferred: false },
    ],
    documentation_expectations: [
      'Redetermination request form (CMS-20027)',
      'Itemised bill',
      'Medical records',
      'Provider statement',
    ],
    timely_filing_days: 365,
    notes: [
      'Use CMS-20027 for Level 1 (Redetermination).',
      'Five-level appeal ladder: Redetermination → Reconsideration → ALJ → MAC → Federal court.',
    ],
  },

  default_medicaid: {
    appeal_deadlines: {
      level_1_days: 90,
      level_2_days: 30,
      external_review_days: 120,
    },
    submission_channels: [
      { channel: 'portal', preferred: true },
      { channel: 'mail', preferred: false },
    ],
    documentation_expectations: [
      'State-specific appeal form',
      'Medical records',
      'Plan benefit reference',
      'Eligibility verification',
    ],
    timely_filing_days: 180,
    notes: [
      'State Medicaid agencies vary — confirm filing window per state.',
      'Stricter documentation reviews than commercial.',
    ],
  },
};

function profileKeyFor(payerClass: ClaimIntel['payer_class']): keyof typeof STATIC_PROFILES {
  if (payerClass === 'medicare') return 'default_medicare';
  if (payerClass === 'medicaid') return 'default_medicaid';
  return 'default_commercial';
}

function unique(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

export function buildPayerRequirements(
  claims: Array<Claim & { intel: ClaimIntel }>,
): PayerRequirements[] {
  const profiles = buildPayerProfiles(claims);

  return profiles.map((profile) => {
    const template = STATIC_PROFILES[profileKeyFor(profile.payer_class)]!;

    const docs = unique([
      ...(template.documentation_expectations ?? []),
      ...profile.documentation_requirements.slice(0, 4),
    ]);

    return {
      payer_id: profile.payer_id,
      payer_name: profile.payer_name,
      payer_class: profile.payer_class,

      appeal_deadlines: template.appeal_deadlines!,

      submission_channels: template.submission_channels!,

      documentation_expectations: docs,

      required_documents: docs,

      common_denial_causes: profile.top_denial_reasons.map((reason) => reason.category),

      overturn_rate: profile.appeal_success_rate,

      timely_filing_days: template.timely_filing_days!,

      notes: template.notes ?? [],
    };
  });
}

export function findRequirementsFor(
  payerId: string,
  claims: Array<Claim & { intel: ClaimIntel }>,
): PayerRequirements | undefined {
  return buildPayerRequirements(claims).find((requirements) => requirements.payer_id === payerId);
}