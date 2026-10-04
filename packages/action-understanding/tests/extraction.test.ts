import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import {
  CHANNEL_FILL_ORDER,
  FC008_EXTRACTOR_ID,
  FC008_EXTRACTOR_VERSION,
  extractObservationSemantics,
} from "../src/extraction.js";
import {
  STATE_TOKEN_REGEX,
  TOKEN_CHANNELS,
  validateActionObservation,
} from "../src/observation.js";
import {
  RAW_SURFACE_FORBIDDEN_KEYS,
  type RawControlCandidate,
  type RawSurface,
  nameLikeText,
  semanticText,
} from "../src/surface.js";
import { SUPPORTED_TRANSITION_PROPERTIES } from "../src/support-matrix.js";

function candidate(overrides: Partial<RawControlCandidate> = {}): RawControlCandidate {
  return {
    ownText: semanticText("Delete file"),
    accessibleName: null,
    controlKind: "button",
    controlRole: "button",
    interactionKind: "activate",
    formMethod: "none",
    destructiveStyle: false,
    nearbyLabels: [],
    ancestorDepth: 3,
    ...overrides,
  };
}

function surface(overrides: Partial<RawSurface> = {}): RawSurface {
  return {
    surfaceKind: "page",
    headings: [semanticText("Files")],
    stateSignals: [{ property: "existence", value: "present" }],
    objectKindEvidence: ["file"],
    candidates: [candidate(), candidate({ ownText: semanticText("Cancel") })],
    targetIndex: 0,
    ...overrides,
  };
}

describe("extractor identity", () => {
  it("declares a stable id and version", () => {
    expect(FC008_EXTRACTOR_ID).toBe("fc008-bounded-surface-extractor");
    expect(FC008_EXTRACTOR_VERSION).toMatch(/^\d+\.\d+$/);
  });

  it("fills channels in a documented priority order covering every channel", () => {
    expect([...CHANNEL_FILL_ORDER].sort()).toEqual([...TOKEN_CHANNELS].sort());
    // Control text first: when the total budget runs out, the token describing the
    // control itself is the one worth keeping.
    expect(CHANNEL_FILL_ORDER[0]).toBe("ctl");
  });
});

describe("refusals", () => {
  it("refuses a surface with no candidate controls", () => {
    const result = extractObservationSemantics(surface({ candidates: [], targetIndex: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("no-candidate-controls");
    }
  });

  it("refuses a target index outside the candidate list", () => {
    const result = extractObservationSemantics(surface({ targetIndex: 9 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("target-index-out-of-range");
    }
  });

  it("refuses a target beyond the scan cap rather than extracting it anyway", () => {
    // The scan cap bounds work before anything is read. A target past the cap was
    // never scanned, so reporting it as observed would misdescribe what happened.
    const many = Array.from({ length: FC008_SAFETY_CAPS.maxCandidateControlsPerScan + 5 }, () =>
      candidate(),
    );
    const result = extractObservationSemantics(
      surface({ candidates: many, targetIndex: FC008_SAFETY_CAPS.maxCandidateControlsPerScan + 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("candidate-limit-exceeded");
    }
  });

  it("refuses when sanitization leaves no semantic token at all", () => {
    // Emitting empty semantics would look like a successful observation of an empty
    // surface, which is a different claim from "this could not be observed safely".
    const result = extractObservationSemantics(
      surface({
        headings: [],
        stateSignals: [],
        candidates: [
          candidate({ ownText: nameLikeText("Q3 Reorganisation Plan"), accessibleName: null }),
          candidate({ ownText: nameLikeText("Hanna Lindqvist") }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("no-retained-semantic-tokens");
    }
  });
});

describe("hard bounds", () => {
  it("never exceeds the per-channel token cap", () => {
    const flood = Array.from({ length: FC008_SAFETY_CAPS.maxNearbyLabels }, (_, i) =>
      semanticText(Array.from({ length: 30 }, (_, j) => `word${i}x${j}`).join(" ")),
    );
    const result = extractObservationSemantics(
      surface({ candidates: [candidate({ nearbyLabels: flood }), candidate()] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const channel of TOKEN_CHANNELS) {
      const count = result.semantics.tokens.filter((token) => token.channel === channel).length;
      expect(count, channel).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxTokensPerChannel);
    }
  });

  it("never exceeds the total token budget and reports the overflow", () => {
    const flood = Array.from({ length: FC008_SAFETY_CAPS.maxNearbyLabels }, (_, i) =>
      semanticText(Array.from({ length: 40 }, (_, j) => `alpha${i}b${j}`).join(" ")),
    );
    const result = extractObservationSemantics(
      surface({
        headings: Array.from({ length: FC008_SAFETY_CAPS.maxHeadingsPerSurface }, (_, i) =>
          semanticText(`heading ${i} with several distinct words here`),
        ),
        candidates: [candidate({ nearbyLabels: flood }), candidate()],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.semantics.tokens.length).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxTotalTokens);
    const diagnostics = result.diagnostics;
    expect(
      diagnostics.channelOverflowTokenCount + diagnostics.totalBudgetOverflowTokenCount,
    ).toBeGreaterThan(0);
  });

  it("caps headings and nearby labels and counts what it skipped", () => {
    const result = extractObservationSemantics(
      surface({
        headings: Array.from({ length: FC008_SAFETY_CAPS.maxHeadingsPerSurface + 4 }, (_, i) =>
          semanticText(`section heading ${i}`),
        ),
        candidates: [
          candidate({
            nearbyLabels: Array.from({ length: FC008_SAFETY_CAPS.maxNearbyLabels + 6 }, (_, i) =>
              semanticText(`context label ${i}`),
            ),
          }),
          candidate(),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.semantics.structuralCounts.headingCount).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxHeadingsPerSurface,
    );
    expect(result.semantics.structuralCounts.nearbyLabelCount).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxNearbyLabels,
    );
    expect(result.diagnostics.skippedHeadingCount).toBe(4);
    expect(result.diagnostics.skippedNearbyLabelCount).toBe(6);
  });

  it("counts headings and nearby labels as fields, not as tokens", () => {
    // These bounds are structural caps on how much of the surface may be read. A
    // single heading can legitimately normalize to many tokens, so counting tokens
    // here would report a cap breach for a surface that is well within every bound.
    const result = extractObservationSemantics(
      surface({
        headings: [semanticText("one heading that contains quite a few separate words")],
        candidates: [
          candidate({
            nearbyLabels: [semanticText("a single label with several words in it")],
          }),
          candidate(),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.semantics.structuralCounts.headingCount).toBe(1);
      expect(result.semantics.structuralCounts.nearbyLabelCount).toBe(1);
      expect(
        result.semantics.tokens.filter((token) => token.channel === "hd").length,
      ).toBeGreaterThan(1);
    }
  });

  it("caps traversal depth", () => {
    const result = extractObservationSemantics(
      surface({ candidates: [candidate({ ancestorDepth: 999 }), candidate()] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.semantics.structuralCounts.surfaceDepth).toBeLessThanOrEqual(
        FC008_SAFETY_CAPS.maxTraversalDepth,
      );
    }
  });

  it("truncates an over-long string rather than storing it", () => {
    const result = extractObservationSemantics(
      surface({
        candidates: [
          candidate({
            ownText: semanticText(`Delete ${"verylongword ".repeat(200)}`),
          }),
          candidate(),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.semantics.tokens.length).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxTotalTokens);
      for (const token of result.semantics.tokens) {
        expect(token.value.length).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxLabelChars);
      }
    }
  });
});

describe("state channel", () => {
  it("keeps the property-scoped form in stateTokens only", () => {
    const result = extractObservationSemantics(
      surface({ stateSignals: [{ property: "visibility", value: "private" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.semantics.stateTokens).toContain("visibility:private");
    for (const stateToken of result.semantics.stateTokens) {
      expect(stateToken).toMatch(STATE_TOKEN_REGEX);
    }
    // Every entry in `tokens` must satisfy the normalized grammar, which has no
    // colon, so the scoped form cannot live there.
    for (const token of result.semantics.tokens) {
      expect(token.value).not.toContain(":");
    }
  });

  it("puts the value on the state channel but not the property name", () => {
    // Emitting the property would scatter the canonical transition vocabulary into
    // free text, which is the shape of generator self-leakage the dataset audits
    // look for, and the scoped state token already encodes it unambiguously.
    const result = extractObservationSemantics(
      surface({ stateSignals: [{ property: "container", value: "source" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const stateChannel = result.semantics.tokens
      .filter((token) => token.channel === "st")
      .map((token) => token.value);
    expect(stateChannel).toContain("source");
    expect(stateChannel).not.toContain("container");
  });

  it("skips a state signal naming a property outside the frozen set", () => {
    const result = extractObservationSemantics(
      surface({
        stateSignals: [
          { property: "existence", value: "present" },
          { property: "archive-state", value: "active" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.semantics.stateTokens).toEqual(["existence:present"]);
    expect(result.diagnostics.skippedStateSignalCount).toBe(1);
    for (const stateToken of result.semantics.stateTokens) {
      const property = stateToken.split(":")[0] as string;
      expect(SUPPORTED_TRANSITION_PROPERTIES).toContain(property);
    }
  });

  it("caps the number of state tokens", () => {
    const signals = Array.from({ length: FC008_SAFETY_CAPS.maxStateTokens + 5 }, (_, i) => ({
      property: "existence",
      value: `value${i}`,
    }));
    const result = extractObservationSemantics(surface({ stateSignals: signals }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.semantics.stateTokens.length).toBeLessThanOrEqual(
        FC008_SAFETY_CAPS.maxStateTokens,
      );
    }
  });
});

describe("forbidden capture", () => {
  it("names the raw surface keys that must never exist", () => {
    const forbidden = new Set(RAW_SURFACE_FORBIDDEN_KEYS);
    for (const key of [
      "url",
      "hostname",
      "selector",
      "xpath",
      "screenshot",
      "clipboard",
      "axTree",
      "timestamp",
      "objectLabel",
      "fixtureId",
      "oracleClass",
      "groundTruth",
    ]) {
      expect(forbidden.has(key as never), key).toBe(true);
    }
  });

  it("emits semantics containing none of the forbidden keys", () => {
    const result = extractObservationSemantics(surface());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const serialized = JSON.stringify(result.semantics);
    for (const key of RAW_SURFACE_FORBIDDEN_KEYS) {
      expect(serialized, `semantics mentions ${key}`).not.toContain(`"${key}"`);
    }
  });

  it("produces semantics the frozen Sprint-1 validator accepts", () => {
    // The extractor does not get its own notion of validity. Everything it emits
    // goes through the same validator the runtime uses.
    const result = extractObservationSemantics(surface());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const issues = validateActionObservation({
      observationId: "obs-extract-0001",
      semantics: result.semantics,
    } as never);
    // The partial object is invalid for missing layers, but never for a semantics
    // defect, which is the part under test here.
    const semanticsIssues = issues.valid
      ? []
      : issues.issues.filter((issue) => issue.path.startsWith("observation.semantics"));
    expect(semanticsIssues).toEqual([]);
  });
});

describe("determinism", () => {
  it("extracts identical semantics from identical input", () => {
    const first = extractObservationSemantics(surface());
    const second = extractObservationSemantics(surface());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not depend on which control index the target happens to be", () => {
    // The same control, reached at two positions, must produce the same semantics.
    // If position mattered, the model would be reading layout rather than meaning.
    const target = candidate({
      ownText: semanticText("Delete file"),
      destructiveStyle: true,
    });
    const other = candidate({ ownText: semanticText("Cancel") });
    const first = extractObservationSemantics(
      surface({ candidates: [target, other], targetIndex: 0 }),
    );
    const second = extractObservationSemantics(
      surface({ candidates: [other, target], targetIndex: 1 }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      const strip = (value: unknown) => JSON.stringify(value);
      expect(strip(first.semantics.tokens.filter((t) => t.channel === "ctl"))).toBe(
        strip(second.semantics.tokens.filter((t) => t.channel === "ctl")),
      );
      expect(first.semantics.destructiveStyle).toBe(second.semantics.destructiveStyle);
    }
  });
});
