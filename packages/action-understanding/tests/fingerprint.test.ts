import { describe, expect, it } from "vitest";
import type {
  AcquisitionContext,
  ActionObservation,
  ObservationSemantics,
} from "../src/observation.js";
import {
  FC008_FINGERPRINT_VERSION,
  FP_MAX_STRING_UNITS,
  computeObservationInputFingerprint,
} from "../src/fingerprint.js";
import { buildAcquisition, buildSemantics } from "./helpers.js";

type AssertFalse<T extends false> = T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// Layer C and Layer D cannot be fingerprinted: the signature does not accept them.
type FingerprintParams = Parameters<typeof computeObservationInputFingerprint>;
type _NotTheWholeObservation = AssertFalse<Equals<FingerprintParams, [ActionObservation]>>;
type _ExactlyTwoLayers = AssertFalse<Equals<FingerprintParams["length"], 3>>;

function fingerprint(
  semantics: ObservationSemantics = buildSemantics(),
  acquisition: AcquisitionContext = buildAcquisition(),
): string {
  const result = computeObservationInputFingerprint(semantics, acquisition);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.fingerprint;
}

describe("input fingerprint determinism", () => {
  it("is stable across repeated computation", () => {
    expect(fingerprint()).toBe(fingerprint());
  });

  it("is versioned", () => {
    expect(FC008_FINGERPRINT_VERSION).toBe("FP1");
    expect(fingerprint().startsWith("FP1|")).toBe(true);
  });

  it("is independent of object key insertion order", () => {
    const base = buildSemantics();
    const reordered = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as unknown as ObservationSemantics;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(fingerprint(reordered)).toBe(fingerprint(base));
  });

  it("is independent of token, state-token, and evidence ordering", () => {
    const base = buildSemantics();
    const permuted = buildSemantics({
      tokens: [...base.tokens].reverse(),
      stateTokens: [...base.stateTokens].reverse(),
      objectKindEvidence: [...base.objectKindEvidence].reverse(),
    });
    expect(fingerprint(permuted)).toBe(fingerprint(base));
  });
});

describe("input fingerprint sensitivity", () => {
  it("changes when any Layer B field changes", () => {
    const baseline = fingerprint();
    const variants: Partial<ObservationSemantics>[] = [
      { controlKind: "link" },
      { controlRole: "checkbox" },
      { interactionKind: "confirm" },
      { surfaceKind: "panel" },
      { formMethod: "get" },
      { destructiveStyle: false },
      { tokens: [{ channel: "ctl", value: "make" }] },
      { stateTokens: [] },
      { objectKindEvidence: [] },
    ];
    const seen = new Set<string>([baseline]);
    for (const patch of variants) {
      const fp = fingerprint(buildSemantics(patch));
      expect(fp).not.toBe(baseline);
      expect(seen.has(fp)).toBe(false);
      seen.add(fp);
    }
  });

  it("changes when a structural count changes", () => {
    const base = buildSemantics();
    const changed = buildSemantics({
      structuralCounts: { ...base.structuralCounts, siblingControlCount: 7 },
    });
    expect(fingerprint(changed)).not.toBe(fingerprint(base));
  });

  it("changes when a missingness flag changes", () => {
    const base = buildSemantics();
    const changed = buildSemantics({
      missingness: { ...base.missingness, redactionApplied: true },
    });
    expect(fingerprint(changed)).not.toBe(fingerprint(base));
  });

  it("changes when Layer A changes", () => {
    const baseline = fingerprint();
    expect(fingerprint(buildSemantics(), buildAcquisition({ topFrame: false }))).not.toBe(baseline);
    expect(fingerprint(buildSemantics(), buildAcquisition({ localeTag: "fr-FR" }))).not.toBe(
      baseline,
    );
    expect(fingerprint(buildSemantics(), buildAcquisition({ platform: "macos" }))).not.toBe(
      baseline,
    );
  });
});

describe("input fingerprint encoding is collision resistant", () => {
  it("distinguishes a token moved between channels", () => {
    const a = fingerprint(
      buildSemantics({
        tokens: [
          { channel: "ctl", value: "public" },
          { channel: "acc", value: "ok" },
        ],
      }),
    );
    const b = fingerprint(
      buildSemantics({
        tokens: [
          { channel: "nb", value: "public" },
          { channel: "acc", value: "ok" },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("distinguishes field boundaries that a naive join would merge", () => {
    // ("ab", "c") must not encode the same as ("a", "bc").
    const a = fingerprint(
      buildSemantics({ objectKindEvidence: ["repository", "file"], stateTokens: [] }),
    );
    const b = fingerprint(
      buildSemantics({ objectKindEvidence: ["repository"], stateTokens: ["visibility:file"] }),
    );
    expect(a).not.toBe(b);
  });

  it("length-prefixes strings so a delimiter cannot be smuggled through a value", () => {
    const a = fingerprint(buildSemantics(), buildAcquisition({ localeTag: "en-US" }));
    const b = fingerprint(
      buildSemantics(),
      buildAcquisition({ localeTag: "en-USS5:chrome" as never }),
    );
    expect(a).not.toBe(b);
  });

  it("type-tags atoms so a number and its string form never collide", () => {
    const base = buildSemantics();
    const fp = fingerprint(
      buildSemantics({ structuralCounts: { ...base.structuralCounts, headingCount: 1 } }),
    );
    expect(fp).toContain("N:1");
    // A string atom carries an S tag and a length, so "1" encodes as S1:1.
    expect(fp).not.toContain("S1:1N:");
  });

  it("uses self-delimiting sequence headers", () => {
    expect(fingerprint()).toMatch(/^FP1\|L2:L\d+:/);
  });
});

describe("input fingerprint failure handling", () => {
  it("fails closed rather than throwing on a non-finite number", () => {
    const base = buildSemantics();
    const result = computeObservationInputFingerprint(
      buildSemantics({
        structuralCounts: { ...base.structuralCounts, headingCount: Number.NaN },
      }),
      buildAcquisition(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("FP_NUMBER_TYPE");
  });

  it("fails closed rather than throwing on a wrongly typed field", () => {
    const result = computeObservationInputFingerprint(
      buildSemantics({ controlKind: 42 as never }),
      buildAcquisition(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("FP_STRING_TYPE");
  });

  it("fails closed on a string beyond the encoder cap", () => {
    const result = computeObservationInputFingerprint(
      buildSemantics({ controlKind: "a".repeat(FP_MAX_STRING_UNITS + 1) as never }),
      buildAcquisition(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("FP_STRING_OVERFLOW");
  });

  it("never hashes, so the encoding stays auditable", () => {
    // FC-008 follows FC-007's decision-fingerprint pattern: a canonical typed
    // encoding, not a digest. A reviewer can read what was fingerprinted.
    const fp = fingerprint();
    expect(fp).toContain("S6:button");
    expect(fp).not.toMatch(/^FP1\|[0-9a-f]{64}$/);
  });
});
