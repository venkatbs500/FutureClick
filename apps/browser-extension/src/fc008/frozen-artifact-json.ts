/**
 * FC-008 Sprint 5B — local frozen artifact payloads for the production host.
 *
 * These JSON modules are copies of the authoritative Sprint-3 artifacts. Tests
 * attest byte SHA-256 identity with research/futurebench/artifacts. The host
 * never fetches, never reads the filesystem at runtime, and never uses Python.
 */

import type { Fc008ModelFamily } from "@futureclick/action-understanding";
import type { BrowserArtifactJson } from "./bundled-source.js";
import factorizedCalibration from "./frozen/fc008-factorized-logistic-calibration.json" with {
  type: "json",
};
import factorizedModel from "./frozen/fc008-factorized-logistic-model.json" with { type: "json" };
import factorizedPolicy from "./frozen/fc008-factorized-logistic-policy.json" with { type: "json" };
import jointCalibration from "./frozen/fc008-joint-logistic-calibration.json" with { type: "json" };
import jointModel from "./frozen/fc008-joint-logistic-model.json" with { type: "json" };
import jointPolicy from "./frozen/fc008-joint-logistic-policy.json" with { type: "json" };

export function readFrozenBrowserArtifactJson(modelFamily: Fc008ModelFamily): BrowserArtifactJson {
  if (modelFamily === "joint-logistic") {
    return Object.freeze({
      modelFamily,
      model: jointModel,
      calibration: jointCalibration,
      policy: jointPolicy,
    });
  }
  return Object.freeze({
    modelFamily,
    model: factorizedModel,
    calibration: factorizedCalibration,
    policy: factorizedPolicy,
  });
}
