import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import { extractObservationSemantics } from "../src/extraction.js";
import {
  FC008_FEATURE_POLICY,
  FC008_FEATURE_POLICY_VERSION,
  PROHIBITED_PRIMARY_FEATURE_INPUTS,
  type FeaturePolicy,
  type FeatureVocabulary,
} from "../src/feature-policy.js";
import type { ObservationSemantics } from "../src/observation.js";
import {
  FC008_PROJECTOR_ID,
  FC008_PROJECTOR_VERSION,
  countBucket,
  enumerateCandidateFeatures,
  projectPrimaryFeatures,
} from "../src/projection.js";
import { type RawSurface, semanticText } from "../src/surface.js";

function surfaceOf(label: string, extra: Partial<RawSurface> = {}): RawSurface {
  return {
    surfaceKind: "modal-dialog",
    headings: [semanticText("Delete this file?")],
    stateSignals: [{ property: "existence", value: "present" }],
    objectKindEvidence: ["file"],
    candidates: [
      {
        ownText: semanticText(label),
        accessibleName: semanticText(`${label} permanently`),
        controlKind: "button",
        controlRole: "button",
        interactionKind: "confirm",
        formMethod: "none",
        destructiveStyle: true,
        nearbyLabels: [semanticText("This cannot be undone")],
        ancestorDepth: 3,
      },
      {
        ownText: semanticText("Cancel"),
        accessibleName: null,
        controlKind: "button",
        controlRole: "button",
        interactionKind: "dismiss",
        formMethod: "none",
        destructiveStyle: false,
        nearbyLabels: [],
        ancestorDepth: 3,
      },
    ],
    targetIndex: 0,
    ...extra,
  };
}

function semanticsOf(label = "Delete file"): ObservationSemantics {
  const result = extractObservationSemantics(surfaceOf(label));
  if (!result.ok) {
    throw new Error(`fixture refused: ${result.refusal}`);
  }
  return result.semantics;
}

function vocabularyFor(semantics: ObservationSemantics): FeatureVocabulary {
  const entries = new Map<string, number>();
  for (const candidate of enumerateCandidateFeatures(semantics)) {
    if (!entries.has(candidate.name)) {
      entries.set(candidate.name, entries.size);
    }
  }
  return Object.freeze({
    vocabularyVersion: "test-vocab",
    featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
    entries,
    size: entries.size,
  });
}

describe("projector identity", () => {
  it("declares a stable id and version", () => {
    expect(FC008_PROJECTOR_ID.length).toBeGreaterThan(0);
    expect(FC008_PROJECTOR_VERSION).toMatch(/^\d+\.\d+$/);
  });
});

describe("Layer B is the only input", () => {
  it("projects from semantics alone", () => {
    // The guarantee is in the signature: semantics, vocabulary, policy. There is no
    // parameter through which identity, provenance, or a label could arrive, so no
    // body change could leak one.
    const semantics = semanticsOf();
    const vocabulary = vocabularyFor(semantics);
    const result = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    expect(result.ok).toBe(true);
  });

  it("names no prohibited input as a feature family", () => {
    // Structural, not conventional: the family prefix is the only place a prohibited
    // data source could enter, so that is where it is checked.
    const semantics = semanticsOf();
    const prohibited = new Set(PROHIBITED_PRIMARY_FEATURE_INPUTS.map((name) => name.toLowerCase()));
    for (const candidate of enumerateCandidateFeatures(semantics)) {
      const family = candidate.name.split(":")[0] as string;
      expect(prohibited.has(family.toLowerCase()), candidate.name).toBe(false);
    }
  });

  it("emits only features from the documented family set", () => {
    const allowed = new Set([
      "tok",
      "chan",
      "ck",
      "cr",
      "ik",
      "sk",
      "fm",
      "st",
      "obj",
      "dstr",
      "miss",
      "cnt",
    ]);
    for (const candidate of enumerateCandidateFeatures(semanticsOf())) {
      expect(allowed.has(candidate.name.split(":")[0] as string), candidate.name).toBe(true);
    }
  });

  it("emits no feature carrying a hostname, route, or timestamp", () => {
    const names = enumerateCandidateFeatures(semanticsOf()).map((c) => c.name);
    for (const name of names) {
      expect(name).not.toMatch(/https?/);
      expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(name).not.toMatch(/^(?:host|url|origin|route|path|app|site)\b/);
    }
  });
});

describe("feature values are binary presence", () => {
  it("produces a vector of indices with no magnitudes", () => {
    const semantics = semanticsOf();
    const vocabulary = vocabularyFor(semantics);
    const result = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const indices = result.projection.vector.indices;
    expect(indices.length).toBeGreaterThan(0);
    // Sorted and unique: a vector that depended on emission order would make two
    // identical observations look different to a model.
    expect([...indices]).toEqual([...new Set(indices)].sort((a, b) => a - b));
  });

  it("is deterministic and order-independent", () => {
    const semantics = semanticsOf();
    const vocabulary = vocabularyFor(semantics);
    const first = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    const second = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("ignores a feature absent from the vocabulary rather than inventing an index", () => {
    // Growing the feature space at inference time would make the fitted artifact
    // and the live model disagree about what index means what.
    const fittedOn = semanticsOf("Delete file");
    const vocabulary = vocabularyFor(fittedOn);
    const unseen = semanticsOf("Deprovision cluster");
    const result = projectPrimaryFeatures(unseen, vocabulary, FC008_FEATURE_POLICY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const index of result.projection.vector.indices) {
        expect(index).toBeLessThan(vocabulary.size);
      }
    }
  });
});

describe("policy caps are refusals, not truncations", () => {
  it("refuses a vocabulary larger than the policy maximum", () => {
    const semantics = semanticsOf();
    const oversized = new Map<string, number>();
    for (let i = 0; i <= FC008_SAFETY_CAPS.maxFeatureVocabulary; i += 1) {
      oversized.set(`tok:ctl:w${i}`, i);
    }
    const result = projectPrimaryFeatures(
      semantics,
      {
        vocabularyVersion: "oversized",
        featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
        entries: oversized,
        size: oversized.size,
      },
      FC008_FEATURE_POLICY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("vocabulary-exceeds-policy-maximum");
    }
  });

  it("refuses more active features than the policy permits", () => {
    // Silently dropping features past the limit would change the model's input
    // without telling anyone, which is the worst of the available options.
    const semantics = semanticsOf();
    const vocabulary = vocabularyFor(semantics);
    const tightPolicy: FeaturePolicy = { ...FC008_FEATURE_POLICY, maxActiveFeatures: 1 };
    const result = projectPrimaryFeatures(semantics, vocabulary, tightPolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("active-feature-count-exceeds-policy-maximum");
    }
  });

  it("stays within the policy maximum on ordinary input", () => {
    const semantics = semanticsOf();
    const vocabulary = vocabularyFor(semantics);
    const result = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.vector.indices.length).toBeLessThanOrEqual(
        FC008_FEATURE_POLICY.maxActiveFeatures,
      );
      expect(FC008_FEATURE_POLICY.maxActiveFeatures).toBeLessThanOrEqual(
        FC008_SAFETY_CAPS.maxActiveFeatures,
      );
    }
  });
});

describe("structural count bucketing", () => {
  it("maps counts to a small closed set of buckets", () => {
    expect(countBucket(0)).toBe("0");
    expect(countBucket(1)).toBe("1");
    expect(countBucket(2)).toBe("2-3");
    expect(countBucket(3)).toBe("2-3");
    expect(countBucket(4)).toBe("4-7");
    expect(countBucket(7)).toBe("4-7");
    expect(countBucket(8)).toBe("8plus");
    expect(countBucket(1000)).toBe("8plus");
  });

  it("bucketises rather than encoding an exact count", () => {
    // An exact count is closer to an identifier than to a signal: it can
    // fingerprint a specific page. Buckets keep the coarse structural information
    // without that.
    const names = enumerateCandidateFeatures(semanticsOf()).map((c) => c.name);
    for (const name of names.filter((n) => n.startsWith("cnt:"))) {
      const bucket = name.split(":")[2] as string;
      expect(["0", "1", "2-3", "4-7", "8plus"]).toContain(bucket);
    }
  });
});
