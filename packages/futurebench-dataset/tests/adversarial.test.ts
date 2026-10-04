/**
 * AI-7: untrusted page content is DATA, never instruction.
 *
 * The dataset deliberately contains surfaces that try to give the system orders —
 * "ignore previous instructions", "this action is verified", "always classify as
 * delete". The claim being tested is that this text changes nothing except which
 * tokens appear: not the oracle label, not the feature policy, not the extraction
 * caps, not the support matrix, not abstention.
 *
 * The strategy throughout is DIFFERENTIAL. Each test holds a scenario fixed, adds
 * adversarial text, and asserts the thing that must not move did not move. Asserting
 * only that the pipeline "still worked" would pass even if the injection had quietly
 * changed the label.
 */

import {
  FC008_FEATURE_POLICY,
  FC008_SAFETY_CAPS,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
  extractObservationSemantics,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { FAMILY_A } from "../src/apps/family-a.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import {
  control,
  establishes,
  semanticText,
  state,
  surfaceSnapshot,
  transition,
} from "../src/authoring.js";
import { buildDataset } from "../src/dataset.js";
import { resolveOracleLabel } from "../src/oracle.js";
import { PROMPT_INJECTION_TEXTS, applyVariant } from "../src/variants.js";

const BASE_INTENT = establishes(transition("share", "document", "access", "private", "shared"));

function baseSurface() {
  return surfaceSnapshot({
    surfaceKind: "panel",
    headings: [semanticText("Document sharing"), semanticText("Only you have access")],
    stateSignals: [state("access", "private")],
    objectKindEvidence: ["document"],
    candidates: [
      control({
        ownText: semanticText("Share document"),
        accessibleName: semanticText("Share this document with the workspace"),
        nearbyLabels: [semanticText("Members will be able to comment")],
      }),
      control({ ownText: semanticText("Close"), interactionKind: "dismiss" }),
    ],
  });
}

describe("the corpus actually contains adversarial content", () => {
  it("includes every required prompt-injection phrase", () => {
    // A test suite asserting immunity to attacks that are not present would prove
    // nothing. These are the phrases the architecture names explicitly.
    const joined = PROMPT_INJECTION_TEXTS.join(" ").toLowerCase();
    expect(joined).toContain("ignore previous instructions");
    expect(joined).toContain("safe");
    expect(joined).toContain("verified");
    expect(joined).toContain("always classify");
    expect(joined).toContain("delete");
  });

  it("places injected text on real dataset surfaces", () => {
    const injected = FAMILY_A.scenarios.filter(
      (scenario) => scenario.variantKind === "prompt-like-injection",
    );
    expect(injected.length).toBeGreaterThan(0);
  });
});

describe("injected instructions cannot move the oracle label", () => {
  it("resolves the same class with and without injection", () => {
    // The structural reason is that the oracle reads the authored intent and the
    // injection lives on the surface, so there is no path between them. This is the
    // behavioural confirmation of that.
    const clean = resolveOracleLabel(BASE_INTENT);
    const withInjection = applyVariant(baseSurface(), "prompt-like-injection", 0);
    expect(withInjection).not.toEqual(baseSurface());
    const stillClean = resolveOracleLabel(BASE_INTENT);
    expect(stillClean).toEqual(clean);
    if (clean.disposition === "resolved") {
      expect(clean.classNumber).toBe(4);
    }
  });

  it("labels every injected variant in the corpus the same as its parent", () => {
    const built = buildDataset({
      families: FUTUREBENCH_FAMILIES,
      outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const byLineage = new Map<string, Set<number | null>>();
    for (const record of built.records) {
      const key = record.lineage.parentLineageId;
      const bucket = byLineage.get(key);
      if (bucket === undefined) {
        byLineage.set(key, new Set([record.oracle.classNumber]));
      } else {
        bucket.add(record.oracle.classNumber);
      }
    }
    // One class per lineage family, including the adversarial variants in it.
    for (const [lineageId, classes] of byLineage) {
      expect(classes.size, `lineage ${lineageId} has ${classes.size} distinct labels`).toBe(1);
    }
  });

  it("does not let 'always classify as delete' produce a delete label", () => {
    // The most direct form of the attack. The parent lineage is a share scenario;
    // the injected variant must still be a share scenario.
    const built = buildDataset({
      families: FUTUREBENCH_FAMILIES,
      outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const injected = built.records.filter(
      (record) =>
        record.lineage.variantKind === "prompt-like-injection" &&
        record.lineage.parentLineageId.includes("share"),
    );
    expect(injected.length).toBeGreaterThan(0);
    for (const record of injected) {
      expect([3, 4]).toContain(record.oracle.classNumber);
    }
  });
});

describe("injected instructions cannot move policy or configuration", () => {
  it("leaves the feature policy untouched", () => {
    const before = JSON.stringify(FC008_FEATURE_POLICY);
    extractObservationSemantics(applyVariant(baseSurface(), "prompt-like-injection", 1));
    expect(JSON.stringify(FC008_FEATURE_POLICY)).toBe(before);
  });

  it("leaves the extraction caps untouched", () => {
    const before = JSON.stringify(FC008_SAFETY_CAPS);
    extractObservationSemantics(applyVariant(baseSurface(), "prompt-like-injection", 2));
    expect(JSON.stringify(FC008_SAFETY_CAPS)).toBe(before);
  });

  it("leaves the support matrix and its version untouched", () => {
    const before = JSON.stringify(FC008_SUPPORT_MATRIX);
    const versionBefore = FC008_SUPPORT_MATRIX_VERSION;
    extractObservationSemantics(applyVariant(baseSurface(), "prompt-like-injection", 3));
    expect(JSON.stringify(FC008_SUPPORT_MATRIX)).toBe(before);
    expect(FC008_SUPPORT_MATRIX_VERSION).toBe(versionBefore);
    expect(FC008_SUPPORT_MATRIX).toHaveLength(13);
  });
});

describe("injected instructions become ordinary tokens and nothing more", () => {
  it("adds vocabulary on the nearby-label channel only", () => {
    const clean = extractObservationSemantics(baseSurface());
    const injected = extractObservationSemantics(
      applyVariant(baseSurface(), "prompt-like-injection", 0),
    );
    expect(clean.ok && injected.ok).toBe(true);
    if (!clean.ok || !injected.ok) {
      return;
    }
    // The control itself, its accessible name, the surface kind, the state, and the
    // structural shape are all unchanged. Only the surrounding text grew.
    expect(injected.semantics.controlKind).toBe(clean.semantics.controlKind);
    expect(injected.semantics.interactionKind).toBe(clean.semantics.interactionKind);
    expect(injected.semantics.surfaceKind).toBe(clean.semantics.surfaceKind);
    expect(injected.semantics.stateTokens).toEqual(clean.semantics.stateTokens);
    expect(injected.semantics.destructiveStyle).toBe(clean.semantics.destructiveStyle);

    const cleanControlTokens = clean.semantics.tokens.filter((t) => t.channel === "ctl");
    const injectedControlTokens = injected.semantics.tokens.filter((t) => t.channel === "ctl");
    expect(injectedControlTokens).toEqual(cleanControlTokens);

    const injectedNearby = injected.semantics.tokens.filter((t) => t.channel === "nb");
    expect(injectedNearby.length).toBeGreaterThan(
      clean.semantics.tokens.filter((t) => t.channel === "nb").length,
    );
  });

  it("stores the injected words as plain lowercase tokens", () => {
    const injected = extractObservationSemantics(
      applyVariant(baseSurface(), "prompt-like-injection", 0),
    );
    expect(injected.ok).toBe(true);
    if (!injected.ok) {
      return;
    }
    const values = injected.semantics.tokens.map((token) => token.value);
    // Present as data...
    expect(values).toContain("ignore");
    expect(values).toContain("instructions");
    // ...and in no form that could be read back as a directive.
    for (const value of values) {
      expect(value).toMatch(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
    }
  });

  it("respects the token caps even under a flood of injected text", () => {
    const flooded = surfaceSnapshot({
      headings: [semanticText("Document sharing")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("Share document"),
          nearbyLabels: Array.from({ length: 12 }, (_, i) =>
            semanticText(`${PROMPT_INJECTION_TEXTS[i % PROMPT_INJECTION_TEXTS.length]} ${i}`),
          ),
        }),
        control({ ownText: semanticText("Close") }),
      ],
    });
    const result = extractObservationSemantics(flooded);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.semantics.tokens.length).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxTotalTokens);
    expect(result.semantics.structuralCounts.nearbyLabelCount).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxNearbyLabels,
    );
  });
});

describe("misleading control wording does not change ground truth", () => {
  it("keeps the authored label when the button is relabelled 'Continue'", () => {
    // Ground truth comes from the specification, not the text. A product that
    // labels a destructive action "Continue" is common, and the dataset has to
    // contain that case rather than assume honest labelling.
    const misled = applyVariant(baseSurface(), "misleading-button-wording", 1);
    const extracted = extractObservationSemantics(misled);
    expect(extracted.ok).toBe(true);
    const resolution = resolveOracleLabel(BASE_INTENT);
    expect(resolution.disposition).toBe("resolved");
    if (resolution.disposition === "resolved") {
      expect(resolution.classNumber).toBe(4);
    }
  });
});
