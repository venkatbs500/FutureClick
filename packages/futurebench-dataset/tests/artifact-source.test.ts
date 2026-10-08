/**
 * FC-008 Sprint 4A — the Node loader and its trust root.
 *
 * The counterpart to `action-understanding/tests/inference-artifact-load.test.ts`,
 * which covers the pure parsing and refusal logic. What is proven HERE is the
 * part that needs a filesystem and a hash function: that the manifest is
 * anchored to a constant in TypeScript source rather than to anything in the
 * artifact directory, and that every artifact's identity is established by its
 * BYTES rather than by its filename.
 *
 * These tests live in this package because `action-understanding/src` is
 * required to be free of Node builtins, so the loader they exercise cannot live
 * there. Nothing here writes to `research/futurebench/artifacts/`; every
 * negative case is built from an in-memory value.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArtifactLoadError, type ArtifactLoadRefusal } from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ARTIFACT_DIRECTORY,
  CANONICAL_ARTIFACT_MANIFEST_PATH,
  FROZEN_FC008_ARTIFACT_MANIFEST_SHA256,
  MAX_ARTIFACT_BYTES,
  type ManifestArtifactEntry,
  type VerifiedArtifactManifest,
  loadFrozenArtifacts,
  loadManifestArtifact,
  loadVerifiedArtifactManifest,
  sha256OfBytes,
} from "../src/artifact-source.js";

// ============================================================================
// REFUSAL HARNESS
// ============================================================================

/**
 * Asserts that `action` refuses with exactly `refusal`.
 *
 * Returns the error so a caller can additionally inspect the reported path when
 * the location of the refusal is itself the point.
 */
function expectRefusal(action: () => unknown, refusal: ArtifactLoadRefusal): ArtifactLoadError {
  let caught: unknown;
  let threw = false;
  try {
    action();
  } catch (error) {
    threw = true;
    caught = error;
  }
  if (!threw) {
    throw new Error(`expected refusal ${refusal}, but the call returned normally`);
  }
  if (!(caught instanceof ArtifactLoadError)) {
    throw new Error(
      `expected an ArtifactLoadError with refusal ${refusal}, received ${String(caught)}`,
    );
  }
  expect(caught.refusal, caught.message).toBe(refusal);
  return caught;
}

/** Frozen SHA-256 values, restated here so a test cannot be satisfied by a recomputation. */
const FROZEN_SHA256 = Object.freeze({
  jointModel: "d30aceb684901bf42b8267719dc20e5319ef35b8603eb7781f50ce486c9d4194",
  jointCalibration: "5d5d99b6f085501de1f83371b3cae08117f8b281b0babc5bf6ae0eb96b1fe8b5",
  jointPolicy: "b3ea74e93bc311fd1025857db8dc6d715e188e7f7dbfbd2d6d377bf3f9b3ecb7",
  factorizedModel: "b2713475a86cd52d6703acbdacae7bb49814b77f1277f4021038cb5f53dbdb8f",
  factorizedCalibration: "9c985d623d29042cd5b7112c9edec80db786e056ac38a056294b1347924de359",
  factorizedPolicy: "89609abe1930e31268e14365d764ec95a6723e869fee6d975ebbf8ac014276c0",
  manifest: "51879c7724ec28585e7802efcc9efe0c5a03222f9ba4105c0516f9094db92595",
});

/** A syntactically valid SHA-256 that is not any real artifact's hash. */
const UNRELATED_SHA256 = "0".repeat(64);

// ============================================================================
// THE NODE LOADER AND ITS TRUST ROOT
// ============================================================================

describe("the verified manifest is anchored outside the artifact directory", () => {
  const manifest = loadVerifiedArtifactManifest();

  it("hashes to the frozen anchor constant", () => {
    expect(manifest.manifestSha256).toBe(FROZEN_FC008_ARTIFACT_MANIFEST_SHA256);
    expect(manifest.manifestSha256).toBe(FROZEN_SHA256.manifest);
  });

  it("recomputes the same hash from the real manifest bytes", () => {
    const bytes = readFileSync(CANONICAL_ARTIFACT_MANIFEST_PATH);
    expect(sha256OfBytes(bytes)).toBe(FROZEN_FC008_ARTIFACT_MANIFEST_SHA256);
  });

  it("does not contain its own anchor, so it cannot self-declare trust", () => {
    // The whole point of the anchor is that it lives in TypeScript source. If the
    // value appeared inside the manifest, a substituted manifest could carry a
    // matching self-claim and the hash comparison would be circular.
    const text = readFileSync(CANONICAL_ARTIFACT_MANIFEST_PATH, "utf8");
    expect(text).not.toContain(FROZEN_FC008_ARTIFACT_MANIFEST_SHA256);
  });

  it("records a byteLength and sha256 that match every real file on disk", () => {
    expect(manifest.entries.size).toBeGreaterThan(0);
    for (const entry of manifest.entries.values()) {
      const bytes = readFileSync(join(CANONICAL_ARTIFACT_DIRECTORY, entry.fileName));
      expect(bytes.byteLength, entry.fileName).toBe(entry.byteLength);
      expect(sha256OfBytes(bytes), entry.fileName).toBe(entry.sha256);
    }
  });

  it("keeps every artifact under the frozen byte ceiling", () => {
    for (const entry of manifest.entries.values()) {
      expect(entry.byteLength, entry.fileName).toBeLessThan(MAX_ARTIFACT_BYTES);
      const bytes = readFileSync(join(CANONICAL_ARTIFACT_DIRECTORY, entry.fileName));
      expect(bytes.byteLength, entry.fileName).toBeLessThan(MAX_ARTIFACT_BYTES);
    }
  });

  it("refuses a name it does not carry", () => {
    const error = expectRefusal(
      () => loadManifestArtifact(manifest, "no-such-artifact"),
      "field-missing",
    );
    expect(error.path).toBe("manifest.artifacts.no-such-artifact");
  });
});

describe("loading the frozen set proves every artifact by its bytes", () => {
  const frozen = loadFrozenArtifacts();

  it("returns the frozen joint hashes", () => {
    expect(frozen.joint.modelSha256).toBe(FROZEN_SHA256.jointModel);
    expect(frozen.joint.calibrationSha256).toBe(FROZEN_SHA256.jointCalibration);
    expect(frozen.joint.policySha256).toBe(FROZEN_SHA256.jointPolicy);
  });

  it("returns the frozen factorized hashes", () => {
    expect(frozen.factorized.modelSha256).toBe(FROZEN_SHA256.factorizedModel);
    expect(frozen.factorized.calibrationSha256).toBe(FROZEN_SHA256.factorizedCalibration);
    expect(frozen.factorized.policySha256).toBe(FROZEN_SHA256.factorizedPolicy);
  });

  it("returns parsed artifacts whose identities equal the verified manifest", () => {
    for (const bundle of [frozen.joint, frozen.factorized]) {
      expect(bundle.model.identity.datasetHash).toBe(frozen.manifest.datasetHash);
      expect(bundle.model.identity.vocabularyHash).toBe(frozen.manifest.vocabularyHash);
      expect(bundle.model.identity.supportMatrixVersion).toBe(frozen.manifest.supportMatrixVersion);
      expect(bundle.model.identity.featurePolicyVersion).toBe(frozen.manifest.featurePolicyVersion);
    }
  });
});

// ============================================================================
// THE BYTE COMPARISON ITSELF
// ============================================================================

/**
 * A copy of a verified manifest with one entry's recorded identity changed.
 *
 * This is what makes the byte-comparison branch reachable WITHOUT touching
 * anything in `research/futurebench/artifacts/`. `loadManifestArtifact` takes a
 * `VerifiedArtifactManifest` as a VALUE, so disagreeing with the real file can
 * be arranged from the manifest side instead of the file side: the loader still
 * reads the genuine, unmodified bytes off disk, hashes them for real, and then
 * compares against a record that no longer matches. Corrupting the file would
 * reach the same branch and would also destroy frozen evidence, which is why
 * these tests are shaped this way rather than as a temporary-file fixture.
 */
function manifestWithEntryOverride(
  manifest: VerifiedArtifactManifest,
  name: string,
  override: Partial<ManifestArtifactEntry>,
): { manifest: VerifiedArtifactManifest; entry: ManifestArtifactEntry } {
  const entry = manifest.entries.get(name);
  if (entry === undefined) {
    throw new Error(`fixture expected a manifest entry named ${name}`);
  }
  const entries = new Map(manifest.entries);
  entries.set(name, Object.freeze({ ...entry, ...override }));
  return { manifest: Object.freeze({ ...manifest, entries }), entry };
}

describe("a manifest entry that disagrees with the bytes on disk is refused", () => {
  const verified = loadVerifiedArtifactManifest();

  it("refuses an artifact whose recorded sha256 is not what its bytes hash to", () => {
    const { manifest, entry } = manifestWithEntryOverride(verified, "joint-logistic-model", {
      sha256: UNRELATED_SHA256,
    });
    const error = expectRefusal(
      () => loadManifestArtifact(manifest, "joint-logistic-model"),
      "hash-mismatch",
    );
    // The reported path is the file whose bytes were actually read and hashed.
    expect(error.path).toBe(join(CANONICAL_ARTIFACT_DIRECTORY, entry.fileName));
    expect(error.message).toContain(FROZEN_SHA256.jointModel);
    expect(error.message).toContain(UNRELATED_SHA256);
  });

  it("refuses an artifact whose recorded byteLength is not its real size", () => {
    // The sha256 is left correct on purpose. The hash is compared first, so a
    // fixture that changed both would only ever observe `hash-mismatch` and the
    // byteLength check would never be exercised.
    const { manifest, entry } = manifestWithEntryOverride(verified, "joint-logistic-model", {
      byteLength: 1,
    });
    const error = expectRefusal(
      () => loadManifestArtifact(manifest, "joint-logistic-model"),
      "shape-mismatch",
    );
    expect(error.path).toBe(join(CANONICAL_ARTIFACT_DIRECTORY, entry.fileName));
    expect(error.message).toContain(`${entry.byteLength} bytes`);
  });
});
