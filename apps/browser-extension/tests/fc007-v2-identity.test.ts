/**
 * FC-007 V2 identity / route mismatch tests.
 */

import { describe, expect, it } from "vitest";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { recognizeStageD } from "../src/fc007/v2/dialog-inventory-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  testMatchesModal,
} from "./fc007-test-dom.js";

describe("FC-007 V2 identity mismatches", () => {
  it("abstains on unauthorized route pathname", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const result = captureFullContractV2(
      doc,
      {
        ...location,
        pathname: "/wrong-owner/wrong-repo/settings",
      },
      {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      },
    );
    expect(result.status).toBe("abstain");
  });

  it("abstains when dialog identity text mismatches route", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const dialog = doc.getElementById("visibility-dialog");
    const p = dialog?.querySelector("p");
    if (p) p.textContent = "other-owner/other-repo";
    const modal = dialog instanceof HTMLDialogElement ? dialog : null;
    if (!modal) throw new Error("missing dialog");
    const stageD = recognizeStageD(modal, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_IDENTITY_COUNT");
    }
  });

  it("abstains when transition heading mismatches owner/repo", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const h1 = doc.querySelector("#visibility-dialog h1");
    if (h1) h1.textContent = "Make wrong-owner/wrong-repo public";
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_TRANSITION_COUNT");
    }
  });

  it("abstains when form action path mismatches identity", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const form = doc.getElementById("visibility-form");
    if (form instanceof HTMLFormElement) {
      form.action = "https://github.com/wrong-owner/wrong-repo/settings/set_visibility";
    }
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("FORM_ACTION_PATH");
    }
  });
});
