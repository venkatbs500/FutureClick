/**
 * Shared DOM builder for FC-007 tests (vitest happy-dom environment).
 * Uses the environment document realm so lib.dom typing and instanceof align.
 */

import type { Fc007RepoIdentity } from "../src/fc007/identity.js";

export const FIXTURE_IDENTITY: Fc007RepoIdentity = {
  ownerDisplay: "fixture-owner",
  ownerNormalized: "fixture-owner",
  repoDisplay: "fixture-repo",
  repoNormalized: "fixture-repo",
  identityKey: "fixture-owner/fixture-repo",
};

export function createFc007SettingsWindow(options?: {
  readonly openDialog?: boolean;
  readonly owner?: string;
  readonly repo?: string;
  readonly lang?: string;
}): {
  readonly window: Window;
  readonly document: Document;
  readonly location: Pick<Location, "protocol" | "hostname" | "port" | "pathname">;
} {
  const owner = options?.owner ?? "fixture-owner";
  const repo = options?.repo ?? "fixture-repo";
  const lang = options?.lang ?? "en";
  const doc = document.implementation.createHTMLDocument("fc007-settings");
  doc.documentElement.lang = lang;
  doc.body.innerHTML = `
    <main>
      <ul>
        <li id="visibility-section">
          <h2>Change repository visibility</h2>
          <div>This repository is currently private.</div>
        </li>
      </ul>
    </main>
    <dialog id="visibility-dialog" aria-modal="true">
      <button type="button" id="dialog-close" aria-label="Close">Close</button>
      <h1>Make ${owner}/${repo} public</h1>
      <p>${owner}/${repo}</p>
      <form id="visibility-form" method="post"
        action="https://github.com/${owner}/${repo}/settings/set_visibility"
        enctype="application/x-www-form-urlencoded">
        <input type="hidden" name="authenticity_token" value="dummy-not-read" />
        <button type="submit" id="final-make-public">Make this repository public</button>
      </form>
      <span>Make this repository public</span>
      <span>Make this repository public</span>
    </dialog>
  `;

  if (options?.openDialog) {
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error("FC007_FIXTURE_DIALOG_MISSING");
    }
    // happy-dom may not implement showModal/:modal; tests inject matchesModal seam.
    dialog.setAttribute("open", "");
    dialog.open = true;
  }

  return {
    window,
    document: doc,
    location: {
      protocol: "https:",
      hostname: "github.com",
      port: "",
      pathname: `/${owner}/${repo}/settings`,
    },
  };
}

/** Test seam: treat open+aria-modal dialogs as :modal (happy-dom lacks :modal). */
export function testMatchesModal(el: Element): boolean {
  return (
    el instanceof HTMLDialogElement && el.open === true && el.getAttribute("aria-modal") === "true"
  );
}

export type Fc007V2StageFixture = "a" | "b" | "c" | "d";

/** Leading structural padding so the visibility widget is visited after element 512. */
export const V2_LIVE_SHAPED_LEADING_PADDING = 520;

function appendLeadingStructuralPadding(main: HTMLElement, doc: Document, count: number): void {
  for (let i = 0; i < count; i += 1) {
    main.appendChild(doc.createElement("span"));
  }
}

function appendDenseProse(main: HTMLElement, doc: Document): void {
  for (let i = 0; i < 350; i += 1) {
    const p = doc.createElement("p");
    p.textContent = `Dense filler prose block ${i} with enough characters to exceed V1 broad text charging when normalized own-text runs on every element.`;
    main.appendChild(p);
  }
}

/**
 * Live-shaped visibility LI: STRONG→DIV→LI, private DIV→DIV→same LI,
 * optional FOCUS-GROUP / ACTION-MENU wrappers (structural only).
 */
export function appendLiveShapedVisibilitySection(
  parent: HTMLElement,
  doc: Document,
  options?: {
    readonly includeChangeControl?: boolean;
    readonly anchorCarrier?: "strong" | "h2" | "role-heading";
    readonly liHopDepth?: number;
  },
): HTMLLIElement {
  const ul = doc.createElement("ul");
  const li = doc.createElement("li");
  li.id = "visibility-section";

  const hopDepth = options?.liHopDepth ?? 2;
  let anchorParent: HTMLElement = li;
  for (let i = 0; i < hopDepth - 1; i += 1) {
    const wrap = doc.createElement("div");
    anchorParent.appendChild(wrap);
    anchorParent = wrap;
  }

  const carrier = options?.anchorCarrier ?? "strong";
  let anchor: HTMLElement;
  if (carrier === "h2") {
    anchor = doc.createElement("h2");
  } else if (carrier === "role-heading") {
    anchor = doc.createElement("div");
    anchor.setAttribute("role", "heading");
  } else {
    anchor = doc.createElement("strong");
  }
  anchor.textContent = "Change repository visibility";
  anchorParent.appendChild(anchor);

  const privateWrap = doc.createElement("div");
  const priv = doc.createElement("div");
  priv.textContent = "This repository is currently private.";
  privateWrap.appendChild(priv);
  li.appendChild(privateWrap);

  if (options?.includeChangeControl !== false) {
    const focusGroup = doc.createElement("focus-group");
    const actionMenu = doc.createElement("action-menu");
    const wrap = doc.createElement("div");
    const button = doc.createElement("button");
    button.type = "button";
    const span = doc.createElement("span");
    span.textContent = "Change visibility";
    button.appendChild(span);
    wrap.appendChild(button);
    actionMenu.appendChild(wrap);
    focusGroup.appendChild(actionMenu);
    li.appendChild(focusGroup);
  }

  ul.appendChild(li);
  parent.appendChild(ul);
  return li;
}

function appendStageDialogContent(
  dialog: HTMLDialogElement,
  stage: Fc007V2StageFixture,
  owner: string,
  repo: string,
): void {
  const doc = dialog.ownerDocument;

  const heading = doc.createElement("h1");
  heading.textContent = `Make ${owner}/${repo} public`;

  const identity = doc.createElement("p");
  identity.textContent = `${owner}/${repo}`;

  const effects = doc.createElement("div");
  effects.setAttribute("role", "region");
  effects.setAttribute("aria-label", "Effects of making this repository public");
  effects.setAttribute("tabindex", "-1");
  const effectsP = doc.createElement("p");
  effectsP.textContent = "Repository will become public.";
  effects.appendChild(effectsP);

  if (stage === "b") {
    dialog.appendChild(heading);
    dialog.appendChild(identity);
    const ack = doc.createElement("button");
    ack.type = "button";
    ack.id = "stage-b-ack";
    ack.textContent = "I want to make this repository public";
    dialog.appendChild(ack);
    return;
  }

  if (stage === "c") {
    dialog.appendChild(heading);
    dialog.appendChild(identity);
    dialog.appendChild(effects);
    const ack = doc.createElement("button");
    ack.type = "button";
    ack.id = "stage-c-ack";
    ack.textContent = "I have read and understand these effects";
    dialog.appendChild(ack);
    return;
  }

  if (stage === "d") {
    dialog.appendChild(heading);
    dialog.appendChild(identity);
    dialog.appendChild(effects);
    const form = doc.createElement("form");
    form.id = "visibility-form";
    form.method = "post";
    form.action = `https://github.com/${owner}/${repo}/settings/set_visibility`;
    form.enctype = "application/x-www-form-urlencoded";
    for (const name of ["authenticity_token", "confirmed", "visibility"] as const) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = "";
      form.appendChild(input);
    }
    const close = doc.createElement("button");
    close.type = "button";
    close.id = "dialog-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "Close";
    form.appendChild(close);
    const submit = doc.createElement("button");
    submit.type = "submit";
    submit.id = "final-make-public";
    submit.textContent = "Make this repository public";
    form.appendChild(submit);
    dialog.appendChild(form);
  }
}

/**
 * V2 fixture: live-shaped STRONG visibility LI after >512 leading elements,
 * form-associated Close, effects region, optional dense prose, 4 dialogs.
 */
export function createFc007V2SettingsWindow(options?: {
  readonly stage?: Fc007V2StageFixture;
  readonly openDialog?: boolean;
  readonly denseProse?: boolean;
  readonly leadingPadding?: number;
  readonly owner?: string;
  readonly repo?: string;
  readonly lang?: string;
}): {
  readonly window: Window;
  readonly document: Document;
  readonly location: Pick<Location, "protocol" | "hostname" | "port" | "pathname">;
} {
  const owner = options?.owner ?? "fixture-owner";
  const repo = options?.repo ?? "fixture-repo";
  const lang = options?.lang ?? "en";
  const stage = options?.stage ?? "d";
  const doc = document.implementation.createHTMLDocument("fc007-v2-settings");
  doc.documentElement.lang = lang;

  const main = doc.createElement("main");
  const leading =
    options?.leadingPadding ?? (options?.denseProse === false ? 0 : V2_LIVE_SHAPED_LEADING_PADDING);
  appendLeadingStructuralPadding(main, doc, leading);
  appendLiveShapedVisibilitySection(main, doc, { includeChangeControl: true });
  if (options?.denseProse !== false) {
    appendDenseProse(main, doc);
  }
  doc.body.appendChild(main);

  for (let i = 0; i < 3; i += 1) {
    const empty = doc.createElement("dialog");
    empty.id = `empty-dialog-${i}`;
    doc.body.appendChild(empty);
  }

  const dialog = doc.createElement("dialog");
  dialog.id = "visibility-dialog";
  dialog.setAttribute("aria-modal", "true");
  // Build via appendChild (not innerHTML) so firstChild/nextSibling chains stay
  // coherent under happy-dom — matches Chromium pointer-traversal expectations.
  appendStageDialogContent(dialog, stage, owner, repo);
  doc.body.appendChild(dialog);

  const shouldOpen = options?.openDialog ?? stage !== "a";
  if (shouldOpen && stage !== "a") {
    dialog.setAttribute("open", "");
    dialog.open = true;
  }

  return {
    window,
    document: doc,
    location: {
      protocol: "https:",
      hostname: "github.com",
      port: "",
      pathname: `/${owner}/${repo}/settings`,
    },
  };
}

export type V2VisibilityMainOptions = {
  readonly leadingPadding?: number;
  readonly trailingPadding?: number;
  readonly anchorCarrier?: "strong" | "h2" | "role-heading";
  readonly liHopDepth?: number;
  readonly includeChangeControl?: boolean;
  readonly omitPrivate?: boolean;
  readonly duplicateStrong?: boolean;
  readonly duplicateHWithStrong?: boolean;
  readonly duplicateRoleWithStrong?: boolean;
  readonly lateDuplicateStrong?: boolean;
  readonly complexDivBeforeTarget?: boolean;
  readonly complexDivOutsideLi?: boolean;
  readonly complexDivInsideLi?: boolean;
  readonly duplicatePrivateInsideLi?: boolean;
  readonly privateOutsideLiOnly?: boolean;
  readonly privateAlsoOutsideLi?: boolean;
  readonly nonLiContainer?: boolean;
  readonly divFallbackNoLi?: boolean;
  readonly anchorChildNodes?: number;
  readonly anchorTextNodes?: number;
  readonly anchorRawUnits?: number;
  readonly anchorTextFillers?: number;
  readonly anchorTextFillerUnits?: number;
  readonly localPaddingElements?: number;
  readonly localTextFillerDivs?: number;
  readonly localTextFillerUnits?: number;
};

/**
 * Minimal / configurable visibility main for FC-007H acquisition tests.
 * Default: live-shaped STRONG carrier with leading padding before the widget.
 */
export function createV2VisibilityMainOnly(options?: V2VisibilityMainOptions): Document {
  const doc = document.implementation.createHTMLDocument("fc007-v2-visibility-main");
  doc.documentElement.lang = "en";
  const main = doc.createElement("main");

  const leading = options?.leadingPadding ?? 0;
  appendLeadingStructuralPadding(main, doc, leading);

  if (options?.complexDivBeforeTarget) {
    const complex = doc.createElement("div");
    for (let i = 0; i < 40; i += 1) {
      complex.appendChild(doc.createElement("span"));
    }
    complex.appendChild(doc.createTextNode("x".repeat(200)));
    main.appendChild(complex);
  }

  if (options?.nonLiContainer || options?.divFallbackNoLi) {
    const container = doc.createElement("div");
    container.id = "visibility-section";
    const strong = doc.createElement("strong");
    strong.textContent = "Change repository visibility";
    const priv = doc.createElement("div");
    priv.textContent = "This repository is currently private.";
    container.appendChild(strong);
    container.appendChild(priv);
    main.appendChild(container);
  } else if (options?.privateOutsideLiOnly) {
    const ul = doc.createElement("ul");
    const li = doc.createElement("li");
    li.id = "visibility-section";
    const wrap = doc.createElement("div");
    const strong = doc.createElement("strong");
    strong.textContent = "Change repository visibility";
    wrap.appendChild(strong);
    li.appendChild(wrap);
    ul.appendChild(li);
    main.appendChild(ul);
    const outside = doc.createElement("div");
    outside.textContent = "This repository is currently private.";
    main.appendChild(outside);
  } else {
    const li = appendLiveShapedVisibilitySection(main, doc, {
      includeChangeControl: options?.includeChangeControl ?? false,
      anchorCarrier: options?.anchorCarrier ?? "strong",
      liHopDepth: options?.liHopDepth ?? 2,
    });

    if (options?.omitPrivate) {
      for (const d of Array.from(li.querySelectorAll("div"))) {
        if (
          d.childNodes.length === 1 &&
          d.textContent === "This repository is currently private."
        ) {
          d.remove();
        }
      }
      // Also remove empty wrapper if left.
      for (const d of Array.from(li.querySelectorAll("div"))) {
        if (d.childElementCount === 0 && (d.textContent ?? "").trim() === "") {
          d.remove();
        }
      }
    }

    if (options?.duplicateStrong) {
      const wrap = doc.createElement("div");
      const dup = doc.createElement("strong");
      dup.textContent = "Change repository visibility";
      wrap.appendChild(dup);
      li.appendChild(wrap);
    }

    if (options?.duplicateHWithStrong) {
      const h2 = doc.createElement("h2");
      h2.textContent = "Change repository visibility";
      li.appendChild(h2);
    }

    if (options?.duplicateRoleWithStrong) {
      const roleEl = doc.createElement("div");
      roleEl.setAttribute("role", "heading");
      roleEl.textContent = "Change repository visibility";
      li.appendChild(roleEl);
    }

    if (options?.duplicatePrivateInsideLi) {
      const wrap = doc.createElement("div");
      const dup = doc.createElement("div");
      dup.textContent = "This repository is currently private.";
      wrap.appendChild(dup);
      li.appendChild(wrap);
    }

    if (options?.complexDivInsideLi) {
      const complex = doc.createElement("div");
      for (let i = 0; i < 40; i += 1) {
        complex.appendChild(doc.createElement("span"));
      }
      li.appendChild(complex);
    }

    if (options?.localPaddingElements) {
      for (let i = 0; i < options.localPaddingElements; i += 1) {
        li.appendChild(doc.createElement("span"));
      }
    }

    if (options?.localTextFillerDivs) {
      const units = options.localTextFillerUnits ?? 150;
      for (let i = 0; i < options.localTextFillerDivs; i += 1) {
        const d = doc.createElement("div");
        d.textContent = "y".repeat(units);
        li.appendChild(d);
      }
    }

    if (
      options?.anchorChildNodes != null ||
      options?.anchorTextNodes != null ||
      options?.anchorRawUnits != null
    ) {
      const anchors = li.querySelectorAll("strong, h1, h2, h3, h4, h5, h6, [role=heading]");
      const target = anchors.item(0);
      if (target) {
        while (target.firstChild) target.removeChild(target.firstChild);
        if (options.anchorRawUnits != null) {
          target.appendChild(doc.createTextNode("z".repeat(options.anchorRawUnits)));
        } else if (options.anchorTextNodes != null) {
          for (let i = 0; i < options.anchorTextNodes; i += 1) {
            target.appendChild(doc.createTextNode("a"));
          }
        } else if (options.anchorChildNodes != null) {
          for (let i = 0; i < options.anchorChildNodes; i += 1) {
            target.appendChild(doc.createElement("span"));
          }
        }
      }
    }
  }

  if (options?.privateAlsoOutsideLi) {
    const outside = doc.createElement("div");
    outside.textContent = "This repository is currently private.";
    main.appendChild(outside);
  }

  if (options?.complexDivOutsideLi) {
    const complex = doc.createElement("div");
    for (let i = 0; i < 40; i += 1) {
      complex.appendChild(doc.createElement("span"));
    }
    complex.appendChild(doc.createTextNode("outside-complex"));
    main.appendChild(complex);
  }

  const fillerCount = options?.anchorTextFillers ?? 0;
  const fillerUnits = options?.anchorTextFillerUnits ?? 150;
  for (let i = 0; i < fillerCount; i += 1) {
    const h = doc.createElement("h3");
    h.textContent = "w".repeat(fillerUnits);
    main.appendChild(h);
  }

  if (options?.lateDuplicateStrong) {
    const wrap = doc.createElement("div");
    const dup = doc.createElement("strong");
    dup.textContent = "Change repository visibility";
    wrap.appendChild(dup);
    main.appendChild(wrap);
  }

  const trailing = options?.trailingPadding ?? 0;
  for (let i = 0; i < trailing; i += 1) {
    main.appendChild(doc.createElement("span"));
  }

  doc.body.appendChild(main);
  return doc;
}

/** Count SHOW_ELEMENT TreeWalker visits under root (including root). */
export function countElementVisits(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let n = 0;
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof Element) n += 1;
    node = walker.nextNode();
  }
  return n;
}

export function getStageDFormRefs(doc: Document): {
  readonly form: HTMLFormElement;
  readonly final: HTMLButtonElement;
  readonly close: HTMLButtonElement;
} {
  const form = doc.getElementById("visibility-form");
  const final = doc.getElementById("final-make-public");
  const close = doc.getElementById("dialog-close");
  if (
    !(form instanceof HTMLFormElement) ||
    !(final instanceof HTMLButtonElement) ||
    !(close instanceof HTMLButtonElement)
  ) {
    throw new Error("FC007_V2_STAGE_D_FORM_MISSING");
  }
  return { form, final, close };
}
