/**
 * FC-007 Sprint 3B — release interceptor surface (isolated component).
 *
 * Re-exports the isolated release component for dedicated tests/smoke.
 * NOT imported by production index / Continue path.
 */

export {
  Fc007IsolatedReleaseComponent,
  createClickEventWithTrustForTest,
  isAuthorizedReleaseEventView,
  type Fc007AuthorizedEventView,
  type Fc007ReleaseCounters,
  type Fc007ReleaseOutcome,
  type Fc007ReleasePermission,
  type Fc007ReleasePhase,
  type Fc007ReleaseReceipt,
  type Fc007TestNativeExecutor,
} from "./release-attempt.js";
