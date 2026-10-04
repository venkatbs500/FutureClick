#!/usr/bin/env node
/**
 * FC-007 Sprint 1 — happy-dom / Node DOM smoke (NOT Chrome).
 *
 * Fast local recognition check against the synthetic fixture.
 * For genuine Chrome/Chromium native smoke, use:
 *   scripts/fc007-observation-chrome-smoke.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(
  pkgRoot,
  "tests/fixtures/fc007/github-settings-visibility.html",
);
const bundlePath = path.join(pkgRoot, "dist/fc007-observation.bundle.js");
const contractModulePath = path.join(pkgRoot, "dist/fc007/contract.js");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[ACTUALLY EXECUTED]", msg);
}

if (!fs.existsSync(bundlePath)) {
  fail(`missing bundle ${bundlePath} — run package build first`);
}
if (!fs.existsSync(contractModulePath)) {
  fail(`missing compiled module ${contractModulePath} — run package build first`);
}
if (!fs.existsSync(fixturePath)) fail(`missing fixture ${fixturePath}`);

const bundle = fs.readFileSync(bundlePath, "utf8");
if (bundle.includes("ArmedContinuation")) fail("bundle contains ArmedContinuation");
if (bundle.includes("continueDecision")) fail("bundle contains continueDecision");
if (bundle.includes("HTMLButtonElement.prototype.click")) {
  fail("bundle captures HTMLButtonElement.prototype.click");
}
if (/\brequestSubmit\b/.test(bundle)) fail("bundle contains requestSubmit");
if (bundle.includes("XMLHttpRequest")) fail("bundle contains XMLHttpRequest");
if (/\bfetch\s*\(/.test(bundle)) fail("bundle contains fetch(");
ok("bundle release-capability static checks");

const html = fs.readFileSync(fixturePath, "utf8");
const win = new Window({
  url: "https://github.com/fixture-owner/fixture-repo/settings",
});

// Align Node globals with the happy-dom realm so instanceof checks match production DOM types.
const g = globalThis;
g.window = win;
g.document = win.document;
g.HTMLElement = win.HTMLElement;
g.HTMLButtonElement = win.HTMLButtonElement;
g.HTMLFormElement = win.HTMLFormElement;
g.HTMLDialogElement = win.HTMLDialogElement;
g.HTMLInputElement = win.HTMLInputElement;
g.HTMLDivElement = win.HTMLDivElement;
g.HTMLLIElement = win.HTMLLIElement;
g.Element = win.Element;
g.Node = win.Node;
g.NodeFilter = win.NodeFilter;
g.MutationObserver = win.MutationObserver;

const doc = win.document;
doc.write(html);
doc.close();
doc.documentElement.lang = "en";

const dialog = doc.getElementById("visibility-dialog");
if (!dialog) fail("dialog missing from fixture");
dialog.setAttribute("open", "");
dialog.open = true;

let fetchCalled = false;
win.fetch = async () => {
  fetchCalled = true;
  throw new Error("FETCH_SHOULD_NOT_RUN");
};

const { recognizeFc007ContractV1 } = await import(pathToFileURL(contractModulePath).href);

const location = {
  protocol: "https:",
  hostname: "github.com",
  port: "",
  pathname: "/fixture-owner/fixture-repo/settings",
};

const result = recognizeFc007ContractV1(doc, location, {
  requireTopFrame: false,
  matchesModal: (el) =>
    el instanceof win.HTMLDialogElement &&
    el.open === true &&
    el.getAttribute("aria-modal") === "true",
});

if (result.status !== "matched") {
  fail(`recognition failed: ${JSON.stringify(result)}`);
}
ok(`recognition matched owner=${result.value.observation.ownerDisplay}`);

const obsJson = JSON.stringify(result.value.observation);
if (obsJson.includes("dummy-not-read")) fail("observation leaked hidden value");
if (obsJson.includes("?")) fail("observation leaked query");
ok("observation privacy checks");

if (win.__fc007SubmitCount) fail("form was submitted during recognition");
if (fetchCalled) fail("fetch was invoked during recognition");
ok("no form submission / fetch");

ok("passive smoke complete");
process.exit(0);
