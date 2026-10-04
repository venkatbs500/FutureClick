/**
 * FC-007 observation privacy + canonical adapter + consequence evaluation.
 */

import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import { describe, expect, it } from "vitest";
import { recognizeFc007ContractV1 } from "../src/fc007/contract.js";
import {
  createGitHubVisibilityObservation,
  validateFc007GitHubVisibilityObservation,
} from "../src/fc007/github-observation.js";
import { adaptGithubVisibilityObservationToCanonicalContext } from "../src/fc007/github-repository-visibility-adapter.js";
import { FIXTURE_IDENTITY, createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 observation privacy", () => {
  it("semantic observation excludes DOM, HTML, hidden values, query, tokens", () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    const r = recognizeFc007ContractV1(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("matched");
    if (r.status !== "matched") return;
    const obs = r.value.observation;
    const json = JSON.stringify(obs);
    expect(json).not.toContain("dummy-not-read");
    expect(json).not.toContain("<");
    expect(json).not.toContain("?");
    expect(json).not.toContain("#");
    expect(Object.keys(obs).sort()).toEqual(
      [
        "adapter",
        "buttonSemantics",
        "contractId",
        "contractVersion",
        "currentVisibility",
        "evidenceBasis",
        "formModalSemantics",
        "observedAt",
        "ownerDisplay",
        "ownerNormalized",
        "readiness",
        "repoDisplay",
        "repoNormalized",
        "requestedVisibility",
        "routeIdentity",
        "supportedLocale",
      ].sort(),
    );
    for (const v of Object.values(obs)) {
      expect(v instanceof Node).toBe(false);
    }
  });

  it("rejects unexpected keys and DOM-ish invalid shapes", () => {
    const base = createGitHubVisibilityObservation({
      observedAt: "2026-09-09T00:00:00.000Z",
      ownerDisplay: FIXTURE_IDENTITY.ownerDisplay,
      ownerNormalized: FIXTURE_IDENTITY.ownerNormalized,
      repoDisplay: FIXTURE_IDENTITY.repoDisplay,
      repoNormalized: FIXTURE_IDENTITY.repoNormalized,
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
      origin: "https://github.com",
      supportedLocale: "en",
    });
    expect(validateFc007GitHubVisibilityObservation({ ...base, html: "<b>" }).status).toBe(
      "invalid",
    );
  });
});

describe("FC-007 canonical adapter + consequence", () => {
  it("maps to frozen canonical context and yields VERIFIED private→public", async () => {
    const obs = createGitHubVisibilityObservation({
      observedAt: "2026-09-09T12:00:00.000Z",
      ownerDisplay: "fixture-owner",
      ownerNormalized: "fixture-owner",
      repoDisplay: "fixture-repo",
      repoNormalized: "fixture-repo",
      pathnameExact: "/fixture-owner/fixture-repo/settings",
      pathnameCanonical: "/fixture-owner/fixture-repo/settings",
      origin: "https://github.com",
      supportedLocale: "en",
    });
    const adapted = adaptGithubVisibilityObservationToCanonicalContext(obs);
    expect(adapted.status).toBe("ok");
    if (adapted.status !== "ok") return;

    const ctx = adapted.context;
    expect(ctx.state.entities).toHaveLength(1);
    expect(ctx.state.entities[0]?.kind).toBe("repository");
    expect(ctx.state.entities[0]?.label).toBe("fixture-owner/fixture-repo");
    expect(ctx.state.facts[0]?.key).toBe("repository.visibility");
    expect(ctx.state.facts[0]?.value).toBe("private");
    expect(ctx.action.actor).toEqual({ kind: "human" });
    expect(ctx.action.intent).toEqual({ verb: "change-access", domain: "version_control" });
    expect(ctx.action.parameters.newVisibility).toBe("public");
    expect(ctx.action.targets).toHaveLength(1);
    expect(ctx.state.environment.kind).toBe("browser");
    expect(ctx.state.environment.platform).toBe("web");
    expect(ctx.state.environment.application).toEqual({
      id: "app-github",
      name: "GitHub",
    });
    expect(Object.hasOwn(ctx.state.environment.application, "version")).toBe(false);
    expect(ctx.action.provenance?.details?.synthetic).toBe(false);
    expect(ctx.action.provenance?.details?.evidenceBasis).toBe("github-settings-ui-contract-v1");

    const engine = new ConsequenceEngine();
    engine.registerEvaluator(createDeterministicRuleEvaluator());
    const assessment = await engine.evaluate(ctx);
    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;
    expect(assessment.value.consequences).toHaveLength(1);
    const c = assessment.value.consequences[0];
    expect(c?.evidence[0]?.mode).toBe("verified");
  });
});
