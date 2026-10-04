#!/usr/bin/env node
/**
 * FC-007 Sprint 3C — maintained Chrome gate for production Continue → one-shot release.
 *
 * Product under test: UNCHANGED normal production artifact
 *   dist/fc007-observation.bundle.js
 *
 * Harness uses Chrome DevTools Protocol Debugger instrumentation only.
 * Does NOT depend on production globals (__FC007_CTRL__ or replacements).
 * Does NOT enable FC007_BUILD_SMOKE / smoke-entry.
 * Synthetic local fixture only — no live GitHub.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(EXT_ROOT, "dist");
const FIXTURE = path.join(EXT_ROOT, "tests/fixtures/fc007/v2/github-settings-v2.html");
const SYNTHETIC_URL = "https://github.com/fixture-owner/fixture-repo/settings";
const MAX_ATTEMPTS = 5;
const requireFromExt = createRequire(path.join(EXT_ROOT, "package.json"));

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("[ACTUALLY EXECUTED]", msg);
}
function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function resolvePuppeteerCorePath() {
  try {
    const resolved = requireFromExt.resolve("puppeteer-core");
    ok(`browser driver (puppeteer-core) resolved: ${resolved}`);
    return resolved;
  } catch (err) {
    fail(
      "RUNTIME_VERIFICATION_BLOCKED: BROWSER DRIVER DEPENDENCY UNAVAILABLE: " +
        String(err && err.message ? err.message : err),
    );
  }
}

const PUPPETEER_CORE_PATH = resolvePuppeteerCorePath();

function discoverLocalChromeForTesting() {
  const homes = [process.env.HOME, os.homedir()].filter(Boolean);
  const found = [];
  for (const home of homes) {
    const roots = [
      path.join(home, "Library/Caches/ms-playwright"),
      path.join(home, ".cache/ms-playwright"),
      path.join(home, ".cache/puppeteer"),
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        const walk = (dir, depth) => {
          if (depth > 6) return;
          let entries = [];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              if (ent.name === "Google Chrome for Testing.app") {
                const bin = path.join(
                  full,
                  "Contents/MacOS/Google Chrome for Testing",
                );
                if (fs.existsSync(bin)) found.push(bin);
              } else if (
                ent.name === "chrome-mac-arm64" ||
                ent.name === "chrome-mac-x64" ||
                ent.name.startsWith("chromium") ||
                ent.name.startsWith("chrome")
              ) {
                walk(full, depth + 1);
              } else if (depth < 3) {
                walk(full, depth + 1);
              }
            }
          }
        };
        walk(root, 0);
      } catch {
        /* ignore */
      }
    }
  }
  return [...new Set(found)];
}

function resolveChromeBinary() {
  const candidates = [
    process.env.FC007_CHROME_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ...discoverLocalChromeForTesting(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  // Prefer Chrome for Testing over generic Chrome when both exist.
  const ranked = [...new Set(candidates)].sort((a, b) => {
    const aCft = /Chrome for Testing/i.test(a) ? 0 : 1;
    const bCft = /Chrome for Testing/i.test(b) ? 0 : 1;
    return aCft - bCft;
  });
  const probe = `
    import { createRequire } from "node:module";
    import * as fs from "node:fs";
    import * as os from "node:os";
    import * as path from "node:path";
    const require = createRequire(import.meta.url);
    let puppeteer;
    try {
      puppeteer = require(${JSON.stringify(PUPPETEER_CORE_PATH)});
    } catch (e) {
      console.error("DRIVER_IMPORT_FAILED", e && e.message);
      process.exit(3);
    }
    const bin = process.argv[1];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-chrome-probe-"));
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-chrome-probep-"));
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({
      manifest_version: 3, name: "probe", version: "0",
      content_scripts: [{
        matches: ["https://example.invalid/*"],
        js: ["c.js"], run_at: "document_start", world: "ISOLATED",
      }],
    }));
    fs.writeFileSync(path.join(tmp, "c.js"), "void 0;");
    const browser = await puppeteer.launch({
      executablePath: bin,
      headless: "new",
      userDataDir: prof,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--disable-extensions-except=" + tmp,
        "--load-extension=" + tmp,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--single-process",
        "--disable-dev-shm-usage",
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
      ],
    });
    try {
      await new Promise((r) => setTimeout(r, 800));
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        try { page.mainFrame(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      await page.goto("data:text/html,<h1>ok</h1>", { waitUntil: "domcontentloaded", timeout: 15000 });
      const t = await page.title();
      // Extension targets should appear when --load-extension works.
      const targets = browser.targets().map((x) => x.type());
      const hasExtTarget = targets.includes("service_worker") || targets.includes("background_page") || targets.includes("other");
      await browser.close();
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
      if (t !== "ok" && t !== "") process.exit(2);
      // Soft signal only — some CfT builds still inject content scripts without SW targets.
      process.exit(0);
    } catch (e) {
      try { await browser.close(); } catch {}
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
      process.exit(1);
    }
  `;
  let sawExisting = false;
  for (const bin of ranked) {
    if (!fs.existsSync(bin)) {
      ok(`Chrome candidate missing: ${bin}`);
      continue;
    }
    sawExisting = true;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe, bin], {
      encoding: "utf8",
      timeout: 45000,
    });
    if (r.status === 3) {
      fail("RUNTIME_VERIFICATION_BLOCKED: BROWSER DRIVER DEPENDENCY UNAVAILABLE");
    }
    if (r.status === 0) {
      ok(`Chrome binary selected: ${bin}`);
      return bin;
    }
    ok(`Chrome binary rejected (startup/navigation probe failed): ${bin}`);
  }
  if (!sawExisting) {
    fail("RUNTIME_VERIFICATION_BLOCKED: NO USABLE CHROME EXECUTABLE");
  }
  fail("RUNTIME_VERIFICATION_BLOCKED: NO USABLE CHROME EXECUTABLE");
}

const CHROME = resolveChromeBinary();

const prodBundle = path.join(DIST, "fc007-observation.bundle.js");
execFileSync("pnpm", ["run", "build"], { cwd: EXT_ROOT, stdio: "inherit" });
if (!fs.existsSync(prodBundle)) fail("fc007-observation.bundle.js missing after normal build");
if (!fs.existsSync(CHROME)) fail(`Chrome for Testing missing at ${CHROME}`);
if (!fs.existsSync(FIXTURE)) fail(`fixture missing at ${FIXTURE}`);

const originalHash = sha256File(prodBundle);
ok(`product artifact hash=${originalHash}`);

for (const needle of ["releaseOnce", "ACTION_ADMITTED_ONCE", "controller.start()"]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
  } catch (err) {
    if (err && err.status === 1) fail(`production bundle missing expected ${needle}`);
    throw err;
  }
}
for (const needle of [
  "__FC007_CTRL__",
  "__FC007_CONTROLLER__",
  "__FC007_RELEASE__",
  "__FC007_DEBUG__",
  "__FC007_TEST__",
  "__FC007_3B_HARNESS__",
  "__FC007_SMOKE_CTRL__",
  "betweenValidationAndReleaseForTest",
  "testNativeExecutorForTest",
  "requestSubmit",
  "ArmedContinuation",
  "sprint3b-smoke-entry",
  "smoke-entry",
  "bindIsolatedControllerHandle",
]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
    fail(`production bundle contains forbidden ${needle}`);
  } catch (err) {
    if (err && err.status !== 1) throw err;
  }
}
ok("normal production bundle Sprint-3C path + no production controller global");
ok(`product artifact: ${prodBundle}`);

const bundleLines = fs.readFileSync(prodBundle, "utf8").split("\n");
let controllerStartLine = -1;
for (let i = 0; i < bundleLines.length; i += 1) {
  if (/^\s*controller\.start\(\);\s*$/.test(bundleLines[i])) {
    controllerStartLine = i;
    break;
  }
}
if (controllerStartLine < 0) fail("could not locate controller.start() line in production bundle");

/**
 * Shared collection-boundary helpers (Node + worker).
 * Missing evidence must remain invalid — never coerce to 0/"0".
 */
const COLLECTION_HELPERS_JS = `
function collectionFail(msg) {
  throw new Error(msg);
}
function parseRequiredFiniteNumericAttributeRaw(raw, label) {
  if (raw === null || raw === undefined) {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required attribute missing (null): " + label,
    );
  }
  if (typeof raw !== "string") {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required attribute not a string: " +
        label +
        " gotType=" +
        typeof raw,
    );
  }
  if (raw.trim() === "") {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required attribute empty/whitespace: " + label,
    );
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required attribute not finite number: " +
        label +
        " raw=" +
        JSON.stringify(raw),
    );
  }
  return numeric;
}
function readRequiredFiniteNumericAttribute(element, attributeName, label) {
  if (!element || typeof element.getAttribute !== "function") {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required attribute element missing: " + label,
    );
  }
  return parseRequiredFiniteNumericAttributeRaw(
    element.getAttribute(attributeName),
    label || attributeName,
  );
}
function readRequiredFiniteCounter(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required finite counter missing/invalid: " +
        label +
        " got=" +
        String(value),
    );
  }
  return value;
}
function readRequiredPageCounterSnap(snap, label) {
  if (!snap || typeof snap !== "object") {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required page counter snap missing: " + label,
    );
  }
  if (snap.present !== true) {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required page counter property absent: " + label,
    );
  }
  return readRequiredFiniteCounter(snap.value, label);
}
function materializeNativeNetworkCounters(raw, prefix) {
  if (!raw || typeof raw !== "object") {
    collectionFail(
      "RUNTIME_VERIFICATION_BLOCKED: required network counter object missing: " + prefix,
    );
  }
  return {
    fetch: readRequiredPageCounterSnap(raw.fetch, prefix + ".fetch"),
    xhr: readRequiredPageCounterSnap(raw.xhr, prefix + ".xhr"),
    submit: readRequiredPageCounterSnap(raw.submit, prefix + ".submit"),
    nav: readRequiredPageCounterSnap(raw.nav, prefix + ".nav"),
  };
}
function snapPageNetworkCountersFromWindow(win) {
  function snap(name) {
    const present = Object.prototype.hasOwnProperty.call(win, name);
    return { present: present === true, value: present ? win[name] : undefined };
  }
  return {
    fetch: snap("__fc007FetchCount"),
    xhr: snap("__fc007XhrCount"),
    submit: snap("__fc007SubmitCount"),
    nav: snap("__fc007NavCount"),
  };
}
function materializeM1NestedObservation(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.done !== "1") return null;
  const nestedWindow = parseRequiredFiniteNumericAttributeRaw(
    raw.winDeltaRaw,
    "m1 data-fc007-m1-win-delta",
  );
  const nestedTarget = parseRequiredFiniteNumericAttributeRaw(
    raw.tgtDeltaRaw,
    "m1 data-fc007-m1-tgt-delta",
  );
  return {
    realDispatch: raw.realDispatchRaw === "1",
    nestedPrevented: raw.nestedPreventedRaw === "1",
    nestedWindow: nestedWindow,
    nestedTarget: nestedTarget,
    nestedWindowMeasured: true,
    nestedTargetMeasured: true,
    viaProcessEvent: false,
  };
}
`;

const collectionHelpers = new Function(
  COLLECTION_HELPERS_JS +
    "; return { collectionFail, parseRequiredFiniteNumericAttributeRaw, readRequiredFiniteNumericAttribute, readRequiredFiniteCounter, readRequiredPageCounterSnap, materializeNativeNetworkCounters, snapPageNetworkCountersFromWindow, materializeM1NestedObservation };",
)();

const workerPath = path.join(os.tmpdir(), `fc007-3c-worker-${process.pid}.mjs`);
fs.writeFileSync(
  workerPath,
  `import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);
const puppeteer = (require(${JSON.stringify(PUPPETEER_CORE_PATH)}).default) ?? require(${JSON.stringify(PUPPETEER_CORE_PATH)});
const CHROME = ${JSON.stringify(CHROME)};
const PROD_BUNDLE = ${JSON.stringify(prodBundle)};
const ORIGINAL_HASH = ${JSON.stringify(originalHash)};
const CONTROLLER_START_LINE = ${JSON.stringify(controllerStartLine)};
const FIXTURE = ${JSON.stringify(FIXTURE)};
const SYNTHETIC_URL = ${JSON.stringify(SYNTHETIC_URL)};
const fixtureHtml = fs.readFileSync(FIXTURE, "utf8");

${COLLECTION_HELPERS_JS}

function isExactSynthetic(url) {
  return url === SYNTHETIC_URL || url === SYNTHETIC_URL + "/";
}
function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const FORBIDDEN_GLOBALS = [
  "__FC007_CTRL__",
  "__FC007_CONTROLLER__",
  "__FC007_RELEASE__",
  "__FC007_DEBUG__",
  "__FC007_TEST__",
  "__FC007_SMOKE_CTRL__",
  "__FC007_3B_HARNESS__",
];

const TMP_EXT = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-3c-ext-"));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-3c-prof-"));
const copiedBundle = path.join(TMP_EXT, "fc007-observation.bundle.js");
fs.copyFileSync(PROD_BUNDLE, copiedBundle);
const copyHash = sha256File(copiedBundle);
if (copyHash !== ORIGINAL_HASH) {
  throw new Error("TMP_EXT bundle not byte-identical to production artifact");
}
fs.writeFileSync(path.join(TMP_EXT, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "fc007-3c-prod",
  version: "0",
  content_scripts: [{
    matches: ["https://github.com/*/*/settings*"],
    js: ["fc007-observation.bundle.js"],
    run_at: "document_start",
    all_frames: false,
    world: "ISOLATED",
  }],
}));

// CfT 142 + --load-extension: without --single-process/--disable-gpu, Puppeteer
 // hits "Requesting main frame too early!" / ConnectionClosed. Harness-only.
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
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

await new Promise((r) => setTimeout(r, 2000));

async function acquirePage() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const pages = await browser.pages();
    for (const p of pages) {
      try {
        p.mainFrame();
        // Reuse a ready blank tab when present (single-process FrameManager).
        if (p.url() === "about:blank" || p.url() === "") return p;
      } catch {
        /* not ready */
      }
    }
    try {
      const page = await browser.newPage();
      const readyDeadline = Date.now() + 5000;
      while (Date.now() < readyDeadline) {
        try {
          page.mainFrame();
          return page;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("RUNTIME VERIFICATION BLOCKED: Puppeteer main frame unavailable");
}

let chromeVersion = "unknown";
try {
  chromeVersion = await browser.version();
} catch {}

let happy = null;
let cancelCase = null;
let escapeCase = null;
let untrustedCase = null;
let doubleCase = null;
let staleEffects = null;
let staleButton = null;
let closedModal = null;
let dispatchStop = null;
let h1 = null;
let a2 = null;

try {
  async function openStageDPage(opts) {
    const preventSubmit = !(opts && opts.preventSubmit === false);
    const requestLedger = [];
    const liveContextIds = new Set();
    let contentScriptContextId = null;
    let controllerObjectId = null;
    const page = await acquirePage();

    await page.evaluateOnNewDocument(() => {
      window.__fc007FetchCount = 0;
      window.__fc007XhrCount = 0;
      window.__fc007SubmitCount = 0;
      window.__fc007NavCount = 0;
      const origFetch = window.fetch?.bind(window);
      if (origFetch) {
        window.fetch = (...args) => {
          window.__fc007FetchCount = (window.__fc007FetchCount || 0) + 1;
          return origFetch(...args);
        };
      }
      const XHR = window.XMLHttpRequest;
      window.XMLHttpRequest = function (...args) {
        window.__fc007XhrCount = (window.__fc007XhrCount || 0) + 1;
        return new XHR(...args);
      };
      const origPush = history.pushState.bind(history);
      history.pushState = function (...args) {
        window.__fc007NavCount = (window.__fc007NavCount || 0) + 1;
        return origPush(...args);
      };
    });

    const cdp = await page.createCDPSession();
    await cdp.send("Runtime.enable");
    await cdp.send("Debugger.enable");
    cdp.on("Runtime.executionContextCreated", (e) => {
      if (typeof e?.context?.id === "number") liveContextIds.add(e.context.id);
    });
    cdp.on("Runtime.executionContextDestroyed", (e) => {
      if (typeof e?.executionContextId === "number") liveContextIds.delete(e.executionContextId);
      if (contentScriptContextId === e.executionContextId) contentScriptContextId = null;
    });

    let captureResolve = null;
    const capturePromise = new Promise((resolve) => {
      captureResolve = resolve;
    });
    const onPaused = async (ev) => {
      try {
        const frame = ev.callFrames?.[0];
        if (!frame) {
          await cdp.send("Debugger.resume").catch(() => {});
          return;
        }
        const r = await cdp.send("Debugger.evaluateOnCallFrame", {
          callFrameId: frame.callFrameId,
          expression: "controller",
          returnByValue: false,
        });
        if (r.result?.objectId) {
          controllerObjectId = r.result.objectId;
          if (typeof r.result.objectId === "string" && captureResolve) {
            captureResolve(controllerObjectId);
            captureResolve = null;
          }
        }
      } catch {
        // ignore
      } finally {
        await cdp.send("Debugger.resume").catch(() => {});
      }
    };
    cdp.on("Debugger.paused", onPaused);

    const bp = await cdp.send("Debugger.setBreakpointByUrl", {
      lineNumber: CONTROLLER_START_LINE,
      urlRegex: "fc007-observation\\\\.bundle\\\\.js",
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
    await Promise.race([
      capturePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("CTRL_CAPTURE_TIMEOUT")), 15000)),
    ]).catch(() => null);

    if (bp?.breakpointId) {
      await cdp.send("Debugger.removeBreakpoint", { breakpointId: bp.breakpointId }).catch(() => {});
    }
    cdp.off("Debugger.paused", onPaused);

    await page.evaluate((preventSubmit) => {
      if (window.__fc007SetStage) window.__fc007SetStage("d");
      const form = document.getElementById("visibility-form");
      if (form) {
        form.addEventListener("submit", (e) => {
          if (preventSubmit) e.preventDefault();
          window.__fc007SubmitCount = (window.__fc007SubmitCount || 0) + 1;
        });
      }
    }, preventSubmit);

    async function resolveIsolatedContextId() {
      if (contentScriptContextId && liveContextIds.has(contentScriptContextId)) {
        return contentScriptContextId;
      }
      for (const id of [...liveContextIds]) {
        try {
          const r = await cdp.send("Runtime.evaluate", {
            expression:
              "typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id) && typeof globalThis.__FC007_CTRL__ === 'undefined'",
            contextId: id,
            returnByValue: true,
          });
          if (r.result?.value === true) {
            contentScriptContextId = id;
            return id;
          }
        } catch {}
      }
      return contentScriptContextId;
    }

    const isoDeadline = Date.now() + 15000;
    while (Date.now() < isoDeadline) {
      if (await resolveIsolatedContextId()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    async function isoEval(expression) {
      let lastErr = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = (await resolveIsolatedContextId()) || contentScriptContextId;
        if (!id) {
          lastErr = new Error("NO_CONTENT_SCRIPT_CONTEXT");
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        try {
          const r = await cdp.send("Runtime.evaluate", {
            expression,
            contextId: id,
            returnByValue: true,
            awaitPromise: true,
          });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "ISO_EXCEPTION");
          return r.result?.value;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      throw lastErr || new Error("ISO_FAILED");
    }

    async function ctrl(functionBody) {
      if (!controllerObjectId) throw new Error("NO_CONTROLLER_OBJECT_ID");
      const r = await cdp.send("Runtime.callFunctionOn", {
        objectId: controllerObjectId,
        functionDeclaration: "function() { " + functionBody + " }",
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || "CTRL_CALL_FAILED");
      }
      return r.result?.value;
    }

    async function probeGlobals() {
      const pageProbe = await page.evaluate((names) => {
        const out = {};
        for (const n of names) out[n] = typeof globalThis[n];
        out.FutureClick = typeof globalThis.FutureClick;
        return out;
      }, FORBIDDEN_GLOBALS);
      const isoProbe = await isoEval(\`(function(names){
        const out = {};
        for (const n of names) out[n] = typeof globalThis[n];
        out.FutureClick = typeof globalThis.FutureClick;
        out.hasChromeRuntime = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
        out.invokeTrustedContinueForTest = typeof globalThis.invokeTrustedContinueForTest;
        return out;
      })(\${JSON.stringify(FORBIDDEN_GLOBALS)})\`);
      return { pageProbe, isoProbe };
    }

    return {
      page,
      cdp,
      requestLedger,
      ctrl,
      isoEval,
      probeGlobals,
      getControllerObjectId: () => controllerObjectId,
      originalHash: ORIGINAL_HASH,
      copyHash,
    };
  }

  async function openVerified(label, opts) {
    const session = await openStageDPage(opts);
    const { page, ctrl, probeGlobals } = session;
    const globals = await probeGlobals();
    for (const n of ${JSON.stringify([
      "__FC007_CTRL__",
      "__FC007_CONTROLLER__",
      "__FC007_RELEASE__",
      "__FC007_DEBUG__",
      "__FC007_TEST__",
      "__FC007_SMOKE_CTRL__",
      "__FC007_3B_HARNESS__",
    ])}) {
      if (globals.pageProbe[n] !== "undefined") {
      await page.close();
        return { ok: false, error: "PAGE_GLOBAL:" + n, globals, session: null };
      }
      if (globals.isoProbe[n] !== "undefined") {
        await page.close();
        return { ok: false, error: "ISO_GLOBAL:" + n, globals, session: null };
      }
    }
    if (!session.getControllerObjectId()) {
      await page.close();
      return { ok: false, error: "SETUP_NO_CTRL_OBJECT:" + label, globals, session: null };
    }
    const box = await page.$eval("#final-make-public", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const verifiedDeadline = Date.now() + 20000;
    let verified = false;
    while (Date.now() < verifiedDeadline) {
      const mode = await ctrl("return this.getPreviewMode ? this.getPreviewMode() : null;");
      if (mode === "verified") { verified = true; break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!verified) {
      await page.close();
      return { ok: false, error: "SETUP_NO_VERIFIED:" + label, session: null };
    }
    const snap = await ctrl(\`return {
      mode: this.getPreviewMode(),
      continueVisible: this.isContinueVisibleForTest(),
      cancelFocused: this.isPreviewCancelFocusedForTest(),
      continueCenter: this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null,
      cancelCenter: this.getPreviewCancelCenterForTest ? this.getPreviewCancelCenterForTest() : null,
      decisionId: this.getActiveDecisionForTest()?.decisionId || null,
      listener: this.isReleaseListenerInstalledForTest(),
      diag: this.getSprint3cDiagnosticsForTest(),
    };\`);
    if (!snap?.continueVisible || !snap?.continueCenter || !snap?.decisionId || !snap?.listener) {
      await page.close();
      return { ok: false, error: "SETUP_CONTINUE_UI:" + label, snap, session: null };
    }
    return { ok: true, session, snap, globals };
  }

  happy = await (async () => {
    try {
      const opened = await openVerified("happy");
      if (!opened.ok || !opened.session) return opened;
      const { page, requestLedger, ctrl } = opened.session;

      await ctrl(\`const release = this.getReleaseComponentForTest();
        window.addEventListener("click", () => {
          try {
            if (release && release.getReceipt && release.getReceipt().consumed === true) {
              document.documentElement.setAttribute("data-fc007-consumed", "1");
            }
          } catch {}
        }, true);
        return true;\`);

      await page.evaluate(() => {
        window.__FC007_PAGE_PROBE__ = {
          primaryWindowSeen: 0,
          nestedWindowSeen: 0,
          reusedWindowSeen: 0,
          descendantWindowSeen: 0,
          primaryTargetSeen: 0,
          nestedTargetSeen: 0,
          reusedTargetSeen: 0,
          descendantTargetSeen: 0,
          permissionConsumedBeforePageWindow: null,
          generatedIsTrusted: null,
          nestedPrevented: null,
          reusedFirstPrevented: null,
          reusedSecondPrevented: null,
          descPrevented: null,
          realm: "page",
          instanceTamperInstalled: false,
          prototypeTamperInstalled: false,
          instanceTamperCount: 0,
          prototypeTamperCount: 0,
        };
        const probe = window.__FC007_PAGE_PROBE__;
        window.addEventListener("click", (e) => {
          const phase = document.documentElement.getAttribute("data-fc007-probe-phase") || "";
          const consumed = document.documentElement.getAttribute("data-fc007-consumed") === "1";
          const button = document.getElementById("final-make-public");
          const onFinal =
            button instanceof HTMLButtonElement &&
            (e.target === button || button.contains(e.target));
          if (phase === "primary") {
            if (e.target !== button) return;
            probe.primaryWindowSeen += 1;
            probe.permissionConsumedBeforePageWindow = consumed;
          } else if (phase === "nested-fresh") {
            if (!onFinal) return;
            probe.nestedWindowSeen += 1;
          } else if (phase === "nested-reused") {
            if (!onFinal) return;
            probe.reusedWindowSeen += 1;
          } else if (phase === "nested-desc") {
            probe.descendantWindowSeen += 1;
          }
        }, true);
      });

      const pageTamperInstall = await page.evaluate(() => {
        const button = document.getElementById("final-make-public");
        if (!(button instanceof HTMLButtonElement)) return { ok: false, error: "NO_PAGE_BUTTON" };
        const probe = window.__FC007_PAGE_PROBE__;
        if (!probe || probe.realm !== "page") return { ok: false, error: "NO_PAGE_PROBE" };
        window.__pageInstanceClickTamperCount = 0;
        window.__pagePrototypeClickTamperCount = 0;
        window.__FC007_PAGE_TAMPER_RESTORE__ = {
          hadOwnClick: Object.prototype.hasOwnProperty.call(button, "click"),
          instanceClick: button.click,
          protoClick: HTMLButtonElement.prototype.click,
          button,
        };
        function pageRealmInstanceClickTamper() {
          window.__pageInstanceClickTamperCount += 1;
          probe.instanceTamperCount = window.__pageInstanceClickTamperCount;
        }
        function pageRealmPrototypeClickTamper() {
          window.__pagePrototypeClickTamperCount += 1;
          probe.prototypeTamperCount = window.__pagePrototypeClickTamperCount;
        }
        button.click = pageRealmInstanceClickTamper;
        HTMLButtonElement.prototype.click = pageRealmPrototypeClickTamper;
        probe.instanceTamperInstalled = button.click === pageRealmInstanceClickTamper;
        probe.prototypeTamperInstalled =
          HTMLButtonElement.prototype.click === pageRealmPrototypeClickTamper;
        return {
          ok: true,
          realm: probe.realm,
          instanceTamperInstalled: probe.instanceTamperInstalled,
          prototypeTamperInstalled: probe.prototypeTamperInstalled,
        };
      });
      if (!pageTamperInstall?.ok) {
        await page.close();
        return { ok: false, error: "PAGE_TAMPER_INSTALL_FAILED", pageTamperInstall };
      }

      await page.evaluate(() => {
        const button = document.getElementById("final-make-public");
        if (!(button instanceof HTMLButtonElement)) throw new Error("NO_BUTTON");
        const probe = window.__FC007_PAGE_PROBE__;
        const span = document.createElement("span");
        span.textContent = "x";
        button.appendChild(span);
        span.addEventListener("click", () => {
          probe.descendantTargetSeen += 1;
        });
        document.documentElement.removeAttribute("data-fc007-consumed");
        let primary = 0;
        button.addEventListener("click", (e) => {
          if (primary === 0) {
            primary += 1;
            probe.primaryTargetSeen += 1;
            probe.generatedIsTrusted = e.isTrusted;
            document.documentElement.setAttribute("data-fc007-probe-phase", "nested-fresh");
            const nested = new MouseEvent("click", { bubbles: true, cancelable: true });
            button.dispatchEvent(nested);
            probe.nestedPrevented = nested.defaultPrevented === true;
            if (!nested.defaultPrevented) probe.nestedTargetSeen += 1;

            document.documentElement.setAttribute("data-fc007-probe-phase", "nested-reused");
            const reused = new MouseEvent("click", { bubbles: true, cancelable: true });
            button.dispatchEvent(reused);
            probe.reusedFirstPrevented = reused.defaultPrevented === true;
            if (!reused.defaultPrevented) probe.reusedTargetSeen += 1;
            button.dispatchEvent(reused);
            probe.reusedSecondPrevented = reused.defaultPrevented === true;
            if (!reused.defaultPrevented) probe.reusedTargetSeen += 1;

            document.documentElement.setAttribute("data-fc007-probe-phase", "nested-desc");
            const nestedDesc = new MouseEvent("click", { bubbles: true, cancelable: true });
            span.dispatchEvent(nestedDesc);
            probe.descPrevented = nestedDesc.defaultPrevented === true;
            if (!nestedDesc.defaultPrevented) probe.descendantTargetSeen += 1;
          } else {
            probe.nestedTargetSeen += 1;
          }
        }, false);
      });

      await page.evaluate(() => {
        document.documentElement.setAttribute("data-fc007-probe-phase", "primary");
      });

      const contCenter = opened.snap.continueCenter;
      const beforeDiag = await ctrl("return this.getSprint3cDiagnosticsForTest();");
      await page.mouse.click(contCenter.x, contCenter.y);

      const releaseDeadline = Date.now() + 8000;
      let diag = null;
      while (Date.now() < releaseDeadline) {
        diag = await ctrl("return this.getSprint3cDiagnosticsForTest();");
        if (diag && (diag.releaseCalls >= 1 || diag.terminalOutcome === "CONSUMED" || diag.acceptedContinueAttempts > (beforeDiag?.acceptedContinueAttempts || 0))) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      const pageTamper = await page.evaluate(() => {
        const probe = window.__FC007_PAGE_PROBE__;
        const restore = window.__FC007_PAGE_TAMPER_RESTORE__;
        const out = {
          realm: probe && probe.realm,
          instanceTamperInstalled: !!(probe && probe.instanceTamperInstalled),
          prototypeTamperInstalled: !!(probe && probe.prototypeTamperInstalled),
          instanceTamperCount:
            typeof window.__pageInstanceClickTamperCount === "number"
              ? window.__pageInstanceClickTamperCount
              : -1,
          prototypeTamperCount:
            typeof window.__pagePrototypeClickTamperCount === "number"
              ? window.__pagePrototypeClickTamperCount
              : -1,
        };
        if (restore && restore.button) {
          if (restore.hadOwnClick) {
            restore.button.click = restore.instanceClick;
          } else {
            try { delete restore.button.click; } catch {
              restore.button.click = restore.instanceClick;
            }
          }
          HTMLButtonElement.prototype.click = restore.protoClick;
        }
        window.__FC007_PAGE_TAMPER_RESTORE__ = null;
        return out;
      });

      const pageProbe = await page.evaluate(() => window.__FC007_PAGE_PROBE__ || null);
      const nativeRaw = await page.evaluate(() => {
        function snap(name) {
          const present = Object.prototype.hasOwnProperty.call(window, name);
          return { present: present === true, value: present ? window[name] : undefined };
        }
        return {
          fetch: snap("__fc007FetchCount"),
          xhr: snap("__fc007XhrCount"),
          submit: snap("__fc007SubmitCount"),
          nav: snap("__fc007NavCount"),
        };
      });
      const native = materializeNativeNetworkCounters(nativeRaw, "happy.native");
      const globalsAfter = await opened.session.probeGlobals();

      await page.close();
      return {
        ok: true,
        diag,
        pageProbe,
        pageTamper,
        pageTamperInstall,
        native,
        requestLedger,
        globals: opened.globals,
        globalsAfter,
        copyHash: opened.session.copyHash,
        originalHash: opened.session.originalHash,
        externalGitHub: requestLedger.filter((e) => /github\\.com/i.test(e.url) && e.disposition === "allowed").length,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  async function runCase(name, mutate) {
    try {
      const opened = await openVerified(name);
      if (!opened.ok || !opened.session) return opened;
      const { page, requestLedger, ctrl } = opened.session;
      if (mutate) await mutate({ page, ctrl, snap: opened.snap });
      const before = await ctrl("return this.getSprint3cDiagnosticsForTest();");
      const center = await ctrl("return this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null;");
      if (center && name !== "cancel" && name !== "escape" && name !== "untrusted") {
        await page.mouse.click(center.x, center.y);
        await new Promise((r) => setTimeout(r, 400));
      }
      const after = await ctrl(\`return {
        mode: this.getPreviewMode(),
        continueVisible: this.isContinueVisibleForTest(),
        diag: this.getSprint3cDiagnosticsForTest(),
        decisionId: this.getActiveDecisionForTest()?.decisionId || null,
      };\`);
      const nativeRaw = await page.evaluate(() => {
        function snap(name) {
          const present = Object.prototype.hasOwnProperty.call(window, name);
          return { present: present === true, value: present ? window[name] : undefined };
        }
        return {
          fetch: snap("__fc007FetchCount"),
          xhr: snap("__fc007XhrCount"),
          submit: snap("__fc007SubmitCount"),
          nav: snap("__fc007NavCount"),
        };
      });
      const native = materializeNativeNetworkCounters(nativeRaw, name + ".native");
      await page.close();
      return { ok: true, name, before, after, native, requestLedger };
    } catch (err) {
      return { ok: false, name, error: String(err) };
    }
  }

  cancelCase = await runCase("cancel", async ({ page, ctrl }) => {
    const cancelCenter = await ctrl("return this.getPreviewCancelCenterForTest();");
    if (!cancelCenter) throw new Error("MISSING_CANCEL_CENTER");
    await page.mouse.click(cancelCenter.x, cancelCenter.y);
    await new Promise((r) => setTimeout(r, 300));
  });

  escapeCase = await runCase("escape", async ({ page }) => {
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
  });

  untrustedCase = await runCase("untrusted", async ({ ctrl }) => {
    await ctrl(\`this.invokeUntrustedContinueClickForTest();
      const btn = this.getContinueButtonForTest();
      if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;\`);
    await new Promise((r) => setTimeout(r, 300));
  });

  doubleCase = await (async () => {
    try {
      const opened = await openVerified("double");
      if (!opened.ok || !opened.session) return opened;
      const { page, requestLedger, ctrl } = opened.session;
      const center = opened.snap.continueCenter;
      await page.mouse.click(center.x, center.y);
      await new Promise((r) => setTimeout(r, 400));
      const afterFirst = await ctrl("return this.getSprint3cDiagnosticsForTest();");
      const center2 = await ctrl("return this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null;");
      if (center2) await page.mouse.click(center2.x, center2.y);
      // Second trusted attempt via debugger-held controller only (no production global helper).
      await ctrl("this.invokeTrustedContinueForTest(); return true;");
      await new Promise((r) => setTimeout(r, 300));
      const afterSecond = await ctrl("return this.getSprint3cDiagnosticsForTest();");
      await page.close();
      return { ok: true, afterFirst, afterSecond, requestLedger };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  staleEffects = await runCase("stale-effects", async ({ page, ctrl }) => {
    await ctrl("this.pauseFreshnessObserverForTest(); return true;");
    const mut = await page.evaluate(() => {
      const region = document.querySelector(
        'div[role="region"][aria-label="Effects of making this repository public"]',
      );
      if (!(region instanceof HTMLDivElement)) return { ok: false, error: "NO_EFFECTS" };
      const p = region.querySelector("p");
      if (!(p instanceof HTMLElement)) return { ok: false, error: "NO_P" };
      p.textContent = "MUTATED STAGE-D EFFECTS PROSE FOR 3C SMOKE";
      return { ok: true };
    });
    if (!mut?.ok) throw new Error("EFFECTS_MUTATION_FAILED:" + JSON.stringify(mut));
  });

  staleButton = await runCase("stale-button", async ({ ctrl }) => {
    await ctrl("this.pauseFreshnessObserverForTest(); return true;");
    const mut = await ctrl(\`const decision = this.getActiveDecisionForTest();
      const original = decision?.finalButton || null;
      if (!(original instanceof HTMLButtonElement)) return { ok: false, error: "NO_ORIGINAL" };
      const form = original.form || document.getElementById("visibility-form");
      if (!(form instanceof HTMLFormElement)) return { ok: false, error: "NO_FORM" };
      const replacement = document.createElement("button");
      replacement.type = "submit";
      replacement.id = "final-make-public";
      replacement.textContent = original.textContent || "Make this repository public";
      original.replaceWith(replacement);
      return {
        ok: true,
        differentIdentity: replacement !== original,
        originalConnected: original.isConnected,
      };\`);
    if (!mut?.ok || !mut.differentIdentity) throw new Error("BUTTON_REPLACE_FAILED:" + JSON.stringify(mut));
  });

  closedModal = await runCase("closed-modal", async ({ page, ctrl }) => {
    await ctrl("this.pauseFreshnessObserverForTest(); return true;");
    await page.evaluate(() => {
      const dialog = document.getElementById("visibility-dialog");
      if (dialog instanceof HTMLDialogElement) {
        try { dialog.close(); } catch {
          dialog.open = false;
          dialog.removeAttribute("open");
        }
      }
    });
  });

  // H1: page-world generated activation of the retained Stage-D final button.
  // The page submit counter only counts submits that REACH the page; it never prevents clicks.
  async function pageAttack(page, kind) {
    return await page.evaluate((kind) => {
      const btn = document.getElementById("final-make-public");
      if (!(btn instanceof HTMLButtonElement)) return { ok: false, error: "NO_BUTTON" };
      const submitBefore = window.__fc007SubmitCount || 0;
      let pageSaw = 0;
      const saw = () => { pageSaw += 1; };
      window.addEventListener("click", saw, false);
      let target = btn;
      let span = null;
      if (kind.indexOf("descendant") >= 0) {
        span = document.createElement("span");
        btn.appendChild(span);
        target = span;
      }
      let prevented = null;
      if (kind.indexOf("click") === 0) {
        target.click();
      } else {
        const ev = new MouseEvent("click", {
          bubbles: true,
          cancelable: kind.indexOf("noncancelable") < 0,
          composed: true,
        });
        target.dispatchEvent(ev);
        prevented = ev.defaultPrevented;
      }
      window.removeEventListener("click", saw, false);
      if (span) span.remove();
      return {
        ok: true,
        kind,
        submitDelta: (window.__fc007SubmitCount || 0) - submitBefore,
        pageSaw,
        prevented,
      };
    }, kind);
  }

  async function h1Snap(page, ctrl) {
    const c = await ctrl(\`return {
      mode: this.getPreviewMode(),
      previewVisible: this.isPreviewVisible(),
      decisionId: this.getActiveDecisionForTest()?.decisionId || null,
      guardPresent: !!this.getRetainedFinalButton(),
      diag: this.getSprint3cDiagnosticsForTest(),
      guard: this.getActivationGuardDiagnosticsForTest(),
    };\`);
    const native = await page.evaluate(() => ({
      fetch: window.__fc007FetchCount || 0,
      xhr: window.__fc007XhrCount || 0,
      nav: window.__fc007NavCount || 0,
      submit: window.__fc007SubmitCount || 0,
    }));
    return { ...c, native };
  }

  const ATTACKS = ["click", "dispatch", "dispatch-noncancelable", "click-descendant", "dispatch-descendant"];

  h1 = await (async () => {
    try {
      const out = { ok: true };

      // Before first human decision.
      {
        const session = await openStageDPage();
        const { page, ctrl, requestLedger } = session;
        const deadline = Date.now() + 15000;
        let guarded = false;
        while (Date.now() < deadline) {
          if (await ctrl("return !!this.getRetainedFinalButton();")) { guarded = true; break; }
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!guarded) { await page.close(); return { ok: false, error: "H1_SETUP_NO_GUARD" }; }
        const attacks = [];
        for (const k of ATTACKS) {
          attacks.push(await pageAttack(page, k));
          await new Promise((r) => setTimeout(r, 150));
        }
        await new Promise((r) => setTimeout(r, 300));
        const after = await h1Snap(page, ctrl);
        const unrelated = await page.evaluate(() => {
          const f = document.createElement("form");
          const b = document.createElement("button");
          b.type = "submit";
          b.textContent = "Unrelated";
          f.appendChild(b);
          document.body.appendChild(f);
          let submits = 0;
          f.addEventListener("submit", (e) => { submits += 1; e.preventDefault(); });
          let pageSaw = 0;
          const saw = () => { pageSaw += 1; };
          window.addEventListener("click", saw, false);
          b.click();
          const ev = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
          b.dispatchEvent(ev);
          window.removeEventListener("click", saw, false);
          f.remove();
          return { submits, pageSaw, prevented: ev.defaultPrevented };
        });
        const guardAfterUnrelated = await ctrl("return this.getActivationGuardDiagnosticsForTest();");
        out.beforeDecision = { attacks, after, unrelated, guardAfterUnrelated, requestLedger };
        await page.close();
      }

      // VERIFIED waiting for Continue (exact freeze reproduction), then real Continue, then post-terminal.
      {
        const opened = await openVerified("h1-waiting");
        if (!opened.ok || !opened.session) return { ok: false, error: "H1_WAITING_SETUP", opened };
        const { page, ctrl, requestLedger } = opened.session;
        const attacks = [];
        for (const k of ["click", "dispatch", "dispatch-noncancelable"]) {
          attacks.push(await pageAttack(page, k));
          await new Promise((r) => setTimeout(r, 150));
        }
        await new Promise((r) => setTimeout(r, 300));
        const waiting = await h1Snap(page, ctrl);
        const center = await ctrl("return this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null;");
        if (!center) { await page.close(); return { ok: false, error: "H1_NO_CONTINUE_CENTER" }; }
        const submitBeforeContinue = waiting.native.submit;
        await page.mouse.click(center.x, center.y);
        await new Promise((r) => setTimeout(r, 400));
        const released = await h1Snap(page, ctrl);
        const postAttacks = [];
        for (const k of ["click", "dispatch", "dispatch-noncancelable"]) {
          postAttacks.push(await pageAttack(page, k));
          await new Promise((r) => setTimeout(r, 150));
        }
        await new Promise((r) => setTimeout(r, 300));
        const postTerminal = await h1Snap(page, ctrl);
        out.waiting = {
          attacks,
          waiting,
          released,
          authorizedSubmitDelta: released.native.submit - submitBeforeContinue,
          postAttacks,
          postTerminal,
          requestLedger,
        };
        await page.close();
      }

      // Descendant while waiting.
      {
        const opened = await openVerified("h1-waiting-descendant");
        if (!opened.ok || !opened.session) return { ok: false, error: "H1_DESC_SETUP", opened };
        const { page, ctrl } = opened.session;
        const attacks = [await pageAttack(page, "click-descendant"), await pageAttack(page, "dispatch-descendant")];
        await new Promise((r) => setTimeout(r, 300));
        out.waitingDescendant = { attacks, after: await h1Snap(page, ctrl) };
        await page.close();
      }

      // Post-Cancel and post-closed-modal page activation.
      for (const [key, terminate] of [
        ["afterCancel", async (page, ctrl) => {
          const c = await ctrl("return this.getPreviewCancelCenterForTest();");
          if (!c) throw new Error("MISSING_CANCEL_CENTER");
          await page.mouse.click(c.x, c.y);
        }],
        ["afterEscape", async (page) => { await page.keyboard.press("Escape"); }],
        ["afterClosedModal", async (page) => {
          await page.evaluate(() => {
            const d = document.getElementById("visibility-dialog");
            if (d instanceof HTMLDialogElement) d.close();
          });
        }],
      ]) {
        const opened = await openVerified("h1-" + key);
        if (!opened.ok || !opened.session) return { ok: false, error: "H1_SETUP_" + key, opened };
        const { page, ctrl } = opened.session;
        await terminate(page, ctrl);
        await new Promise((r) => setTimeout(r, 300));
        const attacks = [];
        for (const k of ["click", "dispatch", "dispatch-noncancelable"]) {
          attacks.push(await pageAttack(page, k));
          await new Promise((r) => setTimeout(r, 150));
        }
        await new Promise((r) => setTimeout(r, 300));
        out[key] = { attacks, after: await h1Snap(page, ctrl) };
        await page.close();
      }
      return out;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // A2 — H2 (Stage-D re-render recovery) and M1 (one guarded submit per Continue).
  // __a2Submits counts final-button submits that REACH document bubble phase. FutureClick
  // stops blocked submits at window capture, so a blocked submit never reaches this counter;
  // the counter's own preventDefault only keeps the page alive after counting.
  const sleepA2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const countSetVisibility = (ledger) => ledger.filter((e) => /\\/settings\\/set_visibility/.test(e.url)).length;

  async function a2InstallCounter(page) {
    await page.evaluate(() => {
      if (window.__a2CounterInstalled) return;
      window.__a2CounterInstalled = true;
      window.__a2Submits = 0;
      document.addEventListener("submit", (e) => {
        const s = e.submitter;
        if (s && s.id === "final-make-public") window.__a2Submits += 1;
        e.preventDefault();
      }, false);
    });
  }

  async function a2Rerender(page) {
    return await page.evaluate(() => {
      const before = document.getElementById("final-make-public");
      try { window.__fc007SetStage("d"); } catch {}
      const after = document.getElementById("final-make-public");
      return { replaced: !!before && !!after && before !== after, oldConnected: !!before && before.isConnected };
    });
  }

  async function a2WaitGuardOnCurrent(ctrl) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const r = await ctrl('const b = this.getRetainedFinalButton(); return !!b && b.isConnected && b === document.getElementById("final-make-public");');
      if (r === true) return true;
      await sleepA2(100);
    }
    return false;
  }

  async function a2Snap(page, ctrl) {
    const c = await ctrl('const b = this.getRetainedFinalButton(); return { mode: this.getPreviewMode(), previewVisible: this.isPreviewVisible(), decisionId: (this.getActiveDecisionForTest() && this.getActiveDecisionForTest().decisionId) || null, guardOnCurrent: !!b && b === document.getElementById("final-make-public"), diag: this.getSprint3cDiagnosticsForTest(), guard: this.getActivationGuardDiagnosticsForTest() };');
    const native = await page.evaluate(() => ({
      a2Submits: window.__a2Submits || 0,
      fetch: window.__fc007FetchCount || 0,
      xhr: window.__fc007XhrCount || 0,
      nav: window.__fc007NavCount || 0,
    }));
    return { ...c, native };
  }

  async function a2PageAttacks(page) {
    return await page.evaluate(() => {
      const out = [];
      for (const kind of ["click", "dispatch-noncancelable", "descendant-noncancelable", "requestSubmit"]) {
        const btn = document.getElementById("final-make-public");
        const before = window.__a2Submits || 0;
        if (kind === "click") btn.click();
        else if (kind === "dispatch-noncancelable") btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: false, composed: true }));
        else if (kind === "descendant-noncancelable") {
          const s = document.createElement("span");
          btn.appendChild(s);
          s.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: false, composed: true }));
          s.remove();
        } else btn.form.requestSubmit(btn);
        out.push({ kind, submitDelta: (window.__a2Submits || 0) - before });
      }
      return out;
    });
  }

  async function a2HumanClickCurrentToVerified(page, ctrl) {
    const box = await page.$eval("#final-make-public", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if ((await ctrl("return this.getPreviewMode();")) === "verified") return true;
      await sleepA2(150);
    }
    return false;
  }

  async function a2TrustedContinue(page, ctrl) {
    const center = await ctrl("return this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null;");
    if (!center) throw new Error("A2_NO_CONTINUE_CENTER");
    await page.mouse.click(center.x, center.y);
    await sleepA2(400);
  }

  async function m1InstallPageHandler(page, kind) {
    await page.evaluate((kind) => {
      const btn = document.getElementById("final-make-public");
      window.__m1 = { fired: 0, unrelatedSubmits: 0 };
      let armed = true;
      btn.addEventListener("click", () => {
        if (!armed) return;
        armed = false;
        window.__m1.fired += 1;
        const nc = () => new MouseEvent("click", { bubbles: true, cancelable: false, composed: true });
        if (kind === "nested-1") btn.dispatchEvent(nc());
        else if (kind === "nested-3") { for (let i = 0; i < 3; i += 1) btn.dispatchEvent(nc()); }
        else if (kind === "request-submit") btn.form.requestSubmit(btn);
        else if (kind === "descendant") {
          const s = document.createElement("span");
          btn.appendChild(s);
          s.dispatchEvent(nc());
          s.remove();
        } else if (kind === "unrelated") {
          const f = document.createElement("form");
          const b = document.createElement("button");
          b.type = "submit";
          f.appendChild(b);
          document.body.appendChild(f);
          f.addEventListener("submit", (ev) => { window.__m1.unrelatedSubmits += 1; ev.preventDefault(); });
          f.requestSubmit(b);
          f.remove();
        }
      });
    }, kind);
  }

  a2 = await (async () => {
    try {
      const out = { ok: true };

      // H2 (1): VERIFIED re-render → recognition rerun → replacement guarded → human click previewed.
      {
        const opened = await openVerified("a2-h2-verified");
        if (!opened.ok || !opened.session) return { ok: false, error: "A2_H2_VERIFIED_SETUP", opened };
        const { page, ctrl, requestLedger } = opened.session;
        await a2InstallCounter(page);
        const before = await a2Snap(page, ctrl);
        const rerender = await a2Rerender(page);
        const guardMoved = await a2WaitGuardOnCurrent(ctrl);
        await sleepA2(300);
        const afterRerender = await a2Snap(page, ctrl);
        const attacks = await a2PageAttacks(page);
        const human = await a2HumanClickCurrentToVerified(page, ctrl);
        const afterHuman = await a2Snap(page, ctrl);
        await a2TrustedContinue(page, ctrl);
        const afterContinue = await a2Snap(page, ctrl);
        out.h2Verified = { before, rerender, guardMoved, afterRerender, attacks, human, afterHuman, afterContinue, setVisibilityRequests: countSetVisibility(requestLedger) };
        await page.close();
      }

      // H2 (2): pending re-render → stale evaluation ignored → replacement guarded.
      {
        const session = await openStageDPage();
        const { page, ctrl, requestLedger } = session;
        await a2InstallCounter(page);
        const guarded = await a2WaitGuardOnCurrent(ctrl);
        if (!guarded) { await page.close(); return { ok: false, error: "A2_H2_PENDING_NO_GUARD" }; }
        await ctrl("this.armEvalDelayForTest(); return true;");
        const box = await page.$eval("#final-make-public", (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.click(box.x, box.y);
        let pending = false;
        const pd = Date.now() + 10000;
        while (Date.now() < pd) {
          if ((await ctrl("return this.getPreviewMode();")) === "pending") { pending = true; break; }
          await sleepA2(50);
        }
        const rerender = await a2Rerender(page);
        const guardMoved = await a2WaitGuardOnCurrent(ctrl);
        const afterRerender = await a2Snap(page, ctrl);
        await ctrl("this.releaseEvalDelayForTest(); return true;");
        await sleepA2(500);
        const afterStaleSettled = await a2Snap(page, ctrl);
        const attacks = await a2PageAttacks(page);
        const human = await a2HumanClickCurrentToVerified(page, ctrl);
        const afterHuman = await a2Snap(page, ctrl);
        await a2TrustedContinue(page, ctrl);
        const afterContinue = await a2Snap(page, ctrl);
        out.h2Pending = { pending, rerender, guardMoved, afterRerender, afterStaleSettled, attacks, human, afterHuman, afterContinue, setVisibilityRequests: countSetVisibility(requestLedger) };
        await page.close();
      }

      // H2 (3): repeated valid re-renders.
      {
        const opened = await openVerified("a2-h2-repeated");
        if (!opened.ok || !opened.session) return { ok: false, error: "A2_H2_REPEATED_SETUP", opened };
        const { page, ctrl, requestLedger } = opened.session;
        await a2InstallCounter(page);
        const rounds = [];
        const decisionIds = [opened.snap.decisionId];
        for (let i = 0; i < 3; i += 1) {
          const rerender = await a2Rerender(page);
          const guardMoved = await a2WaitGuardOnCurrent(ctrl);
          await sleepA2(250);
          const afterRerender = await a2Snap(page, ctrl);
          const attacks = await a2PageAttacks(page);
          const human = await a2HumanClickCurrentToVerified(page, ctrl);
          const afterHuman = await a2Snap(page, ctrl);
          decisionIds.push(afterHuman.decisionId);
          rounds.push({ rerender, guardMoved, afterRerender, attacks, human, afterHuman });
        }
        await a2TrustedContinue(page, ctrl);
        const afterContinue = await a2Snap(page, ctrl);
        const finalButtons = await page.evaluate(() => document.querySelectorAll("#final-make-public").length);
        out.h2Repeated = { rounds, decisionIds, afterContinue, finalButtons, setVisibilityRequests: countSetVisibility(requestLedger) };
        await page.close();
      }

      // M1: nested activations inside the authorized dispatch (submit counted, page kept alive).
      out.m1 = {};
      for (const kind of ["none", "nested-1", "nested-3", "request-submit", "descendant", "unrelated"]) {
        const opened = await openVerified("a2-m1-" + kind);
        if (!opened.ok || !opened.session) return { ok: false, error: "A2_M1_SETUP_" + kind, opened };
        const { page, ctrl, requestLedger } = opened.session;
        await a2InstallCounter(page);
        await m1InstallPageHandler(page, kind);
        const before = await a2Snap(page, ctrl);
        await a2TrustedContinue(page, ctrl);
        const after = await a2Snap(page, ctrl);
        const pageM1 = await page.evaluate(() => window.__m1);
        out.m1[kind] = { before, after, pageM1, submitDelta: after.native.a2Submits - before.native.a2Submits, setVisibilityRequests: countSetVisibility(requestLedger) };
        await page.close();
      }

      // M1 network: no harness preventDefault anywhere; the real form submission navigates and
      // the request ledger records every consequential request to set_visibility.
      out.m1Network = {};
      for (const kind of ["none", "nested-3", "request-submit", "descendant"]) {
        const opened = await openVerified("a2-m1-net-" + kind, { preventSubmit: false });
        if (!opened.ok || !opened.session) return { ok: false, error: "A2_M1_NET_SETUP_" + kind, opened };
        const { page, ctrl, requestLedger } = opened.session;
        await m1InstallPageHandler(page, kind);
        const beforeRequests = countSetVisibility(requestLedger);
        const center = await ctrl("return this.getPreviewContinueCenterForTest ? this.getPreviewContinueCenterForTest() : null;");
        if (!center) { await page.close(); return { ok: false, error: "A2_M1_NET_NO_CENTER_" + kind }; }
        await page.mouse.click(center.x, center.y);
        await sleepA2(1500);
        out.m1Network[kind] = { beforeRequests, afterRequests: countSetVisibility(requestLedger) };
        await page.close();
      }

      return out;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  // M1: stop during actual native dispatch via CDP Debugger.evaluateOnCallFrame
  // (no setTestExecutorForTest; no processEventForTest evidence; real native executor).
  dispatchStop = await (async () => {
    try {
      const opened = await openVerified("dispatch-stop");
      if (!opened.ok || !opened.session) return opened;
      const { page, requestLedger, ctrl, cdp } = opened.session;
      const terminalBefore = await ctrl("return this.getTerminalUiRenderCountForTest();");
      if (typeof terminalBefore !== "number") {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: terminal render count unavailable before dispatch",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      // Retain EXACT original FutureClick preview host + install harness-only
      // MutationObserver on its exact parent (isolated world, observe-only).
      const hostPrep = await ctrl(\`return (() => {
        const host = this.getPreviewHostForTest();
        const decision = this.getActiveDecisionForTest();
        if (!(host instanceof HTMLDivElement)) {
          return { ok: false, error: "NO_ORIGINAL_HOST" };
        }
        if (host.isConnected !== true) {
          return { ok: false, error: "HOST_NOT_CONNECTED" };
        }
        if (host.ownerDocument !== document) {
          return { ok: false, error: "HOST_WRONG_DOCUMENT" };
        }
        if (decision && decision.ownedHost && decision.ownedHost !== host) {
          return { ok: false, error: "HOST_NOT_DECISION_HOST" };
        }
        const parent = host.parentNode;
        if (!parent) return { ok: false, error: "NO_HOST_PARENT" };
        const state = {
          removalCount: 0,
          readdCount: 0,
          replacementInsertCount: 0,
          installed: true,
        };
        const obs = new MutationObserver((records) => {
          for (const rec of records) {
            for (const n of rec.removedNodes) {
              if (n === host) state.removalCount += 1;
            }
            for (const n of rec.addedNodes) {
              if (n === host) state.readdCount += 1;
              else if (n && n.nodeType === 1) state.replacementInsertCount += 1;
            }
          }
        });
        obs.observe(parent, { childList: true });
        this.__fc007M1HostObs = { state, obs, host, parent };
        return {
          ok: true,
          connected: host.isConnected === true,
          sameAsDecision: !decision || decision.ownedHost === host,
          removalCount: state.removalCount,
          readdCount: state.readdCount,
          replacementInsertCount: state.replacementInsertCount,
          observerInstalled: true,
        };
      })();\`);
      if (!hostPrep || hostPrep.ok !== true || hostPrep.observerInstalled !== true) {
        await page.close();
        return {
          ok: false,
          error:
            "RUNTIME_VERIFICATION_BLOCKED: original host / observer unavailable " +
            JSON.stringify(hostPrep || {}),
          runtimeBlocked: true,
          requestLedger,
        };
      }
      if (hostPrep.connected !== true) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: original host not connected before dispatch",
          runtimeBlocked: true,
          requestLedger,
        };
      }
      if (hostPrep.removalCount !== 0) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: previewHostRemovalCount not 0 before dispatch",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      const hostRefBefore = await cdp.send("Runtime.callFunctionOn", {
        objectId: opened.session.getControllerObjectId(),
        functionDeclaration: "function() { return this.getPreviewHostForTest(); }",
        returnByValue: false,
      });
      const originalHostObjectId = hostRefBefore.result?.objectId;
      if (typeof originalHostObjectId !== "string" || !originalHostObjectId) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: original host objectId unavailable",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      async function observeOriginalHostConnected(label) {
        let hr;
        try {
          hr = await cdp.send("Runtime.callFunctionOn", {
            objectId: originalHostObjectId,
            functionDeclaration: "function() { return this.isConnected === true; }",
            returnByValue: true,
          });
        } catch (err) {
          throw new Error(
            "REQUIRED_ORIGINAL_HOST_OBSERVATION_UNAVAILABLE:" + label + ":" + String(err),
          );
        }
        if (hr.exceptionDetails) {
          throw new Error(
            "REQUIRED_ORIGINAL_HOST_OBSERVATION_UNAVAILABLE:" + label + ":exception",
          );
        }
        const observed = hr.result?.value;
        if (typeof observed !== "boolean") {
          throw new Error(
            "REQUIRED_ORIGINAL_HOST_OBSERVATION_UNAVAILABLE:" +
              label +
              ":non-boolean:" +
              String(observed),
          );
        }
        return observed;
      }

      const beforeConnected = await observeOriginalHostConnected("before-dispatch");
      if (beforeConnected !== true) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: original host isConnected not true before dispatch",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      // PAGE-realm nested delivery counters — measured deltas only (never hardcoded).
      // Nested REAL dispatch cannot run while Debugger is paused (Chrome suppresses
      // re-entrant listener delivery). Arm a follow-on page bubble listener that runs
      // after resume, still inside invokeCapturedNativeClick / primary dispatchEvent.
      await page.evaluate(() => {
        const button = document.getElementById("final-make-public");
        if (!(button instanceof HTMLButtonElement)) throw new Error("NO_BUTTON");
        const nonce = "fc007-m1-nested-" + Math.random().toString(36).slice(2);
        const root = document.documentElement;
        root.setAttribute("data-fc007-m1-nonce", nonce);
        root.setAttribute("data-fc007-m1-win", "0");
        root.setAttribute("data-fc007-m1-tgt", "0");
        root.setAttribute("data-fc007-m1-nested-done", "0");
        root.removeAttribute("data-fc007-m1-armed");
        root.removeAttribute("data-fc007-m1-nested-prevented");
        root.removeAttribute("data-fc007-m1-real-dispatch");
        window.__FC007_M1_NESTED__ = {
          nonce,
          windowCount: 0,
          targetCount: 0,
        };
        const probe = window.__FC007_M1_NESTED__;
        window.addEventListener(
          "click",
          (e) => {
            if (root.getAttribute("data-fc007-m1-phase") !== "nested") return;
            const n = e && e.__fc007NestedNonce;
            if (n !== probe.nonce) return;
            probe.windowCount += 1;
            root.setAttribute("data-fc007-m1-win", String(probe.windowCount));
          },
          true,
        );
        button.addEventListener(
          "click",
          function fc007M1NestedTarget(e) {
            if (root.getAttribute("data-fc007-m1-phase") !== "nested") return;
            const n = e && e.__fc007NestedNonce;
            if (n !== probe.nonce) return;
            probe.targetCount += 1;
            root.setAttribute("data-fc007-m1-tgt", String(probe.targetCount));
          },
          false,
        );
        button.addEventListener(
          "click",
          function fc007M1PageHandler() {
            // Marker frame: CDP pauses here during active native primary dispatch.
          },
          false,
        );
        button.addEventListener(
          "click",
          function fc007M1AfterStopNested() {
            if (root.getAttribute("data-fc007-m1-armed") !== "1") return;
            root.removeAttribute("data-fc007-m1-armed");
            const n = root.getAttribute("data-fc007-m1-nonce");
            function readM1CounterAttr(attrName) {
              const raw = root.getAttribute(attrName);
              if (raw === null || raw === undefined) {
                throw new Error("RUNTIME_VERIFICATION_BLOCKED: required attribute missing (null): " + attrName);
              }
              if (typeof raw !== "string" || raw.trim() === "") {
                throw new Error("RUNTIME_VERIFICATION_BLOCKED: required attribute empty/whitespace: " + attrName);
              }
              const numeric = Number(raw);
              if (!Number.isFinite(numeric)) {
                throw new Error("RUNTIME_VERIFICATION_BLOCKED: required attribute not finite number: " + attrName + " raw=" + JSON.stringify(raw));
              }
              return numeric;
            }
            const winBefore = readM1CounterAttr("data-fc007-m1-win");
            const tgtBefore = readM1CounterAttr("data-fc007-m1-tgt");
            root.setAttribute("data-fc007-m1-phase", "nested");
            const nested = new MouseEvent("click", { bubbles: true, cancelable: true });
            try {
              Object.defineProperty(nested, "__fc007NestedNonce", {
                configurable: true,
                value: n,
              });
            } catch {
              nested.__fc007NestedNonce = n;
            }
            button.dispatchEvent(nested);
            root.removeAttribute("data-fc007-m1-phase");
            root.setAttribute("data-fc007-m1-real-dispatch", "1");
            root.setAttribute(
              "data-fc007-m1-nested-prevented",
              nested.defaultPrevented === true ? "1" : "0",
            );
            root.setAttribute(
              "data-fc007-m1-win-delta",
              String(readM1CounterAttr("data-fc007-m1-win") - winBefore),
            );
            root.setAttribute(
              "data-fc007-m1-tgt-delta",
              String(readM1CounterAttr("data-fc007-m1-tgt") - tgtBefore),
            );
            root.setAttribute("data-fc007-m1-nested-done", "1");
          },
          false,
        );
      });

      let stopSnap = null;
      let handling = false;
      let pauseChain = Promise.resolve();
      let pauseResult = null;
      const handlePause = async (ev) => {
        if (handling) {
          await cdp.send("Debugger.resume").catch(() => {});
          return;
        }
        const frames = ev.callFrames || [];
        const topFn = frames[0]?.functionName || "";
        const ctrlFrame = frames.find((f) => f.functionName === "handlePreviewContinue");
        const pageFrame = frames.find((f) => f.functionName === "fc007M1PageHandler") || frames[0];
        const inNative = frames.some((f) => f.functionName === "invokeCapturedNativeClick");
        if (!(topFn === "fc007M1PageHandler" && inNative && ctrlFrame && pageFrame)) {
          await cdp.send("Debugger.resume").catch(() => {});
          return;
        }
        handling = true;
        try {
          const beforeR = await cdp.send("Debugger.evaluateOnCallFrame", {
            callFrameId: ctrlFrame.callFrameId,
            expression: \`(() => {
              const release = this.getReleaseComponentForTest();
              const host = this.getPreviewHostForTest();
              const obs = this.__fc007M1HostObs && this.__fc007M1HostObs.state;
              return {
                dispatch: this.isReleaseDispatchInProgressForTest(),
            guard: release.isDispatchGuardActive(),
            hostConnected: !!(host && host.isConnected),
                started: this.isStartedForTest(),
                listener: this.isReleaseListenerInstalledForTest(),
                previewHostRemovalCount: obs ? obs.removalCount : null,
              };
            })()\`,
            returnByValue: true,
          });

          // Confirm retained original host is still the live host before stop.
          const beforeStopConnected = await observeOriginalHostConnected("before-stop");
          if (beforeStopConnected !== true) {
            throw new Error(
              "REQUIRED_ORIGINAL_HOST_OBSERVATION_UNAVAILABLE: before-stop expected true got " +
                beforeStopConnected,
            );
          }

          await cdp.send("Debugger.evaluateOnCallFrame", {
            callFrameId: ctrlFrame.callFrameId,
            expression: "this.stop()",
            returnByValue: true,
          });

          const afterStopBaseR = await cdp.send("Debugger.evaluateOnCallFrame", {
            callFrameId: ctrlFrame.callFrameId,
            expression: \`(() => {
              const release = this.getReleaseComponentForTest();
              const host = this.getPreviewHostForTest();
              const obs = this.__fc007M1HostObs && this.__fc007M1HostObs.state;
              return {
                dispatch: this.isReleaseDispatchInProgressForTest(),
              guard: release.isDispatchGuardActive(),
              hostConnected: !!(host && host.isConnected),
                started: this.isStartedForTest(),
                deferred: this.isDeferredStopUiCleanupPendingForTest(),
                listener: this.isReleaseListenerInstalledForTest(),
                previewHostRemovalCount: obs ? obs.removalCount : null,
                readdCount: obs ? obs.readdCount : null,
                replacementInsertCount: obs ? obs.replacementInsertCount : null,
              };
            })()\`,
            returnByValue: true,
          });

          const afterStopConnected = await observeOriginalHostConnected("after-stop");
          if (afterStopConnected !== true) {
            throw new Error(
              "REQUIRED_ORIGINAL_HOST_OBSERVATION_UNAVAILABLE: after-stop expected true got " +
                afterStopConnected,
            );
          }
          if (afterStopBaseR.result?.value?.previewHostRemovalCount !== 0) {
            throw new Error(
              "RUNTIME_VERIFICATION_BLOCKED: previewHostRemovalCount not 0 after stop before unwind got=" +
                afterStopBaseR.result?.value?.previewHostRemovalCount,
            );
          }

          // Remove click breakpoint BEFORE resume so follow-on bubble + nested
          // dispatch are not re-paused (paused re-dispatch suppresses listeners).
          await cdp.send("DOMDebugger.removeEventListenerBreakpoint", { eventName: "click" }).catch(() => {});

          await cdp.send("Debugger.evaluateOnCallFrame", {
            callFrameId: pageFrame.callFrameId,
            expression:
              "document.documentElement.setAttribute('data-fc007-m1-armed','1'); true",
            returnByValue: true,
          });

          pauseResult = {
            before: beforeR.result?.value,
            afterStopBase: afterStopBaseR.result?.value || {},
            originalHostConnectedAfterStop: afterStopConnected,
            originalHostConnectedBeforeStop: beforeStopConnected,
            originalHostObjectId,
          };
        } catch (err) {
          pauseResult = { error: String(err) };
        } finally {
          await cdp.send("DOMDebugger.removeEventListenerBreakpoint", { eventName: "click" }).catch(() => {});
          await cdp.send("Debugger.resume").catch(() => {});
        }
      };
      cdp.on("Debugger.paused", (ev) => {
        pauseChain = pauseChain.then(() => handlePause(ev));
      });
      await cdp.send("DOMDebugger.setEventListenerBreakpoint", { eventName: "click" });

      const center = opened.snap.continueCenter;
      await page.mouse.click(center.x, center.y);
      const waitDeadline = Date.now() + 10000;
      while (Date.now() < waitDeadline && !pauseResult) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await pauseChain;

      if (!pauseResult || pauseResult.error) {
        await page.close();
        return {
          ok: false,
          error: pauseResult?.error || "RUNTIME_VERIFICATION_BLOCKED: M1 stop observation unavailable",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      // Wait for follow-on page listener to complete REAL nested dispatch.
      const nestedDeadline = Date.now() + 5000;
      let nestedObs = null;
      while (Date.now() < nestedDeadline) {
        const nestedRaw = await page.evaluate(() => {
          const root = document.documentElement;
          if (root.getAttribute("data-fc007-m1-nested-done") !== "1") return null;
          return {
            done: "1",
            winDeltaRaw: root.getAttribute("data-fc007-m1-win-delta"),
            tgtDeltaRaw: root.getAttribute("data-fc007-m1-tgt-delta"),
            realDispatchRaw: root.getAttribute("data-fc007-m1-real-dispatch"),
            nestedPreventedRaw: root.getAttribute("data-fc007-m1-nested-prevented"),
          };
        });
        if (!nestedRaw) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        try {
          nestedObs = materializeM1NestedObservation(nestedRaw);
        } catch (err) {
          await page.close();
          return {
            ok: false,
            error: String(err && err.message ? err.message : err),
            runtimeBlocked: true,
            requestLedger,
          };
        }
        if (nestedObs) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!nestedObs || nestedObs.realDispatch !== true) {
        await page.close();
        return {
          ok: false,
          error:
            "RUNTIME_VERIFICATION_BLOCKED: real nested dispatch unavailable " +
            JSON.stringify(nestedObs || {}),
          runtimeBlocked: true,
          requestLedger,
        };
      }
      if (nestedObs.nestedPrevented !== true) {
        await page.close();
        return {
          ok: false,
          error:
            "NESTED_NOT_PREVENTED: real nested defaultPrevented=" + nestedObs.nestedPrevented,
          runtimeBlocked: true,
          snap: { before: pauseResult.before, afterStop: pauseResult.afterStopBase },
          requestLedger,
        };
      }
      if (nestedObs.nestedWindowMeasured !== true || nestedObs.nestedTargetMeasured !== true) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: nested page counters unmeasured",
          runtimeBlocked: true,
          requestLedger,
        };
      }

      const afterStop = {
        ...pauseResult.afterStopBase,
        ...nestedObs,
        originalHostConnectedAfterStop: pauseResult.originalHostConnectedAfterStop,
        originalHostObjectId: pauseResult.originalHostObjectId,
      };
      stopSnap = { before: pauseResult.before, afterStop };
      await new Promise((r) => setTimeout(r, 300));

      let after = null;
      try {
        after = await ctrl(\`const host = this.getPreviewHostForTest();
          const release = this.getReleaseComponentForTest();
          const counters = release.getCounters();
          const obs = this.__fc007M1HostObs && this.__fc007M1HostObs.state;
          return {
            started: this.isStartedForTest(),
            releaseDispatchInProgress: this.isReleaseDispatchInProgressForTest(),
            currentHostConnected: !!(host && host.isConnected),
            currentHostPresent: host != null,
            terminalCount: this.getTerminalUiRenderCountForTest(),
            mode: this.getPreviewMode(),
            deferred: this.isDeferredStopUiCleanupPendingForTest(),
            diag: this.getSprint3cDiagnosticsForTest(),
            listener: this.isReleaseListenerInstalledForTest(),
            releaseAttemptCleanupCount: counters.cleanupCount,
            releaseCounters: {
              arms: counters.arms,
              executorCalls: counters.executorCalls,
              authorizedEventsObserved: counters.authorizedEventsObserved,
              permissionConsumptions: counters.permissionConsumptions,
              retries: counters.retries,
              cleanupCount: counters.cleanupCount,
            },
            previewHostRemovalCount: obs ? obs.removalCount : null,
            originalHostReaddCount: obs ? obs.readdCount : null,
            replacementHostInsertCount: obs ? obs.replacementInsertCount : null,
            observerInstalled: !!(obs && obs.installed === true),
          };\`);
      } catch (err) {
        await page.close();
        return {
          ok: false,
          error: "REQUIRED POST-UNWIND OBSERVATION UNAVAILABLE: " + String(err),
          runtimeBlocked: true,
          snap: stopSnap,
          requestLedger,
        };
      }

      if (!after || after.observerInstalled !== true) {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: host observer unavailable after unwind",
          runtimeBlocked: true,
          snap: stopSnap,
          requestLedger,
        };
      }
      if (typeof after.previewHostRemovalCount !== "number") {
        await page.close();
        return {
          ok: false,
          error: "RUNTIME_VERIFICATION_BLOCKED: previewHostRemovalCount unreadable after unwind",
          runtimeBlocked: true,
          snap: stopSnap,
          requestLedger,
        };
      }

      let originalHostConnectedAfterUnwind;
      try {
        originalHostConnectedAfterUnwind = await observeOriginalHostConnected("after-unwind");
      } catch (err) {
        await page.close();
        return {
          ok: false,
          error: String(err),
          runtimeBlocked: true,
          snap: stopSnap,
          requestLedger,
        };
      }
      if (originalHostConnectedAfterUnwind !== false) {
        await page.close();
        return {
          ok: false,
          error:
            "ORIGINAL_HOST_STILL_CONNECTED_AFTER_UNWIND: observed=" +
            originalHostConnectedAfterUnwind,
          runtimeBlocked: true,
          snap: stopSnap,
          requestLedger,
        };
      }

      after.snap = stopSnap;
      after.originalHostConnectedAfterUnwind = originalHostConnectedAfterUnwind;
      after.originalHostConnectedAfterUnwindType = typeof originalHostConnectedAfterUnwind;
      after.originalHostObjectId = originalHostObjectId;
      after.terminalBefore = terminalBefore;
      // Compatibility alias: current controller host absence (NOT original-host proof).
      after.hostConnected = after.currentHostConnected === true;

      await page.close();
      return {
        ok: true,
        terminalBefore,
        after,
        requestLedger,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  })();

  process.stdout.write(JSON.stringify({
    ok: !!(happy?.ok && cancelCase?.ok && escapeCase?.ok && untrustedCase?.ok && doubleCase?.ok && staleEffects?.ok && staleButton?.ok && closedModal?.ok && dispatchStop?.ok && h1?.ok && a2?.ok),
    productBundle: "fc007-observation.bundle.js",
    originalHash: ORIGINAL_HASH,
    copyHash,
    happy,
    cancelCase,
    escapeCase,
    untrustedCase,
    doubleCase,
    staleEffects,
    staleButton,
    closedModal,
    dispatchStop,
    h1,
    a2,
    chromeVersion,
    tmpExt: TMP_EXT,
  }));
} catch (err) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: String(err),
    chromeVersion,
    happy,
    cancelCase,
    escapeCase,
    untrustedCase,
    doubleCase,
    staleEffects,
    staleButton,
    closedModal,
    dispatchStop,
    h1,
    a2,
  }));
  process.exitCode = 1;
} finally {
  try { await browser.close(); } catch {}
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(TMP_EXT, { recursive: true, force: true });
}
`,
);

function requireObservationObject(value, label) {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(
      `RUNTIME_VERIFICATION_BLOCKED: required observation object missing/invalid: ${label} got=${String(value)}`,
    );
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(
      `RUNTIME_VERIFICATION_BLOCKED: required boolean missing/invalid: ${label} got=${String(value)}`,
    );
  }
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      `RUNTIME_VERIFICATION_BLOCKED: required finite number missing/invalid: ${label} got=${String(value)}`,
    );
  }
  return value;
}

function assertZeroRelease(label, caseResult) {
  if (!caseResult || caseResult.ok !== true) {
    fail(`${label} failed: ${JSON.stringify(caseResult)}`);
  }
  let evidence = null;
  if (caseResult.after && caseResult.after.diag != null) {
    evidence = requireObservationObject(caseResult.after.diag, `${label} zero-release diagnostics`);
  } else if (caseResult.afterSecond != null) {
    evidence = requireObservationObject(
      caseResult.afterSecond,
      `${label} zero-release diagnostics`,
    );
  } else {
    fail(
      `RUNTIME_VERIFICATION_BLOCKED: required observation object missing/invalid: ${label} zero-release diagnostics`,
    );
  }
  const arm = requireFiniteNumber(evidence.armCount, `${label} armCount`);
  const exec = requireFiniteNumber(evidence.executorCount, `${label} executorCount`);
  const auth = requireFiniteNumber(
    evidence.authorizedReleaseCount,
    `${label} authorizedReleaseCount`,
  );
  const release = requireFiniteNumber(evidence.releaseCalls, `${label} releaseCalls`);
  if (arm !== 0 || exec !== 0 || auth !== 0 || release !== 0) {
    fail(`${label} expected zero release got arm=${arm} exec=${exec} auth=${auth} release=${release}`);
  }
  ok(`${label} release=0 arm=0 executor=0 auth=0`);
}

// Harness-only fail-closed self-check (no Chrome).
(function runFailClosedSelfChecks() {
  function expectThrow(label, fn) {
    let threw = false;
    let msg = "";
    try {
      fn();
    } catch (err) {
      threw = true;
      msg = String(err && err.message ? err.message : err);
    }
    if (!threw) fail(`self-check ${label}: expected throw, passed`);
    ok(`self-check ${label}: THROWS (${msg.slice(0, 160)})`);
  }
  function expectPass(label, fn) {
    try {
      fn();
    } catch (err) {
      fail(`self-check ${label}: unexpected throw ${err}`);
    }
    ok(`self-check ${label}: PASSES`);
  }
  const throwFail = (msg) => {
    throw new Error(msg);
  };
  const reqObj = (v, l) => {
    if (v === undefined || v === null || typeof v !== "object" || Array.isArray(v)) {
      throwFail(`RUNTIME_VERIFICATION_BLOCKED: required observation object missing/invalid: ${l}`);
    }
    return v;
  };
  const reqNum = (v, l) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throwFail(`RUNTIME_VERIFICATION_BLOCKED: required finite number missing/invalid: ${l}`);
    }
    return v;
  };
  function assertZeroReleaseLocal(label, caseResult) {
    if (!caseResult || caseResult.ok !== true) throwFail(`${label} failed`);
    let evidence = null;
    if (caseResult.after && caseResult.after.diag != null) {
      evidence = reqObj(caseResult.after.diag, `${label} zero-release diagnostics`);
    } else if (caseResult.afterSecond != null) {
      evidence = reqObj(caseResult.afterSecond, `${label} zero-release diagnostics`);
    } else {
      throwFail(
        `RUNTIME_VERIFICATION_BLOCKED: required observation object missing/invalid: ${label} zero-release diagnostics`,
      );
    }
    const arm = reqNum(evidence.armCount, `${label} armCount`);
    const exec = reqNum(evidence.executorCount, `${label} executorCount`);
    const auth = reqNum(evidence.authorizedReleaseCount, `${label} authorizedReleaseCount`);
    const release = reqNum(evidence.releaseCalls, `${label} releaseCalls`);
    if (arm !== 0 || exec !== 0 || auth !== 0 || release !== 0) {
      throwFail(`${label} expected zero`);
    }
  }

  expectThrow("missing observation object", () => {
    assertZeroReleaseLocal("inj", { ok: true });
  });
  expectThrow("missing release counter", () => {
    assertZeroReleaseLocal("inj", {
      ok: true,
      after: { diag: { armCount: 0, executorCount: 0, authorizedReleaseCount: 0 } },
    });
  });
  expectThrow("undefined authorization", () => {
    assertZeroReleaseLocal("inj", {
      ok: true,
      after: {
        diag: {
          armCount: 0,
          executorCount: 0,
          authorizedReleaseCount: undefined,
          releaseCalls: 0,
        },
      },
    });
  });
  expectThrow("null executor", () => {
    assertZeroReleaseLocal("inj", {
      ok: true,
      after: {
        diag: {
          armCount: 0,
          executorCount: null,
          authorizedReleaseCount: 0,
          releaseCalls: 0,
        },
      },
    });
  });
  expectThrow("wrong-type arm", () => {
    assertZeroReleaseLocal("inj", {
      ok: true,
      after: {
        diag: {
          armCount: "0",
          executorCount: 0,
          authorizedReleaseCount: 0,
          releaseCalls: 0,
        },
      },
    });
  });
  expectPass("explicit zeros", () => {
    assertZeroReleaseLocal("inj", {
      ok: true,
      after: {
        diag: {
          armCount: 0,
          executorCount: 0,
          authorizedReleaseCount: 0,
          releaseCalls: 0,
        },
      },
    });
  });

  const ch = collectionHelpers;
  function fakeWin(props) {
    const o = Object.create(null);
    for (const [k, v] of Object.entries(props)) o[k] = v;
    return o;
  }
  function fakeEl(attrs) {
    return {
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
      },
    };
  }

  // NETWORK collection fault injection (actual helpers)
  expectThrow("network all counters missing", () => {
    ch.materializeNativeNetworkCounters(ch.snapPageNetworkCountersFromWindow(fakeWin({})), "inj");
  });
  expectThrow("network fetch missing", () => {
    ch.materializeNativeNetworkCounters(
      ch.snapPageNetworkCountersFromWindow(
        fakeWin({ __fc007XhrCount: 0, __fc007SubmitCount: 0, __fc007NavCount: 0 }),
      ),
      "inj",
    );
  });
  expectThrow("network XHR missing", () => {
    ch.materializeNativeNetworkCounters(
      ch.snapPageNetworkCountersFromWindow(
        fakeWin({ __fc007FetchCount: 0, __fc007SubmitCount: 0, __fc007NavCount: 0 }),
      ),
      "inj",
    );
  });
  expectThrow("network submit missing", () => {
    ch.materializeNativeNetworkCounters(
      ch.snapPageNetworkCountersFromWindow(
        fakeWin({ __fc007FetchCount: 0, __fc007XhrCount: 0, __fc007NavCount: 0 }),
      ),
      "inj",
    );
  });
  expectThrow("network navigation missing", () => {
    ch.materializeNativeNetworkCounters(
      ch.snapPageNetworkCountersFromWindow(
        fakeWin({ __fc007FetchCount: 0, __fc007XhrCount: 0, __fc007SubmitCount: 0 }),
      ),
      "inj",
    );
  });
  expectThrow("network counter undefined", () => {
    ch.readRequiredPageCounterSnap({ present: true, value: undefined }, "inj.undef");
  });
  expectThrow("network counter null", () => {
    ch.readRequiredPageCounterSnap({ present: true, value: null }, "inj.null");
  });
  expectThrow("network counter string zero", () => {
    ch.readRequiredPageCounterSnap({ present: true, value: "0" }, "inj.str0");
  });
  expectThrow("network counter NaN", () => {
    ch.readRequiredPageCounterSnap({ present: true, value: Number.NaN }, "inj.nan");
  });
  expectPass("network explicit numeric zeros", () => {
    const out = ch.materializeNativeNetworkCounters(
      ch.snapPageNetworkCountersFromWindow(
        fakeWin({
          __fc007FetchCount: 0,
          __fc007XhrCount: 0,
          __fc007SubmitCount: 0,
          __fc007NavCount: 0,
        }),
      ),
      "inj",
    );
    if (out.fetch !== 0 || out.xhr !== 0 || out.submit !== 0 || out.nav !== 0) {
      throwFail("expected all zeros");
    }
  });

  // M1 attribute collection fault injection (actual helpers)
  expectThrow("m1 both deltas missing", () => {
    ch.materializeM1NestedObservation({
      done: "1",
      winDeltaRaw: null,
      tgtDeltaRaw: null,
      realDispatchRaw: "1",
      nestedPreventedRaw: "1",
    });
  });
  expectThrow("m1 Window missing", () => {
    ch.materializeM1NestedObservation({
      done: "1",
      winDeltaRaw: null,
      tgtDeltaRaw: "0",
      realDispatchRaw: "1",
      nestedPreventedRaw: "1",
    });
  });
  expectThrow("m1 target missing", () => {
    ch.materializeM1NestedObservation({
      done: "1",
      winDeltaRaw: "0",
      tgtDeltaRaw: null,
      realDispatchRaw: "1",
      nestedPreventedRaw: "1",
    });
  });
  expectThrow("m1 Window empty", () => {
    ch.readRequiredFiniteNumericAttribute(fakeEl({ "data-x": "" }), "data-x", "inj.empty");
  });
  expectThrow("m1 target empty", () => {
    ch.materializeM1NestedObservation({
      done: "1",
      winDeltaRaw: "0",
      tgtDeltaRaw: "",
      realDispatchRaw: "1",
      nestedPreventedRaw: "1",
    });
  });
  expectThrow("m1 whitespace", () => {
    ch.readRequiredFiniteNumericAttribute(fakeEl({ "data-x": "   " }), "data-x", "inj.ws");
  });
  expectThrow("m1 invalid numeric", () => {
    ch.readRequiredFiniteNumericAttribute(fakeEl({ "data-x": "abc" }), "data-x", "inj.abc");
  });
  expectThrow("m1 non-finite Infinity", () => {
    ch.readRequiredFiniteNumericAttribute(fakeEl({ "data-x": "Infinity" }), "data-x", "inj.inf");
  });
  expectThrow("m1 non-finite NaN text", () => {
    ch.readRequiredFiniteNumericAttribute(fakeEl({ "data-x": "NaN" }), "data-x", "inj.nantext");
  });
  expectPass("m1 explicit zero/zero", () => {
    const out = ch.materializeM1NestedObservation({
      done: "1",
      winDeltaRaw: "0",
      tgtDeltaRaw: "0",
      realDispatchRaw: "1",
      nestedPreventedRaw: "1",
    });
    if (
      !out ||
      out.nestedWindow !== 0 ||
      out.nestedTarget !== 0 ||
      out.nestedWindowMeasured !== true ||
      out.nestedTargetMeasured !== true
    ) {
      throwFail("expected measured zeros");
    }
  });
  expectPass("m1 attribute reader explicit 0", () => {
    const n = ch.readRequiredFiniteNumericAttribute(
      fakeEl({ "data-fc007-m1-win-delta": "0" }),
      "data-fc007-m1-win-delta",
      "inj.attr0",
    );
    if (n !== 0) throwFail("expected 0");
  });
})();

let last = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  ok(`Chrome 3C normal-bundle smoke attempt ${attempt}/${MAX_ATTEMPTS}`);
  const child = spawnSync(process.execPath, [workerPath], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    maxBuffer: 20 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse((child.stdout || "").trim() || "{}");
  } catch {
    ok(
      `attempt ${attempt} parse-fail status=${child.status} err=${(child.stderr || "").slice(0, 200)}`,
    );
    continue;
  }
  if (!parsed.ok) {
    ok(
      `attempt ${attempt} not-ok status=${child.status} err=${parsed.error || ""} happy=${JSON.stringify(parsed.happy || {}).slice(0, 200)} dispatchStopError=${parsed.dispatchStop?.error || ""} dispatchStop=${JSON.stringify(parsed.dispatchStop || {}).slice(0, 2000)} stderr=${(child.stderr || "").slice(0, 400)}`,
    );
    if (parsed.dispatchStop?.runtimeBlocked || /RUNTIME_VERIFICATION_BLOCKED|POST-UNWIND OBSERVATION UNAVAILABLE/.test(parsed.error || parsed.dispatchStop?.error || "")) {
      fail(
        `RUNTIME VERIFICATION BLOCKED: ${parsed.error || parsed.dispatchStop?.error || JSON.stringify(parsed.dispatchStop)}`,
      );
    }
    continue;
  }
  last = parsed;
  break;
}
fs.rmSync(workerPath, { force: true });

if (!last?.ok) fail(`Sprint 3C Chrome smoke failed after ${MAX_ATTEMPTS} attempts`);

const h = requireObservationObject(last.happy, "happy result");
const d = requireObservationObject(h.diag, "happy diag");
const pp = requireObservationObject(h.pageProbe, "happy pageProbe");
const pt = requireObservationObject(h.pageTamper, "happy pageTamper");
const native = requireObservationObject(h.native, "happy native counters");
const globals = requireObservationObject(h.globals, "happy globals");
const pageGlobals = requireObservationObject(globals.pageProbe, "happy page globals");
const isoGlobals = requireObservationObject(globals.isoProbe, "happy isolated globals");

const accepted = requireFiniteNumber(d.acceptedContinueAttempts, "happy acceptedContinueAttempts");
const validationPass = requireFiniteNumber(d.continueValidationPass, "happy continueValidationPass");
const releaseCalls = requireFiniteNumber(d.releaseCalls, "happy releaseCalls");
const armCount = requireFiniteNumber(d.armCount, "happy armCount");
const executorCount = requireFiniteNumber(d.executorCount, "happy executorCount");
const authorizedReleaseCount = requireFiniteNumber(
  d.authorizedReleaseCount,
  "happy authorizedReleaseCount",
);
const consumptions = requireFiniteNumber(d.consumptions, "happy consumptions");
const retries = requireFiniteNumber(d.retries, "happy retries");
const fallbacks = requireFiniteNumber(d.fallbacks, "happy fallbacks");

const primaryWindowSeen = requireFiniteNumber(pp.primaryWindowSeen, "happy primaryWindowSeen");
const nestedWindowSeen = requireFiniteNumber(pp.nestedWindowSeen, "happy nestedWindowSeen");
const reusedWindowSeen = requireFiniteNumber(pp.reusedWindowSeen, "happy reusedWindowSeen");
const descendantWindowSeen = requireFiniteNumber(
  pp.descendantWindowSeen,
  "happy descendantWindowSeen",
);
const primaryTargetSeen = requireFiniteNumber(pp.primaryTargetSeen, "happy primaryTargetSeen");
const nestedTargetSeen = requireFiniteNumber(pp.nestedTargetSeen, "happy nestedTargetSeen");
const reusedTargetSeen = requireFiniteNumber(pp.reusedTargetSeen, "happy reusedTargetSeen");
const descendantTargetSeen = requireFiniteNumber(
  pp.descendantTargetSeen,
  "happy descendantTargetSeen",
);
const generatedIsTrusted = requireBoolean(pp.generatedIsTrusted, "happy generatedIsTrusted");
const permBefore = requireBoolean(
  pp.permissionConsumedBeforePageWindow,
  "happy permissionConsumedBeforePageWindow",
);

const instanceTamperCount = requireFiniteNumber(
  pt.instanceTamperCount,
  "happy instanceTamperCount",
);
const prototypeTamperCount = requireFiniteNumber(
  pt.prototypeTamperCount,
  "happy prototypeTamperCount",
);
const instanceTamperInstalled = requireBoolean(
  pt.instanceTamperInstalled,
  "happy instanceTamperInstalled",
);
const prototypeTamperInstalled = requireBoolean(
  pt.prototypeTamperInstalled,
  "happy prototypeTamperInstalled",
);

const nativeFetch = requireFiniteNumber(native.fetch, "happy native.fetch");
const nativeXhr = requireFiniteNumber(native.xhr, "happy native.xhr");
const nativeSubmit = requireFiniteNumber(native.submit, "happy native.submit");
const nativeNav = requireFiniteNumber(native.nav, "happy native.nav");
const externalGitHub = requireFiniteNumber(h.externalGitHub, "happy externalGitHub");

ok(`Chrome version ${last.chromeVersion}`);
ok(`product artifact=${last.productBundle}`);
ok(`bundle hash original=${last.originalHash} copy=${last.copyHash} identical=${last.originalHash === last.copyHash}`);
ok(
  `happy diag accepted=${accepted} pass=${validationPass} releaseCalls=${releaseCalls} arm=${armCount} executor=${executorCount} auth=${authorizedReleaseCount} consumptions=${consumptions} retries=${retries} fallbacks=${fallbacks} terminal=${d.terminalOutcome}`,
);
ok(`generated isTrusted=${generatedIsTrusted}`);
ok(
  `page Window primary=${primaryWindowSeen} nested=${nestedWindowSeen} reused=${reusedWindowSeen} desc=${descendantWindowSeen} permBefore=${permBefore}`,
);
ok(
  `page target primary=${primaryTargetSeen} nested=${nestedTargetSeen} reused=${reusedTargetSeen} desc=${descendantTargetSeen}`,
);
ok(
  `nested prevented fresh=${pp.nestedPrevented} reused1=${pp.reusedFirstPrevented} reused2=${pp.reusedSecondPrevented} desc=${pp.descPrevented}`,
);
ok(
  `PAGE-REALM tamper realm=${pt.realm} instanceInstalled=${instanceTamperInstalled} protoInstalled=${prototypeTamperInstalled} instanceCount=${instanceTamperCount} protoCount=${prototypeTamperCount}`,
);
ok(`native fetch=${nativeFetch} xhr=${nativeXhr} submit=${nativeSubmit} nav=${nativeNav}`);
ok(`live GitHub: ${externalGitHub === 0 ? "NO" : "YES"}`);
ok(
  `page __FC007_CTRL__=${pageGlobals.__FC007_CTRL__} isolated __FC007_CTRL__=${isoGlobals.__FC007_CTRL__}`,
);

if (last.originalHash !== last.copyHash) fail("bundle copy not byte-identical");
if (accepted !== 1) fail(`acceptedContinueAttempts=${accepted}`);
if (validationPass < 1) fail(`continueValidationPass=${validationPass}`);
if (releaseCalls !== 1) fail(`releaseCalls=${releaseCalls}`);
if (armCount !== 1) fail(`armCount=${armCount}`);
if (executorCount !== 1) fail(`executorCount=${executorCount}`);
if (authorizedReleaseCount !== 1) fail(`authorizedReleaseCount=${authorizedReleaseCount}`);
if (consumptions !== 1) fail(`consumptions=${consumptions}`);
if (retries !== 0) fail(`retries=${retries}`);
if (fallbacks !== 0) fail(`fallbacks=${fallbacks}`);
if (d.terminalOutcome !== "CONSUMED") fail(`terminalOutcome=${d.terminalOutcome}`);
if (generatedIsTrusted !== false) fail("generated isTrusted must be false");
if (primaryWindowSeen !== 1) fail("page primary Window must be 1");
if (permBefore !== true) fail("permission must be consumed before page Window");
if (nestedWindowSeen !== 0 || reusedWindowSeen !== 0 || descendantWindowSeen !== 0) {
  fail("page Window must not see nested/reused/descendant");
}
if (nestedTargetSeen !== 0 || reusedTargetSeen !== 0 || descendantTargetSeen !== 0) {
  fail("page nested/reused/descendant target must be 0");
}
if (pt.realm !== "page") fail("page tamper realm must be page");
if (instanceTamperInstalled !== true || prototypeTamperInstalled !== true) {
  fail("PAGE-REALM tamper must be installed");
}
if (instanceTamperCount !== 0 || prototypeTamperCount !== 0) {
  fail("PAGE-REALM tamper must not affect executor");
}
if (nativeFetch !== 0 || nativeXhr !== 0) fail("fetch/XHR escape");
if (externalGitHub !== 0) fail("external GitHub allowed");
if (pageGlobals.__FC007_CTRL__ !== "undefined") fail("page __FC007_CTRL__ must be undefined");
if (isoGlobals.__FC007_CTRL__ !== "undefined") fail("isolated __FC007_CTRL__ must be undefined");

assertZeroRelease("cancel", last.cancelCase);
assertZeroRelease("escape", last.escapeCase);
assertZeroRelease("untrusted", last.untrustedCase);

const dbl = requireObservationObject(last.doubleCase, "double Continue result");
if (dbl.ok !== true) fail(`double Continue failed: ${JSON.stringify(dbl)}`);
const dblFirst = requireObservationObject(dbl.afterFirst, "double afterFirst diagnostics");
const dblSecond = requireObservationObject(dbl.afterSecond, "double afterSecond diagnostics");
const dblFirstRelease = requireFiniteNumber(dblFirst.releaseCalls, "double afterFirst.releaseCalls");
const dblRelease = requireFiniteNumber(dblSecond.releaseCalls, "double afterSecond.releaseCalls");
const dblAuth = requireFiniteNumber(
  dblSecond.authorizedReleaseCount,
  "double afterSecond.authorizedReleaseCount",
);
const dblExec = requireFiniteNumber(dblSecond.executorCount, "double afterSecond.executorCount");
if (dblRelease !== 1) fail(`double releaseCalls=${dblRelease}`);
if (dblAuth !== 1) fail(`double auth=${dblAuth}`);
if (dblExec !== 1) fail(`double executorCount=${dblExec}`);
ok(
  `double Continue firstRelease=${dblFirstRelease} totalRelease=${dblRelease} auth=${dblAuth}`,
);

const se = requireObservationObject(last.staleEffects, "stale effects result");
if (se.ok !== true) fail(`stale effects failed: ${JSON.stringify(se)}`);
const seAfter = requireObservationObject(se.after, "stale effects after");
const seDiag = requireObservationObject(seAfter.diag, "stale effects diagnostics");
const sePass = requireFiniteNumber(seDiag.continueValidationPass, "stale effects continueValidationPass");
const seFail = requireFiniteNumber(seDiag.continueValidationFail, "stale effects continueValidationFail");
const seRelease = requireFiniteNumber(seDiag.releaseCalls, "stale effects releaseCalls");
const seArm = requireFiniteNumber(seDiag.armCount, "stale effects armCount");
const seExec = requireFiniteNumber(seDiag.executorCount, "stale effects executorCount");
const seAuth = requireFiniteNumber(seDiag.authorizedReleaseCount, "stale effects authorizedReleaseCount");
if (sePass !== 0) fail(`stale effects validationPass=${sePass}`);
if (seFail < 1) fail(`stale effects validationFail=${seFail}`);
if (seRelease !== 0 || seArm !== 0 || seExec !== 0 || seAuth !== 0) {
  fail(`stale effects expected zero release got release=${seRelease} arm=${seArm} exec=${seExec} auth=${seAuth}`);
}
ok(`stale effects fail=${seFail} release=${seRelease}`);

assertZeroRelease("stale-button", last.staleButton);
assertZeroRelease("closed-modal", last.closedModal);

const ds = requireObservationObject(last.dispatchStop, "dispatch-stop result");
if (ds.runtimeBlocked) {
  fail(`dispatch-time stop RUNTIME VERIFICATION BLOCKED: ${ds.error || JSON.stringify(ds)}`);
}
if (ds.ok !== true) fail(`dispatch-time stop failed: ${JSON.stringify(ds)}`);
const dsAfter = requireObservationObject(ds.after, "dispatch-stop after");
const snap = requireObservationObject(dsAfter.snap, "dispatch-stop snap");
const snapBefore = requireObservationObject(snap.before, "dispatch-stop snap.before");
const snapAfterStop = requireObservationObject(snap.afterStop, "dispatch-stop snap.afterStop");
const dsDiag = requireObservationObject(dsAfter.diag, "dispatch-stop diagnostics");

requireBoolean(snapBefore.dispatch, "dispatch-stop before.dispatch");
requireBoolean(snapBefore.guard, "dispatch-stop before.guard");
requireBoolean(snapBefore.hostConnected, "dispatch-stop before.hostConnected");
if (snapBefore.dispatch !== true) fail("dispatch-stop: release not active before stop");
if (snapBefore.guard !== true) fail("dispatch-stop: guard not active before stop");
if (snapBefore.hostConnected !== true) fail("dispatch-stop: host not connected before stop");
if (requireBoolean(snapAfterStop.started, "dispatch-stop afterStop.started") !== false) {
  fail("dispatch-stop: not logically stopped");
}
if (requireBoolean(snapAfterStop.hostConnected, "dispatch-stop afterStop.hostConnected") !== true) {
  fail("dispatch-stop: host destroyed before unwind");
}
if (requireBoolean(snapAfterStop.guard, "dispatch-stop afterStop.guard") !== true) {
  fail("dispatch-stop: guard cleared before unwind");
}
if (requireBoolean(snapAfterStop.deferred, "dispatch-stop afterStop.deferred") !== true) {
  fail("dispatch-stop: deferred cleanup not pending");
}
if (requireBoolean(snapAfterStop.realDispatch, "dispatch-stop afterStop.realDispatch") !== true) {
  fail("dispatch-stop: real nested dispatch required");
}
if (snapAfterStop.viaProcessEvent === true) fail("dispatch-stop: processEventForTest evidence forbidden");
if (requireBoolean(snapAfterStop.nestedPrevented, "dispatch-stop nestedPrevented") !== true) {
  fail("dispatch-stop: nested defaultPrevented must be true");
}
if (requireBoolean(snapAfterStop.listener, "dispatch-stop afterStop.listener") !== true) {
  fail("dispatch-stop: release listener must remain after stop");
}
if (requireBoolean(snapAfterStop.nestedWindowMeasured, "dispatch-stop nestedWindowMeasured") !== true) {
  fail("dispatch-stop: nested page Window must be measured");
}
if (requireBoolean(snapAfterStop.nestedTargetMeasured, "dispatch-stop nestedTargetMeasured") !== true) {
  fail("dispatch-stop: nested target must be measured");
}
const m1NestedWin = requireFiniteNumber(snapAfterStop.nestedWindow, "dispatch-stop nestedWindow");
const m1NestedTgt = requireFiniteNumber(snapAfterStop.nestedTarget, "dispatch-stop nestedTarget");
if (m1NestedWin !== 0) fail(`dispatch-stop: nested page Window must be 0 measured got=${m1NestedWin}`);
if (m1NestedTgt !== 0) fail(`dispatch-stop: nested target must be 0 measured got=${m1NestedTgt}`);

if (requireBoolean(dsAfter.currentHostConnected, "dispatch-stop currentHostConnected") !== false) {
  fail("dispatch-stop: current controller host not cleared after unwind");
}
if (requireBoolean(dsAfter.currentHostPresent, "dispatch-stop currentHostPresent") !== false) {
  fail("dispatch-stop: current controller host still present after unwind");
}
if (requireBoolean(dsAfter.deferred, "dispatch-stop deferred") !== false) {
  fail("dispatch-stop: deferred cleanup still pending after unwind");
}
if (requireBoolean(dsAfter.started, "dispatch-stop started") !== false) {
  fail("dispatch-stop: controller not stopped after unwind");
}
if (
  requireBoolean(dsAfter.releaseDispatchInProgress, "dispatch-stop releaseDispatchInProgress") !==
  false
) {
  fail("dispatch-stop: releaseDispatchInProgress still true after unwind");
}
const releaseAttemptCleanup = requireFiniteNumber(
  dsAfter.releaseAttemptCleanupCount,
  "dispatch-stop releaseAttemptCleanupCount",
);
if (releaseAttemptCleanup !== 1) {
  fail(`dispatch-stop: releaseAttemptCleanupCount must be exactly 1 got=${releaseAttemptCleanup}`);
}
const terminalBefore = requireFiniteNumber(ds.terminalBefore, "dispatch-stop terminalBefore");
const terminalCount = requireFiniteNumber(dsAfter.terminalCount, "dispatch-stop terminalCount");
if (terminalCount !== terminalBefore) {
  fail(`dispatch-stop: terminal UI recreated count=${terminalCount} before=${terminalBefore}`);
}
if (dsAfter.originalHostConnectedAfterUnwindType !== "boolean") {
  fail("dispatch-stop: original host after-unwind observation must be boolean");
}
if (requireBoolean(dsAfter.originalHostConnectedAfterUnwind, "dispatch-stop originalHostConnectedAfterUnwind") !== false) {
  fail(
    `dispatch-stop: original retained host isConnected must be false got=${dsAfter.originalHostConnectedAfterUnwind}`,
  );
}
const physicalRemoval = requireFiniteNumber(
  dsAfter.previewHostRemovalCount,
  "dispatch-stop previewHostRemovalCount",
);
if (physicalRemoval !== 1) {
  fail(`dispatch-stop: physical previewHostRemovalCount must be 1 got=${physicalRemoval}`);
}
const readd = requireFiniteNumber(dsAfter.originalHostReaddCount, "dispatch-stop originalHostReaddCount");
if (readd !== 0) fail(`dispatch-stop: originalHostReaddCount must be 0 got=${readd}`);
const replacement = requireFiniteNumber(
  dsAfter.replacementHostInsertCount,
  "dispatch-stop replacementHostInsertCount",
);
if (replacement !== 0) {
  fail(`dispatch-stop: replacementHostInsertCount must be 0 got=${replacement}`);
}
if (
  requireBoolean(snapAfterStop.originalHostConnectedAfterStop, "dispatch-stop originalHostConnectedAfterStop") !==
  true
) {
  fail("dispatch-stop: original host must remain connected after stop before unwind");
}
const removalAfterStop = requireFiniteNumber(
  snapAfterStop.previewHostRemovalCount,
  "dispatch-stop afterStop.previewHostRemovalCount",
);
if (removalAfterStop !== 0) {
  fail(
    `dispatch-stop: previewHostRemovalCount after stop before unwind must be 0 got=${removalAfterStop}`,
  );
}
const dsAuth = requireFiniteNumber(
  dsDiag.authorizedReleaseCount,
  "dispatch-stop diag.authorizedReleaseCount",
);
const dsRetries = requireFiniteNumber(dsDiag.retries, "dispatch-stop diag.retries");
const dsRelease = requireFiniteNumber(dsDiag.releaseCalls, "dispatch-stop diag.releaseCalls");
const dsConsumptions = requireFiniteNumber(dsDiag.consumptions, "dispatch-stop diag.consumptions");
if (dsAuth !== 1) fail(`dispatch-stop: auth=${dsAuth}`);
if (dsRetries !== 0) fail(`dispatch-stop: retries=${dsRetries}`);
if (dsRelease !== 1) fail(`dispatch-stop: releaseCalls=${dsRelease}`);
if (dsConsumptions !== 1) fail(`dispatch-stop: consumptions=${dsConsumptions}`);
ok(
  `dispatch-stop realNested=${snapAfterStop.realDispatch} nestedPrevented=${snapAfterStop.nestedPrevented} nestedWin=${m1NestedWin} nestedTgt=${m1NestedTgt} origHostAfterStop=${snapAfterStop.originalHostConnectedAfterStop} origHostAfterUnwind=${dsAfter.originalHostConnectedAfterUnwind} physicalRemoval=${physicalRemoval} readd=${readd} replacement=${replacement} releaseAttemptCleanup=${releaseAttemptCleanup} terminal=${terminalCount} auth=${dsAuth} consumptions=${dsConsumptions}`,
);

// H1 — matching consequential activation is blocked unless it is the exact authorized release.
const h1 = requireObservationObject(last.h1, "h1 result");
if (h1.ok !== true) fail(`h1 failed: ${JSON.stringify(h1).slice(0, 2000)}`);

function assertAttackBlocked(label, a) {
  const at = requireObservationObject(a, `${label} attack`);
  if (at.ok !== true) fail(`${label} attack setup failed: ${JSON.stringify(at)}`);
  const submitDelta = requireFiniteNumber(at.submitDelta, `${label} submitDelta`);
  const pageSaw = requireFiniteNumber(at.pageSaw, `${label} pageSaw`);
  if (submitDelta !== 0) fail(`${label}: page-generated activation reached submit (delta=${submitDelta})`);
  if (pageSaw !== 0) fail(`${label}: page listener observed blocked activation (pageSaw=${pageSaw})`);
  if (at.kind.indexOf("dispatch") === 0 && at.kind.indexOf("noncancelable") < 0) {
    if (requireBoolean(at.prevented, `${label} prevented`) !== true) fail(`${label}: not prevented`);
  }
}
function assertZeroReleaseSnap(label, snap) {
  const d = requireObservationObject(snap.diag, `${label} diag`);
  for (const k of ["releaseCalls", "armCount", "executorCount", "authorizedReleaseCount", "consumptions", "acceptedContinueAttempts"]) {
    if (requireFiniteNumber(d[k], `${label} ${k}`) !== 0) fail(`${label}: ${k}=${d[k]} expected 0`);
  }
}
function assertQuietNetwork(label, snap) {
  const n = requireObservationObject(snap.native, `${label} native`);
  for (const k of ["fetch", "xhr", "nav"]) {
    if (requireFiniteNumber(n[k], `${label} native.${k}`) !== 0) fail(`${label}: native ${k}=${n[k]}`);
  }
}

const h1Before = requireObservationObject(h1.beforeDecision, "h1 beforeDecision");
for (const a of h1Before.attacks) assertAttackBlocked(`h1 before-decision ${a.kind}`, a);
const h1BeforeAfter = requireObservationObject(h1Before.after, "h1 beforeDecision after");
assertZeroReleaseSnap("h1 before-decision", h1BeforeAfter);
assertQuietNetwork("h1 before-decision", h1BeforeAfter);
if (h1BeforeAfter.previewVisible !== false || h1BeforeAfter.decisionId !== null) {
  fail("h1 before-decision: preview authority created by page activation");
}
if (requireFiniteNumber(h1BeforeAfter.native.submit, "h1 before-decision submit") !== 0) {
  fail("h1 before-decision: submit reached page");
}
const h1BeforeGuard = requireObservationObject(h1BeforeAfter.guard, "h1 before-decision guard");
const h1BeforeBlocked = requireFiniteNumber(h1BeforeGuard.blockedUnauthorizedActivations, "h1 before blockedActivations");
const h1BeforeSubmitsBlocked = requireFiniteNumber(h1BeforeGuard.blockedUnauthorizedSubmits, "h1 before blockedSubmits");
if (h1BeforeBlocked !== h1Before.attacks.length) {
  fail(`h1 before-decision: blockedUnauthorizedActivations=${h1BeforeBlocked} expected ${h1Before.attacks.length}`);
}
if (h1BeforeSubmitsBlocked !== 1) {
  fail(`h1 before-decision: non-cancelable activation submit must be blocked exactly once got=${h1BeforeSubmitsBlocked}`);
}
ok(
  `H1 before-decision attacks=${h1Before.attacks.map((a) => a.kind).join(",")} submit=0 release=0 preview=false blockedActivations=${h1BeforeBlocked} blockedSubmits=${h1BeforeSubmitsBlocked}`,
);

const un = requireObservationObject(h1Before.unrelated, "h1 unrelated");
if (requireFiniteNumber(un.submits, "h1 unrelated submits") !== 2) fail(`h1 unrelated submits=${un.submits} expected 2`);
if (requireFiniteNumber(un.pageSaw, "h1 unrelated pageSaw") !== 2) fail(`h1 unrelated pageSaw=${un.pageSaw} expected 2`);
if (requireBoolean(un.prevented, "h1 unrelated prevented") !== false) fail("h1 unrelated: FutureClick prevented unrelated click");
const unGuard = requireObservationObject(h1Before.guardAfterUnrelated, "h1 unrelated guard");
if (unGuard.blockedUnauthorizedActivations !== h1BeforeBlocked || unGuard.blockedUnauthorizedSubmits !== h1BeforeSubmitsBlocked) {
  fail("h1 unrelated: FutureClick counted an unrelated event");
}
ok(`H1 unrelated synthetic click prevented=false pageSaw=2 submits=2`);

const h1W = requireObservationObject(h1.waiting, "h1 waiting");
for (const a of h1W.attacks) assertAttackBlocked(`h1 waiting ${a.kind}`, a);
const h1Waiting = requireObservationObject(h1W.waiting, "h1 waiting snap");
if (h1Waiting.mode !== "verified") fail(`h1 waiting: VERIFIED lost mode=${h1Waiting.mode}`);
assertZeroReleaseSnap("h1 waiting", h1Waiting);
assertQuietNetwork("h1 waiting", h1Waiting);
if (requireFiniteNumber(h1Waiting.native.submit, "h1 waiting submit") !== 0) fail("h1 waiting: submit reached page");
ok(`H1 waiting (freeze repro) VERIFIED=yes Continue=no attacks=${h1W.attacks.map((a) => a.kind).join(",")} submit=0 release=0`);

const h1Rel = requireObservationObject(h1W.released, "h1 released");
const relD = requireObservationObject(h1Rel.diag, "h1 released diag");
for (const [k, v] of [["acceptedContinueAttempts", 1], ["releaseCalls", 1], ["armCount", 1], ["executorCount", 1], ["authorizedReleaseCount", 1], ["consumptions", 1], ["retries", 0], ["fallbacks", 0]]) {
  if (requireFiniteNumber(relD[k], `h1 released ${k}`) !== v) fail(`h1 released: ${k}=${relD[k]} expected ${v}`);
}
if (relD.terminalOutcome !== "CONSUMED") fail(`h1 released terminal=${relD.terminalOutcome}`);
if (requireFiniteNumber(h1W.authorizedSubmitDelta, "h1 authorizedSubmitDelta") !== 1) {
  fail(`h1 authorized release submit delta=${h1W.authorizedSubmitDelta} expected 1`);
}
ok(`H1 authorized release after blocked attacks release=1 arm=1 executor=1 auth=1 consumptions=1 retries=0 submit=1`);

for (const a of h1W.postAttacks) assertAttackBlocked(`h1 post-terminal ${a.kind}`, a);
const h1Post = requireObservationObject(h1W.postTerminal, "h1 postTerminal");
const postD = requireObservationObject(h1Post.diag, "h1 postTerminal diag");
if (postD.releaseCalls !== 1 || postD.consumptions !== 1 || postD.authorizedReleaseCount !== 1 || postD.retries !== 0) {
  fail(`h1 post-terminal: release state changed ${JSON.stringify(postD)}`);
}
if (h1Post.native.submit !== h1Rel.native.submit) fail("h1 post-terminal: extra submit reached page");
ok(`H1 post-terminal page activation submit=+0 release=1 total`);

const h1Desc = requireObservationObject(h1.waitingDescendant, "h1 waiting descendant");
for (const a of h1Desc.attacks) assertAttackBlocked(`h1 waiting ${a.kind}`, a);
assertZeroReleaseSnap("h1 waiting descendant", requireObservationObject(h1Desc.after, "h1 desc after"));
for (const a of h1Before.attacks.filter((x) => x.kind.indexOf("descendant") >= 0)) {
  assertAttackBlocked(`h1 before-decision ${a.kind}`, a);
}
ok("H1 descendant (before decision + waiting) submit=0 release=0");

for (const key of ["afterCancel", "afterEscape", "afterClosedModal"]) {
  const r = requireObservationObject(h1[key], `h1 ${key}`);
  for (const a of r.attacks) assertAttackBlocked(`h1 ${key} ${a.kind}`, a);
  const after = requireObservationObject(r.after, `h1 ${key} after`);
  assertZeroReleaseSnap(`h1 ${key}`, after);
  if (requireFiniteNumber(after.native.submit, `h1 ${key} submit`) !== 0) fail(`h1 ${key}: submit reached page`);
  ok(`H1 ${key} page activation submit=0 release=0`);
}

// A2 — H2 re-render recovery and M1 single guarded submit per Continue.
const a2 = requireObservationObject(last.a2, "a2 result");
if (a2.ok !== true) fail(`a2 failed: ${JSON.stringify(a2).slice(0, 2000)}`);

function assertA2AttacksBlocked(label, attacks) {
  if (!Array.isArray(attacks) || attacks.length !== 4) fail(`${label}: attack list missing`);
  for (const a of attacks) {
    if (requireFiniteNumber(a.submitDelta, `${label} ${a.kind} submitDelta`) !== 0) {
      fail(`${label}: page ${a.kind} on replacement reached submit (delta=${a.submitDelta})`);
    }
  }
}
function assertSingleRelease(label, snap) {
  const d = requireObservationObject(snap.diag, `${label} diag`);
  for (const [k, v] of [["acceptedContinueAttempts", 1], ["releaseCalls", 1], ["armCount", 1], ["executorCount", 1], ["authorizedReleaseCount", 1], ["consumptions", 1], ["retries", 0], ["fallbacks", 0]]) {
    if (requireFiniteNumber(d[k], `${label} ${k}`) !== v) fail(`${label}: ${k}=${d[k]} expected ${v}`);
  }
  if (d.terminalOutcome !== "CONSUMED") fail(`${label}: terminal=${d.terminalOutcome}`);
}
function assertRecoveredPreview(label, r, priorDecisionId) {
  if (r.rerender?.replaced !== true || r.rerender?.oldConnected !== false) fail(`${label}: page did not replace the final button`);
  if (r.guardMoved !== true) fail(`${label}: guard did not move to the replacement button`);
  const ar = requireObservationObject(r.afterRerender, `${label} afterRerender`);
  if (ar.mode === "verified" || ar.mode === "pending") fail(`${label}: stale preview survived re-render mode=${ar.mode}`);
  if (ar.decisionId !== null) fail(`${label}: stale decision survived re-render`);
  if (ar.guardOnCurrent !== true) fail(`${label}: guard not on current button after re-render`);
  if (requireFiniteNumber(ar.native.a2Submits, `${label} afterRerender submits`) !== 0) fail(`${label}: submit after re-render`);
  assertA2AttacksBlocked(label, r.attacks);
  if (r.human !== true) fail(`${label}: human click on replacement did not produce VERIFIED preview`);
  const ah = requireObservationObject(r.afterHuman, `${label} afterHuman`);
  if (ah.mode !== "verified" || !ah.decisionId) fail(`${label}: no fresh VERIFIED decision`);
  if (priorDecisionId != null && ah.decisionId === priorDecisionId) fail(`${label}: decision reused across re-render`);
  if (ah.guardOnCurrent !== true) fail(`${label}: VERIFIED decision not bound to current button`);
  if (requireFiniteNumber(ah.native.a2Submits, `${label} afterHuman submits`) !== 0) fail(`${label}: human click on replacement submitted without Continue`);
  if (requireFiniteNumber(ah.diag.releaseCalls, `${label} afterHuman releaseCalls`) !== 0) fail(`${label}: release before Continue`);
}

const h2V = requireObservationObject(a2.h2Verified, "a2 h2Verified");
assertRecoveredPreview("A2 H2 VERIFIED re-render", h2V, h2V.before?.decisionId ?? null);
if (requireFiniteNumber(h2V.afterRerender.guard.recoveryRecognitionRuns, "h2V recoveryRuns") < 1) fail("A2 H2 VERIFIED: no recovery recognition");
assertSingleRelease("A2 H2 VERIFIED Continue", h2V.afterContinue);
if (requireFiniteNumber(h2V.afterContinue.native.a2Submits, "h2V submits") !== 1) fail(`A2 H2 VERIFIED: Continue submits=${h2V.afterContinue.native.a2Submits} expected 1`);
assertQuietNetwork("A2 H2 VERIFIED", h2V.afterContinue);
ok(`A2 H2 VERIFIED re-render oldPreview=demoted recognitionRerun=${h2V.afterRerender.guard.recoveryRecognitionRuns} replacementGuarded=yes pageAttacks=0 humanClick=intercepted+VERIFIED submitBeforeContinue=0 continueSubmit=1`);

const h2P = requireObservationObject(a2.h2Pending, "a2 h2Pending");
if (h2P.pending !== true) fail("A2 H2 pending: evaluation never reached pending");
assertRecoveredPreview("A2 H2 pending re-render", h2P, null);
const settled = requireObservationObject(h2P.afterStaleSettled, "h2P afterStaleSettled");
if (settled.mode === "verified" || settled.decisionId !== null) fail("A2 H2 pending: stale evaluation published VERIFIED");
if (settled.guardOnCurrent !== true) fail("A2 H2 pending: stale result moved guard off current button");
assertSingleRelease("A2 H2 pending Continue", h2P.afterContinue);
if (requireFiniteNumber(h2P.afterContinue.native.a2Submits, "h2P submits") !== 1) fail(`A2 H2 pending: Continue submits=${h2P.afterContinue.native.a2Submits} expected 1`);
ok(`A2 H2 pending re-render staleResult=ignored freshRecognition=yes replacementGuarded=yes pageAttacks=0 humanClick=intercepted+VERIFIED continueSubmit=1`);

const h2R = requireObservationObject(a2.h2Repeated, "a2 h2Repeated");
if (!Array.isArray(h2R.rounds) || h2R.rounds.length !== 3) fail("A2 H2 repeated: rounds missing");
h2R.rounds.forEach((r, i) => assertRecoveredPreview(`A2 H2 repeated round ${i + 1}`, r, h2R.decisionIds[i]));
if (new Set(h2R.decisionIds).size !== h2R.decisionIds.length) fail("A2 H2 repeated: decision ids not unique");
if (requireFiniteNumber(h2R.finalButtons, "h2R finalButtons") !== 1) fail("A2 H2 repeated: duplicate final buttons");
const h2RRuns = requireFiniteNumber(h2R.rounds[2].afterHuman.guard.recoveryRecognitionRuns, "h2R recoveryRuns");
if (h2RRuns !== 3) fail(`A2 H2 repeated: recoveryRecognitionRuns=${h2RRuns} expected 3`);
assertSingleRelease("A2 H2 repeated Continue", h2R.afterContinue);
if (requireFiniteNumber(h2R.afterContinue.native.a2Submits, "h2R submits") !== 1) fail(`A2 H2 repeated: Continue submits=${h2R.afterContinue.native.a2Submits} expected 1`);
ok(`A2 H2 repeated re-renders=3 recoveryRuns=${h2RRuns} uniqueDecisions=${h2R.decisionIds.length} staleAuthorities=0 continueSubmit=1`);

const m1 = requireObservationObject(a2.m1, "a2 m1");
const M1_EXPECTED_BLOCKED = { none: 0, "nested-1": 1, "nested-3": 3, "request-submit": 1, descendant: 1, unrelated: 0 };
for (const [kind, blocked] of Object.entries(M1_EXPECTED_BLOCKED)) {
  const r = requireObservationObject(m1[kind], `a2 m1 ${kind}`);
  assertSingleRelease(`A2 M1 ${kind}`, r.after);
  if (requireFiniteNumber(r.submitDelta, `m1 ${kind} submitDelta`) !== 1) fail(`A2 M1 ${kind}: guarded submits=${r.submitDelta} expected exactly 1`);
  if (requireFiniteNumber(r.setVisibilityRequests, `m1 ${kind} requests`) !== 0) fail(`A2 M1 ${kind}: unexpected set_visibility request with prevented counter`);
  const g = requireObservationObject(r.after.guard, `m1 ${kind} guard`);
  if (requireFiniteNumber(g.allowedReleaseSubmits, `m1 ${kind} allowed`) !== 1) fail(`A2 M1 ${kind}: allowedReleaseSubmits=${g.allowedReleaseSubmits}`);
  if (requireFiniteNumber(g.blockedUnauthorizedSubmits, `m1 ${kind} blocked`) !== blocked) fail(`A2 M1 ${kind}: blockedUnauthorizedSubmits=${g.blockedUnauthorizedSubmits} expected ${blocked}`);
  if (g.releaseSubmitAllowance !== "none") fail(`A2 M1 ${kind}: allowance not cleared (${g.releaseSubmitAllowance})`);
  if (kind !== "none" && requireFiniteNumber(r.pageM1?.fired, `m1 ${kind} fired`) !== 1) fail(`A2 M1 ${kind}: page handler did not run inside authorized dispatch`);
  if (kind === "unrelated" && requireFiniteNumber(r.pageM1.unrelatedSubmits, "m1 unrelated submits") !== 1) fail("A2 M1 unrelated: unrelated form submit was affected");
  assertQuietNetwork(`A2 M1 ${kind}`, r.after);
  ok(`A2 M1 ${kind} guardedSubmits=1 blockedNested=${blocked} release=1 arm=1 executor=1 auth=1 consumptions=1 retries=0${kind === "unrelated" ? " unrelatedSubmits=1" : ""}`);
}
const m1Net = requireObservationObject(a2.m1Network, "a2 m1Network");
for (const kind of ["none", "nested-3", "request-submit", "descendant"]) {
  const r = requireObservationObject(m1Net[kind], `a2 m1Network ${kind}`);
  if (requireFiniteNumber(r.beforeRequests, `m1net ${kind} before`) !== 0) fail(`A2 M1 network ${kind}: request before Continue`);
  const n = requireFiniteNumber(r.afterRequests, `m1net ${kind} after`);
  if (n !== 1) fail(`A2 M1 network ${kind}: set_visibility requests=${n} expected exactly 1`);
}
ok("A2 M1 network (no harness preventDefault) none/nested-3/request-submit/descendant consequentialRequests=1 each");

ok("Sprint 3C normal-bundle Chrome smoke PASS");
process.exit(0);
