/**
 * FC-007 Sprint 1B — M2 automatic removal + M3 overflow pending evaluation.
 */

import { describe, expect, it } from "vitest";
import type { ConsequenceAssessment } from "@futureclick/action-schema";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { processMutationDelivery } from "../src/fc007/mutation-delivery.js";
import { CURRENT_PRIVATE_TEXT } from "../src/fc007/visibility-section.js";
import { createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const fakeAssessment = {
  consequences: [{ evidence: [{ mode: "verified" }] }],
} as unknown as ConsequenceAssessment;

describe("FC-007 M2 automatic removal invalidation", () => {
  it("removing recognized dialog via MutationObserver clears observation without manual refresh", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");
    expect(controller.getLastObservation()).not.toBeNull();

    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    dialog.remove();
    await flush();

    // Must NOT manually call attemptFullRecognition — observer path only.
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    const kind = controller.getState().kind;
    expect(kind === "contract-recognized" || kind === "evaluated").toBe(false);
    controller.stop();
  });

  it("removing private-state / visibility LI / form / final button invalidates", async () => {
    for (const target of [
      "private-state",
      "visibility-li",
      "visibility-form",
      "final-make-public",
    ] as const) {
      const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
      const controller = new Fc007PassiveController({
        document: doc,
        location,
        requireTopFrame: false,
        recognitionVersion: "v1",
        matchesModal: testMatchesModal,
        evaluateOnRecognize: false,
      });
      controller.start();
      await controller.attemptFullRecognition();
      expect(controller.getState().kind).toBe("contract-recognized");

      if (target === "private-state") {
        const priv = Array.from(doc.querySelectorAll("div")).find(
          (d) => d.textContent?.trim() === CURRENT_PRIVATE_TEXT,
        );
        if (!priv) throw new Error("missing private");
        priv.remove();
      } else if (target === "visibility-li") {
        doc.getElementById("visibility-section")?.remove();
      } else {
        doc.getElementById(target)?.remove();
      }
      await flush();
      expect(controller.getLastObservation()).toBeNull();
      expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
      controller.stop();
    }
  });
});

describe("FC-007 M3 overflow invalidates pending evaluation", () => {
  it("overflow then resolve does NOT publish evaluated (Codex counterexample)", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    Object.defineProperty(doc, "readyState", {
      configurable: true,
      get: () => "loading",
    });
    const d = deferred<{ ok: true; value: ConsequenceAssessment }>();
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      evaluateFn: () => d.promise,
    });
    controller.start();
    const pending = controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");

    // Deliver overflow via real mutation processor path on the controller.
    const roots = Array.from({ length: 100 }, () => doc.createElement("div"));
    const list = {
      length: roots.length,
      item(i: number) {
        return roots[i] ?? null;
      },
    } as unknown as NodeList;
    const record = {
      type: "childList",
      target: doc.body,
      addedNodes: list,
      removedNodes: { length: 0, item: () => null } as unknown as NodeList,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;

    const overflow = processMutationDelivery([record]);
    expect(overflow.status).toBe("overflow");
    controller.handleMutationRecordsForTest([record]);
    expect(controller.getState().kind).toBe("unknown");
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();

    d.resolve({ ok: true, value: fakeAssessment });
    await pending;
    expect(controller.getState().kind).toBe("unknown");
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });

  it("dialog removed while evaluating → resolve does not publish", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    Object.defineProperty(doc, "readyState", {
      configurable: true,
      get: () => "loading",
    });
    const d = deferred<{ ok: true; value: ConsequenceAssessment }>();
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      evaluateFn: () => d.promise,
    });
    controller.start();
    const pending = controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");

    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    dialog.remove();
    await flush();

    expect(controller.getLastObservation()).toBeNull();
    d.resolve({ ok: true, value: fakeAssessment });
    await pending;
    expect(controller.getState().kind).not.toBe("evaluated");
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });

  it("genuine MutationObserver overflow invalidates pending evaluation", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    Object.defineProperty(doc, "readyState", {
      configurable: true,
      get: () => "loading",
    });
    const d = deferred<{ ok: true; value: ConsequenceAssessment }>();
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      evaluateFn: () => d.promise,
    });
    controller.start();
    const pending = controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");

    // Real DOM mutations → real MutationObserver delivery (not injected records).
    // Append > MUTATION_ROOT_MAX (16) element roots in one synchronous batch so the
    // genuine observer delivery overflows root budget without synthetic MutationRecords.
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    await flush();
    const before = controller.getInvalidationCounters().requestSequence;
    for (let i = 0; i < 40; i += 1) {
      host.appendChild(doc.createElement("div"));
    }
    await flush();
    await flush();

    expect(controller.getInvalidationCounters().requestSequence).toBeGreaterThan(before);
    expect(controller.getState().kind).toBe("unknown");
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();

    d.resolve({ ok: true, value: fakeAssessment });
    await pending;
    expect(controller.getState().kind).toBe("unknown");
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });
});
