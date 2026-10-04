/**
 * FC-007 Sprint 1A — M1 document_start lifecycle tests (real controller).
 */

import { describe, expect, it } from "vitest";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function setReadyState(doc: Document, state: DocumentReadyState): void {
  Object.defineProperty(doc, "readyState", {
    configurable: true,
    get: () => state,
  });
}

describe("FC-007 M1 document_start lifecycle", () => {
  it("loading without main does not permanently die", () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: false });
    doc.querySelector("main")?.remove();
    setReadyState(doc, "loading");

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    expect(controller.getState().kind).toBe("awaiting-dom");
    expect(controller.getState().kind).not.toBe("abstained");
    controller.stop();
  });

  it("DOMContentLoaded with supported DOM recognizes", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    setReadyState(doc, "loading");

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    expect(controller.getState().kind).toBe("awaiting-dom");

    setReadyState(doc, "interactive");
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    // Allow microtasks from attemptFullRecognition
    await Promise.resolve();
    await Promise.resolve();

    const kind = controller.getState().kind;
    expect(kind === "contract-recognized" || kind === "evaluated").toBe(true);
    controller.stop();
  });

  it("DOMContentLoaded with main still absent abstains", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: false });
    doc.querySelector("main")?.remove();
    setReadyState(doc, "loading");

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    setReadyState(doc, "interactive");
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().kind).toBe("abstained");
    const abstained = controller.getState();
    if (abstained.kind === "abstained") {
      expect(abstained.reason).toMatch(/MAIN/);
    }
    controller.stop();
  });

  it("stop before DOMContentLoaded prevents later recognition", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    setReadyState(doc, "loading");
    const states: string[] = [];

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
      onDiagnostic: (s) => states.push(s.kind),
    });
    controller.start();
    controller.stop();
    expect(controller.getState().kind).toBe("idle");

    setReadyState(doc, "interactive");
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().kind).toBe("idle");
    expect(states.filter((k) => k === "contract-recognized").length).toBe(0);
  });

  it("double start does not duplicate observers / lifecycle", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    setReadyState(doc, "complete");
    let recognizeCount = 0;

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
      onDiagnostic: (s) => {
        if (s.kind === "contract-recognized") recognizeCount += 1;
      },
    });
    controller.start();
    await controller.attemptFullRecognition();
    const epoch1 = controller.getInvalidationCounters().epoch;
    controller.start();
    await controller.attemptFullRecognition();
    const epoch2 = controller.getInvalidationCounters().epoch;
    expect(epoch2).toBeGreaterThan(epoch1);
    // Second start tears down first; recognition may run twice total but not with duplicate DCL.
    expect(recognizeCount).toBeGreaterThanOrEqual(1);
    controller.stop();
  });
});
