/**
 * FC-006 Content Script Entry Point (Sprint 3)
 *
 * Epistemological Boundary:
 * Injected at document_start into the exact FC-006 synthetic fixture route.
 *
 * Sprint 3 behavior:
 * - Verifies exact runtime FC-006 authorization.
 * - Captures native HTMLButtonElement.prototype.click at module load.
 * - Installs capture-phase click listener immediately (lifetime of document).
 * - Initializes owned Start/Stop + preview UI when DOM is ready.
 * - Starts in `off`; Start → observing enables trusted interception.
 * - Evaluating UI, deterministic consequence preview, Cancel, Stop.
 * - Trusted Continue → sync revalidation → one-shot private ArmedContinuation
 *   → Reflect.apply(capturedNativeClick, exactPendingElement, []).
 *
 * Explicitly NOT implemented:
 * - generic executor / selector release / arbitrary element argument
 * - cryptographic event authentication
 * - real GitHub mutation
 */

import { isFc006LocationAuthorized } from "./capture.js";
import { Fc006InterceptionController } from "./controller.js";
import type { Fc006LifecycleKind } from "./interception.js";
import "./native-click.js";

export type Fc006RuntimeMode = Fc006LifecycleKind;

export interface Fc006RuntimeState {
  readonly mode: Fc006RuntimeMode;
  readonly sprint: 3;
  readonly activeInterception: boolean;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
}

let controller: Fc006InterceptionController | null = null;

/**
 * Returns a snapshot of FC-006 runtime state, or null if unauthorized / not bootstrapped.
 */
export function getFc006RuntimeState(): Fc006RuntimeState | null {
  if (!controller) return null;
  const kind = controller.getLifecycleKind();
  return Object.freeze({
    mode: kind,
    sprint: 3 as const,
    activeInterception: kind !== "off",
    sessionEpoch: controller.getSessionEpoch(),
    requestSequence: controller.getRequestSequence(),
  });
}

/** Test / diagnostics seam — never page-exposed as a global. */
export function getFc006Controller(): Fc006InterceptionController | null {
  return controller;
}

/**
 * Bootstraps the FC-006 document_start bundle.
 * Listener is installed immediately when authorized; UI mounts when DOM allows.
 */
export function bootstrapFc006(): boolean {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }

  if (!isFc006LocationAuthorized(window.location)) {
    controller = null;
    return false;
  }

  try {
    if (!controller) {
      controller = new Fc006InterceptionController();
    }
    controller.installEarlyListener();
    controller.initUi();
    return true;
  } catch {
    controller = null;
    return false;
  }
}

if (typeof window !== "undefined") {
  bootstrapFc006();
}
