/**
 * FC-007 Sprint 3A security binding — Continue decision boundary.
 * Every path: arm=0, executor=0, authorizedRelease=0.
 */

import { describe, expect, it, vi } from "vitest";
import { validateContinueSameDecision } from "../src/fc007/continue-validator.js";
import {
  EFFECTS_REGION_MAX_DIRECT_CHILDREN,
  EFFECTS_REGION_MAX_PENDING,
  EFFECTS_REGION_MAX_VISITED,
  fingerprintEffectsSemantics,
  projectEffectsSemantics,
} from "../src/fc007/effects-semantics.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { createClickEventWithTrustForTest } from "../src/fc007/release-attempt.js";
import {
  createVerifiedDecision,
  fingerprintAssessment,
  fingerprintCanonicalContext,
  isDecisionAuthorityFrozen,
  snapshotAssessment,
  snapshotCanonicalContext,
} from "../src/fc007/verified-decision.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function trustAll(event: Event): boolean {
  return event.type === "click" || event.type === "keydown";
}

/** Happy-dom cannot emit isTrusted===false via native .click — unit-test seam only. */
function authorizedDispatchExecutor(btn: HTMLButtonElement): void {
  btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
}

function createCancelableClick(target: EventTarget): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "target", { configurable: true, value: target });
  return event;
}

async function reachVerified(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly location: ReturnType<typeof createFc007V2SettingsWindow>["location"];
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly modal: HTMLDialogElement;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    trustClickForTest: trustAll,
  });
  controller.start();
  await controller.attemptFullRecognition();
  const finalButton = controller.getRetainedFinalButton();
  expect(finalButton).toBeInstanceOf(HTMLButtonElement);
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
  const form = doc.getElementById("visibility-form");
  const modal = doc.getElementById("visibility-dialog");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form");
  if (!(modal instanceof HTMLDialogElement)) throw new Error("no modal");

  controller.handleCaptureClickForTest(createCancelableClick(finalButton));
  await vi.waitFor(() => {
    expect(controller.getPreviewMode()).toBe("verified");
  });
  expect(controller.isContinueVisibleForTest()).toBe(true);
  expect(controller.isPreviewCancelFocusedForTest()).toBe(true);
  controller.getReleaseComponentForTest().setTestExecutorForTest(authorizedDispatchExecutor);
  return { controller, document: doc, location, finalButton, form, modal };
}

function assertZeroRelease(controller: Fc007PassiveController): void {
  const d = controller.getSprint3aDiagnosticsForTest();
  expect(d.armCount).toBe(0);
  expect(d.executorCount).toBe(0);
  expect(d.authorizedReleaseCount).toBe(0);
}

function effectsRegionOf(modal: HTMLDialogElement): HTMLDivElement {
  const el = modal.querySelector(
    'div[role="region"][aria-label="Effects of making this repository public"]',
  );
  if (!(el instanceof HTMLDivElement)) throw new Error("no effects region");
  return el;
}

describe("FC-007 Sprint 3A Continue UI + trust", () => {
  it("shows Continue only when VERIFIED and keeps Cancel default focus", async () => {
    const { controller } = await reachVerified();
    expect(controller.getContinueButtonForTest()).toBeInstanceOf(HTMLButtonElement);
    expect(controller.isPreviewCancelFocusedForTest()).toBe(true);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("rejects untrusted Continue click and dispatchEvent", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const c2 = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: (event) => {
        return (event as { __fc007Trust?: boolean }).__fc007Trust === true;
      },
    });
    c2.start();
    await c2.attemptFullRecognition();
    const final = c2.getRetainedFinalButton();
    expect(final).toBeInstanceOf(HTMLButtonElement);
    if (!(final instanceof HTMLButtonElement)) throw new Error("no final");
    const intercept = createCancelableClick(final);
    Object.defineProperty(intercept, "__fc007Trust", { value: true });
    c2.handleCaptureClickForTest(intercept);
    await vi.waitFor(() => expect(c2.getPreviewMode()).toBe("verified"));

    const before = c2.getSprint3aDiagnosticsForTest();
    c2.invokeUntrustedContinueClickForTest();
    const cont = c2.getContinueButtonForTest();
    expect(cont).toBeInstanceOf(HTMLButtonElement);
    if (!(cont instanceof HTMLButtonElement)) throw new Error("no continue");
    cont.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    const after = c2.getSprint3aDiagnosticsForTest();
    expect(after.acceptedContinueAttempts).toBe(0);
    expect(after.continueValidationPass).toBe(0);
    expect(c2.getPreviewMode()).toBe("verified");
    expect(before.decisionEligibility).toBe("eligible");
    expect(after.decisionEligibility).toBe("eligible");
    assertZeroRelease(c2);
    c2.stop();
  });

  it("accepts one trusted Continue, validates, releases once, retires decision", async () => {
    const { controller, form } = await reachVerified();
    form.addEventListener("submit", (e) => e.preventDefault());
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("missing decision");
    expect(isDecisionAuthorityFrozen(decision)).toBe(true);
    const pre = controller.validateContinueSameDecisionForTest();
    expect(pre, JSON.stringify(pre)).toEqual({
      status: "VALID_SAME_DECISION",
      reason: "SAME_REVIEWED_DECISION",
    });
    controller.invokeTrustedContinueForTest();
    await vi.waitFor(() => {
      expect(controller.getSprint3aDiagnosticsForTest().acceptedContinueAttempts).toBe(1);
    });
    const d = controller.getSprint3aDiagnosticsForTest();
    expect(d.continueValidationPass).toBe(1);
    expect(d.continueValidationFail).toBe(0);
    expect(d.decisionEligibility).toBeNull();
    expect(d.continueVisible).toBe(false);
    expect(d.releaseCalls).toBe(1);
    expect(d.armCount).toBe(1);
    expect(d.executorCount).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(d.retries).toBe(0);
    expect(d.fallbacks).toBe(0);
    expect(d.terminalOutcome).toBe("CONSUMED");
    controller.invokeTrustedContinueForTest();
    expect(controller.getSprint3aDiagnosticsForTest().acceptedContinueAttempts).toBe(1);
    expect(controller.getSprint3aDiagnosticsForTest().releaseCalls).toBe(1);
    controller.stop();
  });

  it("double trusted Continue accepts at most once", async () => {
    const { controller, form } = await reachVerified();
    form.addEventListener("submit", (e) => e.preventDefault());
    controller.invokeTrustedContinueForTest();
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3aDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.releaseCalls).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    controller.stop();
  });

  it("Cancel retires decision and keeps release counts at zero", async () => {
    const { controller } = await reachVerified();
    expect(controller.getDecisionLifecycleStatusForTest()).toBe("eligible");
    controller.cancelPreviewForTest();
    expect(controller.getActiveDecisionForTest()).toBeNull();
    expect(controller.isContinueVisibleForTest()).toBe(false);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("old Continue control cannot drive a newer decision", async () => {
    const first = await reachVerified();
    const continueA = first.controller.getContinueButtonForTest();
    expect(continueA).toBeTruthy();
    first.controller.cancelPreviewForTest();

    const final = first.controller.getRetainedFinalButton();
    expect(final).toBeInstanceOf(HTMLButtonElement);
    if (!(final instanceof HTMLButtonElement)) throw new Error("no final");
    first.controller.handleCaptureClickForTest(createCancelableClick(final));
    await vi.waitFor(() => expect(first.controller.getPreviewMode()).toBe("verified"));
    const continueB = first.controller.getContinueButtonForTest();
    expect(continueB).toBeTruthy();
    expect(continueB).not.toBe(continueA);
    const decisionB = first.controller.getActiveDecisionForTest();
    expect(decisionB?.continueControl).toBe(continueB);
    continueA?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(first.controller.getActiveDecisionForTest()?.decisionId).toBe(decisionB?.decisionId);
    expect(first.controller.getSprint3aDiagnosticsForTest().acceptedContinueAttempts).toBe(0);
    assertZeroRelease(first.controller);
    first.controller.stop();
  });

  it("pagehide clears actionable Continue authority", async () => {
    const { controller } = await reachVerified();
    window.dispatchEvent(new Event("pagehide"));
    expect(controller.getActiveDecisionForTest()).toBeNull();
    expect(controller.isContinueVisibleForTest()).toBe(false);
    assertZeroRelease(controller);
    controller.stop();
  });
});

describe("FC-007 Sprint 3A effects semantics (High)", () => {
  it("actual effects-region prose changes fingerprint", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    const before = projectEffectsSemantics(region);
    expect(before.status).toBe("ok");
    if (before.status !== "ok") throw new Error("effects project");
    const p = region.querySelector("p");
    expect(p).toBeTruthy();
    if (!(p instanceof HTMLElement)) throw new Error("no p");
    p.textContent = "MUTATED ACTUAL EFFECTS PROSE FOR CONTINUE BINDING";
    const after = projectEffectsSemantics(region);
    expect(after.status).toBe("ok");
    if (after.status !== "ok") throw new Error("effects after");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(fingerprintEffectsSemantics(after.snapshot)).toBe(after.fingerprint);
    env.controller.stop();
  });

  it("effects prose stale Continue fails without observer", async () => {
    const env = await reachVerified();
    env.controller.pauseFreshnessObserverForTest();
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const originalFp = decision.effectsFingerprint;
    const region = effectsRegionOf(env.modal);
    const p = region.querySelector("p");
    expect(p).toBeTruthy();
    if (!(p instanceof HTMLElement)) throw new Error("no p");
    p.textContent = "CHANGED REVIEWED EFFECTS MEANING";
    const fresh = projectEffectsSemantics(region);
    expect(fresh.status).toBe("ok");
    if (fresh.status !== "ok") throw new Error("fresh effects");
    expect(fresh.fingerprint).not.toBe(originalFp);

    const direct = env.controller.validateContinueSameDecisionForTest();
    expect(direct?.status).toBe("INVALID_STALE_DECISION");
    expect(direct && "reason" in direct ? direct.reason : "").toBe("EFFECTS_FINGERPRINT");

    env.controller.invokeTrustedContinueForTest();
    const d = env.controller.getSprint3aDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.continueValidationFail).toBeGreaterThanOrEqual(1);
    expect(d.continueValidationPass).toBe(0);
    assertZeroRelease(env.controller);
    env.controller.stop();
  });
});

describe("FC-007 Sprint 3A immutable authority", () => {
  it("outer authority is frozen; reassignment impossible", async () => {
    const { controller } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("missing");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(isDecisionAuthorityFrozen(decision)).toBe(true);

    expect(() => {
      (decision as { assessment: unknown }).assessment = { ...decision.assessment };
    }).toThrow();
    expect(() => {
      (decision as { canonicalContext: unknown }).canonicalContext = {
        ...decision.canonicalContext,
      };
    }).toThrow();
    expect(() => {
      (decision as { modal: unknown }).modal = document.createElement("dialog");
    }).toThrow();
    expect(() => {
      (decision as { form: unknown }).form = document.createElement("form");
    }).toThrow();
    expect(() => {
      (decision as { finalButton: unknown }).finalButton = document.createElement("button");
    }).toThrow();
    expect(() => {
      (decision as { repoNormalized: string }).repoNormalized = "other";
    }).toThrow();
    expect(() => {
      (decision as { assessmentFingerprint: string }).assessmentFingerprint = "other";
    }).toThrow();
    expect(() => {
      (decision as { effectsFingerprint: string }).effectsFingerprint = "other";
    }).toThrow();

    // Contradictory clone cannot replace authority.
    const clone = structuredClone({
      ...decision.assessment,
      actionId: "action-contradictory",
    });
    expect(() => {
      (decision as { assessment: unknown }).assessment = clone;
    }).toThrow();
    expect(decision.assessment.actionId).not.toBe("action-contradictory");
    assertZeroRelease(controller);
    controller.stop();
  });

  it("source nested mutation does not alter owned snapshots", async () => {
    const { controller } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("missing decision");
    const assessment = controller.getLastEvaluation();
    expect(assessment).toBeTruthy();
    if (!assessment) throw new Error("missing assessment");
    const state = controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");

    const ctxRes = snapshotCanonicalContext(state.context);
    const aRes = snapshotAssessment(assessment, decision.lineageEntityId);
    expect(ctxRes.status).toBe("ok");
    expect(aRes.status).toBe("ok");
    if (ctxRes.status !== "ok" || aRes.status !== "ok") throw new Error("snap");

    expect(fingerprintCanonicalContext(ctxRes.value)).toBe(decision.contextFingerprint);
    expect(fingerprintAssessment(aRes.value)).toBe(decision.assessmentFingerprint);

    (state.context.action.parameters as { newVisibility: string }).newVisibility = "private";
    const firstCsq = assessment.consequences[0] as { summary: string } | undefined;
    expect(firstCsq).toBeTruthy();
    if (!firstCsq) throw new Error("missing consequence");
    firstCsq.summary = "MUTATED";
    if (assessment.consequences[0]?.evidence[0]) {
      (assessment.consequences[0].evidence[0] as { scope: string }).scope = "MUTATED_SCOPE";
    }

    expect(decision.canonicalContext.requestedVisibility).toBe("public");
    expect(decision.assessment.consequences[0]?.summary).not.toBe("MUTATED");
    expect(decision.assessment.consequences[0]?.evidence[0]?.scope).not.toBe("MUTATED_SCOPE");
    expect(() => {
      (decision.assessment.consequences as unknown as unknown[]).push({});
    }).toThrow();
    assertZeroRelease(controller);
    controller.stop();
  });

  it("eval/decision generation binding is enforced", async () => {
    const { controller, document: doc, location } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const badGen = validateContinueSameDecision({
      decision,
      document: doc,
      location,
      ownedPreviewHost: controller.getPreviewHostForTest(),
      expectedControllerEpoch: decision.controllerEpoch,
      expectedInterceptEvalSeq: decision.interceptEvalSeq,
      expectedDecisionGeneration: decision.decisionGeneration + 1,
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(badGen.status).toBe("INVALID_STALE_DECISION");
    expect(badGen.reason).toBe("DECISION_GENERATION");
    const badEpoch = validateContinueSameDecision({
      decision,
      document: doc,
      location,
      ownedPreviewHost: controller.getPreviewHostForTest(),
      expectedControllerEpoch: decision.controllerEpoch + 1,
      expectedInterceptEvalSeq: decision.interceptEvalSeq,
      expectedDecisionGeneration: decision.decisionGeneration,
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(badEpoch.reason).toBe("CONTROLLER_EPOCH");
    assertZeroRelease(controller);
    controller.stop();
  });
});

describe("FC-007 Sprint 3A projection + lineage", () => {
  it("applicationName is part of context fingerprint", async () => {
    const { controller } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    expect(decision.canonicalContext.applicationName).toBe("GitHub");
    expect(decision.contextFingerprint).toContain("GitHub");
    const mutated = {
      ...decision.canonicalContext,
      applicationName: "NotGitHub",
    };
    expect(fingerprintCanonicalContext(mutated)).not.toBe(decision.contextFingerprint);
    controller.stop();
  });

  it("evidence scope/source/rule/assumption/post-state change fingerprint", async () => {
    const { controller } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const base = decision.assessment;
    const csq0 = base.consequences[0];
    expect(csq0).toBeTruthy();
    if (!csq0) throw new Error("no csq");

    const scopeMut = structuredClone(base) as typeof base;
    if (scopeMut.consequences[0]?.evidence[0]) {
      (scopeMut.consequences[0].evidence[0] as { scope: string }).scope = "DIFFERENT_SCOPE";
    }
    expect(fingerprintAssessment(scopeMut)).not.toBe(decision.assessmentFingerprint);

    const ruleMut = structuredClone(base) as typeof base;
    (ruleMut as { provenanceRuleId: string }).provenanceRuleId = "other.rule";
    expect(fingerprintAssessment(ruleMut)).not.toBe(decision.assessmentFingerprint);

    const asmMut = structuredClone(base) as typeof base;
    if (asmMut.consequences[0]?.evidence[0]?.assumptions[0]) {
      (asmMut.consequences[0].evidence[0].assumptions[0] as { statement: string }).statement =
        "DIFFERENT_ASSUMPTION";
    }
    expect(fingerprintAssessment(asmMut)).not.toBe(decision.assessmentFingerprint);

    const postMut = structuredClone(base) as typeof base;
    if (postMut.consequences[0]?.stateChanges[0]) {
      (
        postMut.consequences[0].stateChanges[0] as {
          after: { status: "known"; value: string | number | boolean | null };
        }
      ).after = { status: "known", value: "internal" };
    }
    expect(fingerprintAssessment(postMut)).not.toBe(decision.assessmentFingerprint);

    const riskMut = structuredClone(base) as typeof base;
    if (riskMut.consequences[0]) {
      (riskMut.consequences[0] as { riskDescription: string }).riskDescription = "other risk";
    }
    expect(fingerprintAssessment(riskMut)).not.toBe(decision.assessmentFingerprint);

    const modeMut = structuredClone(base) as typeof base;
    if (modeMut.consequences[0]?.evidence[0]) {
      (modeMut.consequences[0].evidence[0] as { mode: string }).mode = "predicted";
    }
    expect(fingerprintAssessment(modeMut)).not.toBe(decision.assessmentFingerprint);

    controller.stop();
  });

  it("corrupted lineage fails decision creation", async () => {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const obs = state.observation;
    const continueControl = env.controller.getContinueButtonForTest();
    const ownedHost = env.controller.getPreviewHostForTest();
    const effectsRegion = effectsRegionOf(env.modal);
    expect(continueControl).toBeInstanceOf(HTMLButtonElement);
    expect(ownedHost).toBeInstanceOf(HTMLDivElement);
    if (!(continueControl instanceof HTMLButtonElement)) throw new Error("no continue");
    if (!(ownedHost instanceof HTMLDivElement)) throw new Error("no host");

    const baseArgs = {
      document: env.document,
      controllerEpoch: 1,
      interceptEvalSeq: 1,
      issuancePreviewGeneration: 1,
      modal: env.modal,
      form: env.form,
      finalButton: env.finalButton,
      ownedHost,
      continueControl,
      effectsRegion,
      observation: obs as never,
      observationFingerprint: "x",
      context: state.context,
      assessment: state.assessment,
    };

    const badAction = createVerifiedDecision({
      ...baseArgs,
      assessment: {
        ...state.assessment,
        actionId: "action-not-matching" as typeof state.assessment.actionId,
      },
    });
    expect(badAction.status).toBe("invalid");

    const badContextId = createVerifiedDecision({
      ...baseArgs,
      assessment: {
        ...state.assessment,
        evaluationContextId: "ctx-wrong" as typeof state.assessment.evaluationContextId,
      },
    });
    expect(badContextId.status).toBe("invalid");

    const badTarget = {
      ...state.context,
      action: {
        ...state.context.action,
        targets: [{ entityId: "entity-wrong" as never, role: "primary" as const }],
      },
    };
    expect(createVerifiedDecision({ ...baseArgs, context: badTarget }).status).toBe("invalid");

    const fact0 = state.context.state.facts[0];
    if (!fact0) throw new Error("missing fact");
    const badFact = {
      ...state.context,
      state: {
        ...state.context.state,
        facts: [
          {
            ...fact0,
            subjectEntityId: "entity-wrong" as never,
          },
        ],
      },
    };
    expect(createVerifiedDecision({ ...baseArgs, context: badFact }).status).toBe("invalid");

    const csq0 = state.assessment.consequences[0];
    if (!csq0) throw new Error("missing consequence");
    const badAffected = {
      ...state.assessment,
      consequences: [
        {
          ...csq0,
          affectedEntities: ["entity-wrong" as never],
        },
      ],
    };
    expect(createVerifiedDecision({ ...baseArgs, assessment: badAffected }).status).toBe("invalid");

    const badCsqAction = {
      ...state.assessment,
      consequences: [
        {
          ...csq0,
          actionId: "action-wrong" as never,
        },
      ],
    };
    expect(createVerifiedDecision({ ...baseArgs, assessment: badCsqAction }).status).toBe(
      "invalid",
    );

    assertZeroRelease(env.controller);
    env.controller.stop();
  });

  it("wrong primitive type rejected instead of coercion", async () => {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const continueControl = env.controller.getContinueButtonForTest();
    const ownedHost = env.controller.getPreviewHostForTest();
    if (!(continueControl instanceof HTMLButtonElement)) throw new Error("no continue");
    if (!(ownedHost instanceof HTMLDivElement)) throw new Error("no host");
    const bad = {
      ...state.context,
      action: {
        ...state.context.action,
        intent: { verb: 123 as never, domain: "version_control" },
      },
    };
    const created = createVerifiedDecision({
      document: env.document,
      controllerEpoch: 1,
      interceptEvalSeq: 1,
      issuancePreviewGeneration: 1,
      modal: env.modal,
      form: env.form,
      finalButton: env.finalButton,
      ownedHost,
      continueControl,
      effectsRegion: effectsRegionOf(env.modal),
      observation: state.observation as never,
      observationFingerprint: "x",
      context: bad,
      assessment: state.assessment,
    });
    expect(created.status).toBe("invalid");
    env.controller.stop();
  });

  it("bounded collection overflow rejected", async () => {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const continueControl = env.controller.getContinueButtonForTest();
    const ownedHost = env.controller.getPreviewHostForTest();
    if (!(continueControl instanceof HTMLButtonElement)) throw new Error("no continue");
    if (!(ownedHost instanceof HTMLDivElement)) throw new Error("no host");
    const csq0 = state.assessment.consequences[0];
    if (!csq0) throw new Error("missing consequence");
    const many = Array.from({ length: 20 }, () => csq0);
    const created = createVerifiedDecision({
      document: env.document,
      controllerEpoch: 1,
      interceptEvalSeq: 1,
      issuancePreviewGeneration: 1,
      modal: env.modal,
      form: env.form,
      finalButton: env.finalButton,
      ownedHost,
      continueControl,
      effectsRegion: effectsRegionOf(env.modal),
      observation: state.observation as never,
      observationFingerprint: "x",
      context: state.context,
      assessment: { ...state.assessment, consequences: many },
    });
    expect(created.status).toBe("invalid");
    if (created.status === "invalid") {
      expect(created.reason).toBe("CONSEQUENCES_OVERFLOW");
    }
    env.controller.stop();
  });
});

describe("FC-007 Sprint 3A stale Continue matrix", () => {
  async function staleCase(
    mutate: (args: Awaited<ReturnType<typeof reachVerified>>) => void,
    expectedReason?: string,
  ): Promise<void> {
    const env = await reachVerified();
    env.controller.pauseFreshnessObserverForTest();
    mutate(env);
    const direct = env.controller.validateContinueSameDecisionForTest();
    expect(direct?.status).toBe("INVALID_STALE_DECISION");
    if (expectedReason && direct && direct.status === "INVALID_STALE_DECISION") {
      expect(direct.reason).toContain(expectedReason);
    }
    env.controller.invokeTrustedContinueForTest();
    const d = env.controller.getSprint3aDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.continueValidationFail).toBeGreaterThanOrEqual(1);
    expect(d.continueValidationPass).toBe(0);
    assertZeroRelease(env.controller);
    env.controller.stop();
  }

  it("form replacement", async () => {
    await staleCase(({ document: doc, form }) => {
      const replacement = doc.createElement("form");
      replacement.id = "visibility-form";
      replacement.method = "post";
      replacement.action = form.action;
      const btn = doc.createElement("button");
      btn.type = "submit";
      btn.id = "final-make-public";
      btn.textContent = "Make this repository public";
      replacement.appendChild(btn);
      form.replaceWith(replacement);
    });
  });

  it("button replacement", async () => {
    await staleCase(({ document: doc, finalButton }) => {
      const replacement = doc.createElement("button");
      replacement.type = "submit";
      replacement.id = "final-make-public";
      replacement.textContent = "Make this repository public";
      finalButton.replaceWith(replacement);
    }, "BUTTON_IDENTITY");
  });

  it("modal replacement", async () => {
    await staleCase(({ document: doc, modal }) => {
      const replacement = doc.createElement("dialog");
      replacement.id = "visibility-dialog";
      replacement.setAttribute("aria-modal", "true");
      replacement.open = true;
      replacement.innerHTML = modal.innerHTML;
      modal.replaceWith(replacement);
    });
  });

  it("host replacement", async () => {
    await staleCase(({ controller, modal }) => {
      const host = controller.getPreviewHostForTest();
      expect(host).toBeInstanceOf(HTMLDivElement);
      if (!(host instanceof HTMLDivElement)) throw new Error("no host");
      const decoy = modal.ownerDocument.createElement("div");
      host.replaceWith(decoy);
    }, "HOST");
  });

  it("modal close", async () => {
    await staleCase(({ modal }) => {
      modal.open = false;
      modal.removeAttribute("open");
    });
  });

  it("route change via location provider", async () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    let pathname = "/fixture-owner/fixture-repo/settings";
    const controller = new Fc007PassiveController({
      document: doc,
      locationProvider: () => ({
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname,
      }),
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: trustAll,
    });
    controller.start();
    await controller.attemptFullRecognition();
    const final = controller.getRetainedFinalButton();
    expect(final).toBeInstanceOf(HTMLButtonElement);
    if (!(final instanceof HTMLButtonElement)) throw new Error("no final");
    controller.handleCaptureClickForTest(createCancelableClick(final));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    controller.pauseFreshnessObserverForTest();
    pathname = "/other-owner/other-repo/settings";
    const direct = controller.validateContinueSameDecisionForTest();
    expect(direct?.status).toBe("INVALID_STALE_DECISION");
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3aDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.continueValidationFail).toBeGreaterThanOrEqual(1);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("locale change", async () => {
    await staleCase(({ document: doc }) => {
      doc.documentElement.lang = "fr";
    });
  });

  it("disabled button", async () => {
    await staleCase(({ finalButton }) => {
      finalButton.disabled = true;
    });
  });

  it("aria-disabled button", async () => {
    await staleCase(({ finalButton }) => {
      finalButton.setAttribute("aria-disabled", "true");
    });
  });

  it("second main", async () => {
    await staleCase(({ document: doc }) => {
      const main2 = doc.createElement("main");
      main2.textContent = "extra";
      doc.body.appendChild(main2);
    });
  });

  it("effects text mutation", async () => {
    await staleCase(({ modal }) => {
      const region = effectsRegionOf(modal);
      const p = region.querySelector("p");
      if (p) p.textContent = "MUTATED ACTUAL EFFECTS REGION PROSE";
    }, "EFFECTS_FINGERPRINT");
  });

  it("effects aria-label mutation", async () => {
    await staleCase(({ modal }) => {
      const effects = effectsRegionOf(modal);
      effects.setAttribute("aria-label", "mutated-effects-aria-label-for-fingerprint");
    });
  });

  it("form action mutation", async () => {
    await staleCase(({ form }) => {
      form.action = "https://github.com/fixture-owner/fixture-repo/settings/evil";
    });
  });

  it("submitter name mutation", async () => {
    await staleCase(({ finalButton }) => {
      finalButton.name = "evil-submitter";
    });
  });

  it("private-state signal loss", async () => {
    await staleCase(({ document: doc }) => {
      const section = doc.getElementById("visibility-section");
      if (section) {
        section.textContent = "This repository is currently public.";
      }
    });
  });
});

describe("FC-007 Sprint 3A fingerprint self-consistency", () => {
  it("retained snapshots match stored fingerprints", async () => {
    const { controller } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    expect(fingerprintCanonicalContext(decision.canonicalContext)).toBe(
      decision.contextFingerprint,
    );
    expect(fingerprintAssessment(decision.assessment)).toBe(decision.assessmentFingerprint);
    expect(fingerprintEffectsSemantics(decision.effectsSemantics)).toBe(
      decision.effectsFingerprint,
    );
    controller.stop();
  });
});

describe("FC-007 Sprint 3A final semantic binding regressions", () => {
  it("direct root text changes effects fingerprint and Continue fails", async () => {
    const env = await reachVerified();
    env.controller.pauseFreshnessObserverForTest();
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const originalFp = decision.effectsFingerprint;
    const region = effectsRegionOf(env.modal);
    region.insertBefore(
      env.document.createTextNode("ALL PRIVATE CODE AND SECRETS WILL BE PUBLIC. "),
      region.firstChild,
    );
    const fresh = projectEffectsSemantics(region);
    expect(fresh.status).toBe("ok");
    if (fresh.status !== "ok") throw new Error("fresh");
    expect(fresh.fingerprint).not.toBe(originalFp);
    expect(fresh.snapshot.units[0]?.kind).toBe("text");
    const direct = env.controller.validateContinueSameDecisionForTest();
    expect(direct?.status).toBe("INVALID_STALE_DECISION");
    expect(direct && "reason" in direct ? direct.reason : "").toBe("EFFECTS_FINGERPRINT");
    assertZeroRelease(env.controller);
    env.controller.stop();
  });

  it("effects units A|B vs A,B do not collide", () => {
    const a = fingerprintEffectsSemantics({
      ariaLabel: "Effects of making this repository public",
      units: [{ kind: "text", text: "A|B" }],
    });
    const b = fingerprintEffectsSemantics({
      ariaLabel: "Effects of making this repository public",
      units: [
        { kind: "text", text: "A" },
        { kind: "text", text: "B" },
      ],
    });
    expect(a).not.toBe(b);
  });

  it("mixed root-text+paragraph differs from single paragraph", () => {
    const mixed = fingerprintEffectsSemantics({
      ariaLabel: "Effects of making this repository public",
      units: [
        { kind: "text", text: "A" },
        { kind: "element", tag: "p", text: "B" },
      ],
    });
    const single = fingerprintEffectsSemantics({
      ariaLabel: "Effects of making this repository public",
      units: [{ kind: "element", tag: "p", text: "AB" }],
    });
    expect(mixed).not.toBe(single);
  });

  it("huge direct root text fails closed", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    region.insertBefore(env.document.createTextNode("X".repeat(2000)), region.firstChild);
    const projected = projectEffectsSemantics(region);
    expect(projected.status).toBe("invalid");
    env.controller.stop();
  });

  it("unsupported interactive structure in effects region fails", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    const btn = env.document.createElement("button");
    btn.textContent = "evil";
    region.appendChild(btn);
    expect(projectEffectsSemantics(region).status).toBe("invalid");
    env.controller.stop();
  });

  it("extra entity/fact/target rejected at context snapshot", async () => {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const entity = state.context.state.entities[0];
    const fact = state.context.state.facts[0];
    const target = state.context.action.targets[0];
    if (!entity || !fact || !target) throw new Error("shape");

    expect(
      snapshotCanonicalContext({
        ...state.context,
        state: {
          ...state.context.state,
          entities: [entity, { ...entity, id: "entity-extra" as never }],
        },
      }).status,
    ).toBe("invalid");

    expect(
      snapshotCanonicalContext({
        ...state.context,
        state: {
          ...state.context.state,
          facts: [fact, { ...fact, value: "public" as never }],
        },
      }).status,
    ).toBe("invalid");

    expect(
      snapshotCanonicalContext({
        ...state.context,
        action: {
          ...state.context.action,
          targets: [target, { entityId: "entity-other" as never, role: "primary" as const }],
        },
      }).status,
    ).toBe("invalid");

    expect(
      snapshotCanonicalContext({
        ...state.context,
        state: { ...state.context.state, entities: [] },
      }).status,
    ).toBe("invalid");

    env.controller.stop();
  });

  it("confidence/engineVersion/ruleVersion/timeWindow affect fingerprint", async () => {
    const env = await reachVerified();
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const base = decision.assessment;

    const confMut = structuredClone(base) as typeof base;
    if (confMut.consequences[0]) {
      (confMut.consequences[0] as { confidence: number }).confidence = 0.01;
    }
    expect(fingerprintAssessment(confMut)).not.toBe(decision.assessmentFingerprint);

    const engMut = structuredClone(base) as typeof base;
    (engMut as { provenanceEngineVersion: string }).provenanceEngineVersion = "9.9.9";
    expect(fingerprintAssessment(engMut)).not.toBe(decision.assessmentFingerprint);

    const ruleVerMut = structuredClone(base) as typeof base;
    if (ruleVerMut.consequences[0]) {
      (ruleVerMut.consequences[0] as { provenanceRuleVersion: string }).provenanceRuleVersion =
        "2.0";
    }
    expect(fingerprintAssessment(ruleVerMut)).not.toBe(decision.assessmentFingerprint);

    const twMut = structuredClone(base) as typeof base;
    if (twMut.consequences[0]) {
      (twMut.consequences[0] as { reversibilityTimeWindow: string }).reversibilityTimeWindow =
        "P30D";
    }
    expect(fingerprintAssessment(twMut)).not.toBe(decision.assessmentFingerprint);

    env.controller.stop();
  });

  it("number 1 vs string 1 state values do not collide", async () => {
    const env = await reachVerified();
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const numSnap = structuredClone(decision.assessment) as typeof decision.assessment;
    const strSnap = structuredClone(decision.assessment) as typeof decision.assessment;
    if (!numSnap.consequences[0]?.stateChanges[0] || !strSnap.consequences[0]?.stateChanges[0]) {
      throw new Error("missing state change");
    }
    (
      numSnap.consequences[0].stateChanges[0] as {
        after: { status: "known"; value: number };
      }
    ).after = { status: "known", value: 1 };
    (
      strSnap.consequences[0].stateChanges[0] as {
        after: { status: "known"; value: string };
      }
    ).after = { status: "known", value: "1" };
    expect(fingerprintAssessment(numSnap)).not.toBe(fingerprintAssessment(strSnap));
    env.controller.stop();
  });

  it("invalid evidence mode and state status reject construction", async () => {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const continueControl = env.controller.getContinueButtonForTest();
    const ownedHost = env.controller.getPreviewHostForTest();
    if (!(continueControl instanceof HTMLButtonElement) || !(ownedHost instanceof HTMLDivElement)) {
      throw new Error("missing controls");
    }
    const baseArgs = {
      document: env.document,
      controllerEpoch: 1,
      interceptEvalSeq: 1,
      issuancePreviewGeneration: 1,
      modal: env.modal,
      form: env.form,
      finalButton: env.finalButton,
      ownedHost,
      continueControl,
      effectsRegion: effectsRegionOf(env.modal),
      observation: state.observation as never,
      observationFingerprint: "x",
      context: state.context,
    };

    const badMode = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, mode: "not-a-mode" as never } : e,
              ),
            }
          : c,
      ),
    };
    expect(createVerifiedDecision({ ...baseArgs, assessment: badMode }).status).toBe("invalid");

    const badStatus = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              stateChanges: c.stateChanges.map((sc, j) =>
                j === 0
                  ? {
                      ...sc,
                      after: { status: "not-a-status" as never, value: "public" },
                    }
                  : sc,
              ),
            }
          : c,
      ),
    };
    expect(createVerifiedDecision({ ...baseArgs, assessment: badStatus }).status).toBe("invalid");

    const entityId = state.context.state.entities[0]?.id;
    expect(entityId).toBeTruthy();
    if (!entityId) throw new Error("no entity");
    expect(snapshotAssessment(badMode, entityId).status).toBe("invalid");
    expect(snapshotAssessment(badStatus, entityId).status).toBe("invalid");

    env.controller.stop();
  });
});

describe("FC-007 Sprint 3A M1 effects work boundedness", () => {
  function floodComments(region: HTMLDivElement, n: number): void {
    while (region.firstChild) region.removeChild(region.firstChild);
    for (let i = 0; i < n; i += 1) {
      region.appendChild(region.ownerDocument.createComment(`c${i}`));
    }
  }

  it("10,000 comment direct children reject with 0 child item reads", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    floodComments(region, 10_000);
    const counter = { count: 0 };
    const projected = projectEffectsSemantics(region, { inspectionCounter: counter });
    expect(projected.status).toBe("invalid");
    expect(projected.status === "invalid" ? projected.reason : "").toBe(
      "EFFECTS_DIRECT_CHILD_BUDGET",
    );
    expect(counter.count).toBe(0);
    env.controller.stop();
  });

  it("1,000 comment direct children reject before proportional enumeration", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    floodComments(region, 1_000);
    const counter = { count: 0 };
    const projected = projectEffectsSemantics(region, { inspectionCounter: counter });
    expect(projected.status).toBe("invalid");
    expect(counter.count).toBe(0);
    env.controller.stop();
  });

  it("10,000 text direct children reject with 0 child item reads", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    while (region.firstChild) region.removeChild(region.firstChild);
    for (let i = 0; i < 10_000; i += 1) {
      region.appendChild(env.document.createTextNode(`t${i} `));
    }
    const counter = { count: 0 };
    const projected = projectEffectsSemantics(region, { inspectionCounter: counter });
    expect(projected.status).toBe("invalid");
    expect(counter.count).toBe(0);
    env.controller.stop();
  });

  it("10,000 approved element direct children reject with 0 child item reads", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    while (region.firstChild) region.removeChild(region.firstChild);
    for (let i = 0; i < 10_000; i += 1) {
      const span = env.document.createElement("span");
      span.textContent = "x";
      region.appendChild(span);
    }
    const counter = { count: 0 };
    const projected = projectEffectsSemantics(region, { inspectionCounter: counter });
    expect(projected.status).toBe("invalid");
    expect(counter.count).toBe(0);
    env.controller.stop();
  });

  it("exact direct-child bound accepted when otherwise valid", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    floodComments(region, EFFECTS_REGION_MAX_DIRECT_CHILDREN);
    const projected = projectEffectsSemantics(region);
    expect(projected.status).toBe("ok");
    env.controller.stop();
  });

  it("+1 direct-child bound rejected with 0 child item reads", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    floodComments(region, EFFECTS_REGION_MAX_DIRECT_CHILDREN + 1);
    const counter = { count: 0 };
    const projected = projectEffectsSemantics(region, { inspectionCounter: counter });
    expect(projected.status).toBe("invalid");
    expect(counter.count).toBe(0);
    env.controller.stop();
  });

  it("nested below direct-child limit but visit budget exceeded rejects", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    while (region.firstChild) region.removeChild(region.firstChild);
    const p = env.document.createElement("p");
    for (let i = 0; i < 14; i += 1) {
      const span = env.document.createElement("span");
      for (let j = 0; j < 10; j += 1) {
        span.appendChild(env.document.createComment(`n${i}-${j}`));
      }
      p.appendChild(span);
    }
    region.appendChild(p);
    expect(EFFECTS_REGION_MAX_VISITED).toBeLessThan(155);
    const projected = projectEffectsSemantics(region);
    expect(projected.status).toBe("invalid");
    expect(["EFFECTS_VISIT_BUDGET", "EFFECTS_PENDING_BUDGET", "EFFECTS_ELEMENT_BUDGET"]).toContain(
      projected.status === "invalid" ? projected.reason : "",
    );
    env.controller.stop();
  });

  it("pending stack bound rejects before unbounded growth", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    while (region.firstChild) region.removeChild(region.firstChild);
    const p = env.document.createElement("p");
    for (let i = 0; i < EFFECTS_REGION_MAX_DIRECT_CHILDREN; i += 1) {
      const span = env.document.createElement("span");
      if (i === 0) {
        for (let j = 0; j < EFFECTS_REGION_MAX_DIRECT_CHILDREN; j += 1) {
          span.appendChild(env.document.createComment(`p${j}`));
        }
      }
      p.appendChild(span);
    }
    region.appendChild(p);
    expect(EFFECTS_REGION_MAX_PENDING).toBeLessThan(
      EFFECTS_REGION_MAX_DIRECT_CHILDREN - 1 + EFFECTS_REGION_MAX_DIRECT_CHILDREN,
    );
    const projected = projectEffectsSemantics(region);
    expect(projected.status).toBe("invalid");
    expect(["EFFECTS_PENDING_BUDGET", "EFFECTS_ELEMENT_BUDGET", "EFFECTS_VISIT_BUDGET"]).toContain(
      projected.status === "invalid" ? projected.reason : "",
    );
    env.controller.stop();
  });

  it("document order unchanged for supported small mixed structure", async () => {
    const env = await reachVerified();
    const region = effectsRegionOf(env.modal);
    while (region.firstChild) region.removeChild(region.firstChild);
    region.appendChild(env.document.createTextNode("A"));
    const p = env.document.createElement("p");
    p.textContent = "B";
    region.appendChild(p);
    region.appendChild(env.document.createTextNode("C"));
    const projected = projectEffectsSemantics(region);
    expect(projected.status).toBe("ok");
    if (projected.status !== "ok") throw new Error("project");
    expect(
      projected.snapshot.units.map((u) => `${u.kind}:${"tag" in u ? u.tag : ""}:${u.text}`),
    ).toEqual(["text::A", "element:p:B", "text::C"]);
    env.controller.stop();
  });
});

describe("FC-007 Sprint 3A M2 evidence source / confidence / temporal", () => {
  async function decisionBase() {
    const env = await reachVerified();
    const state = env.controller.getState();
    if (state.kind !== "evaluated") throw new Error("expected evaluated");
    const continueControl = env.controller.getContinueButtonForTest();
    const ownedHost = env.controller.getPreviewHostForTest();
    if (!(continueControl instanceof HTMLButtonElement) || !(ownedHost instanceof HTMLDivElement)) {
      throw new Error("missing controls");
    }
    return {
      env,
      state,
      baseArgs: {
        document: env.document,
        controllerEpoch: 1,
        interceptEvalSeq: 1,
        issuancePreviewGeneration: 1,
        modal: env.modal,
        form: env.form,
        finalButton: env.finalButton,
        ownedHost,
        continueControl,
        effectsRegion: effectsRegionOf(env.modal),
        observation: state.observation as never,
        observationFingerprint: "x",
        context: state.context,
      },
    };
  }

  it("invalid evidence source rejected", async () => {
    const { env, state, baseArgs } = await decisionBase();
    const bad = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, source: "NOT_A_PROVENANCE_SOURCE" as never } : e,
              ),
            }
          : c,
      ),
    };
    expect(createVerifiedDecision({ ...baseArgs, assessment: bad }).status).toBe("invalid");
    const entityId = state.context.state.entities[0]?.id;
    if (!entityId) throw new Error("no entity");
    expect(snapshotAssessment(bad, entityId).status).toBe("invalid");
    env.controller.stop();
  });

  it("evidence confidence supported: absence/1/0.01 differ; NaN/Infinity/OOR reject", async () => {
    const { env, state } = await decisionBase();
    const entityId = state.context.state.entities[0]?.id;
    if (!entityId) throw new Error("no entity");
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");

    const withEvConfidence = (confidence: number | undefined) => ({
      ...decision.assessment,
      consequences: decision.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0
                  ? {
                      mode: e.mode,
                      source: e.source,
                      scope: e.scope,
                      summary: e.summary,
                      assumptions: e.assumptions,
                      confidence,
                    }
                  : e,
              ),
            }
          : c,
      ),
    });
    const absent = withEvConfidence(undefined);
    const one = withEvConfidence(1);
    const tiny = withEvConfidence(0.01);
    expect(fingerprintAssessment(absent)).not.toBe(fingerprintAssessment(one));
    expect(fingerprintAssessment(one)).not.toBe(fingerprintAssessment(tiny));
    expect(fingerprintAssessment(absent)).not.toBe(fingerprintAssessment(tiny));

    const withNan = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, confidence: Number.NaN as never } : e,
              ),
            }
          : c,
      ),
    };
    expect(snapshotAssessment(withNan, entityId).status).toBe("invalid");

    const withInf = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, confidence: Number.POSITIVE_INFINITY as never } : e,
              ),
            }
          : c,
      ),
    };
    expect(snapshotAssessment(withInf, entityId).status).toBe("invalid");

    const withOor = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, confidence: 1.5 as never } : e,
              ),
            }
          : c,
      ),
    };
    expect(snapshotAssessment(withOor, entityId).status).toBe("invalid");

    const withValid = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              evidence: c.evidence.map((e, j) =>
                j === 0 ? { ...e, confidence: 0.01 as never } : e,
              ),
            }
          : c,
      ),
    };
    const snap = snapshotAssessment(withValid, entityId);
    expect(snap.status).toBe("ok");
    if (snap.status === "ok") {
      expect(snap.value.consequences[0]?.evidence[0]?.confidence).toBe(0.01);
    }

    env.controller.stop();
  });

  it("temporal supported: presence changes fingerprint; invalid discriminants reject", async () => {
    const { env, state, baseArgs } = await decisionBase();
    const entityId = state.context.state.entities[0]?.id;
    if (!entityId) throw new Error("no entity");
    const decision = env.controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");

    const withTemporal = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              temporal: { timing: "long-term" as const, frequency: "recurring" as const },
            }
          : c,
      ),
    };
    const snap = snapshotAssessment(withTemporal, entityId);
    expect(snap.status).toBe("ok");
    if (snap.status !== "ok") throw new Error("snap");
    expect(snap.value.consequences[0]?.temporalTiming).toBe("long-term");
    expect(snap.value.consequences[0]?.temporalFrequency).toBe("recurring");
    expect(fingerprintAssessment(snap.value)).not.toBe(decision.assessmentFingerprint);

    const created = createVerifiedDecision({ ...baseArgs, assessment: withTemporal });
    expect(created.status).toBe("ok");

    const badTiming = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              temporal: { timing: "whenever" as never, frequency: "recurring" as const },
            }
          : c,
      ),
    };
    expect(snapshotAssessment(badTiming, entityId).status).toBe("invalid");

    const badFreq = {
      ...state.assessment,
      consequences: state.assessment.consequences.map((c, i) =>
        i === 0
          ? {
              ...c,
              temporal: { timing: "long-term" as const, frequency: "sometimes" as never },
            }
          : c,
      ),
    };
    expect(snapshotAssessment(badFreq, entityId).status).toBe("invalid");

    env.controller.stop();
  });
});
