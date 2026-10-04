/**
 * FC-007 V2 effects region tests.
 */

import { describe, expect, it } from "vitest";
import { EFFECTS_ARIA_LABEL, findExactEffectsRegion } from "../src/fc007/v2/effects-region.js";
import { createFc007V2SettingsWindow } from "./fc007-test-dom.js";

function getDialog(doc: Document): HTMLDialogElement {
  const dialog = doc.getElementById("visibility-dialog");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
  return dialog;
}

function getRegion(dialog: HTMLDialogElement): Element {
  const region = dialog.querySelector('[role="region"]');
  if (!region) throw new Error("missing region");
  return region;
}

describe("FC-007 V2 effects region", () => {
  it("finds exactly one effects region in Stage D dialog", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const dialog = getDialog(doc);
    const region = findExactEffectsRegion(dialog, doc);
    expect(region).toBeInstanceOf(HTMLDivElement);
    expect(region?.getAttribute("tabindex")).toBe("-1");
  });

  it("rejects absent tabindex", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    getRegion(dialog).removeAttribute("tabindex");
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
  });

  it("rejects tabindex=0", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    getRegion(dialog).setAttribute("tabindex", "0");
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
  });

  it("rejects wrong aria-label", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    getRegion(dialog).setAttribute("aria-label", "Wrong label");
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
    getRegion(dialog).setAttribute("aria-label", EFFECTS_ARIA_LABEL);
    expect(findExactEffectsRegion(dialog, doc)).not.toBeNull();
  });

  it("rejects multi-token role", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    getRegion(dialog).setAttribute("role", "region note");
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
  });

  it("rejects duplicate effects regions", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    const clone = getRegion(dialog).cloneNode(true);
    if (clone) dialog.appendChild(clone);
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
  });

  it("rejects generic role=region with wrong label", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "c" });
    const dialog = getDialog(doc);
    const generic = doc.createElement("div");
    generic.setAttribute("role", "region");
    generic.setAttribute("aria-label", "Some other region");
    generic.setAttribute("tabindex", "-1");
    dialog.appendChild(generic);
    expect(findExactEffectsRegion(dialog, doc)).not.toBeNull();
    getRegion(dialog).remove();
    expect(findExactEffectsRegion(dialog, doc)).toBeNull();
  });
});
