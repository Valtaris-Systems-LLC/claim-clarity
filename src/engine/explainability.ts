/**
 * Explainability Engine — Fragment Library
 * Single source of truth for all explanation text.
 * Smart Search, Guided Help, Claim Clarity, trace views, and denial recovery
 * workflows share this engine.
 */

import type { ExplanationFragment, CARCRARCMapping } from '@/types/trace';

// Fragment Library (in production, this would be a database table)
export const FRAGMENT_LIBRARY: ExplanationFragment[] = [
  // Pricing
  { fragment_id: 'frag_pricing_fee_schedule', internal_code: 'PRICING_FS', lens: 'member', locale: 'en', text: 'Your provider has a contracted rate with your plan. The allowed amount is based on this agreement.', detail_level: 1 },
  { fragment_id: 'frag_pricing_fee_schedule', internal_code: 'PRICING_FS', lens: 'provider', locale: 'en', text: 'Allowed amount determined by fee schedule contract terms.', detail_level: 1 },

  // Deductible
  { fragment_id: 'frag_deductible_applied', internal_code: 'DEDUCT_APPLIED', lens: 'member', locale: 'en', text: 'A portion of this service was applied to your annual deductible. You pay this amount before your plan begins to share costs.', detail_level: 1 },
  { fragment_id: 'frag_deductible_applied', internal_code: 'DEDUCT_APPLIED', lens: 'provider', locale: 'en', text: 'Member deductible applied per plan terms.', detail_level: 1 },

  // Coinsurance
  { fragment_id: 'frag_coinsurance_applied', internal_code: 'COINS_APPLIED', lens: 'member', locale: 'en', text: 'After your deductible, you and your plan share the remaining cost. Your share (coinsurance) is shown here.', detail_level: 1 },
  { fragment_id: 'frag_coinsurance_applied', internal_code: 'COINS_APPLIED', lens: 'provider', locale: 'en', text: 'Member coinsurance calculated per plan benefit terms.', detail_level: 1 },

  // Denial
  { fragment_id: 'frag_denial_non_covered', internal_code: 'DENY_NC', lens: 'member', locale: 'en', text: 'This service is not covered under your current plan. You are responsible for the full billed amount.', detail_level: 1 },
  { fragment_id: 'frag_denial_non_covered', internal_code: 'DENY_NC', lens: 'provider', locale: 'en', text: 'Service not in contracted fee schedule. Non-covered per plan terms.', detail_level: 1 },

  // COB
  { fragment_id: 'frag_cob_secondary_calc', internal_code: 'COB_SEC', lens: 'member', locale: 'en', text: 'Your other insurance (primary) paid a portion of this claim. This plan (secondary) covers the remaining eligible amount.', detail_level: 1 },
  { fragment_id: 'frag_cob_secondary_calc', internal_code: 'COB_SEC', lens: 'provider', locale: 'en', text: 'Secondary payer calculation applied. COB allocation based on primary EOB.', detail_level: 1 },

  // Summary (L0)
  { fragment_id: 'frag_summary_paid', internal_code: 'SUMMARY_PAID', lens: 'member', locale: 'en', text: 'Your claim has been processed and payment has been issued.', detail_level: 0 },
  { fragment_id: 'frag_summary_denied', internal_code: 'SUMMARY_DENIED', lens: 'member', locale: 'en', text: 'Your claim was reviewed but could not be approved.', detail_level: 0 },

  // Claim Clarity Recovery Intelligence
  { fragment_id: 'frag_appeal_recommended', internal_code: 'APPEAL_REC', lens: 'provider', locale: 'en', text: 'This denial appears recoverable through appeal. Supporting documentation should be attached and resubmitted.', detail_level: 1 },
  { fragment_id: 'frag_aging_risk', internal_code: 'AGING_RISK', lens: 'provider', locale: 'en', text: 'Claim aging is approaching critical filing limits. Recovery probability decreases as appeal windows close.', detail_level: 1 },
  { fragment_id: 'frag_underpayment_detected', internal_code: 'UNDERPAY', lens: 'provider', locale: 'en', text: 'Potential underpayment detected. Paid amount appears lower than expected reimbursement.', detail_level: 1 },
  { fragment_id: 'frag_missing_docs', internal_code: 'DOC_GAP', lens: 'provider', locale: 'en', text: 'Required documentation is missing and may prevent successful recovery.', detail_level: 1 },
  { fragment_id: 'frag_high_recovery', internal_code: 'HIGH_RECOVERY', lens: 'provider', locale: 'en', text: 'Claim is considered a strong recovery candidate based on denial category, payer behavior, and documentation status.', detail_level: 1 },
];

// CARC/RARC → Internal mapping
export const CARC_RARC_MAPPINGS: CARCRARCMapping[] = [
  { external_carc: '1', internal_reason_code: 'DEDUCT_APPLIED', fragment_ids: { member: ['frag_deductible_applied'], provider: ['frag_deductible_applied'] } },
  { external_carc: '2', internal_reason_code: 'COINS_APPLIED', fragment_ids: { member: ['frag_coinsurance_applied'], provider: ['frag_coinsurance_applied'] } },
  { external_carc: '45', internal_reason_code: 'CONTRACTUAL_ADJ', fragment_ids: { member: ['frag_pricing_fee_schedule'], provider: ['frag_pricing_fee_schedule'] } },
  { external_carc: '96', external_rarc: 'N20', internal_reason_code: 'DENY_NC', fragment_ids: { member: ['frag_denial_non_covered'], provider: ['frag_denial_non_covered'] } },
];

export function getFragment(
  fragmentId: string,
  lens: ExplanationFragment['lens'],
  locale: string = 'en',
  detailLevel?: number
): ExplanationFragment | undefined {
  return FRAGMENT_LIBRARY.find(f =>
    f.fragment_id === fragmentId &&
    f.lens === lens &&
    f.locale === locale &&
    (detailLevel === undefined || f.detail_level === detailLevel)
  );
}

export function mapCARCtoInternal(carc: string, rarc?: string): CARCRARCMapping | undefined {
  return CARC_RARC_MAPPINGS.find(m =>
    m.external_carc === carc &&
    (rarc === undefined || m.external_rarc === rarc || m.external_rarc === undefined)
  );
}

export function explainLineResult(
  fragmentIds: string[],
  lens: ExplanationFragment['lens'],
  detailLevel: 0 | 1 | 2 | 3 = 1,
  locale: string = 'en'
): string[] {
  return fragmentIds
    .map(fid => getFragment(fid, lens, locale, detailLevel))
    .filter((f): f is ExplanationFragment => f !== undefined)
    .map(f => f.text);
}

export function buildRecoveryExplanation(
  score: number,
  recoverabilityTier: 'HIGH' | 'MEDIUM' | 'LOW'
): string {
  if (recoverabilityTier === 'HIGH') {
    return `Recovery Score ${score}. Strong recovery opportunity. Immediate appeal or correction is recommended.`;
  }

  if (recoverabilityTier === 'MEDIUM') {
    return `Recovery Score ${score}. Recovery is possible but additional evidence or payer follow-up may be required.`;
  }

  return `Recovery Score ${score}. Recovery likelihood is low. Evaluate cost of pursuit before further effort.`;
}