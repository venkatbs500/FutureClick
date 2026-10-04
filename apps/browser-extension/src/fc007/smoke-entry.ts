/**
 * FC-007 smoke-only entry (Sprint 3C production path + trusted diagnostics).
 *
 * Same production recognition + Continue → release path with a TRUSTED internal
 * diagnostic callback. NOT listed in the production manifest.
 *
 * Emits console lines prefixed with __FC007_DIAG__ / __FC007_BOOT__ for CDP.
 * Exposes a smoke-only controller handle on the isolated-world globalThis
 * (never page-world visible) for trusted CURRENT-state freshness probes.
 */

import "./native-click-executor.js";
import { authorizeFc007SettingsLocation } from "./location.js";
import { Fc007PassiveController, type Fc007TrustedDiagnostic } from "./passive-controller.js";
import { Fc007IsolatedReleaseComponent } from "./release-attempt.js";

let controller: Fc007PassiveController | null = null;
let smokeRelease: Fc007IsolatedReleaseComponent | null = null;

declare global {
  // Isolated-world only — page scripts cannot read this binding.
  var __FC007_SMOKE_CTRL__: Fc007PassiveController | undefined;
  var __FC007_SMOKE_DIAG__: {
    continueVisible?: boolean;
    trustedContinueAttempts?: number;
    acceptedContinueAttempts?: number;
    continueValidationPass?: number;
    continueValidationFail?: number;
    armCount?: number;
    executorCount?: number;
    authorizedReleaseCount?: number;
    releaseCalls?: number;
    consumptions?: number;
    retries?: number;
    fallbacks?: number;
    terminalOutcome?: string | null;
  };
}

function ensureSmokeReleaseInstalled(): Fc007IsolatedReleaseComponent {
  if (!smokeRelease) {
    smokeRelease = new Fc007IsolatedReleaseComponent();
  }
  if (typeof window !== "undefined" && !smokeRelease.isListenerInstalled()) {
    smokeRelease.install(window);
  }
  return smokeRelease;
}

if (typeof window !== "undefined") {
  ensureSmokeReleaseInstalled();
}

function emitBoot(): void {
  try {
    console.log(
      `__FC007_BOOT__${JSON.stringify({
        readyState: typeof document !== "undefined" ? document.readyState : "unknown",
        releaseListener:
          smokeRelease?.isListenerInstalled() === true ||
          controller?.isReleaseListenerInstalledForTest() === true,
        sprint: "3c",
      })}`,
    );
  } catch {
    // ignore
  }
}

function emitDiag(d: Fc007TrustedDiagnostic): void {
  try {
    const diag: {
      continueVisible?: boolean;
      trustedContinueAttempts?: number;
      acceptedContinueAttempts?: number;
      continueValidationPass?: number;
      continueValidationFail?: number;
      armCount?: number;
      executorCount?: number;
      authorizedReleaseCount?: number;
      releaseCalls?: number;
      consumptions?: number;
      retries?: number;
      fallbacks?: number;
      terminalOutcome?: string | null;
    } = {
      armCount: d.armCount ?? 0,
      executorCount: d.executorCount ?? 0,
      authorizedReleaseCount: d.authorizedReleaseCount ?? 0,
      releaseCalls: d.releaseCalls ?? 0,
      consumptions: d.consumptions ?? 0,
      retries: d.retries ?? 0,
      fallbacks: d.fallbacks ?? 0,
      terminalOutcome: d.terminalOutcome ?? null,
    };
    if (d.continueVisible !== undefined) diag.continueVisible = d.continueVisible;
    if (d.trustedContinueAttempts !== undefined) {
      diag.trustedContinueAttempts = d.trustedContinueAttempts;
    }
    if (d.acceptedContinueAttempts !== undefined) {
      diag.acceptedContinueAttempts = d.acceptedContinueAttempts;
    }
    if (d.continueValidationPass !== undefined) {
      diag.continueValidationPass = d.continueValidationPass;
    }
    if (d.continueValidationFail !== undefined) {
      diag.continueValidationFail = d.continueValidationFail;
    }
    globalThis.__FC007_SMOKE_DIAG__ = diag;
    console.log(`__FC007_DIAG__${JSON.stringify(d)}`);
  } catch {
    // ignore
  }
}

function bindSmokeHandle(c: Fc007PassiveController | null): void {
  try {
    if (c) {
      globalThis.__FC007_SMOKE_CTRL__ = c;
    } else {
      globalThis.__FC007_SMOKE_CTRL__ = undefined;
    }
  } catch {
    // ignore
  }
}

export function bootstrapFc007ObservationSmoke(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  emitBoot();
  const auth = authorizeFc007SettingsLocation(window.location);
  if (auth.status !== "authorized") {
    return false;
  }
  if (controller) {
    controller.stop();
    controller = null;
  }
  const release = ensureSmokeReleaseInstalled();
  controller = new Fc007PassiveController({
    onDiagnostic: emitDiag,
    releaseComponent: release,
  });
  bindSmokeHandle(controller);
  controller.start();
  return true;
}

export function getFc007SmokeController(): Fc007PassiveController | null {
  return controller;
}

if (typeof window !== "undefined") {
  bootstrapFc007ObservationSmoke();
}
