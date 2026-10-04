#!/usr/bin/env node
/**
 * FC-007 Final Acquisition Completeness — Chrome isolated-world gate.
 *
 * Every mandatory case resolves to PASS / FAIL / BLOCKED via
 * fc007-acquisition-gate-eval.mjs. FAIL or BLOCKED → nonzero exit.
 * No live GitHub / mutation: all non-fixture requests are aborted.
 *
 * Work-bound statement: form.elements item probes are capped at
 * FORM_ELEMENTS_MAX+1 (25); Chromium's cold listed-element cache walk is
 * bounded by the completed document inventory (DOCUMENT_MAX_NODE_VISITS_V2 /
 * DOCUMENT_MAX_ELEMENTS_V2), NOT by 25.
 */

import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSOCIATED_REJECT_KINDS,
  MISSING_GETTER_KINDS,
  NAMED_FORM_COUNTS,
  evaluateAcquisitionGateReport,
} from "./fc007-acquisition-gate-eval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(EXT_ROOT, "tests/fixtures/fc007/v2/github-settings-v2.html");
const SYNTHETIC_URL = "https://github.com/fixture-owner/fixture-repo/settings";
const SMOKE_OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "futureclick-fc007-acq-"));
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

let puppeteerPath;
try {
  puppeteerPath = requireFromExt.resolve("puppeteer-core");
  ok(`puppeteer-core: ${puppeteerPath}`);
} catch (e) {
  fail("RUNTIME_VERIFICATION_BLOCKED: BROWSER DRIVER DEPENDENCY UNAVAILABLE: " + e);
}

function discoverChrome() {
  const homes = [process.env.HOME, os.homedir()].filter(Boolean);
  const found = [];
  for (const home of homes) {
    for (const root of [
      path.join(home, "Library/Caches/ms-playwright"),
      path.join(home, ".cache/ms-playwright"),
      path.join(home, ".cache/puppeteer"),
    ]) {
      if (!fs.existsSync(root)) continue;
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
              const bin = path.join(full, "Contents/MacOS/Google Chrome for Testing");
              if (fs.existsSync(bin)) found.push(bin);
            } else walk(full, depth + 1);
          }
        }
      };
      walk(root, 0);
    }
  }
  return [...new Set(found)];
}

const CHROME =
  process.env.FC007_CHROME_PATH ||
  process.env.CHROME_PATH ||
  discoverChrome()[0] ||
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
if (!fs.existsSync(CHROME)) fail("RUNTIME_VERIFICATION_BLOCKED: NO USABLE CHROME EXECUTABLE");
ok(`Chrome: ${CHROME}`);

execFileSync("pnpm", ["exec", "node", "scripts/build.mjs"], {
  cwd: EXT_ROOT,
  stdio: "inherit",
  env: { ...process.env, FC007_BUILD_SMOKE_ACQ: "1", FC007_SMOKE_OUTDIR: SMOKE_OUTDIR },
});
const bundle = path.join(SMOKE_OUTDIR, "fc007-acquisition-smoke.bundle.js");
if (!fs.existsSync(bundle)) fail("acquisition smoke bundle missing");
const bundleSrc = fs.readFileSync(bundle, "utf8");

/**
 * Launch Chrome with `acqJsSource` as an ISOLATED-world content script, load the
 * synthetic fixture at Stage D, then run `steps` in order. Each step is
 * { name, world: "iso" | "main", source }. Returns { version, bootSeen,
 * harnessPresent, steps: { [name]: value } }.
 */
function runProbe(label, acqJsSource, steps) {
  const stepsPath = path.join(SMOKE_OUTDIR, `steps-${label}.json`);
  fs.writeFileSync(stepsPath, JSON.stringify(steps));
  const worker = `
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(${JSON.stringify(puppeteerPath)});
const puppeteer = require(${JSON.stringify(puppeteerPath)});
const [CHROME, ACQ_JS, FIXTURE, STEPS] = process.argv.slice(2);
const SYNTHETIC_URL = ${JSON.stringify(SYNTHETIC_URL)};
const fixtureHtml = fs.readFileSync(FIXTURE, "utf8");
const steps = JSON.parse(fs.readFileSync(STEPS, "utf8"));

const TMP_EXT = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-acq-ext-"));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "fc007-acq-prof-"));
fs.copyFileSync(ACQ_JS, path.join(TMP_EXT, "acq.js"));
fs.writeFileSync(path.join(TMP_EXT, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "fc007-acq", version: "0",
  content_scripts: [{
    matches: ["https://github.com/*/*/settings*"],
    js: ["acq.js"],
    run_at: "document_idle", all_frames: false, world: "ISOLATED",
  }],
}));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", userDataDir: PROFILE,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    "--disable-extensions-except=" + TMP_EXT,
    "--load-extension=" + TMP_EXT,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});
await new Promise((r) => setTimeout(r, 1200));
const page = (await browser.pages())[0] || (await browser.newPage());
let contentScriptContextId = null;
let bootSeen = false;
const cdp = await page.createCDPSession();
await cdp.send("Runtime.enable");
cdp.on("Runtime.consoleAPICalled", (e) => {
  const t = (e.args || []).map((a) => a.value ?? a.description).join(" ");
  if (typeof t === "string" && t.startsWith("__FC007_ACQ_BOOT__") && typeof e.executionContextId === "number") {
    contentScriptContextId = e.executionContextId;
    bootSeen = true;
  }
});
let nonFixtureRequests = 0;
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = req.url();
  if (url === SYNTHETIC_URL || url === SYNTHETIC_URL + "/") {
    req.respond({ status: 200, contentType: "text/html", body: fixtureHtml });
    return;
  }
  if (url.startsWith("chrome-extension://") || url === "about:blank" || url.startsWith("data:")) {
    req.continue();
    return;
  }
  nonFixtureRequests += 1;
  req.abort("blockedbyclient").catch(() => {});
});
await page.goto(SYNTHETIC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(() => { if (window.__fc007SetStage) window.__fc007SetStage("d"); });
await new Promise((r) => setTimeout(r, 1500));
const deadline = Date.now() + 12000;
while (Date.now() < deadline && !contentScriptContextId) {
  await new Promise((r) => setTimeout(r, 100));
}

const report = { version: await browser.version(), bootSeen, harnessPresent: false, steps: {} };
if (contentScriptContextId) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: "!!globalThis.__FC007_ACQ_HARNESS__",
    contextId: contentScriptContextId,
    returnByValue: true,
  });
  report.harnessPresent = r.result?.value === true;
}
for (const step of steps) {
  if (step.world === "main") {
    report.steps[step.name] = await page.evaluate(step.source);
    continue;
  }
  if (!contentScriptContextId) throw new Error("NO_ISOLATED_CONTEXT");
  const r = await cdp.send("Runtime.evaluate", {
    expression: step.source,
    contextId: contentScriptContextId,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error("ISO_EVAL " + step.name + ": " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  report.steps[step.name] = r.result?.value;
}
report.nonFixtureRequests = nonFixtureRequests;

await browser.close();
try { fs.rmSync(TMP_EXT, { recursive: true, force: true }); } catch {}
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
console.log(JSON.stringify(report));
`;

  const acqPath = path.join(SMOKE_OUTDIR, `acq-${label}.js`);
  fs.writeFileSync(acqPath, acqJsSource);
  const workerPath = path.join(SMOKE_OUTDIR, `worker-${label}.mjs`);
  fs.writeFileSync(workerPath, worker);
  const r = spawnSync(process.execPath, [workerPath, CHROME, acqPath, FIXTURE, stepsPath], {
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || "");
    process.stdout.write(r.stdout || "");
    fail(`probe ${label} failed status=${r.status}`);
  }
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    fail(`probe ${label} bad JSON: ${last}`);
  }
}

/** Shared isolated-world helpers (prepended to every iso step). */
const ISO_PRELUDE = `
  const H = globalThis.__FC007_ACQ_HARNESS__;
  if (!H) throw new Error("no_harness");
  const loc = { protocol: "https:", hostname: "github.com", port: "", pathname: "/fixture-owner/fixture-repo/settings" };
  const matchesModal = (d) => d.open === true && d.getAttribute("aria-modal") === "true";
  const identity = H.buildRepoIdentity("fixture-owner", "fixture-repo");
  const formEl = () => document.getElementById("visibility-form");
  const BUILT_INS = [HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement,
    HTMLFieldSetElement, HTMLObjectElement, HTMLOutputElement];
  function capSnap(mm) {
    const r = H.capture(document, loc, { requireTopFrame: false, matchesModal: mm || matchesModal });
    return {
      capStatus: r.status,
      capStage: r.status === "matched" ? r.value.stage : null,
      capReason: r.status === "abstain" ? r.reason : null,
    };
  }
  function formSnap() {
    const form = formEl();
    const fin = document.getElementById("final-make-public");
    const close = document.getElementById("dialog-close");
    if (!(form instanceof HTMLFormElement) || !(fin instanceof HTMLButtonElement) ||
        !(close instanceof HTMLButtonElement) || !identity) {
      return { formStatus: "abstain", formReason: "FIXTURE_REFS_MISSING", hiddenInputCount: null };
    }
    const f = H.recognizeFormContract(fin, form, identity, document, close);
    return {
      formStatus: f.status,
      formReason: f.status === "abstain" ? f.reason : null,
      hiddenInputCount: f.status === "matched" ? f.value.hiddenInputCount : null,
    };
  }
  /** Capture-only counters, then (uncounted) Stage D form-contract reason. */
  function countedSnap(mm) {
    H.resetFormCollectionAccessCounters();
    const cap = capSnap(mm);
    const counters = H.getFormCollectionAccessCounters();
    const f = formSnap();
    return { snap: { ...cap, formStatus: f.formStatus, formReason: f.formReason }, counters, hiddenInputCount: f.hiddenInputCount };
  }
  function isFinalNow() {
    const s = capSnap();
    return s.capStatus === "matched" && s.capStage === "final-confirmation";
  }
  function inFormElements(el) {
    const inv = H.inventoryDocument(document);
    if (inv.status !== "ok") return false;
    const it = H.iterateNativeFormControls(formEl(), 24, inv.elements);
    return (it.status === "ok" || it.status === "overflow") && it.controls.includes(el);
  }
  function documentElementCount() {
    const inv = H.inventoryDocument(document);
    return { status: inv.status, elements: inv.elementVisitAttempts };
  }
`;

function iso(name, body) {
  return { name, world: "iso", source: `(async function(){${ISO_PRELUDE}\n${body}\n})()` };
}
function main(name, body) {
  return { name, world: "main", source: `(function(){${body}\n})()` };
}

const MAIN_PROBE = iso(
  "main",
  `
  const out = {};
  const form = formEl();
  const dialog = document.getElementById("visibility-dialog");
  if (!(form instanceof HTMLFormElement) || !(dialog instanceof HTMLDialogElement)) {
    throw new Error("fixture_missing");
  }

  {
    const b = countedSnap();
    out.baseline = { snap: b.snap, counters: b.counters, hiddenInputCount: b.hiddenInputCount };
  }

  {
    const baselineFinal = isFinalNow();
    const shadow = document.createElement("input");
    shadow.type = "hidden";
    shadow.name = "nextSibling";
    form.appendChild(shadow);
    const bad = document.createElement("button");
    bad.type = "button";
    bad.id = "evil-btn";
    bad.textContent = "Evil";
    dialog.appendChild(bad);
    const inv = H.inventoryDialog(dialog);
    out.namedPropertyNextSibling = {
      baselineFinal,
      ordinaryNextSiblingIsInput: form.nextSibling === shadow,
      nativeNextSiblingNotInput: H.nativeNextSibling(form) !== shadow,
      nativeSeesBadAfterForm: H.nativeNextSibling(form) === bad,
      invHasBad: inv.status === "ok" && inv.elements.some((e) => e && e.id === "evil-btn"),
      snap: countedSnap().snap,
    };
    bad.remove();
    shadow.remove();
  }

  {
    const baselineFinal = isFinalNow();
    const dup = document.createElement("div");
    dup.setAttribute("role", "region");
    dup.setAttribute("tabindex", "-1");
    dup.setAttribute("aria-label", "Effects of making this repository public");
    dialog.appendChild(dup);
    out.dupEffects = { baselineFinal, snap: countedSnap().snap };
    dup.remove();
  }

  {
    const baselineFinal = isFinalNow();
    const big = document.createElement("div");
    for (let i = 0; i < 500; i++) big.appendChild(document.createElement("span"));
    dialog.appendChild(big);
    out.oversize = { baselineFinal, snap: countedSnap().snap };
    big.remove();
  }

  {
    const ext = document.createElement("input");
    ext.type = "hidden";
    ext.name = "nextSibling";
    ext.setAttribute("form", "visibility-form");
    document.body.appendChild(ext);
    const inv2 = H.inventoryDialog(dialog);
    out.externalNotInDialogInv = inv2.status === "ok" && !inv2.elements.includes(ext);
    ext.remove();
  }

  {
    const markers = [];
    for (let i = 0; i < 10000; i++) {
      const d = document.createElement("dialog");
      document.body.appendChild(d);
      markers.push(d);
    }
    let nv = 0;
    const dinv = H.inventoryDocument(document, { onNodeVisit: () => { nv++; } });
    out.dialogs10k = {
      reason: dinv.status === "abstain" ? dinv.reason : null,
      nodeVisits: nv,
      dialogsSeen: dinv.status === "abstain" ? dinv.dialogsSeen : dinv.dialogs.length,
    };
    for (const d of markers) d.remove();
  }

  {
    const markers = [];
    for (let i = 0; i < 10000; i++) {
      const m = document.createElement("main");
      document.body.appendChild(m);
      markers.push(m);
    }
    let nv = 0;
    const minv = H.inventoryDocument(document, { onNodeVisit: () => { nv++; } });
    out.mains10k = {
      reason: minv.status === "abstain" ? minv.reason : null,
      nodeVisits: nv,
      mainsSeen: minv.status === "abstain" ? minv.mainsSeen : minv.mains.length,
    };
    for (const m of markers) m.remove();
  }

  const idle0 = document.getElementById("empty-dialog-0");
  const idle1 = document.getElementById("empty-dialog-1");
  const idle2 = document.getElementById("empty-dialog-2");

  {
    const baselineFinal = isFinalNow();
    const nestedMain = document.createElement("main");
    idle0.appendChild(nestedMain);
    out.nestedMain = { baselineFinal, snap: countedSnap().snap };
    nestedMain.remove();
  }
  {
    const baselineFinal = isFinalNow();
    const nestedDlg = document.createElement("dialog");
    idle0.appendChild(nestedDlg);
    out.nestedDialog = { baselineFinal, snap: countedSnap().snap };
    nestedDlg.remove();
  }

  // Externally associated controls: prove association with the platform's own
  // .form, then require Stage D FORM_UNSUPPORTED_CONTROL and no final-confirmation.
  const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const makers = {
    "input-image": () => { const e = document.createElement("input"); e.type = "image"; e.src = GIF; return e; },
    "input-text": () => { const e = document.createElement("input"); e.type = "text"; return e; },
    "input-checkbox": () => { const e = document.createElement("input"); e.type = "checkbox"; return e; },
    "input-radio": () => { const e = document.createElement("input"); e.type = "radio"; return e; },
    "input-submit": () => { const e = document.createElement("input"); e.type = "submit"; return e; },
    "input-reset": () => { const e = document.createElement("input"); e.type = "reset"; return e; },
    "input-file": () => { const e = document.createElement("input"); e.type = "file"; return e; },
    "input-number": () => { const e = document.createElement("input"); e.type = "number"; return e; },
    "input-email": () => { const e = document.createElement("input"); e.type = "email"; return e; },
    "button-button": () => { const e = document.createElement("button"); e.type = "button"; return e; },
    "button-submit": () => { const e = document.createElement("button"); e.type = "submit"; return e; },
    "select": () => document.createElement("select"),
    "textarea": () => document.createElement("textarea"),
    "fieldset": () => document.createElement("fieldset"),
    "object": () => document.createElement("object"),
    "output": () => document.createElement("output"),
    "input-image-inactive-dialog": () => { const e = document.createElement("input"); e.type = "image"; e.src = GIF; return e; },
    "input-text-inactive-dialog": () => { const e = document.createElement("input"); e.type = "text"; return e; },
  };
  const kinds = ${JSON.stringify(ASSOCIATED_REJECT_KINDS)};
  out.associated = {};
  for (const kind of kinds) {
    const make = makers[kind];
    if (!make) { out.associated[kind] = { error: "no_maker" }; continue; }
    const baselineFinal = isFinalNow();
    const el = make();
    el.setAttribute("form", "visibility-form");
    (kind.endsWith("-inactive-dialog") ? idle1 : document.body).appendChild(el);
    const associated = el.form === form;
    let nativeGetterAgrees = false;
    try { nativeGetterAgrees = H.nativeBuiltInAssociatedForm(el) === form; } catch (e) { nativeGetterAgrees = false; }
    const listed = inFormElements(el);
    out.associated[kind] = {
      baselineFinal,
      associated,
      nativeGetterAgrees,
      inFormElements: listed,
      snap: countedSnap().snap,
    };
    el.remove();
  }

  {
    const baselineFinal = isFinalNow();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const inp = document.createElement("input");
    inp.type = "text";
    inp.setAttribute("form", "visibility-form");
    root.appendChild(inp);
    out.shadowNotAssociated = {
      baselineFinal,
      associated: inp.form === form,
      inFormElements: inFormElements(inp),
      snap: countedSnap().snap,
    };
    host.remove();
  }

  {
    const baselineFinal = isFinalNow();
    const ext = document.createElement("input");
    ext.type = "hidden";
    ext.setAttribute("form", "visibility-form");
    document.body.appendChild(ext);
    const comments = [];
    for (let i = 0; i < 5000; i++) {
      const c = document.createComment("fc007");
      document.appendChild(c);
      comments.push(c);
    }
    const r = countedSnap();
    out.documentLevelFlood = { baselineFinal, documentLevelNodes: comments.length, snap: r.snap, counters: r.counters };
    for (const c of comments) c.remove();
    ext.remove();
  }

  {
    const baselineFinal = isFinalNow();
    for (let i = 0; i < 10000; i++) {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = "f" + i;
      inp.setAttribute("form", "visibility-form");
      idle2.appendChild(inp);
    }
    const r = countedSnap();
    out.controls10k = { baselineFinal, associatedCount: 10000, snap: r.snap, counters: r.counters };
    while (idle2.firstChild) idle2.removeChild(idle2.firstChild);
  }

  {
    const baselineFinal = isFinalNow();
    const ext = document.createElement("input");
    ext.type = "hidden";
    ext.setAttribute("form", "visibility-form");
    document.body.appendChild(ext);
    const pad = [];
    let n = documentElementCount().elements;
    while (n < 3000) {
      const s = document.createElement("span");
      document.body.appendChild(s);
      pad.push(s);
      n += 1;
    }
    const dc = documentElementCount();
    const r = countedSnap();
    out.nearCapPadded = {
      baselineFinal,
      externalAssociated: ext.form === form,
      inventoryStatus: dc.status,
      documentElements: dc.elements,
      snap: r.snap,
      counters: r.counters,
    };
    for (const s of pad) s.remove();
    ext.remove();
  }

  {
    const baselineFinal = isFinalNow();
    const added = [];
    let n = documentElementCount().elements;
    while (n < 3000) {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.setAttribute("form", "visibility-form");
      document.body.appendChild(inp);
      added.push(inp);
      n += 1;
    }
    const dc = documentElementCount();
    const r = countedSnap();
    out.nearCapManyBuiltIn = {
      baselineFinal,
      associatedCount: added.filter((e) => e.form === form).length,
      inventoryStatus: dc.status,
      documentElements: dc.elements,
      snap: r.snap,
      counters: r.counters,
    };
    for (const e of added) e.remove();
  }

  {
    const added = [];
    for (let i = 0; i < 200; i++) {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.setAttribute("form", "visibility-form");
      document.body.appendChild(inp);
      added.push(inp);
    }
    const inv = H.inventoryDocument(document);
    H.resetFormCollectionAccessCounters();
    const it = inv.status === "ok" ? H.iterateNativeFormControls(form, 24, inv.elements) : { status: "inventory_" + inv.reason };
    out.iterateBounded = {
      status: it.status,
      controlCount: it.controls ? it.controls.length : null,
      counters: H.getFormCollectionAccessCounters(),
    };
    for (const e of added) e.remove();
  }

  {
    const inv = H.inventoryDocument(document);
    const copy = inv.status === "ok" ? inv.elements.slice() : [];
    H.resetFormCollectionAccessCounters();
    const it = H.iterateNativeFormControls(form, 24, copy);
    const fin = document.getElementById("final-make-public");
    const close = document.getElementById("dialog-close");
    const fr = H.recognizeFormContract(fin, form, identity, document, close, { documentElements: copy });
    out.unprovenInventoryRejected = {
      iterateStatus: it.status,
      formReason: fr.status === "abstain" ? fr.reason : null,
      counters: H.getFormCollectionAccessCounters(),
    };
  }

  {
    const baselineFinal = isFinalNow();
    const head = document.head || document.documentElement;
    const bases = [];
    for (let i = 0; i < 50; i++) {
      const b = document.createElement("base");
      head.appendChild(b);
      bases.push(b);
    }
    const targeted = document.createElement("base");
    targeted.setAttribute("target", "_blank");
    head.appendChild(targeted);
    bases.push(targeted);
    out.lateBaseTarget = { baselineFinal, snap: countedSnap().snap };
    for (const b of bases) b.remove();
  }

  // Multi-modal LAST (mutates dialog modality). Setup must prove two genuine
  // :modal dialogs, else BLOCKED. Never convert setup failure into PASS.
  {
    const baselineFinal = isFinalNow();
    const modalPred = (d) => { try { return d.matches(":modal"); } catch (e) { return false; } };
    try {
      const d1 = dialog;
      const d2 = idle1;
      if (!(d2 instanceof HTMLDialogElement) || typeof d2.showModal !== "function") {
        out.multiModal = { outcome: "BLOCKED", reason: "showModal_unavailable", baselineFinal, aModal: false, bModal: false };
      } else {
        const d1WasModal = modalPred(d1);
        if (!d1WasModal) {
          try { d1.close(); } catch (e) {}
          d1.showModal();
        }
        d2.showModal();
        d2.setAttribute("aria-modal", "true");
        const aModal = modalPred(d1);
        const bModal = modalPred(d2);
        if (!aModal || !bModal) {
          out.multiModal = { outcome: "BLOCKED", reason: "two_modals_unproven", baselineFinal, aModal, bModal };
        } else {
          const snap = countedSnap(modalPred).snap;
          const notFinal = !(snap.capStatus === "matched" && snap.capStage === "final-confirmation");
          out.multiModal = { outcome: notFinal ? "PASS" : "FAIL", baselineFinal, aModal, bModal, snap };
        }
        try { d2.close(); } catch (e) {}
        d2.removeAttribute("aria-modal");
      }
    } catch (err) {
      out.multiModal = { outcome: "BLOCKED", reason: "setup_threw", message: String(err && err.message), baselineFinal, aModal: false, bModal: false };
    }
  }

  return out;
`,
);

/** FACE setup in the page MAIN world (customElements is null in isolated worlds). */
function faceSetupMain(countExpr) {
  return `
  const out = {
    customElementsAvailable: false, registered: false, formAssociatedStatic: false,
    attachInternalsOk: false, internalsFormIsRetainedForm: false, definedPseudo: false,
    intendedElement: false, faceCount: 0,
  };
  try {
    if (typeof customElements === "undefined" || customElements === null) {
      out.error = "customElements unavailable";
      return out;
    }
    out.customElementsAvailable = true;
    class Fc007FaceProbe extends HTMLElement {
      static formAssociated = true;
      constructor() { super(); this.__fc007Internals = this.attachInternals(); }
    }
    customElements.define("fc007-face-probe", Fc007FaceProbe);
    const ctor = customElements.get("fc007-face-probe");
    out.registered = ctor === Fc007FaceProbe;
    out.formAssociatedStatic = !!ctor && ctor.formAssociated === true;
    const form = document.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) { out.error = "form missing"; return out; }
    const count = ${countExpr};
    let internalsOk = count > 0;
    let assocOk = count > 0;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("fc007-face-probe");
      el.id = "fc007-face-el-" + i;
      el.setAttribute("form", "visibility-form");
      document.body.appendChild(el);
      const internals = el.__fc007Internals;
      if (!(internals instanceof ElementInternals)) { internalsOk = false; continue; }
      if (internals.form !== form) assocOk = false;
    }
    const first = document.getElementById("fc007-face-el-0");
    out.attachInternalsOk = internalsOk;
    out.internalsFormIsRetainedForm = assocOk;
    out.definedPseudo = !!first && first.matches(":defined");
    out.intendedElement = !!first && first instanceof Fc007FaceProbe &&
      first.localName === "fc007-face-probe" && first.getAttribute("form") === "visibility-form";
    out.faceCount = count;
  } catch (e) {
    out.error = "setup_threw: " + String(e && e.message);
  }
  return out;
`;
}

const FACE_PRE = iso("pre", `globalThis.__fc007FaceBaselineFinal = isFinalNow(); return globalThis.__fc007FaceBaselineFinal;`);
const FACE_PROBE = iso(
  "probe",
  `
  const el = document.getElementById("fc007-face-el-0");
  const found = el instanceof HTMLElement;
  const builtIn = found ? BUILT_INS.some((C) => el instanceof C) : true;
  const listed = found ? inFormElements(el) : false;
  const dc = documentElementCount();
  const r = countedSnap();
  return {
    baselineFinal: globalThis.__fc007FaceBaselineFinal === true,
    found,
    builtIn,
    inFormElements: listed,
    inventoryStatus: dc.status,
    documentElements: dc.elements,
    snap: r.snap,
    counters: r.counters,
  };
`,
);

/**
 * Large named-control form inserted as the FIRST body child (encountered early).
 * Controls are named after sensitive properties so Chromium's
 * [LegacyOverrideBuiltIns] named lookup visibly shadows ordinary reads.
 */
function namedFormProbe(count) {
  return iso(
    "probe",
    `
  const SHADOW_NAMES = ["tagName", "localName", "nodeName", "lang", "children", "childNodes",
    "parentElement", "parentNode", "firstChild", "nextSibling", "firstElementChild",
    "nextElementSibling", "nodeType", "getAttribute", "hasAttribute", "contains", "matches",
    "id", "name", "elements", "length", "action", "method", "target", "ownerDocument", "isConnected"];
  // Per-control appendChild into a form is quadratic in Chromium; one fragment parse is linear.
  const controlsHtml = (() => {
    const parts = [];
    for (let i = 0; i < ${count}; i++) {
      parts.push('<input type="hidden" name="' + (i < SHADOW_NAMES.length ? SHADOW_NAMES[i] : "c" + i) + '">');
    }
    return parts.join("");
  })();
  function buildForm(id) {
    const f = document.createElement("form");
    f.id = id;
    f.innerHTML = controlsHtml;
    document.body.insertBefore(f, document.body.firstChild);
    return f;
  }
  const tagGetter = Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get;
  const itemFn = HTMLCollection.prototype.item;
  const elementsGetter = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "elements").get;
  const timeColdItem = (f) => {
    const t0 = performance.now();
    Reflect.apply(itemFn, Reflect.apply(elementsGetter, f, []), [0]);
    return performance.now() - t0;
  };

  let setup;
  let form;
  try {
    form = buildForm("fc007-big-named-form");
    setup = {
      controlCount: Reflect.apply(
        Object.getOwnPropertyDescriptor(Element.prototype, "childElementCount").get, form, []),
      formIsFirstBodyChild: document.body.firstElementChild === form,
      ordinaryTagNameShadowed: false,
    };
  } catch (e) {
    return { setup: { error: "build_threw: " + String(e && e.message) } };
  }

  // Production path FIRST, on a cold form (no prior ordinary lookup).
  const inv = H.inventoryDocument(document);
  let captureThrew = false;
  let r = { snap: { capStatus: "abstain", capStage: null, capReason: "THREW", formStatus: "abstain", formReason: "THREW" },
    counters: H.getFormCollectionAccessCounters() };
  try {
    H.resetFormCollectionAccessCounters();
    const cap = capSnap();
    r = { snap: { ...cap, formStatus: "abstain", formReason: null }, counters: H.getFormCollectionAccessCounters() };
  } catch (e) {
    captureThrew = true;
  }
  const nativeTagName = Reflect.apply(tagGetter, form, []);

  // Diagnostics only: the first native collection access after capture is still cold.
  const coldItemAfterCaptureMs = timeColdItem(form);
  const t1 = performance.now();
  Reflect.apply(itemFn, Reflect.apply(elementsGetter, form, []), [0]);
  const warmItemMs = performance.now() - t1;

  // Setup proof (after production run): ordinary lookup consults the named interceptor.
  const shadow = form.tagName;
  setup.ordinaryTagNameShadowed = shadow instanceof HTMLInputElement && shadow.name === "tagName";

  // Contrast diagnostic: an ordinary lookup on a fresh cold form pre-warms the cache.
  form.remove();
  const form2 = buildForm("fc007-big-named-form-2");
  void form2.tagName;
  const coldItemAfterOrdinaryTagNameMs = timeColdItem(form2);
  form2.remove();

  return {
    setup,
    nativeTagName: typeof nativeTagName === "string" ? nativeTagName : null,
    inventory: {
      status: inv.status,
      reason: inv.status === "abstain" ? inv.reason : null,
      nodeVisitAttempts: inv.nodeVisitAttempts,
      elementVisitAttempts: inv.elementVisitAttempts,
    },
    captureThrew,
    snap: r.snap,
    counters: r.counters,
    diag: { coldItemAfterCaptureMs, warmItemMs, coldItemAfterOrdinaryTagNameMs },
  };
`,
  );
}

const report = {
  version: null,
  main: null,
  face: null,
  faceNearCap: null,
  namedForm10k: null,
  namedForm100k: null,
  missingGetters: [],
};
let nonFixtureRequests = 0;

{
  const rep = runProbe("main", bundleSrc, [MAIN_PROBE]);
  report.version = rep.version;
  report.main = rep.steps.main;
  nonFixtureRequests += rep.nonFixtureRequests;
  ok(`Chrome version ${rep.version}`);
}
{
  const rep = runProbe("face", bundleSrc, [
    FACE_PRE,
    main("setup", faceSetupMain("1")),
    FACE_PROBE,
  ]);
  report.face = { setup: rep.steps.setup, probe: rep.steps.probe };
  nonFixtureRequests += rep.nonFixtureRequests;
}
{
  const rep = runProbe("faceNearCap", bundleSrc, [
    FACE_PRE,
    main("setup", faceSetupMain(`Math.max(0, 3000 - document.getElementsByTagName("*").length)`)),
    FACE_PROBE,
  ]);
  report.faceNearCap = { setup: rep.steps.setup, probe: rep.steps.probe };
  nonFixtureRequests += rep.nonFixtureRequests;
}

for (const [key, count] of Object.entries(NAMED_FORM_COUNTS)) {
  const rep = runProbe(key, bundleSrc, [namedFormProbe(count)]);
  report[key] = rep.steps.probe;
  nonFixtureRequests += rep.nonFixtureRequests;
}

/** Corrupt a retained native dependency in the isolated world BEFORE module load. */
function corruptPrelude(kind) {
  const [ctor, prop] = kind.split(".");
  return `Object.defineProperty(${ctor}.prototype, ${JSON.stringify(prop)}, { configurable: true, enumerable: true, writable: true, value: null });\n`;
}
for (const kind of MISSING_GETTER_KINDS) {
  const rep = runProbe(`missing-${kind}`, corruptPrelude(kind) + bundleSrc, []);
  report.missingGetters.push({ kind, bootSeen: rep.bootSeen, harnessPresent: rep.harnessPresent });
  nonFixtureRequests += rep.nonFixtureRequests;
}

console.log(JSON.stringify(report, null, 2));
for (const key of Object.keys(NAMED_FORM_COUNTS)) {
  const d = report[key]?.diag;
  if (d) {
    console.log(
      `[DIAG] ${key} coldItemAfterCapture=${d.coldItemAfterCaptureMs?.toFixed?.(2)}ms warmItem=${d.warmItemMs?.toFixed?.(2)}ms coldItemAfterOrdinaryTagName=${d.coldItemAfterOrdinaryTagNameMs?.toFixed?.(2)}ms (diagnostic only; not gated)`,
    );
  }
}
const evaluation = evaluateAcquisitionGateReport(report);
for (const r of evaluation.results) {
  console.log(`[${r.outcome}]`, r.name, r.detail);
}
console.log(
  `[SUMMARY] passed=${evaluation.passed} failed=${evaluation.failed} blocked=${evaluation.blocked} nonFixtureRequestsAborted=${nonFixtureRequests}`,
);
console.log(
  "[INFO] work bound: explicit item probes <= 25 per collection access; native listed-element cache walk bounded by completed document inventory (4096 nodes / 3072 elements), NOT O(25)",
);
if (evaluation.blocked) {
  fail(`Chrome acquisition gate BLOCKED (${evaluation.blocked} mandatory case(s) could not be set up)`);
}
if (evaluation.exitCode !== 0) fail(`Chrome acquisition gate failed ${evaluation.failed} checks`);
ok("Chrome acquisition gate PASS");
cleanup();
