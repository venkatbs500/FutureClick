/**
 * FC-007H Medium fixes — exact one main + LI contained in retained main.
 */

import { describe, expect, it } from "vitest";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { recognizeVisibilitySectionV2 } from "../src/fc007/v2/visibility-section-v2.js";
import {
  createFc007V2SettingsWindow,
  createV2VisibilityMainOnly,
  testMatchesModal,
} from "./fc007-test-dom.js";

function buildEscapedLiDocument(): Document {
  const doc = document.implementation.createHTMLDocument("fc007-escaped-li");
  doc.documentElement.lang = "en";
  // Independent counterexample: LI outside main supplies private state.
  // LI
  //   main
  //     DIV > STRONG anchor
  //   DIV > private DIV
  const li = doc.createElement("li");
  const main = doc.createElement("main");
  const titleWrap = doc.createElement("div");
  const strong = doc.createElement("strong");
  strong.textContent = "Change repository visibility";
  titleWrap.appendChild(strong);
  main.appendChild(titleWrap);
  const privateWrap = doc.createElement("div");
  const priv = doc.createElement("div");
  priv.textContent = "This repository is currently private.";
  privateWrap.appendChild(priv);
  li.appendChild(main);
  li.appendChild(privateWrap);
  doc.body.appendChild(li);
  return doc;
}

function buildLiOnlyAboveMainDocument(): Document {
  const doc = document.implementation.createHTMLDocument("fc007-li-above-main");
  doc.documentElement.lang = "en";
  const li = doc.createElement("li");
  const main = doc.createElement("main");
  const titleWrap = doc.createElement("div");
  const strong = doc.createElement("strong");
  strong.textContent = "Change repository visibility";
  titleWrap.appendChild(strong);
  const privateWrap = doc.createElement("div");
  const priv = doc.createElement("div");
  priv.textContent = "This repository is currently private.";
  privateWrap.appendChild(priv);
  main.appendChild(titleWrap);
  main.appendChild(privateWrap);
  li.appendChild(main);
  doc.body.appendChild(li);
  return doc;
}

function buildDivFallbackOutsideLiDocument(): Document {
  const doc = document.implementation.createHTMLDocument("fc007-div-fallback");
  doc.documentElement.lang = "en";
  const outerLi = doc.createElement("li");
  const main = doc.createElement("main");
  const generic = doc.createElement("div");
  const strong = doc.createElement("strong");
  strong.textContent = "Change repository visibility";
  generic.appendChild(strong);
  const priv = doc.createElement("div");
  priv.textContent = "This repository is currently private.";
  generic.appendChild(priv);
  main.appendChild(generic);
  outerLi.appendChild(main);
  doc.body.appendChild(outerLi);
  return doc;
}

async function reachV2EvaluatedRealEngine(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    // Real ConsequenceEngine (no evaluateFn override).
  });
  controller.start();
  await controller.attemptFullRecognition();
  expect(controller.getState().kind).toBe("evaluated");
  expect(controller.getLastObservation()).not.toBeNull();
  expect(controller.getLastEvaluation()).not.toBeNull();
  return { controller, document: doc };
}

describe("FC-007H Medium 1 — exact one main", () => {
  it("0 main → MAIN_ABSENT", () => {
    const doc = document.implementation.createHTMLDocument("no-main");
    doc.documentElement.lang = "en";
    const result = recognizeVisibilitySectionV2(doc);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("MAIN_ABSENT");
    }
  });

  it("1 main → valid fixture continues", () => {
    expect(recognizeVisibilitySectionV2(createV2VisibilityMainOnly({})).status).toBe("matched");
  });

  it("2 mains (second empty) → MAIN_NOT_UNIQUE", () => {
    const doc = createV2VisibilityMainOnly({});
    doc.body.appendChild(doc.createElement("main"));
    const result = recognizeVisibilitySectionV2(doc);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("MAIN_NOT_UNIQUE");
    }
  });

  it("2 mains (second has duplicate anchor) → MAIN_NOT_UNIQUE", () => {
    const doc = createV2VisibilityMainOnly({});
    const second = doc.createElement("main");
    const wrap = doc.createElement("div");
    const strong = doc.createElement("strong");
    strong.textContent = "Change repository visibility";
    wrap.appendChild(strong);
    second.appendChild(wrap);
    doc.body.appendChild(second);
    const result = recognizeVisibilitySectionV2(doc);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("MAIN_NOT_UNIQUE");
    }
  });

  it("A/B/C/D all reject ambiguous-main state", () => {
    for (const stage of ["a", "b", "c", "d"] as const) {
      const { document: doc, location } = createFc007V2SettingsWindow({
        stage,
        openDialog: stage !== "a",
      });
      doc.body.appendChild(doc.createElement("main"));
      const result = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      });
      expect(result.status).toBe("abstain");
      if (result.status === "abstain") {
        expect(result.reason).toBe("MAIN_NOT_UNIQUE");
      }
    }
  });

  it("Stage-D evaluated → append second main → getter clears authority (real engine)", async () => {
    const { controller, document: doc } = await reachV2EvaluatedRealEngine();
    doc.body.appendChild(doc.createElement("main"));
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    expect(controller.getState().kind === "evaluated").toBe(false);
    controller.stop();
  });
});

describe("FC-007H Medium 2 — LI contained in retained main", () => {
  it("approved in-main LI shape → PASS", () => {
    const result = recognizeVisibilitySectionV2(createV2VisibilityMainOnly({}));
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.value.main.contains(result.value.section)).toBe(true);
      expect(result.value.main.contains(result.value.privateStateElement)).toBe(true);
      expect(result.value.section.contains(result.value.privateStateElement)).toBe(true);
    }
  });

  it("LI wrapping main with private sibling outside main → ABSTAIN", () => {
    const result = recognizeVisibilitySectionV2(buildEscapedLiDocument());
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
  });

  it("nearest LI only above main → ABSTAIN", () => {
    const result = recognizeVisibilitySectionV2(buildLiOnlyAboveMainDocument());
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
  });

  it("generic DIV inside main + LI outside main → ABSTAIN (no DIV fallback)", () => {
    const result = recognizeVisibilitySectionV2(buildDivFallbackOutsideLiDocument());
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
  });

  it("private state outside main cannot satisfy proof", () => {
    const doc = createV2VisibilityMainOnly({ omitPrivate: true });
    const outside = doc.createElement("div");
    outside.textContent = "This repository is currently private.";
    doc.body.appendChild(outside);
    const result = recognizeVisibilitySectionV2(doc);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE");
    }
  });

  it("Stage-D evaluated → LI escape mutation → getter clears authority (real engine)", async () => {
    const { controller, document: doc } = await reachV2EvaluatedRealEngine();
    const main = doc.querySelector("main");
    const section = doc.getElementById("visibility-section");
    expect(main && section).toBeTruthy();
    if (!main || !(section instanceof HTMLLIElement)) return;

    // Restructure so nearest LI is outside main (escape shape).
    const outerLi = doc.createElement("li");
    const title = section.querySelector("strong");
    const priv = Array.from(section.querySelectorAll("div")).find(
      (d) =>
        d.childNodes.length === 1 &&
        d.textContent?.trim() === "This repository is currently private.",
    );
    expect(title && priv).toBeTruthy();
    if (!title || !priv) return;

    // Move main under outer LI; move private sibling beside main (outside main).
    section.remove();
    const titleWrap = doc.createElement("div");
    titleWrap.appendChild(title);
    // Clear main children then rebuild escape.
    while (main.firstChild) main.removeChild(main.firstChild);
    main.appendChild(titleWrap);
    const privateWrap = doc.createElement("div");
    privateWrap.appendChild(priv);
    outerLi.appendChild(main);
    outerLi.appendChild(privateWrap);
    doc.body.appendChild(outerLi);

    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    expect(controller.getState().kind === "evaluated").toBe(false);
    controller.stop();
  });

  it("A/B/C/D reject escaped-LI documents", () => {
    for (const stage of ["a", "b", "c", "d"] as const) {
      const escaped = buildEscapedLiDocument();
      // Attach stage dialogs from a normal fixture onto escaped doc for B/C/D.
      const { document: staged, location } = createFc007V2SettingsWindow({
        stage,
        openDialog: stage !== "a",
        denseProse: false,
        leadingPadding: 0,
      });
      // Replace staged main with escaped structure while keeping dialogs.
      const stagedMain = staged.querySelector("main");
      stagedMain?.remove();
      const escapedLi = escaped.body.firstElementChild;
      if (escapedLi) {
        staged.body.insertBefore(staged.importNode(escapedLi, true), staged.body.firstChild);
      }

      const result = captureFullContractV2(staged, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      });
      expect(result.status).toBe("abstain");
      if (result.status === "abstain") {
        expect(result.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
      }
    }
  });
});

describe("FC-007H Medium fixes — real-engine counterexample probe", () => {
  it("two mains never reach evaluated", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    doc.body.appendChild(doc.createElement("main"));
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
    });
    controller.start();
    await controller.attemptFullRecognition();
    const state = controller.getState();
    expect(state.kind).toBe("abstained");
    if (state.kind === "abstained") {
      expect(state.reason).toBe("MAIN_NOT_UNIQUE");
    }
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });

  it("escaped LI never reach evaluated", async () => {
    const { document: staged, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    staged.querySelector("main")?.remove();
    const escaped = buildEscapedLiDocument();
    const escapedLi = escaped.body.firstElementChild;
    if (escapedLi) {
      staged.body.insertBefore(staged.importNode(escapedLi, true), staged.body.firstChild);
    }
    const controller = new Fc007PassiveController({
      document: staged,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("abstained");
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });

  it("valid Stage D fixture still reaches evaluated via real engine", async () => {
    const { controller } = await reachV2EvaluatedRealEngine();
    expect(controller.getState().kind).toBe("evaluated");
    controller.stop();
  });
});
