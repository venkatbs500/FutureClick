/**
 * FC-007 modal inventory tests (M1-B).
 */

import { describe, expect, it } from "vitest";
import { inventorySupportedVisibilityDialog } from "../src/fc007/dialog-inventory.js";
import { FIXTURE_IDENTITY, createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 modal inventory", () => {
  it("recognizes exactly one supported open modal dialog", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("matched");
  });

  it("abstains with 0 dialogs", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: false });
    const dialog = doc.getElementById("visibility-dialog");
    dialog?.remove();
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("abstains when two actual modals exist", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const d2 = doc.createElement("dialog");
    d2.setAttribute("aria-modal", "true");
    d2.setAttribute("open", "");
    (d2 as HTMLDialogElement).open = true;
    doc.body.appendChild(d2);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") expect(r.reason).toBe("MULTIPLE_ACTUAL_MODALS");
  });

  it("abstains when >4 dialogs exist", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    for (let i = 0; i < 4; i += 1) {
      doc.body.appendChild(doc.createElement("dialog"));
    }
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") expect(r.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
  });

  it("abstains for open but non-modal dialog", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: () => false,
    });
    expect(r.status).toBe("abstain");
  });

  it("abstains when sole modal is wrong action content", () => {
    const doc = document.implementation.createHTMLDocument("fc007-wrong-modal");
    doc.body.innerHTML = `
      <dialog open aria-modal="true">
        <h1>Delete fixture-owner/fixture-repo</h1>
        <p>fixture-owner/fixture-repo</p>
        <form method="post" action="https://github.com/fixture-owner/fixture-repo/settings/delete"
          enctype="application/x-www-form-urlencoded">
          <button type="submit">Delete this repository</button>
        </form>
      </dialog>`;
    const dialog = doc.querySelector("dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    dialog.open = true;
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("partial-scan: dialog with too many elements abstains even if early match exists", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    // Balanced tree past 64 elements; ≤8 children per node.
    const queue: Element[] = [dialog];
    let added = 0;
    while (added < 70) {
      const parent = queue.shift();
      if (!parent) break;
      const room = Math.min(8, 70 - added);
      for (let i = 0; i < room; i += 1) {
        const d = doc.createElement("div");
        parent.appendChild(d);
        queue.push(d);
        added += 1;
      }
    }
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });
});
