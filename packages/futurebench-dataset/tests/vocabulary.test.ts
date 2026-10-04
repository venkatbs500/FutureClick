import {
  FC008_DATASET_PARTITIONS,
  FC008_FEATURE_POLICY,
  FC008_SAFETY_CAPS,
  type Fc008DatasetPartition,
  type ObservationSemantics,
  enumerateCandidateFeatures,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { control, semanticText, state, surfaceSnapshot } from "../src/authoring.js";
import {
  DEFAULT_VOCABULARY_FIT_OPTIONS,
  fitFeatureVocabulary,
  openTrainOnlyCorpus,
} from "../src/vocabulary.js";
import { buildTestObservation } from "./helpers.js";

function semanticsFor(label: string, extraHeading: string): ObservationSemantics {
  return buildTestObservation(
    surfaceSnapshot({
      headings: [semanticText(extraHeading)],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file"],
      candidates: [
        control({ ownText: semanticText(label), destructiveStyle: true }),
        control({ ownText: semanticText("Cancel") }),
      ],
    }),
    { observationId: "obs-vocab-0001" },
  ).semantics;
}

/** One semantics value, named so contamination fixtures need no index lookup. */
const SAMPLE_SEMANTICS = semanticsFor("Delete file", "Delete this file?");

const TRAIN_SAMPLES = [
  { partition: "train" as const, semantics: SAMPLE_SEMANTICS },
  { partition: "train" as const, semantics: semanticsFor("Remove file", "Delete this file?") },
  { partition: "train" as const, semantics: semanticsFor("Erase file", "Remove this file?") },
];

describe("only the train partition can produce a corpus", () => {
  it("admits train samples", () => {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    expect(opened.ok).toBe(true);
  });

  for (const partition of FC008_DATASET_PARTITIONS) {
    if (partition === "train") {
      continue;
    }
    it(`refuses a corpus containing ${partition}`, () => {
      const opened = openTrainOnlyCorpus([
        ...TRAIN_SAMPLES,
        { partition: partition as Fc008DatasetPartition, semantics: SAMPLE_SEMANTICS },
      ]);
      expect(opened.ok).toBe(false);
      if (!opened.ok) {
        expect(opened.reason).toBe("non-train-partition-present");
        expect(opened.offendingPartitions).toContain(partition);
      }
    });
  }

  it("reports every offending partition, not just the first", () => {
    const opened = openTrainOnlyCorpus([
      { partition: "calibration", semantics: SAMPLE_SEMANTICS },
      { partition: "test-ooa", semantics: SAMPLE_SEMANTICS },
      { partition: "test-id", semantics: SAMPLE_SEMANTICS },
    ]);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect([...opened.offendingPartitions].sort()).toEqual([
        "calibration",
        "test-id",
        "test-ooa",
      ]);
    }
  });

  it("refuses an empty corpus", () => {
    const opened = openTrainOnlyCorpus([]);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.reason).toBe("empty-corpus");
    }
  });

  it("offers no other route to a corpus", async () => {
    // The brand is unforgeable: `openTrainOnlyCorpus` is the only exported function
    // that returns one, so there is no second door into the fitter.
    const module = (await import("../src/vocabulary.js")) as Record<string, unknown>;
    const constructors = Object.keys(module).filter((name) => name.includes("Corpus"));
    expect(constructors).toEqual(["openTrainOnlyCorpus"]);
  });
});

describe("vocabulary fitting", () => {
  function fit() {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    if (!opened.ok) {
      throw new Error("corpus refused");
    }
    return fitFeatureVocabulary(opened.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 1,
    });
  }

  it("produces a vocabulary with dense indices from zero", () => {
    const result = fit();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const indices = [...result.vocabulary.entries.values()].sort((a, b) => a - b);
    expect(indices).toEqual(indices.map((_, i) => i));
    expect(result.vocabulary.size).toBe(indices.length);
  });

  it("assigns indices independently of sample order", () => {
    // Order-independence is what makes the artifact reproducible. Indices are ranked
    // by descending document frequency and then lexicographically, never by the
    // order a feature happened to be seen.
    const forward = fit();
    const reversedOpen = openTrainOnlyCorpus([...TRAIN_SAMPLES].reverse());
    expect(reversedOpen.ok).toBe(true);
    if (!reversedOpen.ok || !forward.ok) {
      return;
    }
    const reversed = fitFeatureVocabulary(reversedOpen.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 1,
    });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect([...reversed.vocabulary.entries.entries()].sort()).toEqual(
        [...forward.vocabulary.entries.entries()].sort(),
      );
    }
  });

  it("names only features the projector can also produce", () => {
    // One source of names, so the vocabulary and the projector cannot drift apart
    // and leave features permanently unreachable.
    const result = fit();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const producible = new Set<string>();
    for (const sample of TRAIN_SAMPLES) {
      for (const candidate of enumerateCandidateFeatures(sample.semantics)) {
        producible.add(candidate.name);
      }
    }
    for (const name of result.vocabulary.entries.keys()) {
      expect(producible.has(name), `${name} is not producible by the projector`).toBe(true);
    }
  });

  it("drops features below the document-frequency floor", () => {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const strict = fitFeatureVocabulary(opened.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 3,
    });
    const loose = fitFeatureVocabulary(opened.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 1,
    });
    expect(strict.ok && loose.ok).toBe(true);
    if (strict.ok && loose.ok) {
      expect(strict.vocabulary.size).toBeLessThan(loose.vocabulary.size);
      // "erase" appears in one sample only and must not survive a floor of three.
      expect([...strict.vocabulary.entries.keys()]).not.toContain("tok:ctl:erase");
    }
  });

  it("applies a vocabulary ceiling deterministically and reports what it cost", () => {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const options = {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 1,
      maxVocabulary: 2,
    };
    const result = fitFeatureVocabulary(opened.corpus, options);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // The ceiling keeps the most frequent features and reports the discard count,
    // so the loss is visible in the artifact rather than invisible. The ranking is
    // frequency then lexicographic, which makes the cut reproducible.
    expect(result.vocabulary.size).toBe(2);
    expect(result.diagnostics.truncatedByCeilingCount).toBeGreaterThan(0);
    const again = fitFeatureVocabulary(opened.corpus, options);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect([...again.vocabulary.entries.entries()]).toEqual([
        ...result.vocabulary.entries.entries(),
      ]);
    }
  });

  it("refuses a ceiling above the absolute safety cap", () => {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const result = fitFeatureVocabulary(opened.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      maxVocabulary: FC008_SAFETY_CAPS.maxFeatureVocabulary + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("max-vocabulary-exceeds-absolute-cap");
    }
  });

  it("respects the frozen policy ceiling by default", () => {
    expect(DEFAULT_VOCABULARY_FIT_OPTIONS.maxVocabulary).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxFeatureVocabulary,
    );
  });

  it("contains no site identity, label, partition name, or private name", () => {
    const result = fit();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const name of result.vocabulary.entries.keys()) {
      // Checked on the FAMILY prefix, not the whole name. A substring scan would
      // flag `cnt:nearby-labels:0` for containing "label", which counts rendered UI
      // labels and has nothing to do with a class label. Identity and ground truth
      // could only enter as a new feature family, so the prefix is the right scope.
      const family = name.split(":")[0] as string;
      expect(family).not.toMatch(/^(?:host|url|origin|route|path|app|site|ts|time)$/);
      expect(family).not.toMatch(/^(?:class|label|oracle|truth|target|y)\d*$/);
      expect(family).not.toMatch(/^(?:lineage|scenario|fixture|generator|record|split)/);
      for (const partition of FC008_DATASET_PARTITIONS) {
        expect(family).not.toContain(partition);
      }
    }
  });
});

describe("projection against a fitted vocabulary", () => {
  it("activates only features present in the vocabulary", () => {
    const opened = openTrainOnlyCorpus(TRAIN_SAMPLES);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const fitted = fitFeatureVocabulary(opened.corpus, {
      ...DEFAULT_VOCABULARY_FIT_OPTIONS,
      minDocumentFrequency: 1,
    });
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) {
      return;
    }
    // An unseen surface: its novel tokens have no index and must simply be absent
    // rather than growing the feature space at inference time.
    const unseen = semanticsFor("Promote deployment", "Release pipeline");
    const projection = projectPrimaryFeatures(unseen, fitted.vocabulary, FC008_FEATURE_POLICY);
    expect(projection.ok).toBe(true);
    if (projection.ok) {
      for (const index of projection.projection.vector.indices) {
        expect(index).toBeLessThan(fitted.vocabulary.size);
      }
    }
  });
});
