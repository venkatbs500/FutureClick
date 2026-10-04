/**
 * Shared test fixtures.
 *
 * `buildObservationFromSurface` deliberately returns an unvalidated payload rather
 * than a typed `ActionObservation`, so that the only way to obtain one is through
 * `validateActionObservation`. Constructing an observation that bypassed the
 * validator would create a second admission path, and a test helper that cast its
 * way past it would be the first user of that path. So this helper validates, and
 * throws if the fixture is malformed — a broken fixture should fail loudly at setup
 * rather than quietly weaken whatever assertion follows.
 */

import {
  type ActionObservation,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
  type RawSurface,
  buildObservationFromSurface,
  validateActionObservation,
} from "@futureclick/action-understanding";

export interface TestObservationOptions {
  readonly observationId?: string;
  readonly observationSequence?: number;
  readonly applicationFamilyId?: string;
  readonly templateLineageId?: string;
  readonly scenarioId?: string;
}

/** A validated observation built from one raw surface. */
export function buildTestObservation(
  surface: RawSurface,
  options: TestObservationOptions = {},
): ActionObservation {
  const assembled = buildObservationFromSurface({
    surface,
    acquisition: {
      actor: { kind: "human" },
      platform: "web",
      environmentKind: "browser",
      localeTag: "en-US",
      topFrame: true,
      acquisitionAuthorized: true,
    },
    benchmark: {
      applicationFamilyId: options.applicationFamilyId ?? "family-test",
      templateLineageId: options.templateLineageId ?? "lineage-test",
      wordingVariantId: "w0",
      layoutVariantId: "l0",
      scenarioId: options.scenarioId ?? "scenario-test",
      generatorVersion: "fb-gen-1-0",
    },
    freshness: {
      epoch: 1,
      observationSequence: options.observationSequence ?? 1,
      // A fixed instant: a real capture time would make every fixture hash differ
      // from run to run, and capture time is not what any of these tests are about.
      capturedAt: "2026-01-01T00:00:00.000Z" as ActionObservation["freshness"]["capturedAt"],
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      abstentionPolicyVersion: "1.0",
    },
    observationId: options.observationId ?? "obs-fixture-0001",
  });
  if (!assembled.ok) {
    throw new Error(`fixture surface was refused by the extractor: ${assembled.refusal}`);
  }
  const validated = validateActionObservation(assembled.observation);
  if (!validated.valid) {
    throw new Error(
      `fixture observation failed validation: ${validated.issues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(", ")}`,
    );
  }
  return validated.value;
}
