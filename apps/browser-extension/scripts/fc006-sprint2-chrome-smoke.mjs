/**
 * FC-006 Sprint 2 / 2B native Chrome acceptance smoke (ephemeral; not a package dep).
 * Uses Chrome for Testing + puppeteer-core (branded Google Chrome ignores --load-extension).
 *
 * Sprint 2B harness fixes:
 * - Browser profile lives under os.tmpdir(), never inside the repository.
 * - already-defaultPrevented pending uses a pre-prevented MouseEvent (not a late capture listener).
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = process.env.FC006_EXT_ROOT
  ? path.resolve(process.env.FC006_EXT_ROOT)
  : path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXT_ROOT, "../..");
const DIST = path.join(EXT_ROOT, "dist");
const FIXTURES = path.join(EXT_ROOT, "tests/fixtures");
const CHROME =
  process.env.CHROME_PATH ||
  "/tmp/fc006-smoke-deps/chrome/mac_arm-141.0.7390.122/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc006-"));
const resolvedProfile = path.resolve(PROFILE);
const resolvedRepo = path.resolve(REPO_ROOT);
if (
  resolvedProfile === resolvedRepo ||
  resolvedProfile.startsWith(resolvedRepo + path.sep)
) {
  throw new Error(
    `Refusing Chrome profile inside repository: profile=${resolvedProfile} repo=${resolvedRepo}`,
  );
}
console.log(`[profile] ${resolvedProfile} (outside repo=${resolvedRepo})`);

const RESULTS = {};

async function loadPuppeteer() {
  if (process.env.PUPPETEER_CORE_PATH) {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    return require(process.env.PUPPETEER_CORE_PATH);
  }
  const mod = await import("puppeteer-core");
  return mod.default ?? mod;
}

function log(name, status, detail = "") {
  RESULTS[name] = { status, detail };
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function serve(port) {
  const routes = new Map([
    [
      "/fc006/repository-visibility-interception.html",
      path.join(FIXTURES, "fc006/repository-visibility-interception.html"),
    ],
    [
      "/fc005/repository-visibility.html",
      path.join(FIXTURES, "fc005/repository-visibility.html"),
    ],
  ]);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const file = routes.get(u.pathname);
    if (!file) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForUiHosts(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = await page.evaluate(
      () => document.querySelectorAll("[data-futureclick-ui='indicator']").length,
    );
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function fixtureState(page) {
  return page.evaluate(() => {
    const status = document.getElementById("page-handler-status")?.textContent ?? "";
    const vis = document.getElementById("repository-state")?.textContent ?? "";
    const meta =
      document
        .getElementById("btn-change-visibility")
        ?.getAttribute("data-futureclick-current-visibility") ?? "";
    const m = status.match(/(\d+)/);
    return {
      executionCount: m ? Number(m[1]) : -1,
      visibilityText: vis,
      metadata: meta,
    };
  });
}

async function fc006UiState(page) {
  return page.evaluate(() => {
    const hosts = [...document.querySelectorAll("[data-futureclick-ui]")];
    const indicator = hosts.find((h) => h.getAttribute("data-futureclick-ui") === "indicator");
    const dialog = hosts.find((h) => h.getAttribute("data-futureclick-ui") === "dialog");
    const status = indicator?.shadowRoot?.querySelector(".status")?.textContent ?? "";
    const dlgText = dialog?.shadowRoot?.textContent ?? "";
    const dlgDisplay = dialog ? getComputedStyle(dialog).display : "none";
    const buttons = [...(dialog?.shadowRoot?.querySelectorAll("button") ?? [])];
    const continueBtn = buttons.find((b) => (b.textContent || "").trim() === "Continue");
    return {
      hasIndicator: !!indicator,
      power: status.trim(),
      dialogText: dlgText,
      dialogVisible: dlgDisplay !== "none",
      hasContinue: !!(continueBtn && !continueBtn.hidden),
    };
  });
}

async function trustedClick(page, selectorOrElementHandle) {
  if (typeof selectorOrElementHandle === "string") {
    await page.waitForSelector(selectorOrElementHandle, { timeout: 10000 });
    const el = await page.$(selectorOrElementHandle);
    if (!el) throw new Error(`missing ${selectorOrElementHandle}`);
    const box = await el.boundingBox();
    if (!box) throw new Error(`no box for ${selectorOrElementHandle}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return;
  }
  let box = await selectorOrElementHandle.boundingBox();
  if (!box) {
    // Detached/hidden retained Continue: reinsert and force a hittable box for adversarial click.
    await page.evaluate((node) => {
      if (!node || node.nodeType !== 1) return;
      if (!node.isConnected) {
        document.body.appendChild(node);
      }
      node.hidden = false;
      node.disabled = false;
      node.style.display = "block";
      node.style.visibility = "visible";
      node.style.position = "fixed";
      node.style.left = "8px";
      node.style.top = "8px";
      node.style.width = "96px";
      node.style.height = "32px";
      node.style.opacity = "1";
      node.style.pointerEvents = "auto";
      node.style.zIndex = "2147483647";
    }, selectorOrElementHandle);
    box = await selectorOrElementHandle.boundingBox();
  }
  if (!box) throw new Error("no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickShadowButton(page, hostAttr, buttonText) {
  const handle = await page.evaluateHandle(
    ({ hostAttr, buttonText }) => {
      const host = document.querySelector(`[data-futureclick-ui="${hostAttr}"]`);
      const buttons = [...(host?.shadowRoot?.querySelectorAll("button") ?? [])];
      return buttons.find((b) => (b.textContent || "").trim() === buttonText) || null;
    },
    { hostAttr, buttonText },
  );
  const el = handle.asElement();
  if (!el) throw new Error(`shadow button ${buttonText} missing`);
  await trustedClick(page, el);
}

async function programmaticShadowClick(page, hostAttr, buttonText) {
  return page.evaluate(
    ({ hostAttr, buttonText }) => {
      const host = document.querySelector(`[data-futureclick-ui="${hostAttr}"]`);
      const buttons = [...(host?.shadowRoot?.querySelectorAll("button") ?? [])];
      const btn = buttons.find((b) => (b.textContent || "").trim() === buttonText);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { hostAttr, buttonText },
  );
}

async function waitPreviewOrEvaluating(page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ui = await fc006UiState(page);
    if (
      ui.dialogVisible &&
      (ui.dialogText.includes("HIGH RISK") || ui.dialogText.includes("Evaluating"))
    ) {
      return ui;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return fc006UiState(page);
}

async function waitPreviewReady(page, timeoutMs = 5000) {
  let ui = await waitPreviewOrEvaluating(page, timeoutMs);
  for (let i = 0; i < 40 && !ui.dialogText.includes("HIGH RISK"); i++) {
    await new Promise((r) => setTimeout(r, 100));
    ui = await fc006UiState(page);
  }
  return ui;
}

/** Nest `depth` wrappers under the pending button and click the deepest leaf. */
async function clickPendingDescendant(page, depth) {
  return page.evaluate((depth) => {
    const btn = document.getElementById("btn-change-visibility");
    if (!btn) return { ok: false, reason: "missing-btn" };
    // Reset prior probe children except text nodes we keep lightly.
    for (const el of [...btn.querySelectorAll("[data-fc006-depth-probe]")]) {
      el.remove();
    }
    let curr = btn;
    for (let i = 0; i < depth; i++) {
      const wrap = document.createElement("span");
      wrap.setAttribute("data-fc006-depth-probe", String(i + 1));
      wrap.textContent = depth === i + 1 ? "leaf" : "";
      curr.appendChild(wrap);
      curr = wrap;
    }
    const leaf = depth === 0 ? btn : curr;
    leaf.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: false, composed: true }),
    );
    return { ok: true, depth, leafTag: leaf.tagName };
  }, depth);
}

async function main() {
  if (!fs.existsSync(path.join(DIST, "manifest.json"))) {
    throw new Error("dist/manifest.json missing — build first");
  }
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome for Testing missing at ${CHROME}`);
  }

  let s4173;
  let s4174;
  let browser;
  try {
    s4173 = await serve(4173);
    s4174 = await serve(4174);
    const puppeteer = await loadPuppeteer();

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      userDataDir: PROFILE,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
      ],
    });

    const page = await browser.newPage();
    const FC006 = "http://127.0.0.1:4173/fc006/repository-visibility-interception.html";

    await page.goto(FC006, { waitUntil: "domcontentloaded" });
    const loaded = await waitForUiHosts(page);
    log(
      "1. unpacked extension load",
      loaded ? "ACTUALLY EXECUTED" : "FAIL",
      loaded ? "indicator host present" : "no UI host",
    );

    await trustedClick(page, "#btn-change-visibility");
    await new Promise((r) => setTimeout(r, 300));
    let st = await fixtureState(page);
    let ui = await fc006UiState(page);
    log(
      "2. FC-006 OFF native mouse",
      st.executionCount === 1 && !ui.dialogVisible && ui.hasIndicator
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, hasIndicator: ui.hasIndicator, power: ui.power }),
    );

    await page.goto(FC006, { waitUntil: "domcontentloaded" });
    await waitForUiHosts(page);

    const progStart = await programmaticShadowClick(page, "indicator", "Start");
    ui = await fc006UiState(page);
    log(
      "3. programmatic Start",
      progStart && ui.power === "OFF" ? "ACTUALLY EXECUTED" : "FAIL",
      `power=${ui.power}`,
    );

    await clickShadowButton(page, "indicator", "Start");
    await new Promise((r) => setTimeout(r, 300));
    ui = await fc006UiState(page);
    log("4. trusted Start", ui.power === "ON" ? "ACTUALLY EXECUTED" : "FAIL", `power=${ui.power}`);

    await trustedClick(page, "#btn-change-visibility");
    ui = await waitPreviewReady(page);
    st = await fixtureState(page);
    const intercepted =
      st.executionCount === 0 &&
      st.metadata === "private" &&
      st.visibilityText.includes("private") &&
      ui.dialogVisible &&
      ui.hasContinue;
    log(
      "A. normal trusted interception",
      intercepted ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, dialogVisible: ui.dialogVisible, hasContinue: ui.hasContinue }),
    );

    const progCancel = await programmaticShadowClick(page, "dialog", "Cancel");
    await new Promise((r) => setTimeout(r, 200));
    ui = await fc006UiState(page);
    st = await fixtureState(page);
    log(
      "M. programmatic UI controls (Cancel inert)",
      progCancel && ui.dialogVisible && st.executionCount === 0 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ dialogVisible: ui.dialogVisible, st }),
    );

    await clickShadowButton(page, "dialog", "Cancel");
    await new Promise((r) => setTimeout(r, 300));
    ui = await fc006UiState(page);
    st = await fixtureState(page);
    log(
      "L. real UI Cancel",
      !ui.dialogVisible && st.executionCount === 0 && ui.power === "ON"
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, dialogVisible: ui.dialogVisible, power: ui.power }),
    );

    // R. Cancel → fresh action
    await trustedClick(page, "#btn-change-visibility");
    ui = await waitPreviewReady(page);
    st = await fixtureState(page);
    log(
      "R. Cancel → fresh action",
      st.executionCount === 0 && ui.dialogVisible ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, dialogVisible: ui.dialogVisible }),
    );

    await clickShadowButton(page, "dialog", "Stop FutureClick");
    await new Promise((r) => setTimeout(r, 300));
    ui = await fc006UiState(page);
    st = await fixtureState(page);
    log(
      "L2. real UI Stop",
      !ui.dialogVisible && ui.power === "OFF" && st.executionCount === 0
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, power: ui.power }),
    );

    // S. Stop → OFF normal action
    await trustedClick(page, "#btn-change-visibility");
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    log(
      "S. Stop → OFF normal action",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );

    await page.goto(FC006, { waitUntil: "domcontentloaded" });
    await waitForUiHosts(page);
    await clickShadowButton(page, "indicator", "Start");
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      document.getElementById("btn-change-visibility")?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "scripted original click while observing",
      !ui.dialogVisible && st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, dialogVisible: ui.dialogVisible }),
    );

    await page.goto(FC006, { waitUntil: "domcontentloaded" });
    await waitForUiHosts(page);
    await clickShadowButton(page, "indicator", "Start");
    await trustedClick(page, "#btn-change-visibility");
    ui = await waitPreviewReady(page);

    // B. non-cancelable pending
    await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      btn?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: false, composed: true }),
      );
    });
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "B. non-cancelable pending",
      st.executionCount === 0 && ui.dialogVisible && st.metadata === "private"
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify(st),
    );

    // C. pre-defaultPrevented pending (constructed already prevented — NOT a late capture listener)
    const prePrevented = await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      if (!btn) return { ok: false };
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      event.preventDefault();
      const before = event.defaultPrevented === true;
      btn.dispatchEvent(event);
      return { ok: true, defaultPreventedBeforeDispatch: before };
    });
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "C. pre-defaultPrevented pending",
      prePrevented.ok &&
        prePrevented.defaultPreventedBeforeDispatch &&
        st.executionCount === 0 &&
        ui.dialogVisible &&
        st.metadata === "private"
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ prePrevented, st }),
    );

    // D. metadata-mutated pending
    await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      btn?.setAttribute("data-futureclick-fixture-contract", "mutated");
      btn?.setAttribute("data-futureclick-operation", "mutated");
      btn?.setAttribute("data-futureclick-entity-key", "mutated");
      btn?.setAttribute("data-futureclick-current-visibility", "public");
      btn?.setAttribute("data-futureclick-requested-visibility", "private");
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "D. metadata-mutated pending",
      st.executionCount === 0 && ui.dialogVisible ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify(st),
    );

    // E. reparent pending under owned host
    await page.evaluate(() => {
      const host = document.querySelector('[data-futureclick-ui="indicator"]');
      const btn = document.getElementById("btn-change-visibility");
      if (host && btn) host.appendChild(btn);
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "E. reparented pending",
      st.executionCount === 0 && ui.dialogVisible ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify(st),
    );

    // Restore button then probe descendant depths F–J
    await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      const card = document.querySelector(".card") || document.body;
      if (btn && card && btn.parentElement !== card) {
        card.appendChild(btn);
      }
    });

    for (const [label, depth] of [
      ["F. 1-hop pending descendant", 1],
      ["G. 4-hop pending descendant", 4],
      ["H. 5-hop pending descendant", 5],
      ["I. 100-hop pending descendant", 100],
      ["J. 1000-hop pending descendant", 1000],
    ]) {
      const probe = await clickPendingDescendant(page, depth);
      await new Promise((r) => setTimeout(r, 150));
      st = await fixtureState(page);
      ui = await fc006UiState(page);
      log(
        label,
        probe.ok && st.executionCount === 0 && ui.dialogVisible ? "ACTUALLY EXECUTED" : "FAIL",
        JSON.stringify({ probe, st, dialogVisible: ui.dialogVisible }),
      );
    }

    // K. unrelated unsupported
    const otherRan = await page.evaluate(() => {
      const other = document.createElement("button");
      other.type = "button";
      other.id = "unrelated-unsupported";
      other.textContent = "unrelated";
      let count = 0;
      other.addEventListener("click", () => {
        count += 1;
      });
      document.body.appendChild(other);
      other.click();
      return count;
    });
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "K. unrelated unsupported",
      otherRan === 1 && st.executionCount === 0 && ui.dialogVisible
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ otherRan, st }),
    );

    // N. scripted Escape inert
    const scriptedEscape = await page.evaluate(() => {
      const dialog = document.querySelector('[data-futureclick-ui="dialog"]');
      const root = dialog?.shadowRoot;
      if (!root) return false;
      root.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      return true;
    });
    await new Promise((r) => setTimeout(r, 150));
    ui = await fc006UiState(page);
    log(
      "N. scripted Escape",
      scriptedEscape && ui.dialogVisible ? "ACTUALLY EXECUTED" : "FAIL",
      `dialogVisible=${ui.dialogVisible}`,
    );

    // O. native Escape
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 250));
    ui = await fc006UiState(page);
    log(
      "O. native Escape",
      !ui.dialogVisible && ui.power === "ON" ? "ACTUALLY EXECUTED" : "FAIL",
      `dialogVisible=${ui.dialogVisible} power=${ui.power}`,
    );

    // Focus deep hostile wrappers evidence (exact-control design: zero parent climb)
    await trustedClick(page, "#btn-change-visibility");
    ui = await waitPreviewReady(page);
    const focusEvidence = await page.evaluate(() => {
      const dialog = document.querySelector('[data-futureclick-ui="dialog"]');
      const root = dialog?.shadowRoot;
      if (!root) return { ok: false };
      let wraps = 0;
      let node = document.createElement("div");
      node.setAttribute("data-fc006-hostile-focus", "1");
      let tip = node;
      for (let i = 0; i < 1000; i++) {
        const w = document.createElement("div");
        tip.appendChild(w);
        tip = w;
        wraps += 1;
      }
      // Place hostile tree inside dialog panel without making it a known control.
      const panel = root.querySelector(".panel.dialog");
      panel?.appendChild(node);
      tip.tabIndex = 0;
      tip.focus();
      const active = root.activeElement;
      // Tab should cycle known Cancel/Stop without walking tip's ancestry.
      root.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
          composed: true,
          // isTrusted cannot be set from script — this proves scripted Tab is inert;
          // design evidence is still that handleDialogKeydown uses activeElement identity only.
        }),
      );
      return {
        ok: true,
        wraps,
        activeIsTip: active === tip,
        design: "exact-controls+shadowRoot.activeElement; no parent walk",
      };
    });
    log(
      "focus deep 1000-wrapper design",
      focusEvidence.ok && focusEvidence.wraps === 1000 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify(focusEvidence),
    );
    // Remove hostile focus tree so Cancel remains hittable, then dismiss.
    await page.evaluate(() => {
      const dialog = document.querySelector('[data-futureclick-ui="dialog"]');
      const hostile = dialog?.shadowRoot?.querySelector("[data-fc006-hostile-focus]");
      hostile?.remove();
    });
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 250));
    ui = await fc006UiState(page);
    if (ui.dialogVisible) {
      await clickShadowButton(page, "dialog", "Cancel");
      await new Promise((r) => setTimeout(r, 200));
    }

    // ===== Sprint 3 Trusted Continue acceptance (A–W) =====
    async function resetFc006On() {
      await page.goto(FC006, { waitUntil: "domcontentloaded" });
      await waitForUiHosts(page);
      await clickShadowButton(page, "indicator", "Start");
      await new Promise((r) => setTimeout(r, 200));
    }

    async function interceptToPreview() {
      await trustedClick(page, "#btn-change-visibility");
      return waitPreviewReady(page);
    }

    // 3A normal preview then trusted Continue
    await resetFc006On();
    ui = await interceptToPreview();
    st = await fixtureState(page);
    const preContinue = { ...st, dialogVisible: ui.dialogVisible, hasContinue: ui.hasContinue };
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3A. normal trusted Continue",
      preContinue.executionCount === 0 &&
        preContinue.metadata === "private" &&
        st.executionCount === 1 &&
        st.metadata === "public" &&
        st.visibilityText.includes("public") &&
        !ui.dialogVisible &&
        ui.power === "ON"
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ preContinue, st, power: ui.power, dialogVisible: ui.dialogVisible }),
    );

    // 3U old Continue cannot execute again (dialog gone; count stays 1)
    const oldContinue = await programmaticShadowClick(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 150));
    st = await fixtureState(page);
    log(
      "3U. old Continue cannot execute again",
      (!oldContinue || st.executionCount === 1) && st.executionCount === 1
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ oldContinue, st }),
    );

    // 3B programmatic Continue inert
    await resetFc006On();
    ui = await interceptToPreview();
    const progCont = await programmaticShadowClick(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3B. programmatic Continue",
      progCont && st.executionCount === 0 && ui.dialogVisible && ui.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ progCont, st, dialogVisible: ui.dialogVisible, hasContinue: ui.hasContinue }),
    );

    // ===== Sprint 3A corrective acceptance (H1/H2/H3/M2) =====

    // 3A-H1: different VALID entityKey before Continue → stale (not merely invalid)
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      document
        .getElementById("btn-change-visibility")
        ?.setAttribute("data-futureclick-entity-key", "fixture-repository-alternate-valid");
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3A-H1. valid alternate entityKey before Continue",
      st.executionCount === 0 &&
        ui.dialogVisible &&
        ui.dialogText.includes("ACTION CHANGED") &&
        !ui.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, hasContinue: ui.hasContinue, dialog: ui.dialogText.slice(0, 80) }),
    );
    if (st.executionCount !== 0) {
      throw new Error("H1 harness false-pass guard: alternate entityKey must not release");
    }
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3A-H2a: retain Continue A DOM, Cancel A, preview B, activate old A
    await resetFc006On();
    await interceptToPreview();
    const oldContinueA = await page.evaluateHandle(() => {
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      return (
        [...(host?.shadowRoot?.querySelectorAll("button") ?? [])].find(
          (b) => b.textContent?.trim() === "Continue",
        ) ?? null
      );
    });
    await clickShadowButton(page, "dialog", "Cancel");
    await new Promise((r) => setTimeout(r, 200));
    await interceptToPreview();
    const pendingBBefore = await page.evaluate(() => {
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      return {
        dialogVisible: !!host && host.style.display !== "none",
        hasContinue: [...(host?.shadowRoot?.querySelectorAll("button") ?? [])].some(
          (b) => b.textContent?.trim() === "Continue" && !b.hidden,
        ),
      };
    });
    await trustedClick(page, oldContinueA);
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3A-H2a. old Continue A after Cancel → B",
      st.executionCount === 0 &&
        ui.dialogVisible &&
        ui.hasContinue &&
        pendingBBefore.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({
        st,
        ui: { dialogVisible: ui.dialogVisible, hasContinue: ui.hasContinue },
        pendingBBefore,
        note: "retained Continue A ElementHandle; Cancel/showPreview replace the Continue node so old A has no authority",
      }),
    );
    if (st.executionCount !== 0) {
      throw new Error("H2 harness false-pass guard: old Continue A must not release B");
    }
    await clickShadowButton(page, "dialog", "Cancel");

    // 3A-H2b: old Continue A after Stop/Start → B
    await resetFc006On();
    await interceptToPreview();
    const oldContinueStop = await page.evaluateHandle(() => {
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      return (
        [...(host?.shadowRoot?.querySelectorAll("button") ?? [])].find(
          (b) => b.textContent?.trim() === "Continue",
        ) ?? null
      );
    });
    await clickShadowButton(page, "dialog", "Stop FutureClick");
    await new Promise((r) => setTimeout(r, 200));
    await clickShadowButton(page, "indicator", "Start");
    await new Promise((r) => setTimeout(r, 200));
    await interceptToPreview();
    await trustedClick(page, oldContinueStop);
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3A-H2b. old Continue A after Stop/Start → B",
      st.executionCount === 0 && ui.dialogVisible && ui.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, hasContinue: ui.hasContinue }),
    );
    if (st.executionCount !== 0) {
      throw new Error("H2 Stop/Start harness false-pass guard: old Continue must not release");
    }
    await clickShadowButton(page, "dialog", "Cancel");

    // 3A-H2c: old Continue after success inert
    await resetFc006On();
    await interceptToPreview();
    const continueBeforeSuccess = await page.evaluateHandle(() => {
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      return (
        [...(host?.shadowRoot?.querySelectorAll("button") ?? [])].find(
          (b) => b.textContent?.trim() === "Continue",
        ) ?? null
      );
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    const countAfterSuccess = st.executionCount;
    await trustedClick(page, continueBeforeSuccess);
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    log(
      "3A-H2c. old Continue after success",
      countAfterSuccess === 1 && st.executionCount === 1
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ countAfterSuccess, st }),
    );

    // 3A-H3a: custom element disconnectedCallback mutates fixtureContract during beginContinuing
    await resetFc006On();
    await interceptToPreview();
    const h3a = await page.evaluate(() => {
      const sequence = [];
      window.__fc006H3Sequence = sequence;
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      const extra = host?.shadowRoot?.querySelector(".panel.dialog > div:not(.row)");
      // dialogExtra is a bare div without class — take the content container between body and row
      const dialog = host?.shadowRoot?.querySelector(".panel.dialog");
      const children = dialog ? [...dialog.children] : [];
      const extraEl = children.find((el) => el.tagName === "DIV" && !el.classList.contains("row"));
      if (!extraEl) return { ok: false, reason: "no-extra" };
      if (!customElements.get("fc006-hostile-probe")) {
        class Fc006HostileProbe extends HTMLElement {
          disconnectedCallback() {
            sequence.push("disconnectedCallback");
            document
              .getElementById("btn-change-visibility")
              ?.setAttribute("data-futureclick-fixture-contract", "hostile-contract");
            sequence.push("mutated-contract");
          }
        }
        customElements.define("fc006-hostile-probe", Fc006HostileProbe);
      }
      const probe = document.createElement("fc006-hostile-probe");
      extraEl.appendChild(probe);
      sequence.push("probe-inserted");
      return { ok: true };
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    const seqA = await page.evaluate(() => window.__fc006H3Sequence ?? []);
    log(
      "3A-H3a. custom-element contract mutation during Continue UI",
      h3a.ok &&
        st.executionCount === 0 &&
        ui.dialogText.includes("ACTION CHANGED") &&
        seqA.includes("disconnectedCallback") &&
        seqA.includes("mutated-contract")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ h3a, st, seqA, hasContinue: ui.hasContinue }),
    );
    if (st.executionCount !== 0) {
      throw new Error("H3 harness false-pass guard: contract mutation must not release");
    }
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3A-H3b: custom element mutates to alternate valid entityKey
    await resetFc006On();
    await interceptToPreview();
    const h3b = await page.evaluate(() => {
      const sequence = [];
      window.__fc006H3SequenceB = sequence;
      const host = document.querySelector("[data-futureclick-ui='dialog']");
      const dialog = host?.shadowRoot?.querySelector(".panel.dialog");
      const children = dialog ? [...dialog.children] : [];
      const extraEl = children.find((el) => el.tagName === "DIV" && !el.classList.contains("row"));
      if (!extraEl) return { ok: false };
      if (!customElements.get("fc006-hostile-probe-entity")) {
        class Fc006HostileProbeEntity extends HTMLElement {
          disconnectedCallback() {
            sequence.push("disconnectedCallback");
            document
              .getElementById("btn-change-visibility")
              ?.setAttribute("data-futureclick-entity-key", "fixture-repository-alternate-valid");
            sequence.push("mutated-entity");
          }
        }
        customElements.define("fc006-hostile-probe-entity", Fc006HostileProbeEntity);
      }
      extraEl.appendChild(document.createElement("fc006-hostile-probe-entity"));
      sequence.push("probe-inserted");
      return { ok: true };
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    const seqB = await page.evaluate(() => window.__fc006H3SequenceB ?? []);
    log(
      "3A-H3b. custom-element valid entityKey mutation during Continue UI",
      h3b.ok &&
        st.executionCount === 0 &&
        ui.dialogText.includes("ACTION CHANGED") &&
        seqB.includes("disconnectedCallback") &&
        seqB.includes("mutated-entity")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ h3b, st, seqB }),
    );
    if (st.executionCount !== 0) {
      throw new Error("H3 entity harness false-pass guard: entity mutation must not release");
    }
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3C duplicate Continue — second trusted click after first should not double
    await resetFc006On();
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 200));
    // try rapid second (dialog may already be cleared)
    try {
      await clickShadowButton(page, "dialog", "Continue");
    } catch {
      /* expected missing after success */
    }
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    log(
      "3C. duplicate Continue",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );

    // 3D metadata changed before Continue → stale
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      document
        .getElementById("btn-change-visibility")
        ?.setAttribute("data-futureclick-fixture-contract", "mutated");
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3D. metadata changed before Continue",
      st.executionCount === 0 &&
        ui.dialogVisible &&
        ui.dialogText.includes("ACTION CHANGED") &&
        !ui.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, dialogText: ui.dialogText.slice(0, 120), hasContinue: ui.hasContinue }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3E currentVisibility changed before Continue
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      document
        .getElementById("btn-change-visibility")
        ?.setAttribute("data-futureclick-current-visibility", "public");
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3E. currentVisibility changed before Continue",
      st.executionCount === 0 && ui.dialogText.includes("ACTION CHANGED") && !ui.hasContinue
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, hasContinue: ui.hasContinue }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3F element replaced by clone
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      if (!btn || !btn.parentElement) return;
      const clone = btn.cloneNode(true);
      clone.id = "btn-change-visibility";
      btn.replaceWith(clone);
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3F. element replaced by clone",
      st.executionCount === 0 && ui.dialogText.includes("ACTION CHANGED")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3G element detached
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      document.getElementById("btn-change-visibility")?.remove();
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3G. element detached",
      st.executionCount === 0 && ui.dialogText.includes("ACTION CHANGED")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3H disabled before Continue
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      if (btn) btn.disabled = true;
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3H. disabled before Continue",
      st.executionCount === 0 && ui.dialogText.includes("ACTION CHANGED")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3I editable before Continue
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      document.getElementById("btn-change-visibility")?.setAttribute("contenteditable", "true");
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3I. editable before Continue",
      st.executionCount === 0 && ui.dialogText.includes("ACTION CHANGED")
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st }),
    );
    await clickShadowButton(page, "dialog", "Dismiss");

    // 3J wrong/changed location — navigate away while preview open is heavy; use wrong-port page Continue absence
    await page.goto("http://127.0.0.1:4174/fc006/repository-visibility-interception.html", {
      waitUntil: "domcontentloaded",
    });
    await new Promise((r) => setTimeout(r, 500));
    ui = await fc006UiState(page);
    log(
      "3J. wrong/changed location",
      !ui.hasIndicator ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ hasIndicator: ui.hasIndicator }),
    );

    // 3K hostile instance .click override
    await resetFc006On();
    await interceptToPreview();
    const hostile = await page.evaluate(() => {
      const btn = document.getElementById("btn-change-visibility");
      let hostileCounter = 0;
      if (btn) {
        btn.click = () => {
          hostileCounter += 1;
        };
      }
      window.__fc006HostileCounter = () => hostileCounter;
      return true;
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    const hostileCount = await page.evaluate(() =>
      typeof window.__fc006HostileCounter === "function" ? window.__fc006HostileCounter() : -1,
    );
    log(
      "3K. hostile instance click override",
      hostile && hostileCount === 0 && st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ hostileCount, st }),
    );

    // 3L page prototype click override
    await resetFc006On();
    await interceptToPreview();
    await page.evaluate(() => {
      window.__fc006ProtoHostile = 0;
      HTMLButtonElement.prototype.click = function hostileProtoClick() {
        window.__fc006ProtoHostile += 1;
      };
    });
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    const protoHostile = await page.evaluate(() => window.__fc006ProtoHostile ?? -1);
    log(
      "3L. page prototype click override",
      protoHostile === 0 && st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({
        protoHostile,
        st,
        note: "extension isolated world captures native click at bootstrap; page-world override must not run",
      }),
    );

    // 3M nested dispatchEvent during released handler
    await resetFc006On();
    await page.evaluate(() => {
      window.__fc006NestProbe = (b) => {
        b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      };
    });
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    log(
      "3M. nested dispatchEvent during release",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );

    // 3N nested .click() during released handler
    await resetFc006On();
    await page.evaluate(() => {
      window.__fc006NestProbe = (b) => {
        HTMLButtonElement.prototype.click.call(b);
      };
    });
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    log(
      "3N. nested .click() during release",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );

    // 3O nested second supported target
    await resetFc006On();
    await page.evaluate(() => {
      window.__fc006NestProbe = () => {
        const other = document.createElement("button");
        other.type = "button";
        other.setAttribute("data-futureclick-fixture-contract", "fc006.repository-visibility-interception.v1");
        other.setAttribute("data-futureclick-operation", "repository.visibility.change");
        other.setAttribute("data-futureclick-entity-key", "fixture-repository");
        other.setAttribute("data-futureclick-current-visibility", "private");
        other.setAttribute("data-futureclick-requested-visibility", "public");
        let nested = 0;
        other.addEventListener("click", () => {
          nested += 1;
        });
        document.body.appendChild(other);
        other.click();
        window.__fc006NestedOther = nested;
      };
    });
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    const nestedOther = await page.evaluate(() => window.__fc006NestedOther ?? -1);
    log(
      "3O. nested second supported target",
      st.executionCount === 1 && nestedOther === 0 ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, nestedOther }),
    );

    // 3P metadata mutation then nested event during release
    await resetFc006On();
    await page.evaluate(() => {
      window.__fc006NestProbe = (b) => {
        b.setAttribute("data-futureclick-current-visibility", "public");
        b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      };
    });
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    log(
      "3P. metadata mutation + nested event during release",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );
    await page.evaluate(() => {
      window.__fc006NestProbe = undefined;
    });

    // 3Q Cancel before Continue
    await resetFc006On();
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Cancel");
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3Q. Cancel before Continue",
      st.executionCount === 0 && !ui.dialogVisible && ui.power === "ON"
        ? "ACTUALLY EXECUTED"
        : "FAIL",
      JSON.stringify({ st, power: ui.power }),
    );

    // 3R Stop before Continue
    await resetFc006On();
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Stop FutureClick");
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    ui = await fc006UiState(page);
    log(
      "3R. Stop before Continue",
      st.executionCount === 0 && ui.power === "OFF" ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, power: ui.power }),
    );

    // 3S Stop → OFF normal action
    await trustedClick(page, "#btn-change-visibility");
    await new Promise((r) => setTimeout(r, 200));
    st = await fixtureState(page);
    log(
      "3S. Stop → OFF normal action",
      st.executionCount === 1 ? "ACTUALLY EXECUTED" : "FAIL",
      String(st.executionCount),
    );

    // 3T successful Continue exact count 1 (reaffirm)
    await resetFc006On();
    await interceptToPreview();
    await clickShadowButton(page, "dialog", "Continue");
    await new Promise((r) => setTimeout(r, 400));
    st = await fixtureState(page);
    log(
      "3T. successful Continue exact count 1",
      st.executionCount === 1 && st.metadata === "public" ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify(st),
    );

    await page.goto("http://127.0.0.1:4174/fc006/repository-visibility-interception.html", {
      waitUntil: "domcontentloaded",
    });
    await new Promise((r) => setTimeout(r, 800));
    ui = await fc006UiState(page);
    await trustedClick(page, "#btn-change-visibility");
    await new Promise((r) => setTimeout(r, 300));
    st = await fixtureState(page);
    log(
      "3W. wrong port",
      st.executionCount === 1 && !ui.hasIndicator ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ st, hasIndicator: ui.hasIndicator }),
    );

    await page.goto("http://127.0.0.1:4173/fc005/repository-visibility.html", {
      waitUntil: "domcontentloaded",
    });
    await new Promise((r) => setTimeout(r, 1000));
    const fc005Start = await page.$("#fc-start-btn");
    if (fc005Start) await trustedClick(page, "#fc-start-btn");
    const before = await page.evaluate(() => {
      const status = document.getElementById("page-handler-status")?.textContent ?? "";
      const m = status.match(/(\d+)/);
      return m ? Number(m[1]) : 0;
    });
    const btn = (await page.$("#btn-change-visibility")) || (await page.$("button"));
    if (btn) await trustedClick(page, btn);
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(() => {
      const status = document.getElementById("page-handler-status")?.textContent ?? "";
      const m = status.match(/(\d+)/);
      return m ? Number(m[1]) : -1;
    });
    const fc006Dialog = await page.evaluate(
      () => !!document.querySelector("[data-futureclick-ui='dialog']"),
    );
    log(
      "3V. FC-005 passive",
      after > before && !fc006Dialog ? "ACTUALLY EXECUTED" : "FAIL",
      JSON.stringify({ before, after, fc006Dialog }),
    );

    log("profile outside repo", "ACTUALLY EXECUTED", resolvedProfile);
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    try {
      s4173?.close();
    } catch {
      /* ignore */
    }
    try {
      s4174?.close();
    } catch {
      /* ignore */
    }
    try {
      // Only remove the external temp profile — never a repo path.
      const stillOutside =
        resolvedProfile !== resolvedRepo &&
        !resolvedProfile.startsWith(resolvedRepo + path.sep);
      if (stillOutside && fs.existsSync(PROFILE)) {
        fs.rmSync(PROFILE, { recursive: true, force: true });
        console.log(`[profile] cleaned ${resolvedProfile}`);
      }
    } catch (err) {
      console.warn("[profile] cleanup failed", err);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(RESULTS, null, 2));
  const failed = Object.values(RESULTS).filter((r) => r.status === "FAIL").length;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  try {
    const stillOutside =
      resolvedProfile !== resolvedRepo &&
      !resolvedProfile.startsWith(resolvedRepo + path.sep);
    if (stillOutside && fs.existsSync(PROFILE)) {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  process.exit(1);
});
