/**
 * FC-007 Sprint 1A — M6 observation validator trust-boundary tests.
 */

import { describe, expect, it } from "vitest";
import {
  createGitHubVisibilityObservation,
  validateFc007GitHubVisibilityObservation,
} from "../src/fc007/github-observation.js";
import { adaptGithubVisibilityObservationToCanonicalContext } from "../src/fc007/github-repository-visibility-adapter.js";

function validBase() {
  return createGitHubVisibilityObservation({
    observedAt: "2026-09-10T00:00:00.000Z",
    ownerDisplay: "fixture-owner",
    ownerNormalized: "fixture-owner",
    repoDisplay: "fixture-repo",
    repoNormalized: "fixture-repo",
    pathnameExact: "/fixture-owner/fixture-repo/settings",
    pathnameCanonical: "/fixture-owner/fixture-repo/settings",
    origin: "https://github.com",
    supportedLocale: "en",
  });
}

describe("FC-007 M6 observation validator", () => {
  it("accepts reconstructed valid observation", () => {
    const v = validateFc007GitHubVisibilityObservation(validBase());
    expect(v.status).toBe("ok");
  });

  it("rejects extra top-level field", () => {
    expect(validateFc007GitHubVisibilityObservation({ ...validBase(), evil: true }).status).toBe(
      "invalid",
    );
  });

  it("rejects extra nested adapter field", () => {
    const base = validBase();
    const bad = {
      ...base,
      adapter: { id: base.adapter.id, version: base.adapter.version, extra: 1 },
    };
    expect(validateFc007GitHubVisibilityObservation(bad).status).toBe("invalid");
    expect(adaptGithubVisibilityObservationToCanonicalContext(bad).status).toBe("invalid");
  });

  it("rejects accessor property", () => {
    const base = validBase();
    const obj: Record<string, unknown> = { ...base };
    Object.defineProperty(obj, "ownerDisplay", {
      enumerable: true,
      get: () => "fixture-owner",
    });
    expect(validateFc007GitHubVisibilityObservation(obj).status).toBe("invalid");
  });

  it("rejects class/prototype object", () => {
    class Obs {}
    const o = new Obs() as unknown as Record<string, unknown>;
    Object.assign(o, validBase());
    expect(validateFc007GitHubVisibilityObservation(o).status).toBe("invalid");
  });

  it("rejects symbol field", () => {
    const base = validBase() as unknown as Record<string | symbol, unknown>;
    const obj = { ...base, [Symbol("x")]: 1 };
    // Spread may drop symbol — define on plain object with all keys:
    const plain: Record<string | symbol, unknown> = {};
    for (const k of Object.keys(base)) plain[k] = (base as Record<string, unknown>)[k];
    plain[Symbol("x")] = 1;
    expect(validateFc007GitHubVisibilityObservation(plain).status).toBe("invalid");
  });

  it("rejects owner/repo normalized mismatch", () => {
    const base = validBase();
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        ownerNormalized: "OTHER",
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        repoNormalized: "OTHER",
      }).status,
    ).toBe("invalid");
  });

  it("rejects evil origin / wrong pathname / subroute / wrong repo", () => {
    const base = validBase();
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        routeIdentity: {
          ...base.routeIdentity,
          origin: "https://evil.example",
        },
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        routeIdentity: {
          ...base.routeIdentity,
          pathnameExact: "/fixture-owner/fixture-repo/settings/actions",
          pathnameCanonical: "/fixture-owner/fixture-repo/settings",
        },
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        routeIdentity: {
          origin: "https://github.com",
          pathnameExact: "/fixture-owner/other/settings",
          pathnameCanonical: "/fixture-owner/fixture-repo/settings",
        },
      }).status,
    ).toBe("invalid");
  });

  it("rejects locale fr and en-GB", () => {
    const base = validBase();
    expect(
      validateFc007GitHubVisibilityObservation({ ...base, supportedLocale: "fr" }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({ ...base, supportedLocale: "en-GB" }).status,
    ).toBe("invalid");
  });

  it("rejects wrong contract/adapter/evidence/visibility/observedAt", () => {
    const base = validBase();
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        contractId: "nope",
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        adapter: { id: "bad", version: "1.0" },
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        evidenceBasis: "nope",
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        currentVisibility: "public",
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        requestedVisibility: "private",
      }).status,
    ).toBe("invalid");
    expect(
      validateFc007GitHubVisibilityObservation({
        ...base,
        observedAt: "not-a-timestamp",
      }).status,
    ).toBe("invalid");
  });

  it("Codex malicious object probe fails validator AND adapter", () => {
    const malicious = {
      ...validBase(),
      html: "<script>",
      token: "steal",
      routeIdentity: {
        origin: "https://evil.example",
        pathnameExact: "/fixture-owner/fixture-repo/settings",
        pathnameCanonical: "/fixture-owner/fixture-repo/settings",
        query: "?x=1",
      },
    };
    expect(validateFc007GitHubVisibilityObservation(malicious).status).toBe("invalid");
    expect(adaptGithubVisibilityObservationToCanonicalContext(malicious).status).toBe("invalid");
  });

  it("revoked Proxy reflective validation returns invalid not throw", () => {
    const base = validBase();
    const { proxy, revoke } = Proxy.revocable(base as object, {
      get(_t, p) {
        return Reflect.get(base as object, p);
      },
      ownKeys() {
        return Reflect.ownKeys(base as object);
      },
      getOwnPropertyDescriptor(_t, p) {
        return Reflect.getOwnPropertyDescriptor(base as object, p);
      },
    });
    revoke();
    expect(() => validateFc007GitHubVisibilityObservation(proxy)).not.toThrow();
    expect(validateFc007GitHubVisibilityObservation(proxy).status).toBe("invalid");
  });
});
