import { describe, expect, it } from "vitest";
import { validateActionEvaluationContext } from "@futureclick/action-schema";
import { createDeterministicIdGenerator } from "@futureclick/shared";
import {
  type BrowserContextDraft,
  type BrowserObservation,
  constructCanonicalContext,
  createBrowserObservation,
  syntheticRepositoryVisibilityAdapter,
} from "../src/index.js";

function getSampleObservation(): BrowserObservation {
  return createBrowserObservation({
    id: "obs-sample-001" as import("../src/types.js").BrowserObservationId,
    capturedAt: "2026-09-08T14:30:00.000Z" as import("@futureclick/shared").IsoTimestamp,
    page: {
      origin: "http://127.0.0.1:4173",
      routeId: "synthetic.repository-visibility",
    },
    metadata: {
      fixtureContract: "fc005.repository-visibility.v1",
      operation: "repository.visibility.change",
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

function getSampleDraft(): BrowserContextDraft {
  return {
    kind: "synthetic.repository-visibility",
    entityKey: "fixture-repository",
    entityKind: "repository",
    currentVisibility: "private",
    requestedVisibility: "public",
    intent: {
      verb: "change-access",
      domain: "version_control",
    },
    targetRole: "primary",
  };
}

describe("Canonical Context Construction", () => {
  it("Probe 1: Valid draft and observation construct valid, frozen ActionEvaluationContext", () => {
    const obs = getSampleObservation();
    const draft = getSampleDraft();

    const res = constructCanonicalContext(draft, obs, syntheticRepositoryVisibilityAdapter);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ctx = res.value;

    // Verify FC-002 validation passes authoritatively
    const validation = validateActionEvaluationContext(ctx);
    expect(validation.valid).toBe(true);

    // Verify Repository entity (Finding H2: Predefined trusted canonical label)
    expect(ctx.state.entities.length).toBe(1);
    const entity = ctx.state.entities[0];
    expect(entity).toBeDefined();
    if (!entity) return;
    expect(entity.kind).toBe("repository");
    expect(entity.label).toBe("Synthetic Repository");

    // Verify State Fact
    expect(ctx.state.facts.length).toBe(1);
    const fact = ctx.state.facts[0];
    expect(fact).toBeDefined();
    if (!fact) return;
    expect(fact.key).toBe("repository.visibility");
    expect(fact.value).toBe("private");
    expect(fact.subjectEntityId).toBe(entity.id);
    expect(fact.observedAt).toBe(obs.capturedAt);

    // Verify Proposed Action
    expect(ctx.action.intent.verb).toBe("change-access");
    expect(ctx.action.intent.domain).toBe("version_control");
    expect(ctx.action.targets.length).toBe(1);
    expect(ctx.action.targets[0]?.entityId).toBe(entity.id);
    expect(ctx.action.targets[0]?.role).toBe("primary");
    expect(ctx.action.parameters.newVisibility).toBe("public");
    expect(ctx.action.executionStatus).toBe("proposed");
    expect(ctx.action.proposedAt).toBe(obs.capturedAt);

    // Verify Environment compatibility
    expect(ctx.state.environment.kind).toBe("browser");
    expect(ctx.state.environment.platform).toBe("web");
    expect(ctx.action.environment.environmentId).toBe(ctx.state.environment.environmentId);
    expect(ctx.action.environment.application.id).toBe(ctx.state.environment.application.id);

    // Verify Provenance
    expect(ctx.state.provenance?.source).toBe("adapter");
    expect(ctx.state.provenance?.timestamp).toBe(obs.capturedAt);
    expect(ctx.state.provenance?.details?.synthetic).toBe(true);
    expect(ctx.state.provenance?.details?.adapterId).toBe(syntheticRepositoryVisibilityAdapter.id);
    expect(ctx.action.provenance?.source).toBe("adapter");

    // Verify Freezing
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.state)).toBe(true);
    expect(Object.isFrozen(ctx.action)).toBe(true);
  });

  it("Probe 2: Determinism: Same observation + equivalent deterministic IdGenerator produces deeply equal contexts", () => {
    const obs = getSampleObservation();
    const draft = getSampleDraft();

    const idGen1 = createDeterministicIdGenerator("test-seed");
    const idGen2 = createDeterministicIdGenerator("test-seed");

    const res1 = constructCanonicalContext(draft, obs, syntheticRepositoryVisibilityAdapter, {
      idGenerator: idGen1,
    });
    const res2 = constructCanonicalContext(draft, obs, syntheticRepositoryVisibilityAdapter, {
      idGenerator: idGen2,
    });

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (!res1.ok || !res2.ok) return;

    expect(JSON.stringify(res1.value)).toBe(JSON.stringify(res2.value));
  });

  it("Probe 3: Normalized ID collision detection fails closed", () => {
    const obs = getSampleObservation();
    const draft = getSampleDraft();

    // Mock IdGenerator that returns whitespace variants of the same ID
    let call = 0;
    const collidingIdGen = {
      // biome-ignore lint/suspicious/noExplicitAny: testing colliding generator
      generate: (): any => {
        call++;
        return call === 1 ? "collision-id" : " collision-id ";
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing colliding generator
      nextId: (): any => "collision-id",
    };

    const res = constructCanonicalContext(draft, obs, syntheticRepositoryVisibilityAdapter, {
      idGenerator: collidingIdGen,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("Normalized ID collision detected");
    }
  });
});
