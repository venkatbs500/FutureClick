/**
 * FC-007 Sprint 1A — M2 fresh recognition + M3 async invalidation.
 */

import type { ConsequenceAssessment } from "@futureclick/action-schema";
import { describe, expect, it } from "vitest";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
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

describe("FC-007 M2 fresh semantics", () => {
  it("matched → private sentence changed → no match / stale cleared", async () => {
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

    const priv = Array.from(doc.querySelectorAll("div")).find(
      (d) => d.textContent?.trim() === CURRENT_PRIVATE_TEXT,
    );
    expect(priv).toBeTruthy();
    if (!priv) throw new Error("missing private");
    priv.textContent = "This repository is currently public.";

    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });

  it("matched → locale changed → no match", async () => {
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

    doc.documentElement.lang = "fr";
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    controller.stop();
  });

  it("matched → route changed → no match", async () => {
    const loc = {
      protocol: "https:",
      hostname: "github.com",
      port: "",
      pathname: "/fixture-owner/fixture-repo/settings",
    };
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const controller = new Fc007PassiveController({
      document: doc,
      locationProvider: () => loc,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");

    loc.pathname = "/fixture-owner/other-repo/settings";
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    controller.stop();
  });

  it("matched → LI relationship broken → no match", async () => {
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

    const priv = Array.from(doc.querySelectorAll("div")).find(
      (d) => d.textContent?.trim() === CURRENT_PRIVATE_TEXT,
    );
    if (!priv) throw new Error("missing");
    // Move private div outside LI (>4 hops / wrong section).
    doc.querySelector("main")?.appendChild(priv);

    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    controller.stop();
  });

  it("matched → dialog removed → no current recognized result", async () => {
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

    doc.getElementById("visibility-dialog")?.remove();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });

  it("matched → over-budget refresh invalidates old recognized state", async () => {
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

    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    for (let i = 0; i < 70; i += 1) {
      dialog.appendChild(doc.createElement("div"));
    }
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });
});

describe("FC-007 M3 async evaluation invalidation", () => {
  it("evaluation pending → stop → resolve → no publication", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    const d = deferred<{ ok: true; value: ConsequenceAssessment }>();
    const publications: string[] = [];

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      evaluateFn: () => d.promise,
      onDiagnostic: (s) => publications.push(s.kind),
    });
    controller.start();
    const pending = controller.attemptFullRecognition();
    controller.stop();
    d.resolve({
      ok: true,
      value: {
        consequences: [{ evidence: [{ mode: "verified" }] }],
      } as unknown as ConsequenceAssessment,
    });
    await pending;
    expect(controller.getState().kind).toBe("idle");
    expect(publications.filter((k) => k === "evaluated").length).toBe(0);
  });

  it("request A pending → B starts → A resolves → A ignored", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    Object.defineProperty(doc, "readyState", {
      configurable: true,
      get: () => "loading",
    });
    const a = deferred<{ ok: true; value: ConsequenceAssessment }>();
    const b = deferred<{ ok: true; value: ConsequenceAssessment }>();
    let call = 0;
    const fakeAssessment = {
      consequences: [{ evidence: [{ mode: "verified" }] }],
    } as unknown as ConsequenceAssessment;

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      evaluateFn: () => {
        call += 1;
        if (call === 1) return a.promise;
        if (call === 2) return b.promise;
        return Promise.resolve({ ok: true, value: fakeAssessment });
      },
    });
    // Arm without auto-recognition (still loading / awaiting-dom).
    controller.start();
    expect(controller.getState().kind).toBe("awaiting-dom");

    const pA = controller.attemptFullRecognition();
    const pB = controller.attemptFullRecognition();
    a.resolve({ ok: true, value: fakeAssessment });
    await pA;
    expect(controller.getState().kind).not.toBe("evaluated");
    b.resolve({ ok: true, value: fakeAssessment });
    await pB;
    expect(controller.getState().kind).toBe("evaluated");
    controller.stop();
  });

  it("DOM changes during evaluation → old observation not published as evaluated", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
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
    // Mutate private text while evaluation is in flight.
    const priv = Array.from(doc.querySelectorAll("div")).find(
      (el) => el.textContent?.trim() === CURRENT_PRIVATE_TEXT,
    );
    if (!priv) throw new Error("missing");
    priv.textContent = "This repository is currently public.";
    d.resolve({
      ok: true,
      value: {
        consequences: [{ evidence: [{ mode: "verified" }] }],
      } as unknown as ConsequenceAssessment,
    });
    await pending;
    expect(controller.getState().kind).toBe("abstained");
    controller.stop();
  });
});
