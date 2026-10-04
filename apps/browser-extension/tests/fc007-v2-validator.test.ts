/**
 * FC-007 V2 observation validator tests.
 */

import { describe, expect, it } from "vitest";
import {
  createGitHubVisibilityObservationV2,
  observationSemanticFingerprintV2,
  validateFc007GitHubVisibilityObservationV2,
} from "../src/fc007/v2/github-observation-v2.js";

function validStageAInput(): Record<string, unknown> {
  return {
    contractId: "github.repository-visibility.private-to-public.v2",
    contractVersion: "2.0",
    observedAt: "2026-01-01T00:00:00.000Z",
    ownerDisplay: "fixture-owner",
    ownerNormalized: "fixture-owner",
    repoDisplay: "fixture-repo",
    repoNormalized: "fixture-repo",
    currentVisibility: "private",
    requestedVisibility: "public",
    routeIdentity: {
      origin: "https://github.com",
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
    },
    supportedLocale: "en",
    stage: "settings-private",
    stageSemantics: { kind: "settings-private" },
    buttonSemantics: "none",
    formModalSemantics: "none",
    readiness: "n/a",
    evidenceBasis: "github-settings-ui-contract-v2",
    adapter: {
      id: "browser.github.repository-visibility-observation",
      version: "2.0",
    },
  };
}

describe("FC-007 V2 observation validator", () => {
  it("validates and freezes a Stage D observation", () => {
    const obs = createGitHubVisibilityObservationV2({
      observedAt: "2026-01-01T00:00:00.000Z",
      ownerDisplay: "fixture-owner",
      ownerNormalized: "fixture-owner",
      repoDisplay: "fixture-repo",
      repoNormalized: "fixture-repo",
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
      origin: "https://github.com",
      supportedLocale: "en",
      stage: "final-confirmation",
    });
    expect(Object.isFrozen(obs)).toBe(true);
    const validated = validateFc007GitHubVisibilityObservationV2(obs);
    expect(validated.status).toBe("ok");
  });

  it("rejects unexpected top-level keys", () => {
    const input = { ...validStageAInput(), extraKey: "surprise" };
    const result = validateFc007GitHubVisibilityObservationV2(input);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/KEY_COUNT|UNEXPECTED_KEY/);
    }
  });

  it("rejects invalid stage literal", () => {
    const input = { ...validStageAInput(), stage: "not-a-stage" };
    const result = validateFc007GitHubVisibilityObservationV2(input);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toBe("STAGE");
    }
  });

  it("rejects accessor properties on input", () => {
    const malicious: Record<string, unknown> = {};
    Object.defineProperty(malicious, "contractId", {
      enumerable: true,
      get() {
        throw new Error("getter trap");
      },
    });
    const result = validateFc007GitHubVisibilityObservationV2(malicious);
    expect(result.status).toBe("invalid");
  });

  it("rejects symbol keys", () => {
    const input = validStageAInput();
    (input as Record<symbol, unknown>)[Symbol("trap")] = "x";
    const result = validateFc007GitHubVisibilityObservationV2(input);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toBe("SYMBOL_KEY");
    }
  });

  it("rejects class instances", () => {
    class ObsClass {
      contractId = "github.repository-visibility.private-to-public.v2";
    }
    const result = validateFc007GitHubVisibilityObservationV2(new ObsClass());
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toBe("UNEXPECTED_PROTOTYPE");
    }
  });

  it("rejects revoked Proxy input safely", () => {
    const { proxy, revoke } = Proxy.revocable(validStageAInput(), {});
    revoke();
    const result = validateFc007GitHubVisibilityObservationV2(proxy);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toBe("VALIDATION_EXCEPTION");
    }
  });

  it("fingerprint excludes observedAt", () => {
    const a = createGitHubVisibilityObservationV2({
      observedAt: "2026-01-01T00:00:00.000Z",
      ownerDisplay: "fixture-owner",
      ownerNormalized: "fixture-owner",
      repoDisplay: "fixture-repo",
      repoNormalized: "fixture-repo",
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
      origin: "https://github.com",
      supportedLocale: "en",
      stage: "intent-confirmation",
    });
    const b = createGitHubVisibilityObservationV2({
      observedAt: "2026-02-02T00:00:00.000Z",
      ownerDisplay: "fixture-owner",
      ownerNormalized: "fixture-owner",
      repoDisplay: "fixture-repo",
      repoNormalized: "fixture-repo",
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
      origin: "https://github.com",
      supportedLocale: "en",
      stage: "intent-confirmation",
    });
    expect(observationSemanticFingerprintV2(a)).toBe(observationSemanticFingerprintV2(b));
  });
});
