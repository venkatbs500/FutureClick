/**
 * FC-006 Sprint 3B — direct closed fingerprint probes (production builders).
 */

import {
  BrowserAdapterEngine,
  type BrowserObservation,
  type BrowserObservationId,
  createBrowserObservation,
} from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import type { IsoTimestamp } from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import {
  buildFc006ReleaseAssessmentFingerprint,
  buildFc006ReleaseContextFingerprint,
} from "../src/fc006/release-fingerprints.js";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
  syntheticRepositoryInterceptionAdapter,
} from "../src/fc006/synthetic-repository-interception-adapter.js";

function createObservation(): BrowserObservation {
  return createBrowserObservation({
    id: "obs-fc006-fp-01" as BrowserObservationId,
    capturedAt: "2026-09-09T12:00:00.000Z" as IsoTimestamp,
    page: { origin: FC006_ORIGIN, routeId: FC006_ROUTE_ID },
    element: { kind: "button", role: "button", buttonType: "button" },
    metadata: {
      fixtureContract: FC006_FIXTURE_CONTRACT,
      operation: FC006_OPERATION,
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

describe("FC-006 Sprint 3B: strict release fingerprints", () => {
  async function buildCanonical() {
    const observation = createObservation();
    const engine = new BrowserAdapterEngine({
      registry: [syntheticRepositoryInterceptionAdapter],
    });
    const adapt = engine.adapt(observation);
    expect(adapt.status).toBe("matched");
    if (adapt.status !== "matched") throw new Error("adapt failed");
    const ce = new ConsequenceEngine();
    ce.registerEvaluator(createDeterministicRuleEvaluator());
    const assessment = await ce.evaluate(adapt.context);
    expect(assessment.ok).toBe(true);
    if (!assessment.ok) throw new Error("evaluate failed");
    return { observation, context: adapt.context, assessment: assessment.value };
  }

  it("exact frozen private→public output builds fingerprints", async () => {
    const { observation, context, assessment } = await buildCanonical();
    const cfp = buildFc006ReleaseContextFingerprint(context, observation);
    const afp = buildFc006ReleaseAssessmentFingerprint(assessment, context);
    expect(cfp).not.toBeNull();
    expect(afp).not.toBeNull();
    expect(afp?.beforeValueType).toBe("string");
    expect(afp?.afterValueType).toBe("string");
    expect(afp?.assessmentEngineVersion).toBe("0.2.0");
    expect(afp?.evidenceDetailsAbsent).toBe(true);
    expect(afp?.reversibilityTimeWindowAbsent).toBe(true);
  });

  it("rejects before.value array coercion", async () => {
    const { context, assessment } = await buildCanonical();
    const c = assessment.consequences[0];
    const sc = c?.stateChanges?.[0];
    if (!c || !sc) throw new Error("missing");
    const mutated = {
      ...assessment,
      consequences: [
        {
          ...c,
          stateChanges: [{ ...sc, before: { status: "known" as const, value: ["private"] } }],
        },
      ],
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("rejects after.value array coercion", async () => {
    const { context, assessment } = await buildCanonical();
    const c = assessment.consequences[0];
    const sc = c?.stateChanges?.[0];
    if (!c || !sc) throw new Error("missing");
    const mutated = {
      ...assessment,
      consequences: [
        {
          ...c,
          stateChanges: [{ ...sc, after: { status: "known" as const, value: ["public"] } }],
        },
      ],
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("rejects state provenance source=model", async () => {
    const { observation, context } = await buildCanonical();
    if (!context.state.provenance) throw new Error("missing provenance");
    const mutated = {
      ...context,
      state: {
        ...context.state,
        provenance: { ...context.state.provenance, source: "model" as const },
      },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects state provenance synthetic=false", async () => {
    const { observation, context } = await buildCanonical();
    if (!context.state.provenance?.details) throw new Error("missing details");
    const mutated = {
      ...context,
      state: {
        ...context.state,
        provenance: {
          ...context.state.provenance,
          details: { ...context.state.provenance.details, synthetic: false },
        },
      },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects assessment engineVersion mutation", async () => {
    const { context, assessment } = await buildCanonical();
    const mutated = {
      ...assessment,
      provenance: { ...assessment.provenance, engineVersion: "9.9.9" },
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("rejects unexpected evidence.details", async () => {
    const { context, assessment } = await buildCanonical();
    const c = assessment.consequences[0];
    const e = c?.evidence[0];
    if (!c || !e) throw new Error("missing");
    const mutated = {
      ...assessment,
      consequences: [{ ...c, evidence: [{ ...e, details: { hostile: true } }] }],
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("rejects unexpected reversibility.timeWindow", async () => {
    const { context, assessment } = await buildCanonical();
    const c = assessment.consequences[0];
    if (!c?.reversibility) throw new Error("missing");
    const mutated = {
      ...assessment,
      consequences: [
        {
          ...c,
          reversibility: { ...c.reversibility, timeWindow: "immediate" },
        },
      ],
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("rejects unexpected consequence provenance field", async () => {
    const { context, assessment } = await buildCanonical();
    const c = assessment.consequences[0];
    if (!c?.provenance) throw new Error("missing");
    const mutated = {
      ...assessment,
      consequences: [
        {
          ...c,
          provenance: { ...c.provenance, engineVersion: "0.2.0" },
        },
      ],
    };
    expect(buildFc006ReleaseAssessmentFingerprint(mutated, context)).toBeNull();
  });

  it("binds actor human and rejects agent kind", async () => {
    const { observation, context } = await buildCanonical();
    const okFp = buildFc006ReleaseContextFingerprint(context, observation);
    expect(okFp?.actorKind).toBe("human");
    expect(okFp?.actorIdAbsent).toBe(true);
    const mutated = {
      ...context,
      action: { ...context.action, actor: { kind: "agent" as const } },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects actor id insertion", async () => {
    const { observation, context } = await buildCanonical();
    const mutated = {
      ...context,
      action: {
        ...context.action,
        actor: { kind: "human" as const, id: "different-principal" },
      },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects environment kind service on both sides", async () => {
    const { observation, context } = await buildCanonical();
    const env = { ...context.state.environment, kind: "service" as const };
    const mutated = {
      ...context,
      state: { ...context.state, environment: env },
      action: { ...context.action, environment: env },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects application version change on both sides", async () => {
    const { observation, context } = await buildCanonical();
    const application = { ...context.state.environment.application, version: "9.9" };
    const env = { ...context.state.environment, application };
    const mutated = {
      ...context,
      state: { ...context.state, environment: env },
      action: { ...context.action, environment: env },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects state/action environment semantic mismatch", async () => {
    const { observation, context } = await buildCanonical();
    const mutated = {
      ...context,
      action: {
        ...context.action,
        environment: { ...context.action.environment, kind: "service" as const },
      },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });

  it("rejects sessionId insertion", async () => {
    const { observation, context } = await buildCanonical();
    const env = { ...context.state.environment, sessionId: "other-session" };
    const mutated = {
      ...context,
      state: { ...context.state, environment: env },
      action: { ...context.action, environment: env },
    };
    expect(buildFc006ReleaseContextFingerprint(mutated, observation)).toBeNull();
  });
});
