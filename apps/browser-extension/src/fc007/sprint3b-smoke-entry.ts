/**
 * FC-007 Sprint 3B — dedicated isolated smoke entry.
 *
 * NOT listed in the production manifest.
 * Does NOT wire production Continue → release.
 * Installs Window capture at document_start (module eval) BEFORE page handlers.
 * Exposes isolated-world harness only (never page-world).
 */

import { authorizeFc007SettingsLocation } from "./location.js";
import { Fc007PassiveController, type Fc007TrustedDiagnostic } from "./passive-controller.js";
import { Fc007IsolatedReleaseComponent } from "./release-attempt.js";
import type { Fc007VerifiedDecision } from "./verified-decision.js";

let controller: Fc007PassiveController | null = null;
/** Installed at module load / document_start — before page Window capture. */
let release: Fc007IsolatedReleaseComponent | null = null;
/** Retained across stopControllerKeepDecision for isolated 3B release proofs. */
let retainedDecision: Fc007VerifiedDecision | null = null;

declare global {
  var __FC007_SMOKE_CTRL__: Fc007PassiveController | undefined;
  var __FC007_3B_HARNESS__:
    | {
        getController: () => Fc007PassiveController | null;
        getDecision: () => Fc007VerifiedDecision | null;
        ensureReleaseInstalled: () => boolean;
        isListenerInstalled: () => boolean;
        releaseOnceCurrentDecision: () => {
          outcome: string;
          consumed: boolean;
          authorizedEventObserved: boolean;
          invalidationObserved: boolean;
          executorThrew: boolean;
          counters: ReturnType<Fc007IsolatedReleaseComponent["getCounters"]>;
          permission: string;
          dispatchGuardActive: boolean;
          fcWindowSequenceAtConsume: number;
          receipt: ReturnType<Fc007IsolatedReleaseComponent["getReceipt"]>;
        };
        /** Low-level test-only path (must not be 3C production pattern). */
        armCurrentDecision: () => { status: string; reason?: string };
        executeArmed: () => {
          outcome: string;
          consumed: boolean;
          authorizedEventObserved: boolean;
          counters: ReturnType<Fc007IsolatedReleaseComponent["getCounters"]>;
          permission: string;
          dispatchGuardActive: boolean;
        };
        stopControllerKeepDecision: () => void;
        getReleaseSnapshot: () => {
          phase: string;
          permission: string;
          outcome: string | null;
          receipt: ReturnType<Fc007IsolatedReleaseComponent["getReceipt"]>;
          counters: ReturnType<Fc007IsolatedReleaseComponent["getCounters"]>;
          dispatchGuardActive: boolean;
          listenerInstalled: boolean;
          uninstallDeferred: boolean;
          fcWindowSequenceAtConsume: number;
        };
        uninstall: () => void;
        notePrimary: () => void;
      }
    | undefined;
}

function emptyCounters() {
  return {
    attemptsCreated: 0,
    arms: 0,
    executorCalls: 0,
    authorizedEventsObserved: 0,
    permissionConsumptions: 0,
    nestedEventsObserved: 0,
    nestedEventsPrevented: 0,
    pagePrimaryHandlers: 0,
    pageNestedHandlers: 0,
    submitEvents: 0,
    cleanupCount: 0,
    retries: 0,
    fallbacks: 0,
    blockedMatchingEvents: 0,
    fcWindowCaptureSeen: 0,
  };
}

function emitBoot(): void {
  try {
    console.log(
      `__FC007_BOOT__${JSON.stringify({
        readyState: typeof document !== "undefined" ? document.readyState : "unknown",
        sprint: "3b",
        windowListenerEarly: release?.isListenerInstalled() === true,
      })}`,
    );
  } catch {
    // ignore
  }
}

function emitDiag(d: Fc007TrustedDiagnostic): void {
  try {
    console.log(`__FC007_DIAG__${JSON.stringify(d)}`);
  } catch {
    // ignore
  }
}

/**
 * Install Window capture at earliest isolated bootstrap — BEFORE page scripts
 * register page Window capture handlers. Listener remains inert until releaseOnce.
 */
function installReleaseEarly(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (release?.isListenerInstalled()) return;
  if (!release) {
    release = new Fc007IsolatedReleaseComponent();
  }
  release.install(window);
  // Smoke-only diagnostic mirror: runs AFTER release security listener (same world),
  // sets cross-world attribute so page Window can observe consume-before-page-Window.
  window.addEventListener(
    "click",
    () => {
      if (release?.getReceipt().consumed === true) {
        try {
          document.documentElement.setAttribute("data-fc007-consumed", "1");
        } catch {
          // ignore
        }
      }
    },
    true,
  );
}

function bindHarness(): void {
  globalThis.__FC007_SMOKE_CTRL__ = controller ?? undefined;
  globalThis.__FC007_3B_HARNESS__ = {
    getController: () => controller,
    getDecision: () => retainedDecision ?? controller?.getActiveDecisionForTest() ?? null,
    ensureReleaseInstalled: () => {
      installReleaseEarly();
      return release?.isListenerInstalled() === true;
    },
    isListenerInstalled: () => release?.isListenerInstalled() === true,
    releaseOnceCurrentDecision: () => {
      const decision = retainedDecision ?? controller?.getActiveDecisionForTest() ?? null;
      if (!decision || !release) {
        return {
          outcome: "NOT_ARMED",
          consumed: false,
          authorizedEventObserved: false,
          invalidationObserved: false,
          executorThrew: false,
          counters: emptyCounters(),
          permission: "none",
          dispatchGuardActive: false,
          fcWindowSequenceAtConsume: 0,
          reason: "NO_DECISION_OR_RELEASE",
          receipt: {
            consumed: false,
            authorizedEventObserved: false,
            invalidationObserved: false,
            executorThrew: false,
            executorFailurePhase: null,
            consumedAtGeneration: null,
            attemptId: null,
          },
        };
      }
      const r = release.releaseOnce(decision);
      return {
        outcome: r.outcome,
        consumed: r.receipt.consumed,
        authorizedEventObserved: r.receipt.authorizedEventObserved,
        invalidationObserved: r.receipt.invalidationObserved,
        executorThrew: r.receipt.executorThrew,
        counters: release.getCounters(),
        permission: release.getPermission(),
        dispatchGuardActive: release.isDispatchGuardActive(),
        fcWindowSequenceAtConsume: release.getFcWindowSequenceAtConsume(),
        reason: r.reason ?? null,
        receipt: release.getReceipt(),
      };
    },
    armCurrentDecision: () => {
      const decision = retainedDecision ?? controller?.getActiveDecisionForTest() ?? null;
      if (!decision || !release) return { status: "invalid", reason: "NO_DECISION_OR_RELEASE" };
      const r = release.armForTest(decision);
      if (r.status === "ok") return { status: "ok" };
      return { status: "invalid", reason: r.reason };
    },
    executeArmed: () => {
      if (!release) {
        return {
          outcome: "NOT_ARMED",
          consumed: false,
          authorizedEventObserved: false,
          counters: emptyCounters(),
          permission: "none",
          dispatchGuardActive: false,
        };
      }
      const r = release.executeArmedForTest();
      return {
        outcome: r.outcome,
        consumed: r.receipt.consumed,
        authorizedEventObserved: r.receipt.authorizedEventObserved,
        counters: release.getCounters(),
        permission: release.getPermission(),
        dispatchGuardActive: release.isDispatchGuardActive(),
      };
    },
    stopControllerKeepDecision: () => {
      const decision = controller?.getActiveDecisionForTest() ?? null;
      if (decision) retainedDecision = decision;
      const host = retainedDecision?.ownedHost ?? null;
      const modal = retainedDecision?.modal ?? null;
      controller?.stop();
      // Preserve exact retained host connectivity for 3B currentness (no selector recovery).
      if (host && modal && !host.isConnected && modal.isConnected) {
        modal.appendChild(host);
      }
    },
    getReleaseSnapshot: () => {
      if (!release) {
        return {
          phase: "NONE",
          permission: "none",
          outcome: null,
          receipt: {
            consumed: false,
            authorizedEventObserved: false,
            invalidationObserved: false,
            executorThrew: false,
            executorFailurePhase: null,
            consumedAtGeneration: null,
            attemptId: null,
          },
          counters: emptyCounters(),
          dispatchGuardActive: false,
          listenerInstalled: false,
          uninstallDeferred: false,
          fcWindowSequenceAtConsume: 0,
        };
      }
      return {
        phase: release.getPhase(),
        permission: release.getPermission(),
        outcome: release.getOutcome(),
        receipt: release.getReceipt(),
        counters: release.getCounters(),
        dispatchGuardActive: release.isDispatchGuardActive(),
        listenerInstalled: release.isListenerInstalled(),
        uninstallDeferred: release.wasUninstallDeferred(),
        fcWindowSequenceAtConsume: release.getFcWindowSequenceAtConsume(),
      };
    },
    uninstall: () => {
      release?.uninstall();
    },
    notePrimary: () => {
      release?.notePagePrimaryHandlerForTest();
    },
  };
}

export function bootstrapFc007Sprint3bSmoke(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  // EARLY Window capture — before page scripts (document_start).
  installReleaseEarly();
  emitBoot();
  const auth = authorizeFc007SettingsLocation(window.location);
  if (auth.status !== "authorized") {
    return false;
  }
  if (controller) {
    controller.stop();
    controller = null;
  }
  retainedDecision = null;
  controller = new Fc007PassiveController({
    onDiagnostic: emitDiag,
  });
  controller.start();
  bindHarness();
  return true;
}

if (typeof window !== "undefined") {
  bootstrapFc007Sprint3bSmoke();
}
