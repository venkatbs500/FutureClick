#!/usr/bin/env node
/**
 * FC-007 Sprint 3B — dedicated isolated release Chrome smoke (security-fix).
 * Isolated-world release + genuine page-realm Window probes.
 * Production Continue remains unwired. No live GitHub.
 */

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
const SMOKE_OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-3b-smoke-"));
const requireFromExt = createRequire(path.join(EXT_ROOT, "package.json"));

function fail(msg) {
  console.error("[FAIL]", msg);
  cleanup();
  process.exit(1);
}
function ok(msg) {
  console.log("[ACTUALLY EXECUTED]", msg);
}
function cleanup() {
  try {
    fs.rmSync(SMOKE_OUTDIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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
      await browser.close();
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
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
  fail("RUNTIME_VERIFICATION_BLOCKED: NO USABLE CHROME EXECUTABLE");
}

const CHROME = resolveChromeBinary();

const prodBundle = path.join(DIST, "fc007-observation.bundle.js");
if (!fs.existsSync(prodBundle)) {
  execFileSync("pnpm", ["run", "build"], { cwd: EXT_ROOT, stdio: "inherit" });
}
for (const needle of ["releaseOnce", "ACTION_ADMITTED_ONCE"]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
  } catch (err) {
    if (err && err.status === 1) fail(`production bundle missing Sprint-3C ${needle}`);
    throw err;
  }
}
for (const needle of ["__FC007_3B_HARNESS__", "ArmedContinuation", "requestSubmit"]) {
  try {
    execFileSync("rg", ["-F", "-q", "--", needle, prodBundle], { stdio: "ignore" });
    fail(`production bundle contains forbidden ${needle}`);
  } catch (err) {
    if (err && err.status !== 1) throw err;
  }
}
ok("production bundle has Sprint-3C Continue→release; no 3B harness");

execFileSync("pnpm", ["exec", "node", "scripts/build.mjs"], {
  cwd: EXT_ROOT,
  stdio: "inherit",
  env: { ...process.env, FC007_BUILD_SMOKE_3B: "1", FC007_SMOKE_OUTDIR: SMOKE_OUTDIR },
});
const smokeBundle = path.join(SMOKE_OUTDIR, "fc007-sprint3b-smoke.bundle.js");
if (!fs.existsSync(smokeBundle)) fail("3B smoke bundle missing");
ok(`3B smoke bundle at ${smokeBundle}`);

const workerPath = path.join(os.tmpdir(), `fc007-3b-worker-${process.pid}.mjs`);
fs.writeFileSync(
  workerPath,
  `import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);
const puppeteer = (require(${JSON.stringify(PUPPETEER_CORE_PATH)}).default) ?? require(${JSON.stringify(PUPPETEER_CORE_PATH)});
const CHROME = ${JSON.stringify(CHROME)};
const ROOT_SMOKE = ${JSON.stringify(smokeBundle)};
const FIXTURE = ${JSON.stringify(FIXTURE)};
const SYNTHETIC_URL = ${JSON.stringify(SYNTHETIC_URL)};
const fixtureHtml = fs.readFileSync(FIXTURE, "utf8");

const TMP_EXT = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-3b-ext-"));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-3b-prof-"));
fs.copyFileSync(ROOT_SMOKE, path.join(TMP_EXT, "fc007-sprint3b-smoke.bundle.js"));
fs.writeFileSync(path.join(TMP_EXT, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "fc007-3b", version: "0",
  content_scripts: [{
    matches: ["https://github.com/*/*/settings*"],
    js: ["fc007-sprint3b-smoke.bundle.js"],
    run_at: "document_start", all_frames: false, world: "ISOLATED",
  }],
}));

// CfT 142 + extensions: --single-process/--disable-gpu required for Puppeteer frames.
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", userDataDir: PROFILE,
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

try {
  const pages = await browser.pages();
  let page = pages[0];
  if (!page) page = await browser.newPage();
  {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { page.mainFrame(); break; } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try { page.mainFrame(); } catch {
      throw new Error("RUNTIME VERIFICATION BLOCKED: Puppeteer main frame unavailable");
    }
  }
  const requestLedger = [];
  let contentScriptContextId = null;
  const diagEvents = [];
  const cdp = await page.createCDPSession();
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.consoleAPICalled", (e) => {
    const t = (e.args || []).map((a) => a.value ?? a.description).join(" ");
    if (typeof t !== "string") return;
    if ((t.startsWith("__FC007_DIAG__") || t.startsWith("__FC007_BOOT__")) && typeof e.executionContextId === "number") {
      contentScriptContextId = e.executionContextId;
    }
    if (t.startsWith("__FC007_DIAG__")) {
      try { diagEvents.push(JSON.parse(t.slice("__FC007_DIAG__".length))); } catch {}
    }
  });

  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    if (url === SYNTHETIC_URL || url === SYNTHETIC_URL + "/") {
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
  await page.evaluate(() => {
    if (window.__fc007SetStage) window.__fc007SetStage("d");
    const main = document.querySelector("main");
    if (main) { const p = document.createElement("span"); main.appendChild(p); p.remove(); }
  });
  await new Promise((r) => setTimeout(r, 1500));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !contentScriptContextId) {
    await new Promise((r) => setTimeout(r, 100));
  }
  while (Date.now() < deadline) {
    if (diagEvents.some((d) => d.kind === "evaluated" || d.kind === "contract-recognized")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!contentScriptContextId) throw new Error("NO_ISOLATED_CONTEXT");

  async function iso(expr) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: expr,
      contextId: contentScriptContextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "iso-eval-failed");
    return r.result?.value;
  }

  const earlyListener = await iso(\`(function(){
    const h = globalThis.__FC007_3B_HARNESS__;
    return h && h.isListenerInstalled ? h.isListenerInstalled() : false;
  })()\`);
  if (!earlyListener) throw new Error("WINDOW_LISTENER_NOT_EARLY");

  const box = await page.$eval("#final-make-public", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);

  const verifiedDeadline = Date.now() + 20000;
  let verified = false;
  while (Date.now() < verifiedDeadline) {
    const mode = await iso(\`(function(){ const c = globalThis.__FC007_SMOKE_CTRL__; return c && c.getPreviewMode ? c.getPreviewMode() : null; })()\`);
    if (mode === "verified") { verified = true; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!verified) throw new Error("NOT_VERIFIED");

  // GENUINE page-realm Window capture — AFTER extension document_start listener.
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
      realm: "page",
      instanceTamperInstalled: false,
      prototypeTamperInstalled: false,
      instanceTamperCount: 0,
      prototypeTamperCount: 0,
    };
    const probe = window.__FC007_PAGE_PROBE__;
    window.addEventListener("click", () => {
      const phase = document.documentElement.getAttribute("data-fc007-probe-phase") || "";
      const consumed = document.documentElement.getAttribute("data-fc007-consumed") === "1";
      if (phase === "primary") {
        probe.primaryWindowSeen += 1;
        probe.permissionConsumedBeforePageWindow = consumed;
      } else if (phase === "nested-fresh") {
        probe.nestedWindowSeen += 1;
      } else if (phase === "nested-reused") {
        probe.reusedWindowSeen += 1;
      } else if (phase === "nested-desc") {
        probe.descendantWindowSeen += 1;
      }
    }, true);
  });

  // Stale matrix FIRST (unused decision). PAGE-REALM .click tampers installed via page.evaluate
  // between stale restore and releaseOnce — never in the isolated world.
  const stalePrep = await iso(\`(function(){
    const h = globalThis.__FC007_3B_HARNESS__;
    const c = globalThis.__FC007_SMOKE_CTRL__;
    if (!h || !c) return { ok: false, error: "NO_HARNESS" };
    const decision = h.getDecision();
    if (!decision) return { ok: false, error: "NO_DECISION" };
    if (!(decision.finalButton instanceof HTMLButtonElement)) return { ok: false, error: "NO_BUTTON" };

    h.ensureReleaseInstalled();
    const prod = c.getSprint3aDiagnosticsForTest();
    h.stopControllerKeepDecision();

    const snapExec = () => h.getReleaseSnapshot().counters.executorCalls;
    const snapAuth = () => h.getReleaseSnapshot().counters.authorizedEventsObserved;
    const staleResults = {};
    function rejectCase(name, mutate, restore) {
      mutate();
      const beforeExec = snapExec();
      const beforeAuth = snapAuth();
      const r = h.armCurrentDecision();
      staleResults[name] = {
        status: r.status,
        reason: r.reason || null,
        executorDelta: snapExec() - beforeExec,
        authDelta: snapAuth() - beforeAuth,
      };
      if (restore) restore();
    }
    const hostParent = decision.ownedHost.parentNode;
    rejectCase("hostRemoved", () => decision.ownedHost.remove(), () => hostParent && hostParent.appendChild(decision.ownedHost));
    rejectCase("hostReparented", () => document.body.appendChild(decision.ownedHost), () => decision.modal.appendChild(decision.ownedHost));
    const formParent = decision.form.parentNode;
    rejectCase("formReparented", () => document.body.appendChild(decision.form), () => formParent && formParent.appendChild(decision.form));
    const otherForm = document.createElement("form");
    document.body.appendChild(otherForm);
    const btnParent = decision.finalButton.parentNode;
    rejectCase("wrongButtonForm", () => otherForm.appendChild(decision.finalButton), () => btnParent && btnParent.appendChild(decision.finalButton));
    otherForm.remove();
    rejectCase("modalClosed", () => decision.modal.close(), () => {
      try { decision.modal.showModal(); } catch {
        decision.modal.setAttribute("open", "");
        decision.modal.open = true;
      }
    });
    const modalParent = decision.modal.parentNode;
    rejectCase("modalDisconnected", () => decision.modal.remove(), () => {
      if (modalParent) modalParent.appendChild(decision.modal);
      try {
        if (decision.modal.open) decision.modal.close();
        decision.modal.showModal();
      } catch {
        decision.modal.setAttribute("open", "");
        decision.modal.open = true;
      }
      if (!decision.ownedHost.isConnected) decision.modal.appendChild(decision.ownedHost);
    });
    const staleOk = Object.values(staleResults).every((x) => x.status === "invalid" && x.executorDelta === 0 && x.authDelta === 0);

    try {
      if (decision.modal.open) decision.modal.close();
      decision.modal.showModal();
    } catch {
      decision.modal.setAttribute("open", "");
      decision.modal.open = true;
    }
    if (!decision.ownedHost.isConnected) decision.modal.appendChild(decision.ownedHost);

    return {
      ok: staleOk === true,
      staleOk,
      staleResults,
      prod,
      postStaleHostConnected: decision.ownedHost.isConnected,
      postStaleModalOpen: decision.modal.open,
      postStaleHostParentIsModal: decision.ownedHost.parentElement === decision.modal,
      postStaleButtonForm: decision.finalButton.form === decision.form,
      postStaleFormInModal: decision.modal.contains(decision.form),
    };
  })()\`);

  if (!stalePrep?.ok) throw new Error("STALE_PREP_FAILED:" + JSON.stringify(stalePrep));

  // GENUINE PAGE-REALM .click tampering via page.evaluate (page main world — NOT iso/CDP isolated).
  // Hostile instrumentation only; release still invoked through isolated harness below.
  const pageTamperInstall = await page.evaluate(() => {
    const button = document.getElementById("final-make-public");
    if (!(button instanceof HTMLButtonElement)) return { ok: false, error: "NO_PAGE_BUTTON" };
    const probe = window.__FC007_PAGE_PROBE__;
    if (!probe || probe.realm !== "page") return { ok: false, error: "NO_PAGE_PROBE" };
    window.__pageInstanceClickTamperCount = 0;
    window.__pagePrototypeClickTamperCount = 0;
    probe.instanceTamperCount = 0;
    probe.prototypeTamperCount = 0;
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
      installVia: "page.evaluate",
      instanceTamperInstalled: probe.instanceTamperInstalled,
      prototypeTamperInstalled: probe.prototypeTamperInstalled,
      buttonId: button.id,
    };
  });
  if (!pageTamperInstall?.ok) {
    throw new Error("PAGE_TAMPER_INSTALL_FAILED:" + JSON.stringify(pageTamperInstall));
  }

  // Prove isolated world did NOT install .click overrides (page-realm proof is separate).
  const isoTamperCheck = await iso(\`(function(){
    const button = document.getElementById("final-make-public");
    if (!(button instanceof HTMLButtonElement)) return { isolatedWorldTamperUsedAsProof: true, error: "NO_BUTTON" };
    const own = Object.prototype.hasOwnProperty.call(button, "click");
    const protoName = HTMLButtonElement.prototype.click && HTMLButtonElement.prototype.click.name;
    // Isolated must not own a smoke-installed pageRealm* override; native name is typically "".
    const looksLikePageTamperName =
      protoName === "pageRealmPrototypeClickTamper" || protoName === "pageRealmInstanceClickTamper";
    return {
      isolatedWorldTamperUsedAsProof: looksLikePageTamperName === true,
      isolatedOwnClick: own,
      isolatedProtoName: protoName || "",
      hasPageProbe: typeof globalThis.__FC007_PAGE_PROBE__ !== "undefined",
    };
  })()\`);
  if (isoTamperCheck?.isolatedWorldTamperUsedAsProof === true) {
    throw new Error("ISOLATED_WORLD_TAMPER_DETECTED:" + JSON.stringify(isoTamperCheck));
  }
  // Page probe must be invisible in isolated world (separate JS heap).
  if (isoTamperCheck?.hasPageProbe === true) {
    throw new Error("PAGE_PROBE_VISIBLE_IN_ISOLATED:" + JSON.stringify(isoTamperCheck));
  }

  // Isolated release path: handlers + releaseOnce. NO isolated-world .click overrides.
  const releaseResult = await iso(\`(async function(){
    const h = globalThis.__FC007_3B_HARNESS__;
    if (!h) return { ok: false, error: "NO_HARNESS" };
    const decision = h.getDecision();
    if (!decision) return { ok: false, error: "NO_DECISION" };
    const button = decision.finalButton;
    if (!(button instanceof HTMLButtonElement)) return { ok: false, error: "NO_BUTTON" };
    if (!h.isListenerInstalled()) return { ok: false, error: "LISTENER_MISSING_BEFORE_RELEASE" };

    let primary = 0;
    let nestedDownstream = 0, nestedDescDownstream = 0, reusedDownstream = 0;
    let sawConsumed = false, sawGuard = false;
    let nestedPrevented = false, descPrevented = false;
    let reusedFirstPrevented = false, reusedSecondPrevented = false;
    let generatedIsTrusted = null, generatedTargetExact = false;

    const span = document.createElement("span");
    span.textContent = "x";
    button.appendChild(span);
    span.addEventListener("click", () => { nestedDescDownstream += 1; });
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    document.documentElement.removeAttribute("data-fc007-consumed");

    button.addEventListener("click", (e) => {
      if (primary === 0) {
        primary += 1;
        h.notePrimary();
        const snap = h.getReleaseSnapshot();
        sawConsumed = snap.receipt.consumed === true;
        sawGuard = snap.dispatchGuardActive === true;
        generatedIsTrusted = e.isTrusted;
        generatedTargetExact = e.target === button;

        document.documentElement.setAttribute("data-fc007-probe-phase", "nested-fresh");
        const nested = new MouseEvent("click", { bubbles: true, cancelable: true });
        button.dispatchEvent(nested);
        nestedPrevented = nested.defaultPrevented === true;
        if (!nested.defaultPrevented) nestedDownstream += 1;

        document.documentElement.setAttribute("data-fc007-probe-phase", "nested-reused");
        const reused = new MouseEvent("click", { bubbles: true, cancelable: true });
        button.dispatchEvent(reused);
        reusedFirstPrevented = reused.defaultPrevented === true;
        if (!reused.defaultPrevented) reusedDownstream += 1;
        button.dispatchEvent(reused);
        reusedSecondPrevented = reused.defaultPrevented === true;
        if (!reused.defaultPrevented) reusedDownstream += 1;

        document.documentElement.setAttribute("data-fc007-probe-phase", "nested-desc");
        const nestedDesc = new MouseEvent("click", { bubbles: true, cancelable: true });
        span.dispatchEvent(nestedDesc);
        descPrevented = nestedDesc.defaultPrevented === true;
        if (!nestedDesc.defaultPrevented) nestedDescDownstream += 1;
      } else {
        nestedDownstream += 1;
      }
    }, false);

    document.documentElement.setAttribute("data-fc007-probe-phase", "primary");
    const exec = h.releaseOnceCurrentDecision();
    const snap = h.getReleaseSnapshot();

    return {
      ok: exec.outcome === "CONSUMED" && exec.consumed === true,
      exec, snap, primary, sawConsumed, sawGuard,
      nestedPrevented, descPrevented, nestedDownstream, nestedDescDownstream,
      reusedFirstPrevented, reusedSecondPrevented, reusedDownstream,
      generatedIsTrusted, generatedTargetExact,
      authorizationCount: snap.counters.authorizedEventsObserved,
      blockedMatching: snap.counters.blockedMatchingEvents,
      retries: snap.counters.retries,
      fallbacks: snap.counters.fallbacks,
      executorCalls: snap.counters.executorCalls,
      fcWindowSequenceAtConsume: exec.fcWindowSequenceAtConsume,
      listenerInstalledAfter: snap.listenerInstalled,
      releaseReason: exec.reason || null,
    };
  })()\`);

  // Read PAGE-REALM tamper proof and restore page overrides (page.evaluate = page world).
  const pageTamper = await page.evaluate(() => {
    const probe = window.__FC007_PAGE_PROBE__;
    const restore = window.__FC007_PAGE_TAMPER_RESTORE__;
    const out = {
      realm: probe && probe.realm,
      installVia: "page.evaluate",
      instanceTamperInstalled: !!(probe && probe.instanceTamperInstalled),
      prototypeTamperInstalled: !!(probe && probe.prototypeTamperInstalled),
      instanceTamperCount:
        typeof window.__pageInstanceClickTamperCount === "number"
          ? window.__pageInstanceClickTamperCount
          : (probe ? probe.instanceTamperCount : -1),
      prototypeTamperCount:
        typeof window.__pagePrototypeClickTamperCount === "number"
          ? window.__pagePrototypeClickTamperCount
          : (probe ? probe.prototypeTamperCount : -1),
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
  const isolatedWorldTamperUsedAsProof = isoTamperCheck?.isolatedWorldTamperUsedAsProof === true;
  const result = {
    ...(releaseResult || {}),
    ok: !!(stalePrep?.ok && releaseResult?.ok),
    prod: stalePrep.prod,
    staleResults: stalePrep.staleResults,
    staleOk: stalePrep.staleOk,
    postStaleHostConnected: stalePrep.postStaleHostConnected,
    postStaleModalOpen: stalePrep.postStaleModalOpen,
    postStaleHostParentIsModal: stalePrep.postStaleHostParentIsModal,
    postStaleButtonForm: stalePrep.postStaleButtonForm,
    postStaleFormInModal: stalePrep.postStaleFormInModal,
    pageTamperInstall,
    pageTamper,
    isoTamperCheck,
    isolatedWorldTamperUsedAsProof,
  };
  const staleResults = { ok: !!stalePrep?.staleOk, results: stalePrep?.staleResults || {} };

  process.stdout.write(JSON.stringify({
    ok: !!result?.ok && !!staleResults?.ok &&
      pageTamper?.instanceTamperInstalled === true &&
      pageTamper?.prototypeTamperInstalled === true &&
      pageTamper?.instanceTamperCount === 0 &&
      pageTamper?.prototypeTamperCount === 0,
    result,
    pageProbe,
    pageTamper,
    staleResults,
    requestLedger,
    chromeVersion: await browser.version(),
    externalGitHub: requestLedger.filter((e) => /github\\\\.com/i.test(e.url) && e.disposition === "allowed").length,
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
  ok(`Chrome 3B smoke attempt ${attempt}/${MAX_ATTEMPTS}`);
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
      `attempt ${attempt} parse-fail status=${child.status} err=${(child.stderr || "").slice(0, 160)}`,
    );
    continue;
  }
  if (!parsed.ok) {
    ok(
      `attempt ${attempt} not-ok status=${child.status} err=${parsed.error || ""} result=${JSON.stringify(parsed.result || parsed).slice(0, 500)} stderr=${(child.stderr || "").slice(0, 200)}`,
    );
    continue;
  }
  last = parsed;
  break;
}
fs.rmSync(workerPath, { force: true });
cleanup();
execFileSync("pnpm", ["exec", "node", "scripts/build.mjs"], { cwd: EXT_ROOT, stdio: "inherit" });

if (!last?.ok) fail("Sprint 3B Chrome smoke failed");
const r = last.result;
const pp = last.pageProbe || {};
const st = last.staleResults || {};

ok(`Chrome version ${last.chromeVersion}`);
ok(`native executor outcome=${r.exec.outcome}`);
ok(`generated isTrusted=${r.generatedIsTrusted} exactTarget=${r.generatedTargetExact}`);
ok(`consume-before-handler consumed=${r.sawConsumed} guard=${r.sawGuard}`);
ok(`fresh nested prevented=${r.nestedPrevented} downstream=${r.nestedDownstream}`);
ok(`reused first=${r.reusedFirstPrevented} second=${r.reusedSecondPrevented} downstream=${r.reusedDownstream}`);
ok(`descendant nested prevented=${r.descPrevented} downstream=${r.nestedDescDownstream}`);
const pt = last.pageTamper || r.pageTamper || {};
ok(`authorizationCount=${r.authorizationCount} blocked=${r.blockedMatching} executor=${r.executorCalls} retries=${r.retries}`);
ok(
  `PAGE-REALM tamper realm=${pt.realm} instanceInstalled=${pt.instanceTamperInstalled} protoInstalled=${pt.prototypeTamperInstalled} instanceCount=${pt.instanceTamperCount} protoCount=${pt.prototypeTamperCount} isolatedAsProof=${r.isolatedWorldTamperUsedAsProof}`,
);
ok(
  `page Window primary=${pp.primaryWindowSeen} nested=${pp.nestedWindowSeen} reused=${pp.reusedWindowSeen} desc=${pp.descendantWindowSeen} permBefore=${pp.permissionConsumedBeforePageWindow}`,
);
ok(`stale matrix ok=${st.ok} keys=${Object.keys(st.results || {}).join(",")}`);
ok(
  `production Continue arm=${r.prod?.armCount} executor=${r.prod?.executorCount} authRelease=${r.prod?.authorizedReleaseCount}`,
);
ok(`live GitHub: ${(last.externalGitHub ?? 0) === 0 ? "NO" : "YES"}`);

if (r.generatedIsTrusted !== false) fail("isTrusted must be false");
if (!r.generatedTargetExact) fail("exact target required");
if (!r.sawConsumed || !r.sawGuard) fail("consume/guard in handler failed");
if (!r.nestedPrevented || r.nestedDownstream !== 0) fail("fresh nested not blocked");
if (!r.reusedFirstPrevented || !r.reusedSecondPrevented || r.reusedDownstream !== 0) {
  fail("reused Event not blocked twice");
}
if (!r.descPrevented || r.nestedDescDownstream !== 0) fail("descendant nested not blocked");
if (r.authorizationCount !== 1 || r.executorCalls !== 1 || r.retries !== 0) fail("one-shot failed");
if ((r.blockedMatching ?? 0) < 3) fail("expected >=3 blocked matching (fresh+reusedx2+desc)");
if (pt.realm !== "page") fail("page tamper realm must be page");
if (pt.instanceTamperInstalled !== true || pt.prototypeTamperInstalled !== true) {
  fail("PAGE-REALM tamper must be installed");
}
if (pt.instanceTamperCount !== 0 || pt.prototypeTamperCount !== 0) {
  fail("PAGE-REALM tamper affected executor");
}
if (r.isolatedWorldTamperUsedAsProof !== false) fail("isolated-world tamper used as page proof");
if (pp.primaryWindowSeen !== 1) fail("page primary Window count must be 1");
if (pp.permissionConsumedBeforePageWindow !== true) {
  fail("permission must be consumed before page Window handler");
}
if (pp.nestedWindowSeen !== 0 || pp.reusedWindowSeen !== 0 || pp.descendantWindowSeen !== 0) {
  fail("page Window must not see nested/reused/descendant");
}
if (!st.ok) fail("stale authority matrix failed");
if ((r.prod?.armCount ?? 0) !== 0 || (r.prod?.executorCount ?? 0) !== 0) {
  fail("production release counters nonzero");
}
if ((last.externalGitHub ?? 0) !== 0) fail("external GitHub");
ok("Sprint 3B dedicated Chrome smoke PASS");
