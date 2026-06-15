// Claim State Machine — explicit transitions with guards, transition reasons,
// idempotency safety, and audit-ready results.

import type { ClaimStatus } from '@/types/claim';

export interface TransitionGuard {
  id: string;
  description: string;
  check: (context: TransitionContext) => boolean;
}

export interface TransitionContext {
  claimId: string;
  currentStatus: ClaimStatus;
  targetStatus: ClaimStatus;

  hasPrimacyConfirmation?: boolean;
  hasExceptionOverride?: boolean;
  hasIdempotencyKey?: boolean;
  idempotencyKey?: string;
  hasPaymentAmount?: boolean;
  hasDenialReason?: boolean;
  hasReviewNote?: boolean;

  userId?: string;
  timestamp?: string;
  reason?: string;
}

export interface TransitionResult {
  allowed: boolean;
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  transitionLabel?: string;
  failedGuards: string[];
  appliedGuards: string[];
  guardMessages: string[];
  idempotencyKey?: string;
  auditEvent: {
    claimId: string;
    actor: string;
    at: string;
    action: string;
    from: ClaimStatus;
    to: ClaimStatus;
    allowed: boolean;
    reason?: string;
    failedGuards: string[];
    appliedGuards: string[];
  };
}

export interface StatusTransition {
  from: ClaimStatus;
  to: ClaimStatus;
  guards: TransitionGuard[];
  label: string;
  category: 'intake' | 'cob' | 'adjudication' | 'payment' | 'post_payment' | 'terminal';
}

const requirePrimacyConfirmation: TransitionGuard = {
  id: 'REQUIRE_PRIMACY_CONFIRMATION',
  description:
    'COB-routed claims require primacy confirmation or audited exception override before adjudication/payment.',
  check: (ctx) => Boolean(ctx.hasPrimacyConfirmation || ctx.hasExceptionOverride),
};

const requireIdempotencyKey: TransitionGuard = {
  id: 'REQUIRE_IDEMPOTENCY_KEY',
  description: 'Payment-impacting actions require an external idempotency key.',
  check: (ctx) => Boolean(ctx.hasIdempotencyKey && ctx.idempotencyKey),
};

const requirePaymentAmount: TransitionGuard = {
  id: 'REQUIRE_PAYMENT_AMOUNT',
  description: 'Payment transitions require a calculated payable amount.',
  check: (ctx) => Boolean(ctx.hasPaymentAmount),
};

const requireDenialReason: TransitionGuard = {
  id: 'REQUIRE_DENIAL_REASON',
  description: 'Denied claims require a denial reason for downstream explainability and appeal routing.',
  check: (ctx) => Boolean(ctx.hasDenialReason || ctx.hasReviewNote),
};

const requireReviewNote: TransitionGuard = {
  id: 'REQUIRE_REVIEW_NOTE',
  description: 'Manual review transitions require a note or reason.',
  check: (ctx) => Boolean(ctx.hasReviewNote || ctx.reason),
};

const noGuard: TransitionGuard = {
  id: 'NO_GUARD',
  description: 'No additional checks required.',
  check: () => true,
};

export const CLAIM_TRANSITIONS: StatusTransition[] = [
  { from: 'RECEIVED', to: 'ELIGIBILITY_CHECK', guards: [noGuard], label: 'Begin eligibility', category: 'intake' },

  { from: 'ELIGIBILITY_CHECK', to: 'COB_ROUTED', guards: [noGuard], label: 'OHI detected → route COB', category: 'cob' },
  { from: 'ELIGIBILITY_CHECK', to: 'IN_ADJUDICATION', guards: [noGuard], label: 'No OHI → adjudicate', category: 'adjudication' },

  { from: 'COB_ROUTED', to: 'AWAITING_PRIMARY_EOB', guards: [noGuard], label: 'Request primary EOB', category: 'cob' },
  { from: 'AWAITING_PRIMARY_EOB', to: 'IN_ADJUDICATION', guards: [requirePrimacyConfirmation], label: 'Primary EOB received', category: 'adjudication' },
  { from: 'COB_ROUTED', to: 'IN_ADJUDICATION', guards: [requirePrimacyConfirmation], label: 'Primacy confirmed → adjudicate', category: 'adjudication' },

  { from: 'IN_ADJUDICATION', to: 'ADJUDICATED', guards: [noGuard], label: 'Adjudication complete', category: 'adjudication' },
  { from: 'IN_ADJUDICATION', to: 'PENDED', guards: [requireReviewNote], label: 'Pend for review', category: 'adjudication' },
  { from: 'IN_ADJUDICATION', to: 'DENIED', guards: [requireDenialReason], label: 'Deny claim', category: 'terminal' },

  { from: 'PENDED', to: 'IN_ADJUDICATION', guards: [requireReviewNote], label: 'Resume adjudication', category: 'adjudication' },
  { from: 'PENDED', to: 'DENIED', guards: [requireDenialReason], label: 'Deny after review', category: 'terminal' },

  {
    from: 'ADJUDICATED',
    to: 'PAYMENT_IN_PROGRESS',
    guards: [requireIdempotencyKey, requirePaymentAmount],
    label: 'Initiate payment',
    category: 'payment',
  },
  {
    from: 'PAYMENT_IN_PROGRESS',
    to: 'PAID',
    guards: [requireIdempotencyKey],
    label: 'Payment confirmed',
    category: 'payment',
  },

  {
    from: 'PAID',
    to: 'REVERSED',
    guards: [requireIdempotencyKey, requireReviewNote],
    label: 'Reverse payment',
    category: 'post_payment',
  },
  { from: 'PAID', to: 'ADJUSTED', guards: [requireReviewNote], label: 'Adjust claim', category: 'post_payment' },
  { from: 'REVERSED', to: 'IN_ADJUDICATION', guards: [requireReviewNote], label: 'Re-adjudicate reversed claim', category: 'adjudication' },
  { from: 'ADJUSTED', to: 'IN_ADJUDICATION', guards: [requireReviewNote], label: 'Re-adjudicate adjusted claim', category: 'adjudication' },
];

export const ALL_STATUSES: ClaimStatus[] = [
  'RECEIVED',
  'ELIGIBILITY_CHECK',
  'COB_ROUTED',
  'AWAITING_PRIMARY_EOB',
  'IN_ADJUDICATION',
  'PENDED',
  'ADJUDICATED',
  'DENIED',
  'PAYMENT_IN_PROGRESS',
  'PAID',
  'REVERSED',
  'ADJUSTED',
];

export function getValidTransitions(currentStatus: ClaimStatus): StatusTransition[] {
  return CLAIM_TRANSITIONS.filter((transition) => transition.from === currentStatus);
}

export function canTransition(context: TransitionContext): TransitionResult {
  const transition = CLAIM_TRANSITIONS.find(
    (t) => t.from === context.currentStatus && t.to === context.targetStatus,
  );

  const actor = context.userId || 'system';
  const at = context.timestamp || new Date().toISOString();

  if (!transition) {
    return {
      allowed: false,
      fromStatus: context.currentStatus,
      toStatus: context.targetStatus,
      failedGuards: ['NO_VALID_TRANSITION'],
      appliedGuards: [],
      guardMessages: ['No valid state transition exists for this status change.'],
      auditEvent: {
        claimId: context.claimId,
        actor,
        at,
        action: 'claim.transition.denied',
        from: context.currentStatus,
        to: context.targetStatus,
        allowed: false,
        reason: context.reason,
        failedGuards: ['NO_VALID_TRANSITION'],
        appliedGuards: [],
      },
    };
  }

  const failedGuards: string[] = [];
  const appliedGuards: string[] = [];
  const guardMessages: string[] = [];

  for (const guard of transition.guards) {
    if (guard.id === 'NO_GUARD') continue;

    appliedGuards.push(guard.id);

    if (!guard.check(context)) {
      failedGuards.push(guard.id);
      guardMessages.push(guard.description);
    }
  }

  const allowed = failedGuards.length === 0;
  const idempotencyKey = allowed && context.idempotencyKey
    ? context.idempotencyKey
    : undefined;

  return {
    allowed,
    fromStatus: context.currentStatus,
    toStatus: context.targetStatus,
    transitionLabel: transition.label,
    failedGuards,
    appliedGuards,
    guardMessages,
    idempotencyKey,
    auditEvent: {
      claimId: context.claimId,
      actor,
      at,
      action: allowed ? 'claim.transition.allowed' : 'claim.transition.denied',
      from: context.currentStatus,
      to: context.targetStatus,
      allowed,
      reason: context.reason,
      failedGuards,
      appliedGuards,
    },
  };
}

export function getStatusCategory(
  status: ClaimStatus,
): 'intake' | 'cob' | 'adjudication' | 'payment' | 'terminal' {
  switch (status) {
    case 'RECEIVED':
    case 'ELIGIBILITY_CHECK':
      return 'intake';

    case 'COB_ROUTED':
    case 'AWAITING_PRIMARY_EOB':
      return 'cob';

    case 'IN_ADJUDICATION':
    case 'PENDED':
    case 'ADJUDICATED':
      return 'adjudication';

    case 'PAYMENT_IN_PROGRESS':
    case 'PAID':
      return 'payment';

    case 'DENIED':
    case 'REVERSED':
    case 'ADJUSTED':
      return 'terminal';
  }
}

export function isTerminalStatus(status: ClaimStatus): boolean {
  return ['DENIED', 'PAID', 'REVERSED', 'ADJUSTED'].includes(status);
}

export function describeStatus(status: ClaimStatus): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}