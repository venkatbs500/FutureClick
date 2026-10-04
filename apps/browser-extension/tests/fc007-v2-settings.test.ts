/**
 * FC-007H V2 scoped settings visibility acquisition tests.
 */

import { describe, expect, it } from "vitest";
import {
  MAIN_MAX_ELEMENTS,
  MAIN_MAX_ELEMENTS_V2,
  SETTINGS_ANCHOR_TEXT_MAX,
  VISIBILITY_SECTION_MAX_ELEMENTS,
  VISIBILITY_SECTION_MAX_TEXT_UNITS,
} from "../src/fc007/budget.js";
import { recognizeVisibilitySection } from "../src/fc007/visibility-section.js";
import { recognizeVisibilitySectionV2 } from "../src/fc007/v2/visibility-section-v2.js";
import {
  V2_LIVE_SHAPED_LEADING_PADDING,
  countElementVisits,
  createFc007V2SettingsWindow,
  createV2VisibilityMainOnly,
} from "./fc007-test-dom.js";

describe("FC-007H V2 scoped settings acquisition", () => {
  it("recognizes live-shaped dense main (target after 512); V1 abstains", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "a", openDialog: false });
    const main = doc.querySelector("main");
    expect(main).toBeTruthy();
    if (!main) return;
    expect(countElementVisits(main)).toBeGreaterThan(MAIN_MAX_ELEMENTS);
    expect(countElementVisits(main)).toBeLessThanOrEqual(MAIN_MAX_ELEMENTS_V2);

    const strong = main.querySelector("#visibility-section strong");
    expect(strong).toBeTruthy();
    let visitsBeforeStrong = 0;
    const walker = doc.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node instanceof Element) {
        visitsBeforeStrong += 1;
        if (node === strong) break;
      }
      node = walker.nextNode();
    }
    expect(visitsBeforeStrong).toBeGreaterThan(MAIN_MAX_ELEMENTS);

    const v2 = recognizeVisibilitySectionV2(doc);
    expect(v2.status).toBe("matched");
    if (v2.status === "matched") {
      expect(v2.value.headingElement.tagName.toUpperCase()).toBe("STRONG");
      expect(v2.value.section).toBeInstanceOf(HTMLLIElement);
    }

    const v1 = recognizeVisibilitySection(doc);
    expect(v1.status).toBe("abstain");
  });

  it("accepts main with >512 and <2048 elements", () => {
    const doc = createV2VisibilityMainOnly({
      leadingPadding: V2_LIVE_SHAPED_LEADING_PADDING,
    });
    const main = doc.querySelector("main");
    expect(main).toBeTruthy();
    if (!main) return;
    const visits = countElementVisits(main);
    expect(visits).toBeGreaterThan(MAIN_MAX_ELEMENTS);
    expect(visits).toBeLessThan(MAIN_MAX_ELEMENTS_V2);
    expect(recognizeVisibilitySectionV2(doc).status).toBe("matched");
  });

  it("recognizes STRONG, H2, and exact role=heading carriers", () => {
    expect(
      recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ anchorCarrier: "strong" })).status,
    ).toBe("matched");
    expect(
      recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ anchorCarrier: "h2" })).status,
    ).toBe("matched");
    expect(
      recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ anchorCarrier: "role-heading" }))
        .status,
    ).toBe("matched");
  });

  it("ignores unrelated complex DIV before target (no global DIV semantic read)", () => {
    const doc = createV2VisibilityMainOnly({
      leadingPadding: 10,
      complexDivBeforeTarget: true,
    });
    expect(recognizeVisibilitySectionV2(doc).status).toBe("matched");
  });

  it("does not charge unrelated DIV prose toward global anchor text budget", () => {
    const doc = createV2VisibilityMainOnly({ leadingPadding: 0 });
    const main = doc.querySelector("main");
    expect(main).toBeTruthy();
    if (!main) return;
    for (let i = 0; i < 40; i += 1) {
      const div = doc.createElement("div");
      div.textContent = "x".repeat(150);
      const ul = main.querySelector("ul");
      if (ul) main.insertBefore(div, ul);
      else main.appendChild(div);
    }
    expect(recognizeVisibilitySectionV2(doc).status).toBe("matched");
  });

  it("abstains VISIBILITY_ANCHOR_NOT_UNIQUE on duplicate STRONG", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ duplicateStrong: true }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_ANCHOR_NOT_UNIQUE");
    }
  });

  it("abstains VISIBILITY_ANCHOR_NOT_UNIQUE on STRONG + H duplicate", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ duplicateHWithStrong: true }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_ANCHOR_NOT_UNIQUE");
    }
  });

  it("abstains VISIBILITY_ANCHOR_NOT_UNIQUE on STRONG + role=heading duplicate", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ duplicateRoleWithStrong: true }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_ANCHOR_NOT_UNIQUE");
    }
  });

  it("abstains VISIBILITY_ANCHOR_NOT_UNIQUE on late duplicate STRONG", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ lateDuplicateStrong: true }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_ANCHOR_NOT_UNIQUE");
    }
  });

  it("abstains SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET for >32 childNodes on anchor", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ anchorChildNodes: 33 }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET");
    }
  });

  it("abstains SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET for >8 text nodes on anchor", () => {
    const result = recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ anchorTextNodes: 9 }));
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET");
    }
  });

  it("abstains SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET for >160 raw units on anchor", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ anchorRawUnits: 161 }),
    );
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET");
    }
  });

  it("passes at exact SETTINGS_ANCHOR_TEXT_MAX and abstains at +1", () => {
    const anchorUnits = "Change repository visibility".length;
    const remain = SETTINGS_ANCHOR_TEXT_MAX - anchorUnits;
    const full = Math.floor(remain / 150);
    const last = remain - full * 150;
    const docPass = createV2VisibilityMainOnly({
      anchorTextFillers: full + (last > 0 ? 1 : 0),
      anchorTextFillerUnits: 150,
    });
    // Rebuild fillers precisely: first create base then adjust last filler.
    const mainPass = docPass.querySelector("main");
    expect(mainPass).toBeTruthy();
    if (!mainPass) return;
    for (const h of Array.from(mainPass.querySelectorAll("h3"))) h.remove();
    for (let i = 0; i < full; i += 1) {
      const h = docPass.createElement("h3");
      h.textContent = "w".repeat(150);
      mainPass.appendChild(h);
    }
    if (last > 0) {
      const h = docPass.createElement("h3");
      h.textContent = "w".repeat(last);
      mainPass.appendChild(h);
    }
    expect(recognizeVisibilitySectionV2(docPass).status).toBe("matched");

    const docFail = createV2VisibilityMainOnly({});
    const mainFail = docFail.querySelector("main");
    expect(mainFail).toBeTruthy();
    if (!mainFail) return;
    for (let i = 0; i < full; i += 1) {
      const h = docFail.createElement("h3");
      h.textContent = "w".repeat(150);
      mainFail.appendChild(h);
    }
    const hOver = docFail.createElement("h3");
    hOver.textContent = "w".repeat(last + 1);
    mainFail.appendChild(hOver);
    const fail = recognizeVisibilitySectionV2(docFail);
    expect(fail.status).toBe("abstain");
    if (fail.status === "abstain") {
      expect(fail.reason).toBe("SETTINGS_ANCHOR_TEXT_BUDGET_EXHAUSTED");
    }
  });

  it("passes at exact MAIN_MAX_ELEMENTS_V2 and abstains at +1", () => {
    const docPass = createV2VisibilityMainOnly({});
    const mainPass = docPass.querySelector("main");
    expect(mainPass).toBeTruthy();
    if (!mainPass) return;
    let visits = countElementVisits(mainPass);
    while (visits < MAIN_MAX_ELEMENTS_V2) {
      mainPass.appendChild(docPass.createElement("span"));
      visits += 1;
    }
    expect(countElementVisits(mainPass)).toBe(MAIN_MAX_ELEMENTS_V2);
    expect(recognizeVisibilitySectionV2(docPass).status).toBe("matched");

    const docFail = createV2VisibilityMainOnly({});
    const mainFail = docFail.querySelector("main");
    expect(mainFail).toBeTruthy();
    if (!mainFail) return;
    let v = countElementVisits(mainFail);
    while (v < MAIN_MAX_ELEMENTS_V2 + 1) {
      mainFail.appendChild(docFail.createElement("span"));
      v += 1;
    }
    const fail = recognizeVisibilitySectionV2(docFail);
    expect(fail.status).toBe("abstain");
    if (fail.status === "abstain") {
      expect(fail.reason).toBe("MAIN_ELEMENT_BUDGET_EXHAUSTED");
    }
  });

  it("LI hops: 2 and 4 pass; 5 and no-LI abstain", () => {
    expect(recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ liHopDepth: 2 })).status).toBe(
      "matched",
    );
    expect(recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ liHopDepth: 4 })).status).toBe(
      "matched",
    );
    const hop5 = recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ liHopDepth: 5 }));
    expect(hop5.status).toBe("abstain");
    if (hop5.status === "abstain") {
      expect(hop5.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
    const noLi = recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ nonLiContainer: true }));
    expect(noLi.status).toBe("abstain");
    if (noLi.status === "abstain") {
      expect(noLi.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
    const divOnly = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ divFallbackNoLi: true }),
    );
    expect(divOnly.status).toBe("abstain");
    if (divOnly.status === "abstain") {
      expect(divOnly.reason).toBe("VISIBILITY_CONTAINER_LI_MISMATCH");
    }
  });

  it("private-state uniqueness and outside-LI isolation", () => {
    expect(recognizeVisibilitySectionV2(createV2VisibilityMainOnly({})).status).toBe("matched");

    const zero = recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ omitPrivate: true }));
    expect(zero.status).toBe("abstain");
    if (zero.status === "abstain") {
      expect(zero.reason).toBe("VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE");
    }

    const two = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ duplicatePrivateInsideLi: true }),
    );
    expect(two.status).toBe("abstain");
    if (two.status === "abstain") {
      expect(two.reason).toBe("VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE");
    }

    const outsideOnly = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ privateOutsideLiOnly: true }),
    );
    expect(outsideOnly.status).toBe("abstain");
    if (outsideOnly.status === "abstain") {
      expect(outsideOnly.reason).toBe("VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE");
    }

    // Extra private outside LI must not affect recognition when LI has exactly one.
    expect(
      recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ privateAlsoOutsideLi: true }))
        .status,
    ).toBe("matched");
  });

  it("complex DIV outside LI irrelevant; inside LI abstains", () => {
    expect(
      recognizeVisibilitySectionV2(createV2VisibilityMainOnly({ complexDivOutsideLi: true }))
        .status,
    ).toBe("matched");
    const inside = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ complexDivInsideLi: true }),
    );
    expect(inside.status).toBe("abstain");
    if (inside.status === "abstain") {
      expect(inside.reason).toBe("VISIBILITY_LOCAL_OWN_TEXT_OVER_BUDGET");
    }
  });

  it("local element cap 48 pass / 49 abstain", () => {
    const docPass = createV2VisibilityMainOnly({ includeChangeControl: true });
    const liPass = docPass.getElementById("visibility-section");
    expect(liPass).toBeTruthy();
    if (!(liPass instanceof HTMLLIElement)) return;
    let visits = countElementVisits(liPass);
    while (visits < VISIBILITY_SECTION_MAX_ELEMENTS) {
      liPass.appendChild(docPass.createElement("span"));
      visits += 1;
    }
    expect(countElementVisits(liPass)).toBe(VISIBILITY_SECTION_MAX_ELEMENTS);
    expect(recognizeVisibilitySectionV2(docPass).status).toBe("matched");

    const docFail = createV2VisibilityMainOnly({ includeChangeControl: true });
    const liFail = docFail.getElementById("visibility-section");
    expect(liFail).toBeTruthy();
    if (!(liFail instanceof HTMLLIElement)) return;
    let v = countElementVisits(liFail);
    while (v < VISIBILITY_SECTION_MAX_ELEMENTS + 1) {
      liFail.appendChild(docFail.createElement("span"));
      v += 1;
    }
    const fail = recognizeVisibilitySectionV2(docFail);
    expect(fail.status).toBe("abstain");
    if (fail.status === "abstain") {
      expect(fail.reason).toBe("VISIBILITY_LOCAL_ELEMENT_BUDGET_EXHAUSTED");
    }
  });

  it("local text cap exact pass / +1 abstain", () => {
    const privateUnits = "This repository is currently private.".length;
    const remain = VISIBILITY_SECTION_MAX_TEXT_UNITS - privateUnits;
    const full = Math.floor(remain / 150);
    const last = remain - full * 150;

    const docPass = createV2VisibilityMainOnly({});
    const liPass = docPass.getElementById("visibility-section");
    expect(liPass).toBeTruthy();
    if (!(liPass instanceof HTMLLIElement)) return;
    for (let i = 0; i < full; i += 1) {
      const d = docPass.createElement("div");
      d.textContent = "y".repeat(150);
      liPass.appendChild(d);
    }
    if (last > 0) {
      const d = docPass.createElement("div");
      d.textContent = "y".repeat(last);
      liPass.appendChild(d);
    }
    expect(recognizeVisibilitySectionV2(docPass).status).toBe("matched");

    const docFail = createV2VisibilityMainOnly({});
    const liFail = docFail.getElementById("visibility-section");
    expect(liFail).toBeTruthy();
    if (!(liFail instanceof HTMLLIElement)) return;
    for (let i = 0; i < full; i += 1) {
      const d = docFail.createElement("div");
      d.textContent = "y".repeat(150);
      liFail.appendChild(d);
    }
    const over = docFail.createElement("div");
    over.textContent = "y".repeat(last + 1);
    liFail.appendChild(over);
    const fail = recognizeVisibilitySectionV2(docFail);
    expect(fail.status).toBe("abstain");
    if (fail.status === "abstain") {
      expect(fail.reason).toBe("VISIBILITY_LOCAL_TEXT_BUDGET_EXHAUSTED");
    }
  });

  it("FOCUS-GROUP / ACTION-MENU structural wrappers do not fail Stage A", () => {
    const result = recognizeVisibilitySectionV2(
      createV2VisibilityMainOnly({ includeChangeControl: true }),
    );
    expect(result.status).toBe("matched");
  });

  it("VISIBILITY_ANCHOR_NOT_FOUND when no exact anchor", () => {
    const doc = createV2VisibilityMainOnly({});
    const strong = doc.querySelector("strong");
    if (strong) strong.textContent = "Other heading";
    const result = recognizeVisibilitySectionV2(doc);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("VISIBILITY_ANCHOR_NOT_FOUND");
    }
  });
});
