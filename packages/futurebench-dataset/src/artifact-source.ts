/**
 * FC-008 Sprint 4A — reading frozen artifacts from disk and proving their bytes.
 *
 * WHY THIS LIVES IN `futurebench-dataset` AND NOT IN `action-understanding`
 *
 * Reading bytes and hashing them needs `node:fs` and `node:crypto`, and
 * `action-understanding/src` is required to contain NO Node builtin, no bare
 * builtin, and no absolute import path at all. That requirement is not a
 * convention: `action-understanding/tests/isolation.test.ts` scans every file
 * under that package's `src/` and fails on the first such import, so a browser
 * bundle importing `@futureclick/action-understanding` can never pull a
 * filesystem or crypto polyfill in.
 *
 * This package is the Node-only offline research side, and it already depends on
 * `@futureclick/action-understanding`, so the loader can sit here and import the
 * pure parsing and validation it needs. The dependency runs one way only — the
 * runtime package must never import this one — which is what keeps the split a
 * structural fact rather than a rule someone has to remember.
 *
 * The pure parsing and numerics in `action-understanding`'s `inference/artifact.ts`
 * and `inference/scoring.ts` are what the runtime path uses; those are
 * environment-independent and take already-decoded values.
 *
 * TRUST ROOT
 *
 * Artifact identity is established by BYTES, never by filename. The chain is:
 *
 *   1. `FROZEN_FC008_ARTIFACT_MANIFEST_SHA256`, a constant in this source file,
 *      is the anchor. It is not read from any artifact, so nothing in the
 *      artifact directory can assert its own trustworthiness.
 *   2. The manifest is read from a path anchored to this module's own location,
 *      not from a caller-supplied path and not from `process.cwd()`. A caller
 *      therefore has no parameter through which it could redirect the trust root.
 *   3. The manifest's bytes are hashed and compared to the anchor. A substituted
 *      or edited manifest fails here.
 *   4. Each artifact is read by its manifest entry, hashed, and compared to the
 *      hash the verified manifest records. A swapped file fails even if it is
 *      individually well-formed.
 *   5. `parseArtifactBundle` then checks that the calibration and policy bodies
 *      reference exactly those model and calibration hashes.
 *
 * This mirrors the Python trust root in `unlock.py` on purpose, so the two
 * implementations agree about what "the frozen artifacts" means.
 *
 * TRUST BOUNDARY, STATED HONESTLY
 *
 * The anchor means a caller cannot substitute the trust root, and a swapped or
 * edited manifest or artifact is detected. It does NOT defend against an actor
 * who rewrites this source constant together with the artifacts. That is
 * repository integrity, enforced by version control and review, not an
 * in-process guarantee.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ArtifactBundle,
  ArtifactLoadError,
  type FactorizedModelArtifact,
  type Fc008ModelFamily,
  type JointModelArtifact,
  assertSharedFeatureOrder,
  parseArtifactBundle,
} from "@futureclick/action-understanding";

/**
 * SHA-256 of the frozen Sprint-3 artifact manifest.
 *
 * The external trust anchor. Changing this constant is a deliberate, reviewable
 * act; it must never be updated to match a manifest that happens to be on disk.
 */
export const FROZEN_FC008_ARTIFACT_MANIFEST_SHA256 =
  "51879c7724ec28585e7802efcc9efe0c5a03222f9ba4105c0516f9094db92595";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/**
 * The canonical artifact directory, anchored to this module.
 *
 * `src/` -> package root -> `packages/` -> repository root.
 */
export const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, "../../..");

export const CANONICAL_ARTIFACT_DIRECTORY = join(
  REPOSITORY_ROOT,
  "research",
  "futurebench",
  "artifacts",
);

export const CANONICAL_ARTIFACT_MANIFEST_PATH = join(
  CANONICAL_ARTIFACT_DIRECTORY,
  "fc008-artifact-manifest.json",
);

/** Frozen per-artifact byte ceiling, carried by the manifest. */
export const MAX_ARTIFACT_BYTES = 2_097_152;

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ManifestArtifactEntry {
  readonly name: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface VerifiedArtifactManifest {
  /** Hash of the manifest bytes, equal to the anchor. */
  readonly manifestSha256: string;
  readonly datasetHash: string;
  readonly vocabularyHash: string;
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
  readonly preregistrationSha256: string;
  readonly entries: ReadonlyMap<string, ManifestArtifactEntry>;
}

function readJsonFile(path: string): { bytes: Uint8Array; value: unknown } {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    throw new ArtifactLoadError(
      "field-missing",
      path,
      `artifact file could not be read (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ArtifactLoadError(
      "shape-mismatch",
      path,
      `artifact is ${bytes.byteLength} bytes, above the frozen ceiling of ${MAX_ARTIFACT_BYTES}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new ArtifactLoadError(
      "field-type-invalid",
      path,
      `artifact is not valid UTF-8 JSON (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
  return { bytes, value };
}

function requireString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ArtifactLoadError("field-missing", `${path}.${key}`, "expected a non-empty string");
  }
  return value;
}

/**
 * Read and verify the canonical artifact manifest.
 *
 * Takes no path parameter. That is the point: the trust root is not an argument.
 */
export function loadVerifiedArtifactManifest(): VerifiedArtifactManifest {
  const { bytes, value } = readJsonFile(CANONICAL_ARTIFACT_MANIFEST_PATH);
  const manifestSha256 = sha256OfBytes(bytes);
  if (manifestSha256 !== FROZEN_FC008_ARTIFACT_MANIFEST_SHA256) {
    throw new ArtifactLoadError(
      "hash-mismatch",
      CANONICAL_ARTIFACT_MANIFEST_PATH,
      `manifest hashes to ${manifestSha256}, expected the frozen ${FROZEN_FC008_ARTIFACT_MANIFEST_SHA256}`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArtifactLoadError("not-an-object", "manifest", "expected a JSON object");
  }
  const manifest = value as Record<string, unknown>;
  const rawEntries = manifest.artifacts;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new ArtifactLoadError(
      "field-missing",
      "manifest.artifacts",
      "expected a non-empty array",
    );
  }

  const entries = new Map<string, ManifestArtifactEntry>();
  for (let index = 0; index < rawEntries.length; index += 1) {
    const raw = rawEntries[index];
    const path = `manifest.artifacts[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ArtifactLoadError("not-an-object", path, "expected a JSON object");
    }
    const entry = raw as Record<string, unknown>;
    const byteLength = entry.byteLength;
    if (typeof byteLength !== "number" || !Number.isInteger(byteLength) || byteLength <= 0) {
      throw new ArtifactLoadError(
        "field-type-invalid",
        `${path}.byteLength`,
        "expected a positive integer",
      );
    }
    const name = requireString(entry, "name", path);
    if (entries.has(name)) {
      throw new ArtifactLoadError(
        "identity-mismatch",
        `${path}.name`,
        `duplicate manifest entry ${name}`,
      );
    }
    entries.set(
      name,
      Object.freeze({
        name,
        fileName: requireString(entry, "fileName", path),
        sha256: requireString(entry, "sha256", path),
        byteLength,
      }),
    );
  }

  return Object.freeze({
    manifestSha256,
    datasetHash: requireString(manifest, "datasetHash", "manifest"),
    vocabularyHash: requireString(manifest, "vocabularyHash", "manifest"),
    supportMatrixVersion: requireString(manifest, "supportMatrixVersion", "manifest"),
    featurePolicyVersion: requireString(manifest, "featurePolicyVersion", "manifest"),
    preregistrationSha256: requireString(manifest, "preregistrationSha256", "manifest"),
    entries,
  });
}

export interface LoadedArtifact {
  readonly name: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly value: unknown;
}

/**
 * Read one manifest-named artifact and prove its bytes.
 *
 * The file is located through the verified manifest entry, and the bytes are
 * hashed and compared to the hash that entry records. The filename is how the
 * file is FOUND; the hash is what establishes that it is the right one.
 */
export function loadManifestArtifact(
  manifest: VerifiedArtifactManifest,
  name: string,
): LoadedArtifact {
  const entry = manifest.entries.get(name);
  if (entry === undefined) {
    throw new ArtifactLoadError(
      "field-missing",
      `manifest.artifacts.${name}`,
      "no such manifest entry",
    );
  }
  const path = join(CANONICAL_ARTIFACT_DIRECTORY, entry.fileName);
  const { bytes, value } = readJsonFile(path);
  const sha256 = sha256OfBytes(bytes);
  if (sha256 !== entry.sha256) {
    throw new ArtifactLoadError(
      "hash-mismatch",
      path,
      `artifact hashes to ${sha256}, but the verified manifest records ${entry.sha256}`,
    );
  }
  if (bytes.byteLength !== entry.byteLength) {
    throw new ArtifactLoadError(
      "shape-mismatch",
      path,
      `artifact is ${bytes.byteLength} bytes, but the verified manifest records ${entry.byteLength}`,
    );
  }
  return Object.freeze({ name, sha256, byteLength: bytes.byteLength, value });
}

const BUNDLE_ARTIFACT_NAMES = Object.freeze({
  "joint-logistic": Object.freeze({
    model: "joint-logistic-model",
    calibration: "joint-logistic-calibration",
    policy: "joint-logistic-policy",
  }),
  "factorized-logistic": Object.freeze({
    model: "factorized-logistic-model",
    calibration: "factorized-logistic-calibration",
    policy: "factorized-logistic-policy",
  }),
});

/** Load, hash-verify, and parse one family's model, calibration, and policy. */
export function loadArtifactBundle(
  manifest: VerifiedArtifactManifest,
  modelFamily: Fc008ModelFamily,
): ArtifactBundle {
  const names = BUNDLE_ARTIFACT_NAMES[modelFamily];
  const model = loadManifestArtifact(manifest, names.model);
  const calibration = loadManifestArtifact(manifest, names.calibration);
  const policy = loadManifestArtifact(manifest, names.policy);
  return parseArtifactBundle({
    modelFamily,
    model: model.value,
    calibration: calibration.value,
    policy: policy.value,
    modelSha256: model.sha256,
    calibrationSha256: calibration.sha256,
    policySha256: policy.sha256,
  });
}

export interface FrozenArtifactSet {
  readonly manifest: VerifiedArtifactManifest;
  readonly joint: ArtifactBundle<JointModelArtifact>;
  readonly factorized: ArtifactBundle<FactorizedModelArtifact>;
  readonly goldenVectors: LoadedArtifact;
}

/**
 * Load both families plus the golden vectors, with every identity proven.
 *
 * Both families are loaded before anything is returned, so a caller cannot act
 * on one family and only then discover the other is unauthorized.
 */
export function loadFrozenArtifacts(): FrozenArtifactSet {
  const manifest = loadVerifiedArtifactManifest();
  const joint = loadArtifactBundle(
    manifest,
    "joint-logistic",
  ) as ArtifactBundle<JointModelArtifact>;
  const factorized = loadArtifactBundle(
    manifest,
    "factorized-logistic",
  ) as ArtifactBundle<FactorizedModelArtifact>;
  assertSharedFeatureOrder(joint.model, factorized.model);

  // The manifest's shared identities must equal what the artifact bodies carry,
  // so the trust anchor and the model weights describe the same research state.
  for (const [label, bundle] of [
    ["joint-logistic", joint],
    ["factorized-logistic", factorized],
  ] as const) {
    for (const key of [
      "datasetHash",
      "vocabularyHash",
      "supportMatrixVersion",
      "featurePolicyVersion",
    ] as const) {
      if (bundle.model.identity[key] !== manifest[key]) {
        throw new ArtifactLoadError(
          "identity-mismatch",
          `${label}.model.${key}`,
          `artifact carries ${bundle.model.identity[key]}, verified manifest carries ${manifest[key]}`,
        );
      }
    }
  }

  return Object.freeze({
    manifest,
    joint,
    factorized,
    goldenVectors: loadManifestArtifact(manifest, "golden-vectors"),
  });
}
