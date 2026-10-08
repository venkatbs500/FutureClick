/**
 * FC-008 Sprint 5B — browser artifact attestation.
 *
 * Frozen Sprint-3 file hashes. Byte SHA-256 is verified in tests / build, not
 * recomputed at inference time. Runtime still runs parseArtifactBundle.
 */

import {
  type ArtifactBundle,
  type Fc008ModelFamily,
  createBrowserArtifactBundle,
} from "@futureclick/action-understanding";

export const FROZEN_BROWSER_ARTIFACT_SHA256 = Object.freeze({
  jointModel: "d30aceb684901bf42b8267719dc20e5319ef35b8603eb7781f50ce486c9d4194",
  jointCalibration: "5d5d99b6f085501de1f83371b3cae08117f8b281b0babc5bf6ae0eb96b1fe8b5",
  jointPolicy: "b3ea74e93bc311fd1025857db8dc6d715e188e7f7dbfbd2d6d377bf3f9b3ecb7",
  factorizedModel: "b2713475a86cd52d6703acbdacae7bb49814b77f1277f4021038cb5f53dbdb8f",
  factorizedCalibration: "9c985d623d29042cd5b7112c9edec80db786e056ac38a056294b1347924de359",
  factorizedPolicy: "89609abe1930e31268e14365d764ec95a6723e869fee6d975ebbf8ac014276c0",
});

export interface BrowserArtifactJson {
  readonly modelFamily: Fc008ModelFamily;
  readonly model: unknown;
  readonly calibration: unknown;
  readonly policy: unknown;
}

export function loadBundledArtifactBundle(json: BrowserArtifactJson): ArtifactBundle {
  if (json.modelFamily === "joint-logistic") {
    return createBrowserArtifactBundle({
      modelFamily: json.modelFamily,
      model: json.model,
      calibration: json.calibration,
      policy: json.policy,
      modelSha256: FROZEN_BROWSER_ARTIFACT_SHA256.jointModel,
      calibrationSha256: FROZEN_BROWSER_ARTIFACT_SHA256.jointCalibration,
      policySha256: FROZEN_BROWSER_ARTIFACT_SHA256.jointPolicy,
    });
  }
  return createBrowserArtifactBundle({
    modelFamily: json.modelFamily,
    model: json.model,
    calibration: json.calibration,
    policy: json.policy,
    modelSha256: FROZEN_BROWSER_ARTIFACT_SHA256.factorizedModel,
    calibrationSha256: FROZEN_BROWSER_ARTIFACT_SHA256.factorizedCalibration,
    policySha256: FROZEN_BROWSER_ARTIFACT_SHA256.factorizedPolicy,
  });
}
