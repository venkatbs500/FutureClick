/**
 * FC-007 acquisition Chrome gate — pure report evaluator.
 *
 * Every mandatory case resolves to exactly one of:
 *   PASS    — setup proven AND security assertion proven
 *   FAIL    — setup proven but security assertion failed, or evidence malformed
 *   BLOCKED — required browser capability / setup could not be established
 *
 * BLOCKED and FAIL both force a nonzero gate exit. Missing / wrong-type /
 * non-finite evidence is FAIL — never a zero/false default.
 */

export const FINAL_STAGE = "final-confirmation";
export const FORM_ELEMENTS_MAX = 24;
export const ITEM_PROBE_CAP = FORM_ELEMENTS_MAX + 1;
export const DOCUMENT_MAX_ELEMENTS_V2 = 3072;
export const HIDDEN_INPUTS_IN_FIXTURE = 3;

/** Externally associated control kinds that MUST be rejected. */
export const ASSOCIATED_REJECT_KINDS = Object.freeze([
  "input-image",
  "input-text",
  "input-checkbox",
  "input-radio",
  "input-submit",
  "input-reset",
  "input-file",
  "input-number",
  "input-email",
  "button-button",
  "button-submit",
  "select",
  "textarea",
  "fieldset",
  "object",
  "output",
  "input-image-inactive-dialog",
  "input-text-inactive-dialog",
]);

export const MISSING_GETTER_KINDS = Object.freeze([
  "CharacterData.data",
  "Node.firstChild",
  "Node.nextSibling",
  "Node.parentNode",
  "Node.nodeType",
  "Node.contains",
  "Element.getAttribute",
  "Element.hasAttribute",
  "Element.tagName",
  "Element.firstElementChild",
  "Element.nextElementSibling",
  "HTMLElement.lang",
  "HTMLFormElement.elements",
  "HTMLCollection.item",
  "HTMLInputElement.form",
  "HTMLButtonElement.form",
  "HTMLSelectElement.form",
  "HTMLTextAreaElement.form",
  "HTMLFieldSetElement.form",
  "HTMLObjectElement.form",
  "HTMLOutputElement.form",
]);

export const NAMED_FORM_COUNTS = Object.freeze({ namedForm10k: 10000, namedForm100k: 100000 });
export const NAMED_FORM_CASES = Object.freeze(Object.keys(NAMED_FORM_COUNTS));

class EvidenceError extends Error {}
class SetupBlocked extends Error {}

function obj(v, name) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new EvidenceError(`${name}: expected object got ${JSON.stringify(v)}`);
  }
  return v;
}
function bool(v, name) {
  if (v !== true && v !== false) {
    throw new EvidenceError(`${name}: expected boolean got ${JSON.stringify(v)}`);
  }
  return v;
}
function finite(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new EvidenceError(`${name}: expected finite number got ${JSON.stringify(v)}`);
  }
  return v;
}
function str(v, name) {
  if (typeof v !== "string") {
    throw new EvidenceError(`${name}: expected string got ${JSON.stringify(v)}`);
  }
  return v;
}
function strOrNull(v, name) {
  if (v !== null && typeof v !== "string") {
    throw new EvidenceError(`${name}: expected string|null got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Capture + Stage D form-contract snapshot. */
function snap(v, name) {
  const s = obj(v, name);
  const capStatus = str(s.capStatus, `${name}.capStatus`);
  if (capStatus !== "matched" && capStatus !== "abstain") {
    throw new EvidenceError(`${name}.capStatus invalid: ${capStatus}`);
  }
  const formStatus = str(s.formStatus, `${name}.formStatus`);
  if (formStatus !== "matched" && formStatus !== "abstain") {
    throw new EvidenceError(`${name}.formStatus invalid: ${formStatus}`);
  }
  return {
    capStatus,
    capStage: strOrNull(s.capStage, `${name}.capStage`),
    capReason: strOrNull(s.capReason, `${name}.capReason`),
    formStatus,
    formReason: strOrNull(s.formReason, `${name}.formReason`),
  };
}
function isFinal(s) {
  return s.capStatus === "matched" && s.capStage === FINAL_STAGE;
}
function counters(v, name) {
  const c = obj(v, name);
  return {
    elementsGetterCalls: finite(c.elementsGetterCalls, `${name}.elementsGetterCalls`),
    itemCalls: finite(c.itemCalls, `${name}.itemCalls`),
    completedInventoryMarks: finite(c.completedInventoryMarks, `${name}.completedInventoryMarks`),
    completedInventoryMarksAtFirstGetter: finite(
      c.completedInventoryMarksAtFirstGetter,
      `${name}.completedInventoryMarksAtFirstGetter`,
    ),
    rejectedWithoutCompletedInventory: finite(
      c.rejectedWithoutCompletedInventory,
      `${name}.rejectedWithoutCompletedInventory`,
    ),
  };
}
/** A case's positive baseline (fresh capture right before injection) must be final. */
function requireBaseline(caseObj, name) {
  const b = bool(caseObj.baselineFinal, `${name}.baselineFinal`);
  if (!b) throw new SetupBlocked(`${name}: baseline capture was not ${FINAL_STAGE}`);
}

function evalOutcomeCase(caseObj, name) {
  const o = obj(caseObj, name);
  if (o.outcome !== "PASS" && o.outcome !== "FAIL" && o.outcome !== "BLOCKED") {
    throw new EvidenceError(`${name}.outcome invalid: ${JSON.stringify(o.outcome)}`);
  }
  return o.outcome;
}

/**
 * @param {unknown} report
 * @returns {{ results: Array<{ name: string, outcome: "PASS"|"FAIL"|"BLOCKED", detail: string }>,
 *             passed: number, failed: number, blocked: number, exitCode: number }}
 */
export function evaluateAcquisitionGateReport(report) {
  const results = [];
  const run = (name, fn) => {
    try {
      const r = fn();
      if (r === true) results.push({ name, outcome: "PASS", detail: "" });
      else results.push({ name, outcome: "FAIL", detail: typeof r === "string" ? r : "assertion" });
    } catch (e) {
      if (e instanceof SetupBlocked) {
        results.push({ name, outcome: "BLOCKED", detail: e.message });
      } else {
        results.push({ name, outcome: "FAIL", detail: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  let R;
  try {
    R = obj(report, "report");
    str(R.version, "report.version");
  } catch (e) {
    results.push({ name: "report", outcome: "FAIL", detail: String(e && e.message) });
    return summarize(results);
  }
  const M = (() => {
    try {
      return obj(R.main, "main");
    } catch (e) {
      results.push({ name: "main", outcome: "FAIL", detail: String(e && e.message) });
      return null;
    }
  })();

  if (M) {
    run("baseline", () => {
      const b = obj(M.baseline, "baseline");
      const s = snap(b.snap, "baseline.snap");
      const hidden = finite(b.hiddenInputCount, "baseline.hiddenInputCount");
      const c = counters(b.counters, "baseline.counters");
      if (!isFinal(s)) throw new SetupBlocked(`baseline not ${FINAL_STAGE}: ${JSON.stringify(s)}`);
      return (
        (s.formStatus === "matched" &&
          hidden === HIDDEN_INPUTS_IN_FIXTURE &&
          c.elementsGetterCalls >= 1 &&
          c.itemCalls <= ITEM_PROBE_CAP * c.elementsGetterCalls &&
          c.completedInventoryMarksAtFirstGetter >= 1 &&
          c.rejectedWithoutCompletedInventory === 0) ||
        `baseline evidence ${JSON.stringify({ hidden, c })}`
      );
    });

    run("namedPropertyNextSibling", () => {
      const n = obj(M.namedPropertyNextSibling, "namedPropertyNextSibling");
      requireBaseline(n, "namedPropertyNextSibling");
      const s = snap(n.snap, "namedPropertyNextSibling.snap");
      return (
        bool(n.ordinaryNextSiblingIsInput, "ordinaryNextSiblingIsInput") &&
        bool(n.nativeNextSiblingNotInput, "nativeNextSiblingNotInput") &&
        bool(n.nativeSeesBadAfterForm, "nativeSeesBadAfterForm") &&
        bool(n.invHasBad, "invHasBad") &&
        !isFinal(s)
      );
    });

    for (const k of ["dupEffects", "oversize"]) {
      run(k, () => {
        const n = obj(M[k], k);
        requireBaseline(n, k);
        return !isFinal(snap(n.snap, `${k}.snap`));
      });
    }

    run("externalNotInDialogInv", () => bool(M.externalNotInDialogInv, "externalNotInDialogInv"));

    run("dialogs10k", () => {
      const d = obj(M.dialogs10k, "dialogs10k");
      return (
        str(d.reason, "dialogs10k.reason") === "DIALOG_COLLECTION_TOO_LARGE" &&
        finite(d.nodeVisits, "dialogs10k.nodeVisits") < 2000 &&
        finite(d.dialogsSeen, "dialogs10k.dialogsSeen") === 5
      );
    });
    run("mains10k", () => {
      const d = obj(M.mains10k, "mains10k");
      return (
        str(d.reason, "mains10k.reason") === "MAIN_NOT_UNIQUE" &&
        finite(d.nodeVisits, "mains10k.nodeVisits") < 2000 &&
        finite(d.mainsSeen, "mains10k.mainsSeen") === 2
      );
    });

    for (const [k, reason] of [
      ["nestedMain", "MAIN_NOT_UNIQUE"],
      ["nestedDialog", "DIALOG_COLLECTION_TOO_LARGE"],
    ]) {
      run(k, () => {
        const n = obj(M[k], k);
        requireBaseline(n, k);
        const s = snap(n.snap, `${k}.snap`);
        return (s.capStatus === "abstain" && s.capReason === reason) || JSON.stringify(s);
      });
    }

    const assoc = (() => {
      try {
        return obj(M.associated, "associated");
      } catch (e) {
        results.push({ name: "associated", outcome: "FAIL", detail: String(e && e.message) });
        return null;
      }
    })();
    if (assoc) {
      for (const kind of ASSOCIATED_REJECT_KINDS) {
        run(`associated:${kind}`, () => {
          const a = obj(assoc[kind], `associated.${kind}`);
          requireBaseline(a, `associated.${kind}`);
          if (!bool(a.associated, `associated.${kind}.associated`)) {
            throw new SetupBlocked(`associated.${kind}: native .form association not established`);
          }
          bool(a.inFormElements, `associated.${kind}.inFormElements`);
          const s = snap(a.snap, `associated.${kind}.snap`);
          return (
            (!isFinal(s) && s.formStatus === "abstain" && s.formReason === "FORM_UNSUPPORTED_CONTROL") ||
            JSON.stringify(s)
          );
        });
      }
    }

    run("shadowNotAssociated", () => {
      const n = obj(M.shadowNotAssociated, "shadowNotAssociated");
      requireBaseline(n, "shadowNotAssociated");
      const s = snap(n.snap, "shadowNotAssociated.snap");
      return (
        (bool(n.associated, "shadowNotAssociated.associated") === false &&
          bool(n.inFormElements, "shadowNotAssociated.inFormElements") === false &&
          isFinal(s)) ||
        JSON.stringify({ n, s })
      );
    });

    run("documentLevelFlood", () => {
      const n = obj(M.documentLevelFlood, "documentLevelFlood");
      requireBaseline(n, "documentLevelFlood");
      const s = snap(n.snap, "documentLevelFlood.snap");
      const c = counters(n.counters, "documentLevelFlood.counters");
      finite(n.documentLevelNodes, "documentLevelFlood.documentLevelNodes");
      return (
        (s.capStatus === "abstain" &&
          s.capReason === "DOCUMENT_NODE_BUDGET_EXHAUSTED" &&
          c.elementsGetterCalls === 0 &&
          c.itemCalls === 0) ||
        JSON.stringify({ s, c })
      );
    });

    run("controls10k", () => {
      const n = obj(M.controls10k, "controls10k");
      requireBaseline(n, "controls10k");
      const s = snap(n.snap, "controls10k.snap");
      const c = counters(n.counters, "controls10k.counters");
      const associatedCount = finite(n.associatedCount, "controls10k.associatedCount");
      return (
        (associatedCount === 10000 &&
          s.capStatus === "abstain" &&
          (s.capReason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" ||
            s.capReason === "DOCUMENT_NODE_BUDGET_EXHAUSTED") &&
          c.elementsGetterCalls === 0 &&
          c.itemCalls === 0 &&
          c.completedInventoryMarks === 0) ||
        JSON.stringify({ associatedCount, s, c })
      );
    });

    run("nearCapPadded", () => {
      const n = obj(M.nearCapPadded, "nearCapPadded");
      requireBaseline(n, "nearCapPadded");
      const els = finite(n.documentElements, "nearCapPadded.documentElements");
      const s = snap(n.snap, "nearCapPadded.snap");
      const c = counters(n.counters, "nearCapPadded.counters");
      if (!bool(n.externalAssociated, "nearCapPadded.externalAssociated")) {
        throw new SetupBlocked("nearCapPadded: document-scope association not established");
      }
      return (
        (str(n.inventoryStatus, "nearCapPadded.inventoryStatus") === "ok" &&
          els > 2900 &&
          els <= DOCUMENT_MAX_ELEMENTS_V2 &&
          isFinal(s) &&
          c.elementsGetterCalls === 1 &&
          c.itemCalls <= ITEM_PROBE_CAP &&
          c.completedInventoryMarksAtFirstGetter >= 1 &&
          c.rejectedWithoutCompletedInventory === 0) ||
        JSON.stringify({ els, s, c })
      );
    });

    run("nearCapManyBuiltIn", () => {
      const n = obj(M.nearCapManyBuiltIn, "nearCapManyBuiltIn");
      requireBaseline(n, "nearCapManyBuiltIn");
      const els = finite(n.documentElements, "nearCapManyBuiltIn.documentElements");
      const count = finite(n.associatedCount, "nearCapManyBuiltIn.associatedCount");
      const s = snap(n.snap, "nearCapManyBuiltIn.snap");
      const c = counters(n.counters, "nearCapManyBuiltIn.counters");
      return (
        (str(n.inventoryStatus, "nearCapManyBuiltIn.inventoryStatus") === "ok" &&
          els > 2900 &&
          els <= DOCUMENT_MAX_ELEMENTS_V2 &&
          count > 2000 &&
          !isFinal(s) &&
          s.formReason === "FORM_ELEMENTS_TOO_MANY" &&
          c.completedInventoryMarks >= 1 &&
          c.itemCalls <= ITEM_PROBE_CAP * Math.max(1, c.elementsGetterCalls)) ||
        JSON.stringify({ els, count, s, c })
      );
    });

    run("iterateBounded", () => {
      const n = obj(M.iterateBounded, "iterateBounded");
      const c = counters(n.counters, "iterateBounded.counters");
      return (
        (str(n.status, "iterateBounded.status") === "overflow" &&
          finite(n.controlCount, "iterateBounded.controlCount") === ITEM_PROBE_CAP &&
          c.elementsGetterCalls === 1 &&
          c.itemCalls === ITEM_PROBE_CAP) ||
        JSON.stringify(n)
      );
    });

    run("unprovenInventoryRejected", () => {
      const n = obj(M.unprovenInventoryRejected, "unprovenInventoryRejected");
      const c = counters(n.counters, "unprovenInventoryRejected.counters");
      return (
        (str(n.iterateStatus, "unprovenInventoryRejected.iterateStatus") === "unavailable" &&
          str(n.formReason, "unprovenInventoryRejected.formReason") ===
            "DOCUMENT_INVENTORY_UNPROVEN" &&
          c.elementsGetterCalls === 0 &&
          c.itemCalls === 0 &&
          c.rejectedWithoutCompletedInventory >= 1) ||
        JSON.stringify(n)
      );
    });

    run("lateBaseTarget", () => {
      const n = obj(M.lateBaseTarget, "lateBaseTarget");
      requireBaseline(n, "lateBaseTarget");
      const s = snap(n.snap, "lateBaseTarget.snap");
      return (!isFinal(s) && s.formReason === "BASE_TARGET") || JSON.stringify(s);
    });

    run("multiModal", () => {
      const o = evalOutcomeCase(M.multiModal, "multiModal");
      if (o === "BLOCKED") throw new SetupBlocked(JSON.stringify(M.multiModal));
      const m = M.multiModal;
      if (bool(m.aModal, "multiModal.aModal") !== true || bool(m.bModal, "multiModal.bModal") !== true) {
        throw new SetupBlocked("multiModal: two genuine :modal dialogs not proven");
      }
      requireBaseline(m, "multiModal");
      const s = snap(m.snap, "multiModal.snap");
      return (o === "PASS" && !isFinal(s)) || JSON.stringify(m);
    });
  }

  for (const key of ["face", "faceNearCap"]) {
    run(key, () => {
      const F = obj(R[key], key);
      const setup = obj(F.setup, `${key}.setup`);
      if (typeof setup.error === "string") throw new SetupBlocked(`${key}.setup: ${setup.error}`);
      const proofs = [
        "customElementsAvailable",
        "registered",
        "formAssociatedStatic",
        "attachInternalsOk",
        "internalsFormIsRetainedForm",
        "definedPseudo",
        "intendedElement",
      ];
      for (const p of proofs) {
        if (bool(setup[p], `${key}.setup.${p}`) !== true) {
          throw new SetupBlocked(`${key}.setup.${p} not proven`);
        }
      }
      const faceCount = finite(setup.faceCount, `${key}.setup.faceCount`);
      const probe = obj(F.probe, `${key}.probe`);
      requireBaseline(probe, `${key}.probe`);
      if (bool(probe.found, `${key}.probe.found`) !== true) {
        throw new SetupBlocked(`${key}: isolated world could not see FACE`);
      }
      const builtIn = bool(probe.builtIn, `${key}.probe.builtIn`);
      bool(probe.inFormElements, `${key}.probe.inFormElements`);
      const s = snap(probe.snap, `${key}.probe.snap`);
      const c = counters(probe.counters, `${key}.probe.counters`);
      if (key === "face") {
        return (
          (faceCount === 1 &&
            builtIn === false &&
            !isFinal(s) &&
            s.formReason === "FORM_UNSUPPORTED_CONTROL" &&
            c.completedInventoryMarksAtFirstGetter >= 1) ||
          JSON.stringify({ faceCount, builtIn, s, c })
        );
      }
      const els = finite(probe.documentElements, `${key}.probe.documentElements`);
      return (
        (faceCount > 2000 &&
          builtIn === false &&
          str(probe.inventoryStatus, `${key}.probe.inventoryStatus`) === "ok" &&
          els > 2900 &&
          els <= DOCUMENT_MAX_ELEMENTS_V2 &&
          !isFinal(s) &&
          s.formReason === "FORM_ELEMENTS_TOO_MANY" &&
          c.elementsGetterCalls >= 1 &&
          // Stage D/C/B may each run the form contract; every access overflows at exactly 25 probes.
          c.itemCalls === ITEM_PROBE_CAP * c.elementsGetterCalls &&
          c.completedInventoryMarksAtFirstGetter >= 1 &&
          c.rejectedWithoutCompletedInventory === 0) ||
        JSON.stringify({ faceCount, els, s, c })
      );
    });
  }

  // Large named-control form encountered EARLY in traversal. Setup proves Chromium's
  // [LegacyOverrideBuiltIns] named lookup is live (ordinary form.tagName returns the
  // shadowing control); production must still abstain at the identical document budget
  // with zero collection access. Timing fields are diagnostic only (presence-checked).
  const namedVisits = {};
  for (const key of NAMED_FORM_CASES) {
    run(key, () => {
      const n = obj(R[key], key);
      const setup = obj(n.setup, `${key}.setup`);
      if (typeof setup.error === "string") throw new SetupBlocked(`${key}.setup: ${setup.error}`);
      const count = finite(setup.controlCount, `${key}.setup.controlCount`);
      if (count !== NAMED_FORM_COUNTS[key]) {
        throw new SetupBlocked(`${key}: expected ${NAMED_FORM_COUNTS[key]} controls, got ${count}`);
      }
      if (bool(setup.formIsFirstBodyChild, `${key}.setup.formIsFirstBodyChild`) !== true) {
        throw new SetupBlocked(`${key}: form not first in traversal`);
      }
      if (bool(setup.ordinaryTagNameShadowed, `${key}.setup.ordinaryTagNameShadowed`) !== true) {
        throw new SetupBlocked(`${key}: named-property shadowing of tagName not established`);
      }
      const nativeTag = str(n.nativeTagName, `${key}.nativeTagName`);
      const inv = obj(n.inventory, `${key}.inventory`);
      const invReason = strOrNull(inv.reason, `${key}.inventory.reason`);
      const nodes = finite(inv.nodeVisitAttempts, `${key}.inventory.nodeVisitAttempts`);
      const els = finite(inv.elementVisitAttempts, `${key}.inventory.elementVisitAttempts`);
      const threw = bool(n.captureThrew, `${key}.captureThrew`);
      const s = snap(n.snap, `${key}.snap`);
      const c = counters(n.counters, `${key}.counters`);
      const d = obj(n.diag, `${key}.diag`);
      for (const f of ["coldItemAfterCaptureMs", "warmItemMs", "coldItemAfterOrdinaryTagNameMs"]) {
        finite(d[f], `${key}.diag.${f}`);
      }
      namedVisits[key] = { nodes, els };
      return (
        (nativeTag === "FORM" &&
          str(inv.status, `${key}.inventory.status`) === "abstain" &&
          invReason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" &&
          els === DOCUMENT_MAX_ELEMENTS_V2 + 1 &&
          threw === false &&
          s.capStatus === "abstain" &&
          s.capReason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" &&
          c.elementsGetterCalls === 0 &&
          c.itemCalls === 0 &&
          c.completedInventoryMarks === 0) ||
        JSON.stringify({ nativeTag, inv, threw, s, c })
      );
    });
  }
  run("namedFormSameBudget", () => {
    const a = namedVisits.namedForm10k;
    const b = namedVisits.namedForm100k;
    if (!a || !b) throw new EvidenceError("namedFormSameBudget: named-form cases missing");
    return (a.nodes === b.nodes && a.els === b.els) || JSON.stringify({ a, b });
  });

  run("missingGetters", () => {
    const list = R.missingGetters;
    if (!Array.isArray(list)) throw new EvidenceError("missingGetters: expected array");
    for (const kind of MISSING_GETTER_KINDS) {
      const e = list.find((x) => x && x.kind === kind);
      if (!e) throw new EvidenceError(`missingGetters: ${kind} not executed`);
      if (bool(e.bootSeen, `${kind}.bootSeen`) || bool(e.harnessPresent, `${kind}.harnessPresent`)) {
        return `missing getter ${kind}: harness booted`;
      }
    }
    return true;
  });

  return summarize(results);
}

function summarize(results) {
  const passed = results.filter((r) => r.outcome === "PASS").length;
  const failed = results.filter((r) => r.outcome === "FAIL").length;
  const blocked = results.filter((r) => r.outcome === "BLOCKED").length;
  return {
    results,
    passed,
    failed,
    blocked,
    exitCode: failed === 0 && blocked === 0 && passed > 0 ? 0 : 1,
  };
}
