/**
 * FC-008 Sprint 5B — browser-safe artifact source.
 *
 * Artifacts are already-parsed JSON. This module never reads the filesystem,
 * never fetches, and never talks to Python. Byte SHA-256 of the frozen files is
 * attested by the caller (build/test) because SubtleCrypto is asynchronous and
 * this package must stay synchronous. Runtime identity is still enforced by
 * `parseArtifactBundle` (schema, versions, cross-artifact hashes, class order).
 */

import type { Fc008ModelFamily } from "./hypothesis.js";
import {
  type ArtifactBundle,
  type ArtifactBundleInput,
  parseArtifactBundle,
} from "./inference/artifact.js";

export const BROWSER_ARTIFACT_SOURCE_ID = "fc008-browser-artifact-source" as const;

export const BROWSER_ARTIFACT_IDENTITY_LAYERS = Object.freeze({
  buildTimeByteSha256: "caller-attested-frozen-file-sha256",
  runtimeSchemaAndCrossArtifact: "parseArtifactBundle",
} as const);

/**
 * Parse one already-loaded family bundle for browser use.
 *
 * `modelSha256` / `calibrationSha256` / `policySha256` must be the frozen
 * Sprint-3 file hashes. This function does not recompute them.
 */
export function createBrowserArtifactBundle(input: ArtifactBundleInput): ArtifactBundle {
  return parseArtifactBundle(input);
}

export function isRecognizedBrowserFamily(value: unknown): value is Fc008ModelFamily {
  return value === "joint-logistic" || value === "factorized-logistic";
}
