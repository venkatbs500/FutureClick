/**
 * FC-007 V2 dispatch — V2 production path does not fall back to V1.
 */

import { describe, expect, it, vi } from "vitest";
import { captureFullContract } from "../src/fc007/capture.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 V2 dispatch isolation", () => {
  it("V2-shaped DOM is not recognized by V1 capture", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const v1 = captureFullContract(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(v1.status).toBe("abstain");
    const v2 = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(v2.status).toBe("matched");
  });

  it("V2 controller Stage B does not evaluate consequences", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "b" });
    const evaluateSpy = vi.fn();
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      recognitionVersion: "v2",
      evaluateFn: evaluateSpy,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("stage-recognized");
    expect(evaluateSpy).not.toHaveBeenCalled();
    controller.stop();
  });

  it("V2 controller Stage D evaluates", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      recognitionVersion: "v2",
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("evaluated");
    controller.stop();
  });
});
