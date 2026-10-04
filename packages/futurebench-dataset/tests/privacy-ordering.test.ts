/**
 * AI-4: sanitization happens before anything else can observe the text.
 *
 * The ordering claim is that raw extracted strings reach the sanitizer and nothing
 * else — not the fingerprint, not the projector, not serialization, not a log, and
 * not a benchmark record. These tests feed genuinely secret-shaped material through
 * the real pipeline and then search the ENTIRE serialized output for it, rather than
 * checking the fields where a leak was expected. A leak that only shows up in a
 * field nobody thought to assert on is the leak that ships.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FC008_FEATURE_POLICY,
  FC008_FEATURE_POLICY_VERSION,
  extractObservationSemantics,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import {
  control,
  hiddenValueText,
  nameLikeText,
  passwordText,
  semanticText,
  state,
  surfaceSnapshot,
  userEnteredText,
} from "../src/authoring.js";
import { canonicalRecordText } from "../src/record.js";
import { buildDataset } from "../src/dataset.js";
import { FAMILY_A } from "../src/apps/family-a.js";
import { buildTestObservation } from "./helpers.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";

/** Material that must never survive, with the shape each one tests. */
const SECRETS = Object.freeze([
  "ada.lovelace@internal.example.org",
  "https://admin.example.com/secret/panel",
  "/Users/venky/private/keys/id_rsa",
  "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "sk_live_51HxQpZm2Lw8Rt3VbNcXy",
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "AKIAIOSFODNN7EXAMPLE",
  "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
]);

function surfaceCarrying(secret: string) {
  return surfaceSnapshot({
    surfaceKind: "modal-dialog",
    headings: [semanticText("Delete this file?"), semanticText(secret)],
    stateSignals: [state("existence", "present")],
    objectKindEvidence: ["file"],
    candidates: [
      control({
        ownText: semanticText("Delete file"),
        accessibleName: semanticText(`Delete file ${secret}`),
        interactionKind: "confirm",
        destructiveStyle: true,
        nearbyLabels: [semanticText(secret), nameLikeText(secret), userEnteredText(secret)],
      }),
      control({ ownText: semanticText("Cancel"), interactionKind: "dismiss" }),
    ],
  });
}

function buildObservation(secret: string) {
  return buildTestObservation(surfaceCarrying(secret), {
    observationId: "obs-privacy-0001",
  });
}

describe("secret-shaped material does not reach the semantics", () => {
  for (const secret of SECRETS) {
    it(`drops ${secret.slice(0, 22)}...`, () => {
      const result = extractObservationSemantics(surfaceCarrying(secret));
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(JSON.stringify(result)).not.toContain(secret);

      // Fragments are scanned against the SEMANTICS rather than the whole result.
      // Normalization splits on separators, so a UUID that went unrecognized before
      // splitting would arrive as several innocuous-looking hex pieces and be
      // retained as vocabulary — that is the failure this catches.
      //
      // The diagnostics are excluded on purpose, not for convenience: the redaction
      // report is required to name the reason category it acted on, and one of those
      // categories is literally "authorization-bearer". A category name describes
      // what was removed and carries no part of the removed value, so matching
      // fragments against it would fail the test for doing the right thing.
      const semantics = JSON.stringify(result.semantics);
      for (const fragment of secret.split(/[^A-Za-z0-9]+/).filter((part) => part.length >= 6)) {
        expect(semantics, `fragment ${fragment} survived`).not.toContain(fragment.toLowerCase());
      }
    });
  }
});

describe("the redaction report carries categories, never values", () => {
  it("reports what was removed without reproducing any of it", () => {
    const secret = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const result = extractObservationSemantics(surfaceCarrying(secret));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // It must say that it found a credential.
    expect(result.diagnostics.redactionReasons).toContain("authorization-bearer");
    expect(result.redaction.credentialPatternDetected).toBe(true);
    // And it must not reproduce the credential while saying so. The payload is the
    // part that matters; the word "Bearer" is the category name.
    const serialized = JSON.stringify({
      report: result.redaction,
      diagnostics: result.diagnostics,
    });
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(serialized).not.toContain("eyjhbGci".toLowerCase());
  });
});

describe("non-semantic field origins are dropped wholesale", () => {
  it("retains nothing from user-entered, hidden, or password slots", () => {
    const marker = "zzqwmarkerzz";
    const result = extractObservationSemantics(
      surfaceSnapshot({
        headings: [semanticText("Share settings")],
        stateSignals: [state("access", "private")],
        objectKindEvidence: ["file"],
        candidates: [
          control({
            ownText: semanticText("Share file"),
            nearbyLabels: [
              userEnteredText(`${marker}typed`),
              hiddenValueText(`${marker}hidden`),
              passwordText(`${marker}password`),
            ],
          }),
          control({ ownText: semanticText("Cancel") }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result)).not.toContain(marker);
    }
  });
});

describe("the fingerprint is computed from sanitized semantics only", () => {
  it("produces the same fingerprint whatever secret the surface carried", () => {
    // Two surfaces identical except for the secret they embed. If the fingerprint
    // were taken before sanitization, these would differ — so equality here is
    // positive evidence of the ordering, not merely the absence of a leak.
    const first = buildObservation(SECRETS[0] as string);
    const second = buildObservation(SECRETS[4] as string);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
  });

  it("computes the fingerprint nowhere except after sanitization", () => {
    // Source-level: exactly one call site, and it is inside the assembly function
    // that can only reach sanitized output.
    const here = dirname(fileURLToPath(import.meta.url));
    const extraction = readFileSync(
      join(here, "..", "..", "action-understanding", "src", "extraction.ts"),
      "utf8",
    );
    const callSites = extraction.match(/computeObservationInputFingerprint\(/g) ?? [];
    expect(callSites.length).toBe(1);
    const sanitizeIndex = extraction.indexOf("sanitizeFields(");
    const fingerprintIndex = extraction.indexOf("computeObservationInputFingerprint(");
    expect(sanitizeIndex).toBeGreaterThan(-1);
    expect(fingerprintIndex).toBeGreaterThan(sanitizeIndex);
  });
});

describe("projected features carry no secret", () => {
  it("names no feature containing secret material", () => {
    const observation = buildObservation(SECRETS[2] as string);
    const vocabulary = {
      vocabularyVersion: "test-vocab",
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      size: 0,
      entries: new Map<string, number>(),
    };
    const projection = projectPrimaryFeatures(
      observation.semantics,
      vocabulary,
      FC008_FEATURE_POLICY,
    );
    expect(JSON.stringify(projection)).not.toContain("id_rsa");
    expect(JSON.stringify(projection)).not.toContain("Users");
  });
});

describe("no secret reaches a benchmark record", () => {
  it("serializes the whole dataset without any secret-shaped material", () => {
    // The end-to-end assertion. Family A's variant set deliberately injects
    // secret-like strings onto surfaces, so this searches the real corpus rather
    // than a purpose-built fixture.
    const built = buildDataset({
      families: FUTUREBENCH_FAMILIES,
      outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const corpus = built.records.map(canonicalRecordText).join("\n");
    for (const needle of [
      "ops.team@example.com",
      "sk_live_",
      "Bearer ",
      "internal.example.com",
      "exports/2026/archive.zip",
      "@example.com",
      "https://",
    ]) {
      expect(corpus, `record corpus contains ${needle}`).not.toContain(needle);
    }
  });

  it("keeps private-name-like text out of the records", () => {
    const built = buildDataset({
      families: FUTUREBENCH_FAMILIES,
      outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const corpus = built.records.map(canonicalRecordText).join("\n").toLowerCase();
    for (const needle of ["lindqvist", "bluefin", "oyelaran", "quarterly-costs", "sediment"]) {
      expect(corpus, `record corpus contains ${needle}`).not.toContain(needle);
    }
  });
});
