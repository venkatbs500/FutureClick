/**
 * FC-008 Sprint 4A — what the artifact parsers accept, and exactly what they refuse.
 *
 * PURE PARSING ONLY. Reading bytes from disk and proving their SHA-256 is a
 * Node-only concern that lives in `@futureclick/futurebench-dataset`, because
 * this package's `src/` must contain no Node builtin at all; its own loader
 * tests live beside it in `futurebench-dataset/tests/artifact-source.test.ts`.
 * What stays here is everything that turns an already-decoded JSON value into a
 * validated artifact or refuses to.
 *
 * The frozen artifacts are READ-ONLY EVIDENCE. Every rejection case below is
 * driven by a `structuredClone` deep copy mutated in memory; nothing here writes
 * to `research/futurebench/artifacts/`, and a failure means the loader is wrong,
 * not that an artifact needs regenerating.
 *
 * WHY EACH REFUSAL IS ASSERTED BY NAME
 *
 * `toThrow()` would pass even when a drifted artifact is refused for the wrong
 * reason, which is the failure mode that actually matters: a feature order that
 * silently trips the shape check instead of the order check means the order check
 * is not doing anything, and a later artifact with a valid shape and a wrong order
 * would load. `expectRefusal` therefore pins the categorical refusal, so each test
 * is evidence about one specific control rather than about "something complained".
 *
 * The mutations are also chosen to isolate a single control. The parsers evaluate
 * their fields in a fixed order (schema and family, then identity, then class
 * order, then feature order, then coefficients), so a test that corrupts two
 * things at once would only ever observe the first refusal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_LOAD_REFUSALS,
  type ArtifactBundleInput,
  ArtifactLoadError,
  type ArtifactLoadRefusal,
  FC008_ARTIFACT_SCHEMA_VERSION,
  FC008_FROZEN_CLASS_ORDER,
  FC008_FROZEN_FEATURE_COUNT,
  MAX_ABSOLUTE_COEFFICIENT,
  assertSharedFeatureOrder,
  parseArtifactBundle,
  parseCalibrationArtifact,
  parseFactorizedModelArtifact,
  parseJointModelArtifact,
  parsePolicyArtifact,
} from "../src/inference/artifact.js";

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

// ============================================================================
// READING THE REAL ARTIFACTS, ONCE
// ============================================================================

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

/**
 * The frozen artifact directory, anchored to this test file.
 *
 * Deliberately NOT `process.cwd()`: Vitest can be invoked from the repository
 * root or from the package directory, and a working-directory-relative path
 * would silently read a different tree depending on which. Anchored here
 * instead of imported from the loader, because the loader is Node-only and lives
 * in `@futureclick/futurebench-dataset`; importing it would be a dependency
 * cycle, and this package's `src/` is required to stay free of Node builtins.
 * A TEST file may use them freely — `isolation.test.ts` scans only `src/`.
 */
const ARTIFACT_DIRECTORY = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "research",
  "futurebench",
  "artifacts",
);

function readArtifactBody(fileName: string): Record<string, unknown> {
  const text = readFileSync(join(ARTIFACT_DIRECTORY, fileName), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fileName} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

const REAL = Object.freeze({
  jointModel: readArtifactBody("fc008-joint-logistic-model.json"),
  jointCalibration: readArtifactBody("fc008-joint-logistic-calibration.json"),
  jointPolicy: readArtifactBody("fc008-joint-logistic-policy.json"),
  factorizedModel: readArtifactBody("fc008-factorized-logistic-model.json"),
  factorizedCalibration: readArtifactBody("fc008-factorized-logistic-calibration.json"),
  factorizedPolicy: readArtifactBody("fc008-factorized-logistic-policy.json"),
});

type RealArtifactName = keyof typeof REAL;

/** A mutable deep copy. The only thing any rejection test is allowed to touch. */
function copyOf(name: RealArtifactName): Record<string, unknown> {
  return structuredClone(REAL[name]) as Record<string, unknown>;
}

// Navigation helpers that fail loudly. The package compiles with
// `noUncheckedIndexedAccess` and Biome forbids `!`, so a mutation that no longer
// finds its target must surface as a fixture error rather than as a silent no-op
// that would make the rejection test vacuously pass.
function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`fixture expected an object at ${key}`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`fixture expected an array at ${key}`);
  }
  return value;
}

function rowAt(rows: unknown[], index: number): unknown[] {
  const row = rows[index];
  if (!Array.isArray(row)) {
    throw new Error(`fixture expected an array row at [${index}]`);
  }
  return row;
}

function elementAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`fixture index ${index} is out of range (length ${items.length})`);
  }
  return value;
}

/** A syntactically valid SHA-256 that is not any real artifact's hash. */
const UNRELATED_SHA256 = "0".repeat(64);

function jointBundleInput(overrides: Partial<ArtifactBundleInput> = {}): ArtifactBundleInput {
  return {
    modelFamily: "joint-logistic",
    model: copyOf("jointModel"),
    calibration: copyOf("jointCalibration"),
    policy: copyOf("jointPolicy"),
    modelSha256: FROZEN_SHA256.jointModel,
    calibrationSha256: FROZEN_SHA256.jointCalibration,
    policySha256: FROZEN_SHA256.jointPolicy,
    ...overrides,
  };
}

function factorizedBundleInput(overrides: Partial<ArtifactBundleInput> = {}): ArtifactBundleInput {
  return {
    modelFamily: "factorized-logistic",
    model: copyOf("factorizedModel"),
    calibration: copyOf("factorizedCalibration"),
    policy: copyOf("factorizedPolicy"),
    modelSha256: FROZEN_SHA256.factorizedModel,
    calibrationSha256: FROZEN_SHA256.factorizedCalibration,
    policySha256: FROZEN_SHA256.factorizedPolicy,
    ...overrides,
  };
}

/** Every value that is not a JSON object, which every parser must reject first. */
const NON_OBJECT_INPUTS: readonly unknown[] = Object.freeze([null, undefined, [], 42, "string"]);

// ============================================================================
// POSITIVE CASES: THE REAL ARTIFACTS LOAD, WITH THE FROZEN SHAPE
// ============================================================================

describe("the real joint model parses at the frozen shape", () => {
  const model = parseJointModelArtifact(copyOf("jointModel"));

  it("carries 13 x 370 coefficients and 13 intercepts", () => {
    expect(model.coefficients).toHaveLength(13);
    for (const row of model.coefficients) {
      expect(row).toHaveLength(FC008_FROZEN_FEATURE_COUNT);
    }
    expect(model.intercepts).toHaveLength(13);
  });

  it("carries 370 feature names and the frozen 1..13 class order", () => {
    expect(model.featureOrder).toHaveLength(FC008_FROZEN_FEATURE_COUNT);
    expect([...model.classOrder]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect([...model.classOrder]).toEqual([...FC008_FROZEN_CLASS_ORDER]);
  });

  it("holds every coefficient finite and well inside the frozen magnitude ceiling", () => {
    const worst = Math.max(
      ...model.coefficients.flatMap((row) => row.map((value) => Math.abs(value))),
      ...model.intercepts.map((value) => Math.abs(value)),
    );
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeLessThan(MAX_ABSOLUTE_COEFFICIENT);
  });
});

describe("the real factorized model parses at the frozen head shapes", () => {
  const model = parseFactorizedModelArtifact(copyOf("factorizedModel"));

  it("carries 10 verb, 9 object-kind, and 10 transition-property rows of 370", () => {
    for (const [head, rows] of [
      [model.verb, 10],
      [model.objectKind, 9],
      [model.transitionProperty, 10],
    ] as const) {
      expect(head.coefficients, head.name).toHaveLength(rows);
      expect(head.intercepts, head.name).toHaveLength(rows);
      expect(head.classOrder, head.name).toHaveLength(rows);
      for (const row of head.coefficients) {
        expect(row).toHaveLength(FC008_FROZEN_FEATURE_COUNT);
      }
    }
  });

  it("maps composition entry i onto class i+1, positionally", () => {
    // Composition is positional, so an off-by-one here would permute the composed
    // logit vector while every individual number stayed valid.
    expect(model.classHeadIndices).toHaveLength(13);
    for (let index = 0; index < model.classHeadIndices.length; index += 1) {
      expect(elementAt(model.classHeadIndices, index).classNumber).toBe(index + 1);
    }
  });
});

describe("the real calibration artifacts parse with the frozen temperatures", () => {
  it("reports a finite positive temperature for each family", () => {
    const joint = parseCalibrationArtifact(copyOf("jointCalibration"), "joint-logistic");
    const factorized = parseCalibrationArtifact(
      copyOf("factorizedCalibration"),
      "factorized-logistic",
    );
    expect(joint.temperature).toBe(0.8035261221856173);
    expect(factorized.temperature).toBe(1.4791083881682072);
    for (const temperature of [joint.temperature, factorized.temperature]) {
      expect(Number.isFinite(temperature)).toBe(true);
      expect(temperature).toBeGreaterThan(0);
    }
  });
});

describe("the real policy artifacts parse with the frozen thresholds", () => {
  it("reports the selected threshold without acting on it", () => {
    const joint = parsePolicyArtifact(copyOf("jointPolicy"), "joint-logistic");
    const factorized = parsePolicyArtifact(copyOf("factorizedPolicy"), "factorized-logistic");
    expect(joint.selectedConfidenceThreshold).toBe(0.4);
    expect(factorized.selectedConfidenceThreshold).toBe(0.65);
  });
});

describe("the real triplets bundle for both families", () => {
  it("accepts each family with its own recorded hashes", () => {
    const joint = parseArtifactBundle(jointBundleInput());
    expect(joint.modelFamily).toBe("joint-logistic");
    expect(joint.modelSha256).toBe(FROZEN_SHA256.jointModel);
    expect(joint.calibration.modelArtifactSha256).toBe(FROZEN_SHA256.jointModel);
    expect(joint.policy.calibrationArtifactSha256).toBe(FROZEN_SHA256.jointCalibration);

    const factorized = parseArtifactBundle(factorizedBundleInput());
    expect(factorized.modelFamily).toBe("factorized-logistic");
    expect(factorized.modelSha256).toBe(FROZEN_SHA256.factorizedModel);
    expect(factorized.calibration.modelArtifactSha256).toBe(FROZEN_SHA256.factorizedModel);
    expect(factorized.policy.calibrationArtifactSha256).toBe(FROZEN_SHA256.factorizedCalibration);
  });
});

describe("the two families share one feature order", () => {
  it("agrees byte for byte, which is what RQ1's comparison assumes", () => {
    const joint = parseJointModelArtifact(copyOf("jointModel"));
    const factorized = parseFactorizedModelArtifact(copyOf("factorizedModel"));
    expect(() => {
      assertSharedFeatureOrder(joint, factorized);
    }).not.toThrow();
    expect([...joint.featureOrder]).toEqual([...factorized.featureOrder]);
  });
});

// ============================================================================
// REJECTIONS
// ============================================================================

describe("a model body from the wrong family is refused", () => {
  it("refuses the factorized body as a joint model", () => {
    expectRefusal(
      () => parseJointModelArtifact(copyOf("factorizedModel")),
      "model-family-unexpected",
    );
  });

  it("refuses the joint body as a factorized model", () => {
    expectRefusal(
      () => parseFactorizedModelArtifact(copyOf("jointModel")),
      "model-family-unexpected",
    );
  });

  it("refuses each calibration body under the other family", () => {
    expectRefusal(
      () => parseCalibrationArtifact(copyOf("jointCalibration"), "factorized-logistic"),
      "model-family-unexpected",
    );
    expectRefusal(
      () => parseCalibrationArtifact(copyOf("factorizedCalibration"), "joint-logistic"),
      "model-family-unexpected",
    );
  });

  it("refuses each policy body under the other family", () => {
    expectRefusal(
      () => parsePolicyArtifact(copyOf("jointPolicy"), "factorized-logistic"),
      "model-family-unexpected",
    );
    expectRefusal(
      () => parsePolicyArtifact(copyOf("factorizedPolicy"), "joint-logistic"),
      "model-family-unexpected",
    );
  });
});

describe("a coefficient matrix of the wrong shape is refused", () => {
  it("refuses a dropped row", () => {
    const body = copyOf("jointModel");
    body.coefficients = arrayAt(body, "coefficients").slice(0, 12);
    expectRefusal(() => parseJointModelArtifact(body), "shape-mismatch");
  });

  it("refuses a dropped column in a single row", () => {
    // Per-row, not just per-matrix: a 13-row matrix with one short row would
    // otherwise score class 12 against a truncated weight vector.
    const body = copyOf("jointModel");
    const rows = arrayAt(body, "coefficients");
    rows[4] = rowAt(rows, 4).slice(0, FC008_FROZEN_FEATURE_COUNT - 1);
    const error = expectRefusal(() => parseJointModelArtifact(body), "shape-mismatch");
    expect(error.path).toBe("jointModel.coefficients[4]");
  });

  it("refuses an extra row", () => {
    const body = copyOf("jointModel");
    const rows = arrayAt(body, "coefficients");
    rows.push(structuredClone(rowAt(rows, 0)));
    expectRefusal(() => parseJointModelArtifact(body), "shape-mismatch");
  });

  it("refuses a declared shape that disagrees with the frozen dimensions", () => {
    // The declared shape is checked against the frozen constants, not against the
    // data, so an artifact cannot declare the shape its own wrong data happens to
    // have and be believed.
    const body = copyOf("jointModel");
    objectAt(body, "shape").coefficients = [13, FC008_FROZEN_FEATURE_COUNT - 1];
    expectRefusal(() => parseJointModelArtifact(body), "shape-mismatch");

    const intercepts = copyOf("jointModel");
    objectAt(intercepts, "shape").intercepts = [12];
    expectRefusal(() => parseJointModelArtifact(intercepts), "shape-mismatch");
  });

  it("refuses a factorized head whose declared shape disagrees", () => {
    const body = copyOf("factorizedModel");
    objectAt(objectAt(body, "heads"), "verb").shape = [9, FC008_FROZEN_FEATURE_COUNT];
    expectRefusal(() => parseFactorizedModelArtifact(body), "shape-mismatch");
  });

  it("refuses a composition table of the wrong length", () => {
    const body = copyOf("factorizedModel");
    const composition = objectAt(body, "composition");
    composition.classOrderHeadIndices = arrayAt(composition, "classOrderHeadIndices").slice(0, 12);
    expectRefusal(() => parseFactorizedModelArtifact(body), "shape-mismatch");
  });
});

describe("a non-finite or non-numeric weight is refused", () => {
  // A single NaN in a 13x370 matrix would otherwise surface much later as a NaN
  // probability inside a metric, where its origin is no longer recoverable.
  for (const [label, poison] of [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["null", null],
    ["a string", "0.5"],
  ] as const) {
    it(`refuses a coefficient set to ${label}`, () => {
      const body = copyOf("jointModel");
      rowAt(arrayAt(body, "coefficients"), 3)[17] = poison;
      const error = expectRefusal(() => parseJointModelArtifact(body), "non-finite-value");
      expect(error.path).toBe("jointModel.coefficients[3][17]");
    });
  }

  it("refuses an intercept set to NaN", () => {
    const body = copyOf("jointModel");
    arrayAt(body, "intercepts")[6] = Number.NaN;
    expectRefusal(() => parseJointModelArtifact(body), "non-finite-value");
  });

  it("refuses a non-finite weight inside a factorized head", () => {
    const body = copyOf("factorizedModel");
    const verb = objectAt(objectAt(body, "heads"), "verb");
    rowAt(arrayAt(verb, "coefficients"), 0)[0] = Number.NaN;
    expectRefusal(() => parseFactorizedModelArtifact(body), "non-finite-value");
  });
});

describe("an exploded coefficient is refused", () => {
  it("refuses a magnitude above the frozen ceiling", () => {
    const body = copyOf("jointModel");
    rowAt(arrayAt(body, "coefficients"), 0)[0] = 1e9;
    const error = expectRefusal(() => parseJointModelArtifact(body), "coefficient-out-of-range");
    expect(error.path).toBe("jointModel.coefficients[0][0]");
  });
});

describe("a drifted feature order is refused", () => {
  it("refuses a truncated feature order as a count mismatch", () => {
    const body = copyOf("jointModel");
    body.featureOrder = arrayAt(body, "featureOrder").slice(0, FC008_FROZEN_FEATURE_COUNT - 1);
    expectRefusal(() => parseJointModelArtifact(body), "feature-count-mismatch");
  });

  it("refuses a duplicated feature name", () => {
    // A duplicate makes the order ambiguous: two indices claim the same feature
    // and a caller mapping by name picks one arbitrarily.
    const body = copyOf("jointModel");
    const order = arrayAt(body, "featureOrder");
    order[1] = order[0];
    expectRefusal(() => parseJointModelArtifact(body), "feature-order-mismatch");
  });

  it("refuses a reversed feature order once the two families are compared", () => {
    // Worth being precise about where this is caught. A single model artifact
    // carries the only statement of its own feature order, so reversing it in
    // memory is internally consistent and `parseJointModelArtifact` accepts it.
    // Two independent controls catch it instead: the byte-level hash check in
    // `futurebench-dataset`'s `artifact-source.ts` rejects a reordered file on
    // disk, and the cross-family comparison below rejects a reordering that
    // reached a parsed artifact.
    const body = copyOf("jointModel");
    body.featureOrder = arrayAt(body, "featureOrder").slice().reverse();
    const reversed = parseJointModelArtifact(body);
    const factorized = parseFactorizedModelArtifact(copyOf("factorizedModel"));
    expectRefusal(() => assertSharedFeatureOrder(reversed, factorized), "feature-order-mismatch");
  });

  it("refuses the two families disagreeing at a single index", () => {
    const body = copyOf("jointModel");
    const order = arrayAt(body, "featureOrder");
    order[200] = "tok:ctl:a-feature-the-factorized-model-never-saw";
    const drifted = parseJointModelArtifact(body);
    const factorized = parseFactorizedModelArtifact(copyOf("factorizedModel"));
    const error = expectRefusal(
      () => assertSharedFeatureOrder(drifted, factorized),
      "feature-order-mismatch",
    );
    expect(error.path).toBe("featureOrder[200]");
  });
});

describe("a drifted class order is refused", () => {
  it("refuses a descending re-sort", () => {
    const body = copyOf("jointModel");
    body.classOrder = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expectRefusal(() => parseJointModelArtifact(body), "class-order-mismatch");
  });

  it("refuses a truncated class order", () => {
    const body = copyOf("jointModel");
    body.classOrder = arrayAt(body, "classOrder").slice(0, 12);
    expectRefusal(() => parseJointModelArtifact(body), "class-order-mismatch");
  });

  it("refuses a single changed class number", () => {
    const body = copyOf("jointModel");
    arrayAt(body, "classOrder")[5] = 99;
    const error = expectRefusal(() => parseJointModelArtifact(body), "class-order-mismatch");
    expect(error.path).toBe("jointModel.classOrder[5]");
  });

  it("refuses a composition entry that claims the wrong class", () => {
    const body = copyOf("factorizedModel");
    const entries = arrayAt(objectAt(body, "composition"), "classOrderHeadIndices");
    const entry = entries[3];
    if (typeof entry !== "object" || entry === null) {
      throw new Error("fixture expected a composition entry object");
    }
    (entry as Record<string, unknown>).classNumber = 99;
    expectRefusal(() => parseFactorizedModelArtifact(body), "class-order-mismatch");
  });
});

describe("a drifted head order is refused", () => {
  it("refuses an alphabetically re-sorted head", () => {
    // The frozen head order is first-appearance order from the TypeScript support
    // matrix, which is not alphabetical, so an artifact that sorted its verbs
    // would map logit 0 onto a different verb while looking perfectly valid.
    const body = copyOf("factorizedModel");
    const verb = objectAt(objectAt(body, "heads"), "verb");
    const order = arrayAt(verb, "classOrder");
    verb.classOrder = order.slice().sort();
    expectRefusal(() => parseFactorizedModelArtifact(body), "head-order-mismatch");
  });

  it("refuses a single renamed verb", () => {
    const body = copyOf("factorizedModel");
    const verb = objectAt(objectAt(body, "heads"), "verb");
    arrayAt(verb, "classOrder")[2] = "renamed";
    const error = expectRefusal(() => parseFactorizedModelArtifact(body), "head-order-mismatch");
    expect(error.path).toBe("factorizedModel.heads.verb.classOrder[2]");
  });

  it("refuses a re-sorted object-kind head", () => {
    const body = copyOf("factorizedModel");
    const head = objectAt(objectAt(body, "heads"), "objectKind");
    head.classOrder = arrayAt(head, "classOrder").slice().sort();
    expectRefusal(() => parseFactorizedModelArtifact(body), "head-order-mismatch");
  });
});

describe("a missing head is refused", () => {
  it("refuses a factorized model with no verb head", () => {
    const body = copyOf("factorizedModel");
    // Rebuilt without the key rather than assigned `undefined`: the parser asks
    // `Object.hasOwn`, so a key that still exists with an undefined value is an
    // absent-head test that would actually exercise the object-type check.
    const { verb: _removed, ...withoutVerb } = objectAt(body, "heads");
    body.heads = withoutVerb;
    const error = expectRefusal(() => parseFactorizedModelArtifact(body), "head-missing");
    expect(error.path).toBe("factorizedModel.heads.verb");
  });
});

describe("a cross-family triplet is refused", () => {
  it("refuses the other family's calibration inside a bundle", () => {
    // Refused as `model-family-unexpected` rather than `cross-family-artifact`:
    // the calibration body names its own family, so the mismatch is caught while
    // parsing it, before the hash cross-reference is ever reached. The
    // `cross-family-artifact` refusal covers the harder case below, where every
    // body is individually valid and only the content links disagree.
    expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ calibration: copyOf("factorizedCalibration") })),
      "model-family-unexpected",
    );
    expectRefusal(
      () => parseArtifactBundle(factorizedBundleInput({ calibration: copyOf("jointCalibration") })),
      "model-family-unexpected",
    );
  });

  it("refuses the other family's policy inside a bundle", () => {
    expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ policy: copyOf("factorizedPolicy") })),
      "model-family-unexpected",
    );
    expectRefusal(
      () => parseArtifactBundle(factorizedBundleInput({ policy: copyOf("jointPolicy") })),
      "model-family-unexpected",
    );
  });
});

describe("a bundle whose content links do not resolve is refused", () => {
  it("refuses a model hash the calibration does not reference", () => {
    const error = expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ modelSha256: UNRELATED_SHA256 })),
      "cross-family-artifact",
    );
    expect(error.path).toBe("joint-logistic.calibration.modelArtifactSha256");
  });

  it("refuses a calibration hash the policy does not reference", () => {
    const error = expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ calibrationSha256: UNRELATED_SHA256 })),
      "cross-family-artifact",
    );
    expect(error.path).toBe("joint-logistic.policy.calibrationArtifactSha256");
  });

  it("refuses a calibration body that names a different model", () => {
    const calibration = copyOf("jointCalibration");
    calibration.modelArtifactSha256 = UNRELATED_SHA256;
    expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ calibration })),
      "cross-family-artifact",
    );
  });
});

describe("an unsupported schema version is refused", () => {
  it("refuses schemaVersion 2.0 in every artifact kind", () => {
    const jointModel = copyOf("jointModel");
    jointModel.schemaVersion = "2.0";
    expectRefusal(() => parseJointModelArtifact(jointModel), "schema-version-unsupported");

    const factorizedModel = copyOf("factorizedModel");
    factorizedModel.schemaVersion = "2.0";
    expectRefusal(
      () => parseFactorizedModelArtifact(factorizedModel),
      "schema-version-unsupported",
    );

    const calibration = copyOf("jointCalibration");
    calibration.schemaVersion = "2.0";
    expectRefusal(
      () => parseCalibrationArtifact(calibration, "joint-logistic"),
      "schema-version-unsupported",
    );

    const policy = copyOf("jointPolicy");
    policy.schemaVersion = "2.0";
    expectRefusal(
      () => parsePolicyArtifact(policy, "joint-logistic"),
      "schema-version-unsupported",
    );
  });

  it("agrees with the version constant the loader publishes", () => {
    expect(FC008_ARTIFACT_SCHEMA_VERSION).toBe("1.0");
    expect(REAL.jointModel.schemaVersion).toBe(FC008_ARTIFACT_SCHEMA_VERSION);
  });
});

describe("a drifted identity is refused", () => {
  it("refuses a calibration whose datasetHash disagrees with the model", () => {
    const calibration = copyOf("jointCalibration");
    calibration.datasetHash = UNRELATED_SHA256;
    const error = expectRefusal(
      () => parseArtifactBundle(jointBundleInput({ calibration })),
      "identity-mismatch",
    );
    expect(error.path).toBe("joint-logistic.calibration.datasetHash");
  });

  it("refuses a policy whose vocabularyHash disagrees with the model", () => {
    const policy = copyOf("jointPolicy");
    policy.vocabularyHash = UNRELATED_SHA256;
    expectRefusal(() => parseArtifactBundle(jointBundleInput({ policy })), "identity-mismatch");
  });

  it("refuses an unknown supportMatrixVersion at parse time", () => {
    // Compared to the TypeScript constant, not merely across the triplet: an
    // artifact built under a different support matrix would otherwise be
    // self-consistent and load.
    const body = copyOf("jointModel");
    body.supportMatrixVersion = "9.9";
    const error = expectRefusal(() => parseJointModelArtifact(body), "identity-mismatch");
    expect(error.path).toBe("jointModel.supportMatrixVersion");
  });

  it("refuses an unknown featurePolicyVersion at parse time", () => {
    const body = copyOf("jointModel");
    body.featurePolicyVersion = "9.9";
    const error = expectRefusal(() => parseJointModelArtifact(body), "identity-mismatch");
    expect(error.path).toBe("jointModel.featurePolicyVersion");
  });

  it("refuses a learned combiner, which the frozen composition does not have", () => {
    const body = copyOf("factorizedModel");
    objectAt(body, "composition").learnedCombiner = true;
    const error = expectRefusal(() => parseFactorizedModelArtifact(body), "identity-mismatch");
    expect(error.path).toBe("factorizedModel.composition.learnedCombiner");
  });
});

describe("malformed input is refused by every parser", () => {
  for (const input of NON_OBJECT_INPUTS) {
    it(`refuses ${JSON.stringify(input) ?? "undefined"} as not an object`, () => {
      expectRefusal(() => parseJointModelArtifact(input), "not-an-object");
      expectRefusal(() => parseFactorizedModelArtifact(input), "not-an-object");
      expectRefusal(() => parseCalibrationArtifact(input, "joint-logistic"), "not-an-object");
      expectRefusal(() => parsePolicyArtifact(input, "joint-logistic"), "not-an-object");
    });
  }

  it("refuses an empty object for a missing schemaVersion", () => {
    expectRefusal(() => parseJointModelArtifact({}), "field-missing");
    expectRefusal(() => parseFactorizedModelArtifact({}), "field-missing");
    expectRefusal(() => parseCalibrationArtifact({}, "joint-logistic"), "field-missing");
    expectRefusal(() => parsePolicyArtifact({}, "joint-logistic"), "field-missing");
  });
});

describe("an invalid temperature is refused", () => {
  for (const [label, temperature] of [
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["a string", "0.8"],
  ] as const) {
    it(`refuses a ${label} temperature`, () => {
      const body = copyOf("jointCalibration");
      objectAt(body, "temperatureFit").temperature = temperature;
      const error = expectRefusal(
        () => parseCalibrationArtifact(body, "joint-logistic"),
        "temperature-invalid",
      );
      expect(error.path).toBe("calibration.temperatureFit.temperature");
    });
  }
});

describe("an out-of-range threshold is refused", () => {
  for (const [label, threshold] of [
    ["below zero", -0.1],
    ["above one", 1.5],
    ["NaN", Number.NaN],
  ] as const) {
    it(`refuses a threshold ${label}`, () => {
      const body = copyOf("jointPolicy");
      body.selectedConfidenceThreshold = threshold;
      const error = expectRefusal(
        () => parsePolicyArtifact(body, "joint-logistic"),
        "threshold-invalid",
      );
      expect(error.path).toBe("policy.selectedConfidenceThreshold");
    });
  }
});

describe("the refusal vocabulary is closed", () => {
  it("names every refusal this file asserts and nothing undeclared", () => {
    // The refusal set is what callers branch on, so it must not be widened
    // accidentally by a parser inventing a new string.
    expect(new Set(ARTIFACT_LOAD_REFUSALS).size).toBe(ARTIFACT_LOAD_REFUSALS.length);
    for (const refusal of [
      "not-an-object",
      "schema-version-unsupported",
      "model-family-unexpected",
      "field-missing",
      "shape-mismatch",
      "feature-count-mismatch",
      "feature-order-mismatch",
      "class-order-mismatch",
      "head-order-mismatch",
      "head-missing",
      "non-finite-value",
      "coefficient-out-of-range",
      "identity-mismatch",
      "cross-family-artifact",
      "temperature-invalid",
      "threshold-invalid",
    ]) {
      expect(ARTIFACT_LOAD_REFUSALS).toContain(refusal);
    }
  });
});
