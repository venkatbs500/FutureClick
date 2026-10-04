/**
 * FC-007 Sprint 1A — M5 confirmation / close-control tests.
 */

import { describe, expect, it } from "vitest";
import { inventorySupportedVisibilityDialog } from "../src/fc007/dialog-inventory.js";
import { FIXTURE_IDENTITY, createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 M5 confirmation controls", () => {
  it("exact approved Close control accepted", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.value.closeButton?.getAttribute("aria-label")).toBe("Close");
      expect(r.value.finalButton.type).toBe("submit");
    }
  });

  it("form-less arbitrary button Confirm additional requirement rejected", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = "Confirm additional requirement";
    dialog.appendChild(btn);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("second form-less Close button rejected", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Close");
    dialog.appendChild(btn);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("role=button custom control rejected", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const el = doc.createElement("div");
    el.setAttribute("role", "button");
    el.textContent = "Extra";
    dialog.appendChild(el);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("tabindex=0 unknown control rejected", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const el = doc.createElement("div");
    el.setAttribute("tabindex", "0");
    dialog.appendChild(el);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("anchor href rejected", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const a = doc.createElement("a");
    a.setAttribute("href", "#");
    a.textContent = "help";
    dialog.appendChild(a);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("final submit remains uniquely identified", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.value.finalButton.id).toBe("final-make-public");
      expect(r.value.finalButton.type).toBe("submit");
    }
  });
});
