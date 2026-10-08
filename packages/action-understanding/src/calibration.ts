/**
 * FC-008 Sprint 5A — runtime-owned temperature calibration.
 *
 * Providers return raw logits. This module turns those logits into a
 * calibrated 13-class distribution. Temperature is applied only after
 * factorized composition has already produced the 13 tuple logits.
 */

import type { Fc008ModelFamily } from "./hypothesis.js";
import { applyTemperature, stableSoftmax } from "./inference/scoring.js";
import type { ArtifactDescriptor } from "./provider.js";
import type { CalibratedScores, CalibrationOutcome, ScoreCalibrator } from "./runtime.js";
import { FC008_SUPPORTED_TUPLE_COUNT } from "./support-matrix.js";

export const TEMPERATURE_CALIBRATOR_ID = "fc008-temperature-calibrator" as const;

export interface TemperatureCalibratorOptions {
  readonly temperature: number;
  readonly artifact: ArtifactDescriptor;
}

/**
 * Create a calibrator bound to one frozen artifact identity and temperature.
 *
 * The temperature must already have been selected on the calibration
 * partition. This function does not fit, search, or retune.
 */
export function createTemperatureCalibrator(
  options: TemperatureCalibratorOptions,
): ScoreCalibrator {
  const { temperature, artifact } = options;
  return Object.freeze({
    calibratorId: TEMPERATURE_CALIBRATOR_ID,
    calibrate(logits: readonly number[], family: Fc008ModelFamily): CalibrationOutcome {
      if (family !== artifact.modelFamily) {
        return Object.freeze({ status: "error" as const, detail: "family-mismatch" });
      }
      if (logits.length !== FC008_SUPPORTED_TUPLE_COUNT) {
        return Object.freeze({ status: "error" as const, detail: "class-count-mismatch" });
      }
      try {
        const scaled = applyTemperature(logits, temperature);
        const probabilities = stableSoftmax(scaled);
        let uncalibratedMax = Number.NEGATIVE_INFINITY;
        const uncalibrated = stableSoftmax(logits);
        for (const value of uncalibrated) {
          if (value > uncalibratedMax) {
            uncalibratedMax = value;
          }
        }
        const scores: CalibratedScores = Object.freeze({
          probabilities,
          uncalibratedMaxProbability: uncalibratedMax,
          temperature,
          calibrationArtifactVersion: artifact.calibrationArtifactVersion,
          unsupportedCombinationMass: 0,
          calibratedForModelFamily: artifact.modelFamily,
          calibratedForModelVersion: artifact.modelVersion,
          calibratedForArtifactSha256: artifact.artifactSha256,
          calibratedForSupportMatrixVersion: artifact.supportMatrixVersion,
          calibratedForFeaturePolicyVersion: artifact.featurePolicyVersion,
        });
        return Object.freeze({ status: "calibrated" as const, scores });
      } catch {
        return Object.freeze({ status: "error" as const, detail: "calibration-failed" });
      }
    },
  });
}
