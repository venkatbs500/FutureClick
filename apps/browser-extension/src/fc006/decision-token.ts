/**
 * FC-006 Continue decision token (Sprint 3A)
 *
 * Epistemological Boundary:
 * Immutable, controller-private binding of a Continue control to the exact
 * pending decision that rendered it. Not page-exposed. Not cryptographic.
 */

export interface ContinueDecisionToken {
  readonly pendingId: string;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
  readonly previewGeneration: number;
}

export function createContinueDecisionToken(args: {
  readonly pendingId: string;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
  readonly previewGeneration: number;
}): ContinueDecisionToken {
  return Object.freeze({
    pendingId: args.pendingId,
    sessionEpoch: args.sessionEpoch,
    requestSequence: args.requestSequence,
    previewGeneration: args.previewGeneration,
  });
}

export function continueDecisionTokensEqual(
  a: ContinueDecisionToken,
  b: ContinueDecisionToken,
): boolean {
  return (
    a.pendingId === b.pendingId &&
    a.sessionEpoch === b.sessionEpoch &&
    a.requestSequence === b.requestSequence &&
    a.previewGeneration === b.previewGeneration
  );
}
