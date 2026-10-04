#!/usr/bin/env node
/**
 * FC-007 Sprint 1C — genuine Chrome passive observation + current-state freshness smoke.
 *
 * Builds a temporary smoke-only bundle (not production dist), loads a temporary
 * unpacked extension, intercepts the exact synthetic GitHub URL locally.
 */

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(EXT_ROOT, "dist");
const FIXTURE = path.join(EXT_ROOT, "tests/fixtures/fc007/v2/github-settings-v2.html");
const CHROME =
  process.env.CHROME_PATH ||
  "/tmp/fc007-chrome142/chrome/mac_arm-142.0.7444.61/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PUPPETEER_CORE_PATH =
  process.env.PUPPETEER_CORE_PATH || "/tmp/fc006-smoke-deps/node_modules/puppeteer-core";
const SYNTHETIC_URL = "https://github.com/fixture-owner/fixture-repo/settings";
const MAX_ATTEMPTS = 5;
const SMOKE_OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-smoke-build-"));

function fail(msg) {
  console.error("[FAIL]", msg);
  cleanupSmokeBuild();
  process.exit(1);
}
function ok(msg) {
  console.log("[ACTUALLY EXECUTED]", msg);
}
function cleanupSmokeBuild() {
  try {
    fs.rmSync(SMOKE_OUTDIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

const prodBundle = path.join(DIST, "fc007-observation.bundle.js");
if (!fs.existsSync(prodBundle)) {
  // Ensure production build exists.
  execFileSync("pnpm", ["run", "build"], { cwd: EXT_ROOT, stdio: "inherit" });
}
if (!fs.existsSync(prodBundle)) fail("fc007-observation.bundle.js missing after build");
if (!fs.existsSync(CHROME)) fail(`Chrome for Testing missing at ${CHROME}`);
if (!fs.existsSync(FIXTURE)) fail(`fixture missing at ${FIXTURE}`);

for (const needle of [
  "ArmedContinuation",
  "continueDecision",
  "requestSubmit",
  "XMLHttpRequest",
  "data-fc007-enable-diagnostic",
  "fc007-passive-diagnostic",
  "__FC007_3B_HARNESS__",
]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
    fail(`production bundle contains forbidden ${needle}`);
  } catch (err) {
    if (err && err.status !== 1) throw err;
  }
}
for (const needle of ["releaseOnce", "ACTION_ADMITTED_ONCE"]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
  } catch (err) {
    if (err && err.status === 1) fail(`production bundle missing expected ${needle}`);
    throw err;
  }
}
if (fs.existsSync(path.join(DIST, "fc007-observation-smoke.bundle.js"))) {
  fail("production dist still contains smoke bundle");
}
ok("production bundle Sprint-3C release path + forbidden capability static checks");

execFileSync("pnpm", ["exec", "node", "scripts/build.mjs"], {
  cwd: EXT_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    FC007_BUILD_SMOKE: "1",
    FC007_SMOKE_OUTDIR: SMOKE_OUTDIR,
  },
});
const smokeBundle = path.join(SMOKE_OUTDIR, "fc007-observation-smoke.bundle.js");
if (!fs.existsSync(smokeBundle)) fail("smoke bundle missing after FC007_BUILD_SMOKE build");
ok(`smoke-only bundle prepared at ${smokeBundle}`);

const workerPath = path.join(os.tmpdir(), `fc007-smoke-worker-${process.pid}.mjs`);
fs.writeFileSync(
  workerPath,
  `import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
const require = createRequire(import.meta.url);
const puppeteer = (require(${JSON.stringify(PUPPETEER_CORE_PATH)}).default) ?? require(${JSON.stringify(PUPPETEER_CORE_PATH)});
const CHROME = ${JSON.stringify(CHROME)};
const ROOT_SMOKE = ${JSON.stringify(smokeBundle)};
const FIXTURE = ${JSON.stringify(FIXTURE)};
const SYNTHETIC_URL = ${JSON.stringify(SYNTHETIC_URL)};

function isExactSynthetic(url) {
  return url === SYNTHETIC_URL || url === SYNTHETIC_URL + "/";
}

const TMP_EXT = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-ext-"));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-"));
fs.copyFileSync(ROOT_SMOKE, path.join(TMP_EXT, "fc007-observation-smoke.bundle.js"));
fs.writeFileSync(path.join(TMP_EXT, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "t",
  version: "0",
  content_scripts: [{
    matches: ["https://github.com/*/*/settings*"],
    js: ["fc007-observation-smoke.bundle.js"],
    run_at: "document_start",
    all_frames: false,
    world: "ISOLATED",
  }],
}));
const fixtureHtml = fs.readFileSync(FIXTURE, "utf8");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    "--disable-extensions-except=" + TMP_EXT,
    "--load-extension=" + TMP_EXT,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

await new Promise((r) => setTimeout(r, 1500));
await browser.version();

async function runPageSession(mutateName, mutateSource, options = {}) {
  const stage = options.stage ?? "d";
  const expectEvaluated = options.expectEvaluated ?? true;
  const requestLedger = [];
  const diagEvents = [];
  const bootEvents = [];
  let contentScriptContextId = null;
  const page = await browser.newPage();
  {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try { if (page.mainFrame()) break; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  await page.evaluateOnNewDocument(() => {
    window.__fc007FinalClickCount = 0;
    window.__fc007TrustedClickCount = 0;
    window.__fc007UntrustedClickCount = 0;
    window.__fc007SubmitCount = 0;
    window.__fc007RequestSubmitCount = 0;
    window.__fc007FetchCount = 0;
    window.__fc007XhrCount = 0;
    const origFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      window.__fc007FetchCount = (window.__fc007FetchCount || 0) + 1;
      return origFetch(...args);
    };
    const XHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function (...args) {
      window.__fc007XhrCount = (window.__fc007XhrCount || 0) + 1;
      return new XHR(...args);
    };
    const proto = HTMLFormElement.prototype;
    if (typeof proto.requestSubmit === "function") {
      const orig = proto.requestSubmit;
      proto.requestSubmit = function (...args) {
        window.__fc007RequestSubmitCount = (window.__fc007RequestSubmitCount || 0) + 1;
        return orig.apply(this, args);
      };
    }
  });

  const cdp = await page.createCDPSession();
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.consoleAPICalled", (e) => {
    const t = (e.args || []).map((a) => a.value ?? a.description).join(" ");
    if (typeof t !== "string") return;
    if (t.startsWith("__FC007_DIAG__") || t.startsWith("__FC007_BOOT__")) {
      if (typeof e.executionContextId === "number") {
        contentScriptContextId = e.executionContextId;
      }
    }
    if (t.startsWith("__FC007_DIAG__")) {
      try { diagEvents.push(JSON.parse(t.slice("__FC007_DIAG__".length))); } catch {}
    }
    if (t.startsWith("__FC007_BOOT__")) {
      try { bootEvents.push(JSON.parse(t.slice("__FC007_BOOT__".length))); } catch {}
    }
  });

  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    if (isExactSynthetic(url)) {
      await new Promise((r) => setTimeout(r, 250));
      requestLedger.push({ url, disposition: "fulfilled-local-fixture" });
      req.respond({ status: 200, contentType: "text/html", body: fixtureHtml });
      return;
    }
    if (url.startsWith("chrome-extension://") || url === "about:blank" || url.startsWith("data:")) {
      requestLedger.push({ url, disposition: "allowed" });
      req.continue();
      return;
    }
    requestLedger.push({ url, disposition: "blocked" });
    req.abort("blockedbyclient").catch(() => {});
  });

  await page.goto(SYNTHETIC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Drop bootstrap diagnostics so stage assertions only see post-SetStage recognition.
  diagEvents.length = 0;
  await page.evaluate((s) => {
    if (window.__fc007SetStage) window.__fc007SetStage(s);
    else if (window.__fc007OpenDialog) window.__fc007OpenDialog();
    // Ensure a childList mutation so the passive observer re-captures after SetStage
    // (Stage A may not open a dialog and would otherwise leave no delivery).
    const main = document.querySelector("main");
    if (main) {
      const probe = document.createElement("span");
      probe.setAttribute("data-fc007-harness", "1");
      main.appendChild(probe);
      probe.remove();
    }
  }, stage);

  const targetKinds = expectEvaluated
    ? ["evaluated", "contract-recognized"]
    : ["stage-recognized"];

  const deadline = Date.now() + 12000;
  let recognized = null;
  while (Date.now() < deadline) {
    recognized = diagEvents.find((d) => targetKinds.includes(d.kind));
    if (recognized) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!recognized) {
    await page.close();
    return {
      ok: false,
      error: "no recognition",
      stage,
      expectEvaluated,
      requestLedger,
      kinds: diagEvents.map((d) => d.kind),
    };
  }
  if (expectEvaluated && mutateSource) {
    while (Date.now() < deadline) {
      const ev = diagEvents.find((d) => d.kind === "evaluated");
      if (ev) {
        recognized = ev;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!diagEvents.some((d) => d.kind === "evaluated")) {
      await page.close();
      return { ok: false, error: "no evaluated before freshness probe", requestLedger, kinds: diagEvents.map((d) => d.kind) };
    }
  }

  const native = await page.evaluate(() => {
    const dialog = document.getElementById("visibility-dialog");
    const button = document.getElementById("final-make-public");
    return {
      showModalOpen: dialog instanceof HTMLDialogElement && dialog.open === true,
      modal: dialog instanceof HTMLDialogElement && dialog.matches(":modal"),
      disabled: button instanceof HTMLButtonElement && button.matches(":disabled"),
      finalClickCount: window.__fc007FinalClickCount || 0,
      trustedClickCount: window.__fc007TrustedClickCount || 0,
      untrustedClickCount: window.__fc007UntrustedClickCount || 0,
      submitCount: window.__fc007SubmitCount || 0,
      requestSubmitCount: window.__fc007RequestSubmitCount || 0,
      fetchCount: window.__fc007FetchCount || 0,
      xhrCount: window.__fc007XhrCount || 0,
      diagnosticEl: !!document.getElementById("fc007-passive-diagnostic"),
    };
  });

  let freshness = null;
  if (mutateSource) {
    await page.evaluate(mutateSource);
    if (!contentScriptContextId) {
      await page.close();
      return { ok: false, error: "no content script context", requestLedger };
    }
    const evalResult = await cdp.send("Runtime.evaluate", {
      expression: \`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        if (!c) return { err: "missing-ctrl" };
        const kind = c.getState().kind;
        const hasObs = c.getLastObservation() != null;
        const hasEval = c.getLastEvaluation() != null;
        return { kind, hasObs, hasEval };
      })()\`,
      contextId: contentScriptContextId,
      returnByValue: true,
      awaitPromise: false,
    });
    freshness = evalResult.result?.value ?? { err: "no-value", raw: evalResult };
  }

  const chromeVersion = await browser.version();
  await page.close();
  return {
    ok: true,
    mutateName,
    stage,
    expectEvaluated,
    tmpExt: TMP_EXT,
    chromeVersion,
    recognized,
    kinds: diagEvents.map((d) => d.kind),
    bootEvents,
    native,
    requestLedger,
    freshness,
  };
}

try {
  const baseline = await runPageSession("baseline", null, { stage: "d", expectEvaluated: true });
  const stageA = await runPageSession("stage-a", null, { stage: "a", expectEvaluated: false });
  const stageB = await runPageSession("stage-b", null, { stage: "b", expectEvaluated: false });
  const stageC = await runPageSession("stage-c", null, { stage: "c", expectEvaluated: false });
  const stageD = await runPageSession("stage-d", null, { stage: "d", expectEvaluated: true });
  const textData = await runPageSession("text.data", () => {
    const priv = Array.from(document.querySelectorAll("div")).find((d) =>
      Array.from(d.childNodes).some(
        (n) =>
          n.nodeType === 3 &&
          (n.nodeValue || "").replace(/[\\t\\n\\r\\f\\v ]+/g, " ").trim() ===
            "This repository is currently private.",
      ),
    );
    if (!priv) throw new Error("missing private");
    const text = Array.from(priv.childNodes).find((n) => n.nodeType === 3);
    if (!text) throw new Error("missing text");
    text.data = "This repository is currently PUBLIC.";
  }, { stage: "d", expectEvaluated: true });
  const disabled = await runPageSession("disabled", () => {
    const button = document.getElementById("final-make-public");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing button");
    button.disabled = true;
  }, { stage: "d", expectEvaluated: true });
  const widget = await runPageSession("confirm-widget", () => {
    const dialog = document.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    dialog.appendChild(document.createElement("confirm-widget"));
  }, { stage: "d", expectEvaluated: true });

  // Sprint 2: trusted final activation → preview → Cancel; untrusted click probe.
  const sprint2 = await (async () => {
    try {
      const requestLedger = [];
      const diagEvents = [];
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        window.__fc007FinalClickCount = 0;
        window.__fc007TrustedClickCount = 0;
        window.__fc007UntrustedClickCount = 0;
        window.__fc007SubmitCount = 0;
        window.__fc007RequestSubmitCount = 0;
        window.__fc007FetchCount = 0;
        window.__fc007XhrCount = 0;
      });
      const cdp = await page.createCDPSession();
      await cdp.send("Runtime.enable");
      cdp.on("Runtime.consoleAPICalled", (e) => {
        const t = (e.args || []).map((a) => a.value ?? a.description).join(" ");
        if (typeof t === "string" && t.startsWith("__FC007_DIAG__")) {
          try { diagEvents.push(JSON.parse(t.slice("__FC007_DIAG__".length))); } catch {}
        }
      });
      await page.setRequestInterception(true);
      page.on("request", async (req) => {
        const url = req.url();
        if (isExactSynthetic(url)) {
          requestLedger.push({ url, disposition: "fulfilled-local-fixture" });
          req.respond({ status: 200, contentType: "text/html", body: fixtureHtml });
          return;
        }
        if (url.startsWith("chrome-extension://") || url === "about:blank" || url.startsWith("data:")) {
          requestLedger.push({ url, disposition: "allowed" });
          req.continue();
          return;
        }
        requestLedger.push({ url, disposition: "blocked" });
        req.abort("blockedbyclient").catch(() => {});
      });
      await page.goto(SYNTHETIC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      diagEvents.length = 0;
      await page.evaluate(() => {
        window.__fc007SetStage("d");
        const main = document.querySelector("main");
        if (main) {
          const probe = document.createElement("span");
          main.appendChild(probe);
          probe.remove();
        }
      });
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (diagEvents.some((d) => d.kind === "evaluated")) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "stage-d not evaluated before sprint2 click" };
      }
      // Trusted native input via Puppeteer (isTrusted=true).
      await page.click("#final-make-public");
      let verifiedDiag = null;
      const previewDeadline = Date.now() + 8000;
      while (Date.now() < previewDeadline) {
        verifiedDiag = [...diagEvents].reverse().find((d) => d.previewMode === "verified");
        if (verifiedDiag) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!verifiedDiag) {
        await page.close();
        return { ok: false, error: "preview not verified", kinds: diagEvents.map((d) => d.kind + ":" + d.previewMode) };
      }
      // Trusted Escape dismisses preview (Cancel-equivalent).
      await page.keyboard.press("Escape");
      let hiddenAfterCancel = false;
      const cancelDeadline = Date.now() + 5000;
      while (Date.now() < cancelDeadline) {
        const latest = [...diagEvents].reverse().find((d) => d.previewMode);
        if (latest && latest.previewMode === "hidden") {
          hiddenAfterCancel = true;
          break;
        }
        // Also accept absence of verified after Escape + short settle.
        if (![...diagEvents].reverse().find((d) => d.previewMode === "verified" && diagEvents.indexOf(d) > diagEvents.indexOf(verifiedDiag))) {
          // no newer verified; check host attribute via page (decorative only)
          const hostHidden = await page.evaluate(() => {
            const host = document.querySelector("[data-fc007-preview-host]");
            return !host || host.getAttribute("data-fc007-preview-open") !== "1";
          });
          if (hostHidden) {
            hiddenAfterCancel = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      // Untrusted programmatic click must not open verified preview.
      const verifiedBeforeUntrusted = diagEvents.filter((d) => d.previewMode === "verified").length;
      await page.evaluate(() => {
        const btn = document.getElementById("final-make-public");
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 500));
      const verifiedAfterUntrusted = diagEvents.filter((d) => d.previewMode === "verified").length;
      const native = await page.evaluate(() => ({
        finalClickCount: window.__fc007FinalClickCount || 0,
        trustedClickCount: window.__fc007TrustedClickCount || 0,
        untrustedClickCount: window.__fc007UntrustedClickCount || 0,
        submitCount: window.__fc007SubmitCount || 0,
        requestSubmitCount: window.__fc007RequestSubmitCount || 0,
        fetchCount: window.__fc007FetchCount || 0,
        xhrCount: window.__fc007XhrCount || 0,
        hasContinueText: !!document.body?.innerText?.includes("Continue"),
      }));
      await page.close();
      return {
        ok: true,
        preview: { previewVisible: true, previewMode: "verified", kind: verifiedDiag.kind },
        afterCancel: { previewVisible: !hiddenAfterCancel ? true : false, previewMode: hiddenAfterCancel ? "hidden" : "unknown" },
        afterUntrusted: {
          previewVisible: verifiedAfterUntrusted > verifiedBeforeUntrusted,
          previewMode: verifiedAfterUntrusted > verifiedBeforeUntrusted ? "verified" : "unchanged",
        },
        native,
        requestLedger,
        externalGitHub: requestLedger.filter((e) => /github\\.com/i.test(e.url) && e.disposition !== "fulfilled-local-fixture").length,
        externalGitHubAllowed: requestLedger.filter((e) => /github\\.com/i.test(e.url) && e.disposition === "allowed").length,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  async function openStageDPage() {
    const requestLedger = [];
    const diagEvents = [];
    let contentScriptContextId = null;
    const liveContextIds = new Set();
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__fc007FinalClickCount = 0;
      window.__fc007TrustedClickCount = 0;
      window.__fc007UntrustedClickCount = 0;
      window.__fc007SubmitCount = 0;
      window.__fc007RequestSubmitCount = 0;
      window.__fc007FetchCount = 0;
      window.__fc007XhrCount = 0;
      window.__fc007AncestorCaptureCount = 0;
      window.__fc007TargetHandlerCount = 0;
      window.__fc007NavCount = 0;
      const origPush = history.pushState.bind(history);
      history.pushState = function (...args) {
        window.__fc007NavCount = (window.__fc007NavCount || 0) + 1;
        return origPush(...args);
      };
    });
    const cdp = await page.createCDPSession();
    await cdp.send("Runtime.enable");
    cdp.on("Runtime.executionContextCreated", (e) => {
      if (typeof e?.context?.id === "number") liveContextIds.add(e.context.id);
    });
    cdp.on("Runtime.executionContextDestroyed", (e) => {
      if (typeof e?.executionContextId === "number") liveContextIds.delete(e.executionContextId);
      if (contentScriptContextId === e.executionContextId) contentScriptContextId = null;
    });
    cdp.on("Runtime.consoleAPICalled", (e) => {
      const t = (e.args || []).map((a) => a.value ?? a.description).join(" ");
      if (typeof t !== "string") return;
      if (t.startsWith("__FC007_DIAG__") || t.startsWith("__FC007_BOOT__")) {
        if (typeof e.executionContextId === "number") contentScriptContextId = e.executionContextId;
      }
      if (t.startsWith("__FC007_DIAG__")) {
        try { diagEvents.push(JSON.parse(t.slice("__FC007_DIAG__".length))); } catch {}
      }
    });
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      const url = req.url();
      if (isExactSynthetic(url)) {
        requestLedger.push({ url, disposition: "fulfilled-local-fixture" });
        req.respond({ status: 200, contentType: "text/html", body: fixtureHtml });
        return;
      }
      if (url.startsWith("chrome-extension://") || url === "about:blank" || url.startsWith("data:")) {
        requestLedger.push({ url, disposition: "allowed" });
        req.continue();
        return;
      }
      requestLedger.push({ url, disposition: "blocked" });
      req.abort("blockedbyclient").catch(() => {});
    });
    await page.goto(SYNTHETIC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    diagEvents.length = 0;
    await page.evaluate(() => {
      window.__fc007SetStage("d");
      const main = document.querySelector("main");
      if (main) {
        const probe = document.createElement("span");
        main.appendChild(probe);
        probe.remove();
      }
      const dialog = document.getElementById("visibility-dialog");
      if (dialog) {
        dialog.addEventListener("click", () => {
          window.__fc007AncestorCaptureCount = (window.__fc007AncestorCaptureCount || 0) + 1;
        }, true);
      }
      const form = document.getElementById("visibility-form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          window.__fc007SubmitCount = (window.__fc007SubmitCount || 0) + 1;
        });
      }
    });
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (diagEvents.some((d) => d.kind === "evaluated")) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    async function resolveSmokeContextId() {
      if (contentScriptContextId && liveContextIds.has(contentScriptContextId)) {
        return contentScriptContextId;
      }
      for (const id of [...liveContextIds]) {
        try {
          const r = await cdp.send("Runtime.evaluate", {
            expression: "!!globalThis.__FC007_SMOKE_CTRL__",
            contextId: id,
            returnByValue: true,
          });
          if (r.result?.value === true) {
            contentScriptContextId = id;
            return id;
          }
        } catch {
          // context may have been destroyed mid-scan
        }
      }
      return contentScriptContextId;
    }

    return {
      page,
      cdp,
      diagEvents,
      requestLedger,
      contentScriptContextId: () => contentScriptContextId,
      resolveSmokeContextId,
    };
  }

  async function waitPreviewMode(diagEvents, mode, ms = 8000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const hit = [...diagEvents].reverse().find((d) => d.previewMode === mode);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  const probe1 = await (async () => {
    try {
      const { page, diagEvents, requestLedger } = await openStageDPage();
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated" };
      }
      await page.evaluate(() => {
        const btn = document.getElementById("final-make-public");
        if (!(btn instanceof HTMLButtonElement)) throw new Error("missing button");
        btn.textContent = "Make this repository public";
        let cur = btn;
        let deepest = btn;
        for (let i = 0; i < 5; i++) {
          const span = document.createElement("span");
          span.setAttribute("data-depth", String(i + 1));
          span.style.cssText = "display:inline-block;min-width:12px;min-height:12px;padding:6px;";
          cur.appendChild(span);
          cur = span;
          deepest = span;
        }
        deepest.textContent = "\\u00a0";
        deepest.addEventListener("click", () => {
          window.__fc007TargetHandlerCount = (window.__fc007TargetHandlerCount || 0) + 1;
        });
        deepest.id = "fc007-deep-target";
      });
      const deepBox = await page.$eval("#fc007-deep-target", (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      });
      if (!deepBox || deepBox.w <= 0 || deepBox.h <= 0) {
        await page.close();
        return { ok: false, error: "deep target not hit-testable", deepBox };
      }
      await page.mouse.click(deepBox.x, deepBox.y);
      const verified = await waitPreviewMode(diagEvents, "verified");
      const native = await page.evaluate(() => ({
        depth: document.querySelectorAll("#final-make-public span[data-depth]").length,
        targetHandler: window.__fc007TargetHandlerCount || 0,
        ancestorHandler: window.__fc007AncestorCaptureCount || 0,
        submit: window.__fc007SubmitCount || 0,
        trustedClick: window.__fc007TrustedClickCount || 0,
        finalClick: window.__fc007FinalClickCount || 0,
      }));
      await page.close();
      return {
        ok: !!verified && native.targetHandler === 0 && native.ancestorHandler === 0 && native.submit === 0 && native.depth >= 5,
        previewMode: verified?.previewMode || null,
        native,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  const probe2 = await (async () => {
    try {
      const session = await openStageDPage();
      const { page, cdp, diagEvents, requestLedger } = session;
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated" };
      }
      await page.evaluate(() => {
        document.body.appendChild(document.createElement("main"));
      });
      await page.click("#final-make-public");
      const firstStopped = await waitPreviewMode(diagEvents, "stopped");
      const afterFirst = await page.evaluate(() => ({
        ancestor: window.__fc007AncestorCaptureCount || 0,
        submit: window.__fc007SubmitCount || 0,
        target: window.__fc007FinalClickCount || 0,
      }));
      const ctxId = session.contentScriptContextId?.() || null;
      let guardInfo = null;
      if (ctxId) {
        const g = await cdp.send("Runtime.evaluate", {
          expression: \`(() => {
            const c = globalThis.__FC007_SMOKE_CTRL__;
            if (!c) return { err: "missing" };
            const btn = c.getRetainedFinalButton && c.getRetainedFinalButton();
            const dialog = document.getElementById("visibility-dialog");
            return {
              hasGuard: !!btn,
              sameBtn: btn === document.getElementById("final-make-public"),
              dialogOpen: dialog instanceof HTMLDialogElement && dialog.open === true,
              dialogModal: dialog instanceof HTMLDialogElement && dialog.matches(":modal"),
              mode: c.getPreviewMode && c.getPreviewMode(),
            };
          })()\`,
          contextId: ctxId,
          returnByValue: true,
        });
        guardInfo = g.result?.value || null;
      }
      // Keep STOPPED UI (compact); reset counters; second trusted final click must also block.
      await page.evaluate(() => {
        window.__fc007AncestorCaptureCount = 0;
        window.__fc007FinalClickCount = 0;
        window.__fc007SubmitCount = 0;
      });
      const clickTarget = await page.evaluate(() => {
        const btn = document.getElementById("final-make-public");
        if (!(btn instanceof HTMLButtonElement)) return null;
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return {
          x,
          y,
          topTag: top && top.tagName,
          topId: top && top.id,
          isButton: top === btn,
        };
      });
      if (!clickTarget?.isButton) {
        await page.close();
        return { ok: false, error: "second click would not hit final button", clickTarget, guardInfo };
      }
      await page.mouse.click(clickTarget.x, clickTarget.y);
      await new Promise((r) => setTimeout(r, 400));
      const afterSecond = await page.evaluate(() => ({
        ancestor: window.__fc007AncestorCaptureCount || 0,
        submit: window.__fc007SubmitCount || 0,
        target: window.__fc007FinalClickCount || 0,
        nav: window.__fc007NavCount || 0,
        fetch: window.__fc007FetchCount || 0,
        xhr: window.__fc007XhrCount || 0,
        previewModeAttr: document.querySelector("[data-fc007-preview-host]")?.getAttribute("data-fc007-preview-open") || null,
      }));
      await page.close();
      return {
        ok:
          !!firstStopped &&
          afterFirst.ancestor === 0 &&
          afterFirst.submit === 0 &&
          afterSecond.ancestor === 0 &&
          afterSecond.submit === 0 &&
          afterSecond.target === 0 &&
          afterSecond.nav === 0,
        firstStopped: !!firstStopped,
        afterFirst,
        afterSecond,
        guardInfo,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  const probe3 = await (async () => {
    try {
      const session = await openStageDPage();
      const { page, cdp, diagEvents, requestLedger } = session;
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated" };
      }
      await page.click("#final-make-public");
      const verified = await waitPreviewMode(diagEvents, "verified");
      if (!verified) {
        await page.close();
        return { ok: false, error: "no verified" };
      }
      const ctxId = session.contentScriptContextId();
      if (!ctxId) {
        await page.close();
        return { ok: false, error: "no content script context" };
      }
      const focusHit = await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          if (!c) return { err: "missing-ctrl" };
          const host = c.getPreviewHostForTest && c.getPreviewHostForTest();
          const dialog = document.getElementById("visibility-dialog");
          return {
            hostInsideDialog: !!(host && dialog && dialog.contains(host)),
            cancelFocused: !!(c.isPreviewCancelFocusedForTest && c.isPreviewCancelFocusedForTest()),
            hitTest: !!(c.hitTestPreviewCancelForTest && c.hitTestPreviewCancelForTest()),
            center: c.getPreviewCancelCenterForTest ? c.getPreviewCancelCenterForTest() : null,
            mode: c.getPreviewMode(),
          };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      const info = focusHit.result?.value || { err: "no-value" };
      if (info.err || !info.center) {
        await page.close();
        return { ok: false, error: "cancel geometry missing", info };
      }
      await page.mouse.click(info.center.x, info.center.y);
      const dismissed = await waitPreviewMode(diagEvents, "hidden", 5000);
      const native = await page.evaluate(() => ({
        submit: window.__fc007SubmitCount || 0,
        finalClick: window.__fc007FinalClickCount || 0,
        ancestor: window.__fc007AncestorCaptureCount || 0,
      }));
      await page.close();
      return {
        ok:
          !!info.hostInsideDialog &&
          !!info.cancelFocused &&
          !!info.hitTest &&
          (!!dismissed || info.mode !== "verified") &&
          native.submit === 0 &&
          native.finalClick === 0,
        info,
        dismissed: !!dismissed,
        native,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  const probe4 = await (async () => {
    try {
      const session = await openStageDPage();
      const { page, diagEvents, requestLedger } = session;
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated" };
      }
      await page.click("#final-make-public");
      const verified = await waitPreviewMode(diagEvents, "verified");
      if (!verified) {
        await page.close();
        return { ok: false, error: "no verified" };
      }

      async function mutateAndWait(name, mutate) {
        const before = diagEvents.length;
        await page.evaluate(mutate);
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const latest = [...diagEvents].reverse().find((d) => d.previewMode);
          if (latest && latest.previewMode !== "verified") {
            return { name, ok: true, mode: latest.previewMode, ms: Date.now() - (deadline - 4000) };
          }
          void before;
          await new Promise((r) => setTimeout(r, 100));
        }
        return { name, ok: false, mode: "verified" };
      }

      async function ensureVerified() {
        await page.evaluate(() => {
          const mains = Array.from(document.querySelectorAll("main"));
          for (let i = 1; i < mains.length; i++) mains[i].remove();
          window.__fc007SetStage("d");
          const main = document.querySelector("main");
          if (main) {
            const probe = document.createElement("span");
            main.appendChild(probe);
            probe.remove();
          }
        });
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (diagEvents.some((d) => d.kind === "evaluated")) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        await page.click("#final-make-public");
        return !!(await waitPreviewMode(diagEvents, "verified"));
      }

      const disabledRes = await mutateAndWait("disabled", () => {
        const btn = document.getElementById("final-make-public");
        if (btn) btn.disabled = true;
      });
      if (!(await ensureVerified())) {
        await page.close();
        return { ok: false, error: "reverify after disabled failed", disabled: disabledRes };
      }
      const secondMain = await mutateAndWait("secondMain", () => {
        document.body.appendChild(document.createElement("main"));
      });
      if (!(await ensureVerified())) {
        await page.close();
        return { ok: false, error: "reverify after secondMain failed", disabled: disabledRes, secondMain };
      }
      const formRes = await mutateAndWait("form", () => {
        const f = document.getElementById("visibility-form");
        if (f) f.setAttribute("action", "https://github.com/fixture-owner/fixture-repo/settings/other");
      });
      if (!(await ensureVerified())) {
        await page.close();
        return { ok: false, error: "reverify after form failed", disabled: disabledRes, secondMain, form: formRes };
      }
      const route = await mutateAndWait("route", () => {
        history.pushState({}, "", "/fixture-owner/fixture-repo/settings/branches");
      });
      await page.close();
      return {
        ok: disabledRes.ok && secondMain.ok && formRes.ok && route.ok,
        disabled: disabledRes,
        secondMain,
        form: formRes,
        route,
        manualGetterRequired: false,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  async function openVerifiedSession() {
    const session = await openStageDPage();
    const { page, diagEvents } = session;
    if (!diagEvents.some((d) => d.kind === "evaluated")) {
      await page.close();
      return { ok: false, error: "not evaluated", session: null };
    }
    await page.click("#final-make-public");
    const verified = await waitPreviewMode(diagEvents, "verified");
    if (!verified) {
      await page.close();
      return { ok: false, error: "no verified", session: null };
    }
    return { ok: true, session, verified };
  }

  async function waitNotVerified(diagEvents, ms = 4000, afterIndex = 0) {
    const started = Date.now();
    const deadline = started + ms;
    while (Date.now() < deadline) {
      for (let i = diagEvents.length - 1; i >= afterIndex; i--) {
        const d = diagEvents[i];
        if (d && d.previewMode && d.previewMode !== "verified") {
          return { ok: true, mode: d.previewMode, latencyMs: Date.now() - started };
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ok: false, mode: "verified", latencyMs: ms };
  }

  // Medium-fix Probe A: effects aria-label auto-invalidates (no manual getter).
  const mediumProbeA = await (async () => {
    try {
      const opened = await openVerifiedSession();
      if (!opened.ok || !opened.session) return opened;
      const { page, diagEvents, requestLedger } = opened.session;
      const afterIndex = diagEvents.length;
      await page.evaluate(() => {
        const effects = document.querySelector('[role="region"]');
        if (!(effects instanceof HTMLElement)) throw new Error("missing effects");
        effects.setAttribute("aria-label", "Effects of something else");
      });
      const wait = await waitNotVerified(diagEvents, 4000, afterIndex);
      await page.close();
      return { ok: wait.ok, getter: false, ...wait, requestLedger };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // Medium-fix Probe B: final submitter nonempty name auto-invalidates.
  const mediumProbeB = await (async () => {
    try {
      const opened = await openVerifiedSession();
      if (!opened.ok || !opened.session) return opened;
      const { page, diagEvents, requestLedger } = opened.session;
      const afterIndex = diagEvents.length;
      await page.evaluate(() => {
        const btn = document.getElementById("final-make-public");
        if (!(btn instanceof HTMLButtonElement)) throw new Error("missing button");
        btn.setAttribute("name", "commit");
      });
      const wait = await waitNotVerified(diagEvents, 4000, afterIndex);
      await page.close();
      return { ok: wait.ok, getter: false, ...wait, requestLedger };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // Medium-fix Probe C: actual retained host role mutation auto-invalidates.
  const mediumProbeC = await (async () => {
    try {
      const opened = await openVerifiedSession();
      if (!opened.ok || !opened.session) return opened;
      const { page, cdp, diagEvents, requestLedger } = opened.session;
      const ctxId = opened.session.contentScriptContextId();
      if (!ctxId) {
        await page.close();
        return { ok: false, error: "no content script context" };
      }
      const afterIndex = diagEvents.length;
      const mut = await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          const host = c && c.getPreviewHostForTest && c.getPreviewHostForTest();
          if (!host) return { err: "no-host" };
          host.setAttribute("role", "button");
          return { ok: true, role: host.getAttribute("role") };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      const mutVal = mut.result?.value || { err: "no-value" };
      if (mutVal.err) {
        await page.close();
        return { ok: false, error: mutVal.err, mutVal };
      }
      const wait = await waitNotVerified(diagEvents, 4000, afterIndex);
      await page.close();
      return { ok: wait.ok, getter: false, mutation: "role=button", ...wait, requestLedger };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // Medium-fix Probe D: exact page dialog cap + owned host; +1 page element demotes.
  const mediumProbeD = await (async () => {
    try {
      const session = await openStageDPage();
      const { page, cdp, diagEvents, requestLedger } = session;
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated" };
      }
      const padInfo = await page.evaluate(() => {
        const dialog = document.getElementById("visibility-dialog");
        if (!(dialog instanceof HTMLDialogElement)) return { err: "no-dialog" };
        const countElements = (root) => {
          let n = 0;
          const walk = (el) => {
            n += 1;
            for (const c of el.children) walk(c);
          };
          walk(root);
          return n;
        };
        const before = countElements(dialog);
        const target = 64;
        let count = before;
        let bucket = document.createElement("div");
        dialog.appendChild(bucket);
        count += 1;
        let current = bucket;
        while (count < target) {
          if (current.childElementCount >= 16) {
            const next = document.createElement("div");
            current.appendChild(next);
            current = next;
            count += 1;
            if (count >= target) break;
          }
          current.appendChild(document.createElement("span"));
          count += 1;
        }
        const main = document.querySelector("main");
        if (main) {
          const probe = document.createElement("span");
          main.appendChild(probe);
          probe.remove();
        }
        return { before, pageCount: countElements(dialog), target };
      });
      if (padInfo.err) {
        await page.close();
        return { ok: false, error: padInfo.err };
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (diagEvents.some((d) => d.kind === "evaluated")) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: "not evaluated after pad", padInfo };
      }
      await page.click("#final-make-public");
      const verified = await waitPreviewMode(diagEvents, "verified");
      if (!verified) {
        await page.close();
        return { ok: false, error: "no verified at exact cap", padInfo };
      }
      const ctxId = session.contentScriptContextId();
      let hostInfo = null;
      if (ctxId) {
        const h = await cdp.send("Runtime.evaluate", {
          expression: \`(() => {
            const c = globalThis.__FC007_SMOKE_CTRL__;
            const host = c && c.getPreviewHostForTest && c.getPreviewHostForTest();
            const dialog = document.getElementById("visibility-dialog");
            const countElements = (root) => {
              let n = 0;
              const walk = (el) => {
                n += 1;
                for (const child of el.children) walk(child);
              };
              walk(root);
              return n;
            };
            return {
              hostMounted: !!(host && dialog && dialog.contains(host)),
              totalWithHost: dialog ? countElements(dialog) : -1,
              hostAttrCount: host ? host.attributes.length : -1,
              hostLightChildren: host ? host.childNodes.length : -1,
              mode: c.getPreviewMode && c.getPreviewMode(),
            };
          })()\`,
          contextId: ctxId,
          returnByValue: true,
        });
        hostInfo = h.result?.value || null;
      }
      await new Promise((r) => setTimeout(r, 300));
      const stillVerified = hostInfo && hostInfo.mode === "verified";
      const plusIndex = diagEvents.length;
      await page.evaluate(() => {
        const dialog = document.getElementById("visibility-dialog");
        if (dialog) dialog.appendChild(document.createElement("span"));
      });
      const afterPlusOne = await waitNotVerified(diagEvents, 4000, plusIndex);
      await page.close();
      return {
        ok:
          !!verified &&
          !!stillVerified &&
          !!hostInfo?.hostMounted &&
          hostInfo.hostAttrCount === 0 &&
          hostInfo.hostLightChildren === 0 &&
          afterPlusOne.ok &&
          padInfo.pageCount === 64,
        pageCount: padInfo.pageCount,
        preMountEvaluated: true,
        hostInfo,
        stillVerified,
        plusOne: afterPlusOne,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // Medium-fix Probe E: native Cancel on verified preview.
  const mediumProbeE = await (async () => {
    try {
      const opened = await openVerifiedSession();
      if (!opened.ok || !opened.session) return opened;
      const { page, cdp, diagEvents, requestLedger } = opened.session;
      const ctxId = opened.session.contentScriptContextId();
      if (!ctxId) {
        await page.close();
        return { ok: false, error: "no content script context" };
      }
      const focusHit = await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          if (!c) return { err: "missing-ctrl" };
          return {
            hostInsideDialog: !!(c.getPreviewHostForTest && c.getPreviewHostForTest() &&
              document.getElementById("visibility-dialog")?.contains(c.getPreviewHostForTest())),
            cancelFocused: !!(c.isPreviewCancelFocusedForTest && c.isPreviewCancelFocusedForTest()),
            hitTest: !!(c.hitTestPreviewCancelForTest && c.hitTestPreviewCancelForTest()),
            center: c.getPreviewCancelCenterForTest ? c.getPreviewCancelCenterForTest() : null,
            mode: c.getPreviewMode(),
          };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      const info = focusHit.result?.value || { err: "no-value" };
      if (info.err || !info.center) {
        await page.close();
        return { ok: false, error: "cancel geometry missing", info };
      }
      await page.mouse.click(info.center.x, info.center.y);
      const dismissed = await waitPreviewMode(diagEvents, "hidden", 5000);
      const native = await page.evaluate(() => ({
        submit: window.__fc007SubmitCount || 0,
        finalClick: window.__fc007FinalClickCount || 0,
        ancestor: window.__fc007AncestorCaptureCount || 0,
      }));
      await page.close();
      return {
        ok:
          !!info.hostInsideDialog &&
          !!info.cancelFocused &&
          !!info.hitTest &&
          (!!dismissed || info.mode !== "verified") &&
          native.submit === 0 &&
          native.finalClick === 0,
        info,
        dismissed: !!dismissed,
        native,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // High fix Probe: pending form replacement cannot publish VERIFIED; post-race activation blocked.
  const pendingFormRace = await (async () => {
    try {
      const session = await openStageDPage();
      const { page, cdp, diagEvents, requestLedger } = session;
      if (!diagEvents.some((d) => d.kind === "evaluated" || d.kind === "contract-recognized")) {
        await page.close();
        return { ok: false, error: "not recognized" };
      }
      const ctxId = session.contentScriptContextId();
      if (!ctxId) {
        await page.close();
        return { ok: false, error: "no content script context" };
      }
      await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          if (!c || typeof c.armEvalDelayForTest !== "function") return { armed: false };
          c.armEvalDelayForTest();
          return { armed: true };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      const clickIndex = diagEvents.length;
      await page.click("#final-make-public");
      const pending = await waitPreviewMode(diagEvents, "pending", 8000);
      if (!pending) {
        await page.close();
        return { ok: false, error: "no pending preview" };
      }
      const replaced = await page.evaluate(() => {
        const oldForm = document.getElementById("visibility-form");
        const btn = document.getElementById("final-make-public");
        if (!(oldForm instanceof HTMLFormElement) || !(btn instanceof HTMLButtonElement)) {
          return { ok: false, error: "missing form/button" };
        }
        const newForm = document.createElement("form");
        newForm.id = "visibility-form";
        newForm.method = oldForm.method;
        newForm.setAttribute("action", oldForm.getAttribute("action") || "");
        newForm.setAttribute("enctype", oldForm.getAttribute("enctype") || "");
        while (oldForm.firstChild) newForm.appendChild(oldForm.firstChild);
        oldForm.replaceWith(newForm);
        return {
          ok: true,
          sameButton: newForm.contains(btn),
          oldConnected: document.contains(oldForm),
        };
      });
      if (!replaced.ok) {
        await page.close();
        return { ok: false, error: "replace failed", replaced };
      }
      await waitNotVerified(diagEvents, 4000, diagEvents.length);
      await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          if (!c || typeof c.releaseEvalDelayForTest !== "function") return { released: false };
          c.releaseEvalDelayForTest();
          return { released: true };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 400));
      const afterEval = await cdp.send("Runtime.evaluate", {
        expression: \`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          return {
            mode: c && c.getPreviewMode && c.getPreviewMode(),
            hasEval: !!(c && c.getLastEvaluation && c.getLastEvaluation()),
            kind: c && c.getState && c.getState().kind,
          };
        })()\`,
        contextId: ctxId,
        returnByValue: true,
      });
      const afterVal = afterEval.result?.value || {};
      const beforeSecondClick = diagEvents.length;
      // Post-race trusted activation of the exact button.
      await page.evaluate(() => {
        window.__fc007AncestorCaptureCount = 0;
        window.__fc007FinalClickCount = 0;
        window.__fc007SubmitCount = 0;
        window.__fc007NavCount = 0;
        window.__fc007TargetHandlerCount = 0;
      });
      const clickInfo = await page.evaluate(() => {
        const btn = document.getElementById("final-make-public");
        if (!(btn instanceof HTMLButtonElement)) return null;
        btn.focus();
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!clickInfo) {
        await page.close();
        return { ok: false, error: "no button for post-race click", afterVal, replaced };
      }
      await page.mouse.click(clickInfo.x, clickInfo.y);
      await new Promise((r) => setTimeout(r, 300));
      const native = await page.evaluate(() => ({
        trustedClick: window.__fc007TrustedClickCount || 0,
        target: window.__fc007TargetHandlerCount || 0,
        ancestor: window.__fc007AncestorCaptureCount || 0,
        submit: window.__fc007SubmitCount || 0,
        nav: window.__fc007NavCount || 0,
        finalClick: window.__fc007FinalClickCount || 0,
      }));
      // Stale evaluation must never have published VERIFIED before the post-race click.
      const sawVerified = diagEvents
        .slice(clickIndex, beforeSecondClick)
        .some((d) => d.previewMode === "verified");
      await page.close();
      return {
        ok:
          !sawVerified &&
          afterVal.mode !== "verified" &&
          replaced.sameButton === true &&
          native.ancestor === 0 &&
          native.submit === 0 &&
          native.nav === 0 &&
          native.target === 0,
        evaluationDelayed: true,
        formReplacedWhilePending: true,
        sawVerified,
        afterVal,
        replaced,
        native,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // Sprint 3A: Continue decision boundary (no arm/execute/release).
  // Mandatory probes use closed PASS/FAIL — setup failure is FAIL (never silent success).
  const sprint3a = await (async () => {
    let phase = "init";
    let page = null;
    let cdp = null;
    let diagEvents = null;
    let requestLedger = [];
    let resolveSmokeContextId = async () => null;
    let getContentScriptContextId = () => null;

    async function bindSession(session) {
      page = session.page;
      cdp = session.cdp;
      diagEvents = session.diagEvents;
      requestLedger = requestLedger.concat(session.requestLedger || []);
      resolveSmokeContextId = session.resolveSmokeContextId;
      getContentScriptContextId = session.contentScriptContextId;
    }

    async function iso(expr) {
      let lastErr = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = (await resolveSmokeContextId()) || getContentScriptContextId();
        if (!id) {
          lastErr = new Error("NO_CONTENT_SCRIPT_CONTEXT");
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        try {
          const r = await cdp.send("Runtime.evaluate", {
            expression: expr,
            contextId: id,
            returnByValue: true,
          });
          if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.text || "ISO_EXCEPTION");
          }
          return r.result?.value;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      throw lastErr || new Error("ISO_FAILED");
    }

    async function waitFreshVerified(mark) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const hit = diagEvents.slice(mark).reverse().find((d) => d.previewMode === "verified");
        const live = await iso(\`(() => {
          const c = globalThis.__FC007_SMOKE_CTRL__;
          if (!c) return null;
          return {
            mode: c.getPreviewMode(),
            cont: c.isContinueVisibleForTest(),
            decisionId: c.getActiveDecisionForTest()?.decisionId || null,
            decisionGeneration: c.getSprint3aDiagnosticsForTest()?.decisionGeneration ?? null,
          };
        })()\`);
        if (hit && live?.mode === "verified" && live.cont && live.decisionId) return live;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    }

    async function requireVerifiedSetup(label) {
      const mark = diagEvents.length;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.evaluate(() => {
            if (typeof window.__fc007SetStage === "function") window.__fc007SetStage("d");
          });
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      try {
        await page.click("#final-make-public");
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        await page.click("#final-make-public").catch(() => {});
      }
      const live = await waitFreshVerified(mark);
      if (!live) return { ok: false, error: \`SETUP_VERIFIED_FAILED:\${label}\` };
      const snap = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const d = c.getActiveDecisionForTest();
        const diag = c.getSprint3aDiagnosticsForTest();
        return {
          mode: c.getPreviewMode(),
          continueVisible: c.isContinueVisibleForTest(),
          cancelFocused: c.isPreviewCancelFocusedForTest(),
          decisionId: d?.decisionId || null,
          decisionGeneration: diag?.decisionGeneration ?? null,
          effectsFp: d?.effectsFingerprint || null,
          accepted: diag?.acceptedContinueAttempts ?? 0,
          pass: diag?.continueValidationPass ?? 0,
          fail: diag?.continueValidationFail ?? 0,
        };
      })()\`);
      if (!snap?.continueVisible || !snap?.decisionId || !snap?.effectsFp) {
        return { ok: false, error: \`SETUP_CONTINUE_MISSING:\${label}\`, snap };
      }
      return { ok: true, snap };
    }

    async function openVerifiedSession(label) {
      const session = await openStageDPage();
      await bindSession(session);
      if (!diagEvents.some((d) => d.kind === "evaluated")) {
        await page.close();
        return { ok: false, error: \`SETUP_NOT_EVALUATED:\${label}\` };
      }
      await page.click("#final-make-public");
      const verified = await waitPreviewMode(diagEvents, "verified");
      if (!verified) {
        await page.close();
        return { ok: false, error: \`SETUP_NO_VERIFIED:\${label}\` };
      }
      const ctxId = await resolveSmokeContextId();
      if (!ctxId) {
        await page.close();
        return { ok: false, error: \`SETUP_NO_CONTENT_SCRIPT_CONTEXT:\${label}\` };
      }
      const snap = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const d = c.getActiveDecisionForTest();
        const diag = c.getSprint3aDiagnosticsForTest();
        return {
          mode: c.getPreviewMode(),
          continueVisible: c.isContinueVisibleForTest(),
          cancelFocused: c.isPreviewCancelFocusedForTest(),
          continueCenter: c.getPreviewContinueCenterForTest ? c.getPreviewContinueCenterForTest() : null,
          decisionId: d?.decisionId || null,
          effectsFp: d?.effectsFingerprint || null,
          accepted: diag?.acceptedContinueAttempts ?? 0,
          pass: diag?.continueValidationPass ?? 0,
          fail: diag?.continueValidationFail ?? 0,
        };
      })()\`);
      if (!snap?.continueVisible || !snap?.cancelFocused || !snap?.continueCenter || !snap?.decisionId || !snap?.effectsFp) {
        await page.close();
        return { ok: false, error: \`SETUP_CONTINUE_UI:\${label}\`, snap };
      }
      return { ok: true, snap };
    }

    try {
      phase = "enter-probe";
      let opened = await openVerifiedSession("enter");
      if (!opened.ok) return opened;
      const ui = opened.snap;
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 400));
      const afterEnter = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const d = c.getSprint3aDiagnosticsForTest();
        return { mode: c.getPreviewMode(), accepted: d.acceptedContinueAttempts, continueVisible: c.isContinueVisibleForTest() };
      })()\`);
      if (afterEnter?.accepted !== 0) {
        await page.close();
        return { ok: false, error: "ENTER_ACCEPTED_CONTINUE", afterEnter };
      }
      try { await page.close(); } catch {}

      phase = "trust-probes";
      opened = await openVerifiedSession("trust");
      if (!opened.ok) return opened;

      const untrusted = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const before = c.getSprint3aDiagnosticsForTest();
        c.invokeUntrustedContinueClickForTest();
        const btn = c.getContinueButtonForTest();
        if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        const after = c.getSprint3aDiagnosticsForTest();
        return {
          acceptedBefore: before.acceptedContinueAttempts,
          acceptedAfter: after.acceptedContinueAttempts,
          arm: after.armCount,
          executor: after.executorCount,
          authorized: after.authorizedReleaseCount,
          mode: c.getPreviewMode(),
        };
      })()\`);
      if (untrusted?.acceptedAfter !== 0 || untrusted?.mode !== "verified") {
        await page.close();
        return { ok: false, error: "UNTRUSTED_CONTINUE_ACCEPTED", untrusted };
      }

      const contCenter = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getPreviewContinueCenterForTest())()\`);
      if (!contCenter) {
        await page.close();
        return { ok: false, error: "MISSING_CONTINUE_CENTER" };
      }
      const beforeMouse = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
      await page.mouse.click(contCenter.x, contCenter.y);
      const mouseDeadline = Date.now() + 5000;
      let mouseDiag = null;
      while (Date.now() < mouseDeadline) {
        mouseDiag = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
        if (mouseDiag && mouseDiag.acceptedContinueAttempts > (beforeMouse?.acceptedContinueAttempts || 0)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!mouseDiag || mouseDiag.acceptedContinueAttempts !== (beforeMouse?.acceptedContinueAttempts || 0) + 1 || mouseDiag.continueValidationPass < 1) {
        await page.close();
        return { ok: false, error: "TRUSTED_MOUSE_CONTINUE_FAILED", mouseDiag, beforeMouse };
      }
      if (mouseDiag.armCount !== 1 || mouseDiag.executorCount !== 1 || mouseDiag.authorizedReleaseCount !== 1) {
        await page.close();
        return { ok: false, error: "RELEASE_NOT_ONE_MOUSE", mouseDiag };
      }
      if ((mouseDiag.releaseCalls ?? 0) !== 1 || (mouseDiag.retries ?? 0) !== 0) {
        await page.close();
        return { ok: false, error: "RELEASE_CALLS_MOUSE", mouseDiag };
      }
      try { await page.close(); } catch {}

      phase = "keyboard";
      opened = await openVerifiedSession("keyboard");
      if (!opened.ok) return opened;
      await page.keyboard.press("Tab");
      await new Promise((r) => setTimeout(r, 50));
      const focusedContinue = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        return { cancelFocused: c.isPreviewCancelFocusedForTest(), continueVisible: c.isContinueVisibleForTest() };
      })()\`);
      if (focusedContinue?.cancelFocused) {
        await page.keyboard.press("Tab");
        await new Promise((r) => setTimeout(r, 50));
      }
      const beforeKey = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
      await page.keyboard.press("Enter");
      const keyDeadline = Date.now() + 5000;
      let keyDiag = null;
      while (Date.now() < keyDeadline) {
        keyDiag = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
        if (keyDiag && keyDiag.acceptedContinueAttempts > (beforeKey?.acceptedContinueAttempts || 0)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!keyDiag || keyDiag.acceptedContinueAttempts !== (beforeKey?.acceptedContinueAttempts || 0) + 1) {
        await page.close();
        return { ok: false, error: "TRUSTED_KEYBOARD_CONTINUE_FAILED", beforeKey, keyDiag, focusedContinue };
      }
      if (keyDiag.armCount !== 1 || keyDiag.executorCount !== 1 || keyDiag.authorizedReleaseCount !== 1) {
        await page.close();
        return { ok: false, error: "RELEASE_NOT_ONE_KEYBOARD", keyDiag };
      }
      try { await page.close(); } catch {}

      phase = "form";
      opened = await openVerifiedSession("form");
      if (!opened.ok) return opened;
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.pauseFreshnessObserverForTest())()\`);
      await page.evaluate(() => {
        const form = document.getElementById("visibility-form");
        if (!(form instanceof HTMLFormElement)) throw new Error("no form");
        const replacement = document.createElement("form");
        replacement.id = "visibility-form";
        replacement.method = "post";
        replacement.action = form.getAttribute("action") || "";
        replacement.enctype = form.getAttribute("enctype") || "application/x-www-form-urlencoded";
        const btn = document.createElement("button");
        btn.type = "submit";
        btn.id = "final-make-public";
        btn.textContent = "Make this repository public";
        replacement.appendChild(btn);
        form.replaceWith(replacement);
      });
      const formValidator = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const result = c.validateContinueSameDecisionForTest();
        return { mode: c.getPreviewMode(), continueVisible: c.isContinueVisibleForTest(), result };
      })()\`);
      if (!formValidator?.result || formValidator.result.status !== "INVALID_STALE_DECISION") {
        await page.close();
        return { ok: false, error: "FORM_VALIDATOR_NOT_INVALID", formValidator };
      }
      const formProbe = {
        ok: true,
        setupVerified: true,
        observerDependency: false,
        validatorReached: true,
        validation: formValidator.result.status,
        reason: formValidator.result.reason,
      };
      try { await page.close(); } catch {}

      phase = "button";
      opened = await openVerifiedSession("button");
      if (!opened.ok) return opened;
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.pauseFreshnessObserverForTest())()\`);
      const buttonMut = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const decision = c.getActiveDecisionForTest();
        const original = decision?.finalButton || null;
        if (!(original instanceof HTMLButtonElement)) return { ok: false, error: "NO_ORIGINAL_BUTTON" };
        const form = original.form || document.getElementById("visibility-form");
        if (!(form instanceof HTMLFormElement)) return { ok: false, error: "NO_FORM" };
        const replacement = document.createElement("button");
        replacement.type = "submit";
        replacement.id = "final-make-public";
        if (original.name) replacement.name = original.name;
        replacement.textContent = original.textContent || "Make this repository public";
        replacement.disabled = false;
        replacement.removeAttribute("aria-disabled");
        original.replaceWith(replacement);
        const current = document.getElementById("final-make-public");
        return {
          ok: true,
          differentIdentity: replacement !== original,
          originalConnected: original.isConnected,
          currentIsReplacement: current === replacement,
          replacementDisabled: replacement.disabled === true,
          replacementInForm: replacement.form === form || form.contains(replacement),
        };
      })()\`);
      if (!buttonMut?.ok || !buttonMut.differentIdentity || buttonMut.originalConnected !== false || !buttonMut.currentIsReplacement || buttonMut.replacementDisabled || !buttonMut.replacementInForm) {
        await page.close();
        return { ok: false, error: "BUTTON_REPLACEMENT_ASSERT_FAILED", buttonMut };
      }
      const buttonValidator = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        return c.validateContinueSameDecisionForTest();
      })()\`);
      if (!buttonValidator || buttonValidator.status !== "INVALID_STALE_DECISION") {
        await page.close();
        return { ok: false, error: "BUTTON_VALIDATOR_NOT_INVALID", buttonValidator, buttonMut };
      }
      if (buttonValidator.reason !== "BUTTON_IDENTITY") {
        await page.close();
        return { ok: false, error: "BUTTON_REASON_NOT_IDENTITY", buttonValidator, buttonMut };
      }
      const buttonProbe = {
        ok: true,
        setupVerified: true,
        observerDependency: false,
        validatorReached: true,
        differentIdentity: true,
        contractValid: true,
        recognizedReplacement: true,
        validation: buttonValidator.status,
        reason: buttonValidator.reason,
      };
      try { await page.close(); } catch {}

      phase = "route";
      opened = await openVerifiedSession("route");
      if (!opened.ok) return opened;
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.pauseFreshnessObserverForTest())()\`);
      await page.evaluate(() => {
        history.pushState({}, "", "/other-owner/other-repo/settings");
      });
      // pushState can invalidate Puppeteer's main-world context; prefer iso validator.
      await new Promise((r) => setTimeout(r, 100));
      const routeValidator = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.validateContinueSameDecisionForTest())()\`);
      if (!routeValidator || routeValidator.status !== "INVALID_STALE_DECISION") {
        await page.close();
        return { ok: false, error: "ROUTE_VALIDATOR_NOT_INVALID", routeValidator };
      }
      const routeProbe = {
        ok: true,
        setupVerified: true,
        mutationApplied: true,
        validatorReached: true,
        validation: routeValidator.status,
        reason: routeValidator.reason,
      };
      try { await page.close(); } catch {}

      phase = "effects-paragraph";
      opened = await openVerifiedSession("effects-paragraph");
      if (!opened.ok) return opened;
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.pauseFreshnessObserverForTest())()\`);
      const effectsMut = await page.evaluate(() => {
        const region = document.querySelector(
          'div[role="region"][aria-label="Effects of making this repository public"]',
        );
        if (!(region instanceof HTMLDivElement)) return { ok: false, error: "EFFECTS_REGION_MISSING" };
        const p = region.querySelector("p");
        if (!(p instanceof HTMLElement)) return { ok: false, error: "EFFECTS_PROSE_MISSING" };
        const beforeText = p.textContent || "";
        p.textContent = "MUTATED STAGE-D EFFECTS PROSE FOR CONTINUE BINDING";
        return { ok: true, beforeText, afterText: p.textContent };
      });
      if (!effectsMut?.ok) {
        await page.close();
        return { ok: false, error: "EFFECTS_MUTATION_FAILED", effectsMut };
      }
      const effectsValidator = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const decision = c.getActiveDecisionForTest();
        const freshFp = c.fingerprintCurrentEffectsForTest();
        const result = c.validateContinueSameDecisionForTest();
        return {
          originalFp: decision?.effectsFingerprint || null,
          freshFp,
          fingerprintChanged: !!(decision?.effectsFingerprint && freshFp && decision.effectsFingerprint !== freshFp),
          result,
          arm: c.getSprint3aDiagnosticsForTest().armCount,
          executor: c.getSprint3aDiagnosticsForTest().executorCount,
          authorized: c.getSprint3aDiagnosticsForTest().authorizedReleaseCount,
        };
      })()\`);
      if (!effectsValidator?.fingerprintChanged) {
        await page.close();
        return { ok: false, error: "EFFECTS_FINGERPRINT_UNCHANGED", effectsValidator, effectsMut };
      }
      if (!effectsValidator?.result || effectsValidator.result.status !== "INVALID_STALE_DECISION") {
        await page.close();
        return { ok: false, error: "EFFECTS_VALIDATOR_NOT_INVALID", effectsValidator };
      }
      if (effectsValidator.result.reason !== "EFFECTS_FINGERPRINT") {
        await page.close();
        return { ok: false, error: "EFFECTS_REASON_UNEXPECTED", effectsValidator };
      }
      if (effectsValidator.arm !== 0 || effectsValidator.executor !== 0 || effectsValidator.authorized !== 0) {
        await page.close();
        return { ok: false, error: "EFFECTS_RELEASE_NONZERO", effectsValidator };
      }
      const effectsProbe = {
        ok: true,
        initialVerified: true,
        actualEffectsRegion: true,
        observerDependency: false,
        originalFingerprint: effectsValidator.originalFp,
        freshFingerprint: effectsValidator.freshFp,
        fingerprintChanged: true,
        mutationApplied: true,
        validation: effectsValidator.result.status,
        reason: effectsValidator.result.reason,
        arm: 0,
        executor: 0,
        authorizedRelease: 0,
      };
      try { await page.close(); } catch {}

      phase = "effects-root";
      opened = await openVerifiedSession("effects-root");
      if (!opened.ok) return opened;
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.pauseFreshnessObserverForTest())()\`);
      const rootMut = await page.evaluate(() => {
        const region = document.querySelector(
          'div[role="region"][aria-label="Effects of making this repository public"]',
        );
        if (!(region instanceof HTMLDivElement)) return { ok: false, error: "EFFECTS_REGION_MISSING" };
        const text = "ALL PRIVATE CODE AND SECRETS WILL BE PUBLIC. ";
        region.insertBefore(document.createTextNode(text), region.firstChild);
        return {
          ok: true,
          firstChildIsText: region.firstChild?.nodeType === Node.TEXT_NODE,
          firstChildText: region.firstChild?.nodeValue || "",
        };
      });
      if (!rootMut?.ok || !rootMut.firstChildIsText || !rootMut.firstChildText.includes("ALL PRIVATE CODE")) {
        await page.close();
        return { ok: false, error: "EFFECTS_ROOT_MUTATION_FAILED", rootMut };
      }
      const rootValidator = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const decision = c.getActiveDecisionForTest();
        const freshFp = c.fingerprintCurrentEffectsForTest();
        const result = c.validateContinueSameDecisionForTest();
        return {
          originalFp: decision?.effectsFingerprint || null,
          freshFp,
          fingerprintChanged: !!(decision?.effectsFingerprint && freshFp && decision.effectsFingerprint !== freshFp),
          result,
          arm: c.getSprint3aDiagnosticsForTest().armCount,
          executor: c.getSprint3aDiagnosticsForTest().executorCount,
          authorized: c.getSprint3aDiagnosticsForTest().authorizedReleaseCount,
        };
      })()\`);
      if (!rootValidator?.fingerprintChanged) {
        await page.close();
        return { ok: false, error: "EFFECTS_ROOT_FINGERPRINT_UNCHANGED", rootValidator, rootMut };
      }
      if (!rootValidator?.result || rootValidator.result.status !== "INVALID_STALE_DECISION") {
        await page.close();
        return { ok: false, error: "EFFECTS_ROOT_VALIDATOR_NOT_INVALID", rootValidator };
      }
      if (rootValidator.result.reason !== "EFFECTS_FINGERPRINT") {
        await page.close();
        return { ok: false, error: "EFFECTS_ROOT_REASON_UNEXPECTED", rootValidator };
      }
      if (rootValidator.arm !== 0 || rootValidator.executor !== 0 || rootValidator.authorized !== 0) {
        await page.close();
        return { ok: false, error: "EFFECTS_ROOT_RELEASE_NONZERO", rootValidator };
      }
      const effectsRootProbe = {
        ok: true,
        initialVerified: true,
        observerPaused: true,
        actualEffectsRegion: true,
        originalFingerprint: rootValidator.originalFp,
        mutationApplied: true,
        freshFingerprint: rootValidator.freshFp,
        fingerprintChanged: true,
        validation: rootValidator.result.status,
        reason: rootValidator.result.reason,
        arm: 0,
        executor: 0,
        authorizedRelease: 0,
      };
      try { await page.close(); } catch {}

      phase = "double";
      opened = await openVerifiedSession("double");
      if (!opened.ok) return opened;
      const doubleBefore = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const d = c.getActiveDecisionForTest();
        const diag = c.getSprint3aDiagnosticsForTest();
        return {
          decisionId: d?.decisionId || null,
          accepted: diag.acceptedContinueAttempts,
        };
      })()\`);
      if (!doubleBefore?.decisionId) {
        await page.close();
        return { ok: false, error: "DOUBLE_NO_DECISION", doubleBefore };
      }
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.invokeTrustedContinueForTest())()\`);
      await new Promise((r) => setTimeout(r, 120));
      const afterFirst = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        const diag = c.getSprint3aDiagnosticsForTest();
        return {
          accepted: diag.acceptedContinueAttempts,
          decisionId: c.getActiveDecisionForTest()?.decisionId || null,
          eligibility: c.getDecisionLifecycleStatusForTest(),
        };
      })()\`);
      await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.invokeTrustedContinueForTest())()\`);
      await new Promise((r) => setTimeout(r, 120));
      const afterSecond = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
      const doubleDelta = (afterSecond?.acceptedContinueAttempts || 0) - (doubleBefore.accepted || 0);
      if (doubleDelta !== 1) {
        await page.close();
        return { ok: false, error: "DOUBLE_DELTA_NOT_1", doubleBefore, afterFirst, afterSecond, doubleDelta };
      }
      if ((afterFirst?.accepted || 0) - (doubleBefore.accepted || 0) !== 1) {
        await page.close();
        return { ok: false, error: "DOUBLE_FIRST_NOT_1", doubleBefore, afterFirst };
      }
      if (afterSecond.armCount !== 1 || afterSecond.executorCount !== 1 || afterSecond.authorizedReleaseCount !== 1) {
        await page.close();
        return { ok: false, error: "DOUBLE_RELEASE_NOT_ONE", afterSecond };
      }
      const doubleProbe = {
        ok: true,
        decisionId: doubleBefore.decisionId,
        acceptedBefore: doubleBefore.accepted,
        acceptedAfterFirst: afterFirst.accepted,
        acceptedAfterSecond: afterSecond.acceptedContinueAttempts,
        totalDelta: doubleDelta,
        arm: afterSecond.armCount,
        executor: afterSecond.executorCount,
        authorizedRelease: afterSecond.authorizedReleaseCount,
      };

      // Native Cancel regression on a fresh verified page.
      phase = "native-cancel";
      try { await page.close(); } catch {}
      opened = await openVerifiedSession("native-cancel");
      if (!opened.ok) return opened;
      const cancelCenter = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getPreviewCancelCenterForTest())()\`);
      if (!cancelCenter) {
        await page.close();
        return { ok: false, error: "MISSING_CANCEL_CENTER" };
      }
      await page.mouse.click(cancelCenter.x, cancelCenter.y);
      await new Promise((r) => setTimeout(r, 300));
      const afterCancel = await iso(\`(() => {
        const c = globalThis.__FC007_SMOKE_CTRL__;
        return { mode: c.getPreviewMode(), continueVisible: c.isContinueVisibleForTest() };
      })()\`);
      if (afterCancel?.mode === "verified" || afterCancel?.continueVisible) {
        await page.close();
        return { ok: false, error: "NATIVE_CANCEL_FAILED", afterCancel };
      }

      const native = await page.evaluate(() => ({
        submit: window.__fc007SubmitCount || 0,
        finalClick: window.__fc007FinalClickCount || 0,
        fetch: window.__fc007FetchCount || 0,
        xhr: window.__fc007XhrCount || 0,
      }));
      const finalDiag = await iso(\`(() => globalThis.__FC007_SMOKE_CTRL__.getSprint3aDiagnosticsForTest())()\`);
      await page.close();
      return {
        ok:
          !!ui.continueVisible &&
          !!ui.cancelFocused &&
          untrusted?.acceptedAfter === 0 &&
          mouseDiag.continueValidationPass >= 1 &&
          keyDiag.acceptedContinueAttempts >= 1 &&
          formProbe.ok &&
          buttonProbe.ok &&
          routeProbe.ok &&
          effectsProbe.ok &&
          effectsRootProbe.ok &&
          doubleProbe.ok &&
          native.submit === 0 &&
          native.fetch === 0 &&
          native.xhr === 0 &&
          finalDiag.armCount === 0 &&
          finalDiag.executorCount === 0 &&
          finalDiag.authorizedReleaseCount === 0,
        ui,
        afterEnter,
        untrusted,
        mouseDiag,
        keyDiag,
        formProbe,
        buttonProbe,
        routeProbe,
        effectsProbe,
        effectsRootProbe,
        doubleProbe,
        staleDiag: formProbe,
        native,
        finalDiag,
        requestLedger,
        externalGitHubAllowed: requestLedger.filter((e) => /github\\\\.com/i.test(e.url) && e.disposition === "allowed").length,
      };
    } catch (err) {
      try { if (page) await page.close(); } catch {}
      return { ok: false, error: String(err), phase };
    }
  })();

  process.stdout.write(JSON.stringify({
    ok: true,
    tmpExt: TMP_EXT,
    baseline,
    stageA,
    stageB,
    stageC,
    stageD,
    textData,
    disabled,
    widget,
    sprint2,
    sprint3a,
    probe1,
    probe2,
    probe3,
    probe4,
    mediumProbeA,
    mediumProbeB,
    mediumProbeC,
    mediumProbeD,
    mediumProbeE,
    pendingFormRace,
    chromeVersion: await browser.version(),
  }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err) }));
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(TMP_EXT, { recursive: true, force: true });
}
`,
);

let last = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  ok(`Chrome smoke attempt ${attempt}/${MAX_ATTEMPTS}`);
  const child = spawnSync(process.execPath, [workerPath], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    maxBuffer: 20 * 1024 * 1024,
  });
  let result = null;
  try {
    result = JSON.parse((child.stdout || "").trim() || "{}");
  } catch {
    ok(
      `attempt ${attempt} parse-fail status=${child.status} out=${(child.stdout || "").slice(0, 160)} err=${(child.stderr || "").slice(0, 160)}`,
    );
    continue;
  }
  if (!result.ok || !result.baseline?.ok) {
    ok(
      `attempt ${attempt} worker-not-ok status=${child.status} err=${result.error || result.baseline?.error || (child.stderr || "").slice(0, 200)}`,
    );
    continue;
  }
  last = result;
  ok(`temporary smoke extension prepared at ${result.tmpExt}`);
  ok(`real Chrome launched executable=${CHROME}`);
  ok(`synthetic URL intercepted locally: ${SYNTHETIC_URL}`);
  ok(`trusted smoke diagnostic recognition kind=${result.baseline.recognized.kind}`);
  break;
}

fs.rmSync(workerPath, { force: true });

if (!last?.baseline?.ok) fail(`no trusted diagnostic recognition after ${MAX_ATTEMPTS} attempts`);

const baseline = last.baseline;
ok(`Chrome version ${baseline.chromeVersion}`);
const kinds = baseline.kinds || [];
if (
  !(kinds.includes("awaiting-dom") || (baseline.bootEvents || []).some((b) => b.readyState === "loading"))
) {
  fail(`missing document_start awaiting-dom; kinds=${JSON.stringify(kinds)}`);
}
ok("document_start lifecycle awaiting-dom → recognized/evaluated");

const n = baseline.native;
if (!n.showModalOpen || !n.modal || n.disabled !== false || n.diagnosticEl) {
  fail(`native modal/diagnostic failure: ${JSON.stringify(n)}`);
}
ok("native showModal / :modal / :disabled; no page diagnostic DOM");
if (
  baseline.recognized.ownerNormalized !== "fixture-owner" ||
  baseline.recognized.repoNormalized !== "fixture-repo"
) {
  fail("owner/repo mismatch");
}
ok("semantic recognition matched fixture-owner/fixture-repo");
if (
  n.finalClickCount ||
  n.trustedClickCount ||
  n.untrustedClickCount ||
  n.submitCount ||
  n.requestSubmitCount ||
  n.fetchCount ||
  n.xhrCount
) {
  fail(`activation counters non-zero: ${JSON.stringify(n)}`);
}
ok("final-button clicks=0 trusted=0 untrusted=0 submit=0 requestSubmit=0 fetch=0 xhr=0");

function assertCountersZero(native, label) {
  if (
    native.finalClickCount ||
    native.trustedClickCount ||
    native.untrustedClickCount ||
    native.submitCount ||
    native.requestSubmitCount ||
    native.fetchCount ||
    native.xhrCount
  ) {
    fail(`${label} activation counters non-zero: ${JSON.stringify(native)}`);
  }
}

function assertStageSession(label, probe, { expectEvaluated, expectedDiagnosticStage }) {
  if (!probe?.ok) fail(`${label} probe failed: ${probe?.error || "unknown"}`);
  if (probe.expectEvaluated !== expectEvaluated) {
    fail(`${label} expectEvaluated mismatch`);
  }
  const kind = probe.recognized?.kind;
  if (expectedDiagnosticStage && probe.recognized?.stage !== expectedDiagnosticStage) {
    fail(`${label} diagnostic stage mismatch: ${probe.recognized?.stage}`);
  }
  if (expectEvaluated) {
    if (kind !== "evaluated" && kind !== "contract-recognized") {
      fail(`${label} expected evaluated/contract-recognized got ${kind}`);
    }
    if (!probe.kinds.includes("evaluated")) {
      fail(`${label} missing evaluated in kinds ${JSON.stringify(probe.kinds)}`);
    }
  } else {
    if (kind !== "stage-recognized") {
      fail(`${label} expected stage-recognized got ${kind}`);
    }
    if (probe.kinds.includes("evaluated")) {
      fail(`${label} must not evaluate consequences`);
    }
    if (probe.recognized?.readiness === "enabled") {
      fail(`${label} readiness must not be enabled for intermediate stage`);
    }
  }
  assertCountersZero(probe.native, label);
  ok(`${label} diagnostic stage=${probe.recognized?.stage} kind=${kind} counters=0`);
}

assertStageSession("stage-a", last.stageA, {
  expectEvaluated: false,
  expectedDiagnosticStage: "settings-private",
});
assertStageSession("stage-b", last.stageB, {
  expectEvaluated: false,
  expectedDiagnosticStage: "intent-confirmation",
});
assertStageSession("stage-c", last.stageC, {
  expectEvaluated: false,
  expectedDiagnosticStage: "effects-acknowledgement",
});
assertStageSession("stage-d", last.stageD, {
  expectEvaluated: true,
  expectedDiagnosticStage: "final-confirmation",
});
ok("V2 fixture stages via __fc007SetStage without FC clicks");

function assertFreshnessProbe(label, probe) {
  if (!probe?.ok) fail(`${label} probe failed: ${probe?.error || "unknown"}`);
  const f = probe.freshness;
  if (!f || f.err) fail(`${label} freshness read failed: ${JSON.stringify(f)}`);
  if (f.kind === "evaluated" || f.kind === "contract-recognized") {
    fail(`${label} still recognized/evaluated after mutation: ${JSON.stringify(f)}`);
  }
  if (f.hasObs || f.hasEval) {
    fail(`${label} still has observation/evaluation: ${JSON.stringify(f)}`);
  }
  ok(`${label} current-read invalidated (kind=${f.kind})`);
}

assertFreshnessProbe("text.data", last.textData);
assertFreshnessProbe("disabled", last.disabled);
assertFreshnessProbe("confirm-widget", last.widget);

const sprint2 = last.sprint2;
if (!sprint2?.ok) fail(`sprint2 probe failed: ${JSON.stringify(sprint2)}`);
if (sprint2.preview?.previewMode !== "verified" || !sprint2.preview?.previewVisible) {
  fail(`sprint2 preview not verified: ${JSON.stringify(sprint2.preview)}`);
}
ok("sprint2 trusted click intercepted; VERIFIED preview visible");
if (sprint2.afterCancel?.previewVisible) {
  fail(`sprint2 preview still visible after Cancel: ${JSON.stringify(sprint2.afterCancel)}`);
}
ok("sprint2 Cancel dismissed preview; no page action");
if (sprint2.afterUntrusted?.previewVisible && sprint2.afterUntrusted?.previewMode === "verified") {
  fail(`sprint2 untrusted click obtained verified preview: ${JSON.stringify(sprint2.afterUntrusted)}`);
}
ok("sprint2 untrusted programmatic click did not obtain verified preview authority");
assertCountersZero(sprint2.native, "sprint2");
if (sprint2.native?.hasContinueText) fail("sprint2 page text unexpectedly contains Continue");
if (sprint2.externalGitHubAllowed) fail(`sprint2 allowed external GitHub requests: ${sprint2.externalGitHubAllowed}`);
ok("sprint2 counters=0 Continue absent from page text external GitHub=0");

const sprint3a = last.sprint3a;
if (!sprint3a?.ok) fail(`sprint3a probe failed: ${JSON.stringify(sprint3a)}`);
if (!sprint3a.ui?.continueVisible) fail(`sprint3a Continue not visible: ${JSON.stringify(sprint3a.ui)}`);
if (!sprint3a.ui?.cancelFocused) fail(`sprint3a Cancel not default focus: ${JSON.stringify(sprint3a.ui)}`);
ok("sprint3a Continue visible; Cancel default focus");
if (sprint3a.untrusted?.acceptedAfter !== 0) fail(`sprint3a untrusted Continue accepted: ${JSON.stringify(sprint3a.untrusted)}`);
ok("sprint3a untrusted Continue rejected");
if (sprint3a.mouseDiag?.acceptedContinueAttempts !== 1 || sprint3a.mouseDiag?.continueValidationPass < 1) {
  fail(`sprint3a trusted mouse Continue failed: ${JSON.stringify(sprint3a.mouseDiag)}`);
}
ok("sprint3a trusted mouse Continue validated once; release once");
if (!sprint3a.keyDiag || sprint3a.keyDiag.armCount !== 1) {
  fail(`sprint3a keyboard Continue failed: ${JSON.stringify(sprint3a.keyDiag)}`);
}
ok("sprint3a trusted keyboard Continue validated; release once");
if (sprint3a.afterEnter?.accepted !== 0) fail(`sprint3a Enter accepted Continue: ${JSON.stringify(sprint3a.afterEnter)}`);
ok("sprint3a immediate Enter cancels (not Continue)");
if (!sprint3a.formProbe?.ok || sprint3a.formProbe.validation !== "INVALID_STALE_DECISION") {
  fail(`sprint3a form replacement probe failed: ${JSON.stringify(sprint3a.formProbe)}`);
}
ok(
  `sprint3a form replacement validator=${sprint3a.formProbe.validation} reason=${sprint3a.formProbe.reason} observerDependency=false`,
);
if (!sprint3a.buttonProbe?.ok || sprint3a.buttonProbe.reason !== "BUTTON_IDENTITY") {
  fail(`sprint3a button replacement probe failed: ${JSON.stringify(sprint3a.buttonProbe)}`);
}
ok(
  `sprint3a button replacement validator=${sprint3a.buttonProbe.validation} reason=${sprint3a.buttonProbe.reason} identityChanged=true`,
);
if (!sprint3a.routeProbe?.ok || sprint3a.routeProbe.validation !== "INVALID_STALE_DECISION") {
  fail(`sprint3a route/repo probe failed: ${JSON.stringify(sprint3a.routeProbe)}`);
}
ok(
  `sprint3a route/repo validator=${sprint3a.routeProbe.validation} reason=${sprint3a.routeProbe.reason}`,
);
if (!sprint3a.effectsProbe?.ok || sprint3a.effectsProbe.reason !== "EFFECTS_FINGERPRINT") {
  fail(`sprint3a effects paragraph probe failed: ${JSON.stringify(sprint3a.effectsProbe)}`);
}
ok(
  `sprint3a effects paragraph reason=${sprint3a.effectsProbe.reason} fpChanged=${sprint3a.effectsProbe.fingerprintChanged} observerDependency=false arm=0`,
);
if (!sprint3a.effectsRootProbe?.ok || sprint3a.effectsRootProbe.reason !== "EFFECTS_FINGERPRINT") {
  fail(`sprint3a effects root prose probe failed: ${JSON.stringify(sprint3a.effectsRootProbe)}`);
}
ok(
  `sprint3a effects root reason=${sprint3a.effectsRootProbe.reason} fpChanged=${sprint3a.effectsRootProbe.fingerprintChanged} observerPaused=true arm=0`,
);
if (!sprint3a.doubleProbe?.ok || sprint3a.doubleProbe.totalDelta !== 1) {
  fail(`sprint3a double Continue probe failed: ${JSON.stringify(sprint3a.doubleProbe)}`);
}
ok(
  `sprint3a double Continue decision=${sprint3a.doubleProbe.decisionId} before=${sprint3a.doubleProbe.acceptedBefore} afterFirst=${sprint3a.doubleProbe.acceptedAfterFirst} afterSecond=${sprint3a.doubleProbe.acceptedAfterSecond} delta=${sprint3a.doubleProbe.totalDelta} arm=1 executor=1 authorized=1`,
);
if (sprint3a.finalDiag?.armCount !== 0 || sprint3a.finalDiag?.executorCount !== 0 || sprint3a.finalDiag?.authorizedReleaseCount !== 0) {
  fail(`sprint3a cancel-session release counters non-zero: ${JSON.stringify(sprint3a.finalDiag)}`);
}
ok("sprint3a cancel-session arm=0 executor=0 authorizedRelease=0");
if (sprint3a.externalGitHubAllowed) fail(`sprint3a allowed external GitHub: ${sprint3a.externalGitHubAllowed}`);

if (!last.probe1?.ok) fail(`Chrome Probe 1 deep descendant failed: ${JSON.stringify(last.probe1)}`);
ok(
  `Chrome Probe 1 deep descendant depth=${last.probe1.native?.depth} preview=${last.probe1.previewMode} target=${last.probe1.native?.targetHandler} ancestor=${last.probe1.native?.ancestorHandler} submit=${last.probe1.native?.submit}`,
);
if (!last.probe2?.ok) fail(`Chrome Probe 2 stale-repeat failed: ${JSON.stringify(last.probe2)}`);
ok(
  `Chrome Probe 2 firstStopped=${last.probe2.firstStopped} second ancestor=${last.probe2.afterSecond?.ancestor} submit=${last.probe2.afterSecond?.submit}`,
);
if (!last.probe3?.ok) fail(`Chrome Probe 3 native Cancel failed: ${JSON.stringify(last.probe3)}`);
ok(
  `Chrome Probe 3 hostInside=${last.probe3.info?.hostInsideDialog} focus=${last.probe3.info?.cancelFocused} hitTest=${last.probe3.info?.hitTest} dismissed=${last.probe3.dismissed}`,
);
if (!last.probe4?.ok) fail(`Chrome Probe 4 automatic freshness failed: ${JSON.stringify(last.probe4)}`);
ok(
  `Chrome Probe 4 disabled=${last.probe4.disabled?.ok} secondMain=${last.probe4.secondMain?.ok} form=${last.probe4.form?.ok} route=${last.probe4.route?.ok} manualGetter=false`,
);

if (!last.mediumProbeA?.ok) {
  fail(`Chrome Medium Probe A effects aria-label failed: ${JSON.stringify(last.mediumProbeA)}`);
}
ok(
  `Chrome Medium Probe A effects aria-label auto-invalidated latencyMs=${last.mediumProbeA.latencyMs} getter=false`,
);
if (!last.mediumProbeB?.ok) {
  fail(`Chrome Medium Probe B final name failed: ${JSON.stringify(last.mediumProbeB)}`);
}
ok(
  `Chrome Medium Probe B final name auto-invalidated latencyMs=${last.mediumProbeB.latencyMs} getter=false`,
);
if (!last.mediumProbeC?.ok) {
  fail(`Chrome Medium Probe C host role failed: ${JSON.stringify(last.mediumProbeC)}`);
}
ok(
  `Chrome Medium Probe C host role auto-invalidated latencyMs=${last.mediumProbeC.latencyMs} getter=false`,
);
if (!last.mediumProbeD?.ok) {
  fail(`Chrome Medium Probe D exact dialog cap failed: ${JSON.stringify(last.mediumProbeD)}`);
}
ok(
  `Chrome Medium Probe D pageCount=${last.mediumProbeD.pageCount} hostMounted=${last.mediumProbeD.hostInfo?.hostMounted} plusOne=${last.mediumProbeD.plusOne?.ok}`,
);
if (!last.mediumProbeE?.ok) {
  fail(`Chrome Medium Probe E native Cancel failed: ${JSON.stringify(last.mediumProbeE)}`);
}
ok(
  `Chrome Medium Probe E focus=${last.mediumProbeE.info?.cancelFocused} hitTest=${last.mediumProbeE.info?.hitTest} dismissed=${last.mediumProbeE.dismissed}`,
);
if (last.chromeVersion) ok(`Chrome version ${last.chromeVersion}`);

if (!last.pendingFormRace?.ok) {
  fail(`Chrome pending form race failed: ${JSON.stringify(last.pendingFormRace)}`);
}
ok(
  `Chrome pending form race delayed=${last.pendingFormRace.evaluationDelayed} replaced=${last.pendingFormRace.formReplacedWhilePending} verified=${last.pendingFormRace.sawVerified} post ancestor=${last.pendingFormRace.native?.ancestor} submit=${last.pendingFormRace.native?.submit}`,
);

function isExactOrSlash(url) {
  return url === SYNTHETIC_URL || url === `${SYNTHETIC_URL}/`;
}
const ledger = baseline.requestLedger || [];
if (ledger.some((e) => e.disposition === "allowed" && /^https?:/i.test(e.url))) {
  fail("allowed external HTTP(S)");
}
if (!ledger.some((e) => e.disposition === "fulfilled-local-fixture" && isExactOrSlash(e.url))) {
  fail("synthetic GitHub URL was not fulfilled locally");
}
if (ledger.some((e) => /github\.com/i.test(e.url) && e.disposition === "allowed")) {
  fail("live GitHub request was allowed");
}
ok(
  `request ledger: fulfilled-local=${ledger.filter((e) => e.disposition === "fulfilled-local-fixture").length} blocked=${ledger.filter((e) => e.disposition === "blocked").length} allowed-non-http=${ledger.filter((e) => e.disposition === "allowed").length}`,
);
ok("live GitHub contacted: NO");
ok("exact synthetic URL fulfillment");
ok("production vs smoke: temp smoke build dir; committed manifest uses production only");
ok("release capability: Continue→releaseOnce present; no ArmedRelease / requestSubmit / 3B harness in production bundle");
ok("cleanup navigation / temp smoke artifacts");
cleanupSmokeBuild();
ok("genuine Chrome passive smoke complete");
process.exit(0);
