/**
 * FC-007 passive controller integration + no-release spies.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 passive controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recognizes contract passively without invoking release primitives", async () => {
    const {
      document: doc,
      location,
      window: win,
    } = createFc007SettingsWindow({
      openDialog: true,
    });

    const fetchSpy = vi.fn();
    (win as unknown as { fetch: unknown }).fetch = fetchSpy;
    const xhrCtor = vi.fn(() => {
      throw new Error("XHR_SHOULD_NOT_RUN");
    });
    (win as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = xhrCtor;

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
    });

    const clickSpy = vi.spyOn(HTMLButtonElement.prototype, "click");
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit");

    controller.start();
    const state = await controller.attemptFullRecognition();
    expect(state.kind).toBe("evaluated");
    if (state.kind !== "evaluated") return;
    expect(state.assessment.consequences[0]?.evidence[0]?.mode).toBe("verified");
    expect(clickSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrCtor).not.toHaveBeenCalled();
    controller.stop();
  });

  it("abstains when dialog not open (no stale recognized state)", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: false });
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
    expect(controller.getState().kind).toBe("abstained");
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });
});
