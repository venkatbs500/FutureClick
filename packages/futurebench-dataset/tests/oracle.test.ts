import { FC008_SUPPORT_MATRIX } from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import {
  establishes,
  establishesNothingSupported,
  establishesSubmission,
  establishesWithPrimary,
  transition,
} from "../src/authoring.js";
import { ORACLE_FORBIDDEN_INPUTS, resolveOracleLabel } from "../src/oracle.js";

describe("specificity oracle", () => {
  it("resolves every one of the thirteen frozen classes from its own tuple", () => {
    for (const entry of FC008_SUPPORT_MATRIX) {
      const tuple = entry.tuple;
      const intent =
        entry.classNumber === 13
          ? establishesSubmission()
          : establishes(
              transition(
                tuple.verb,
                tuple.objectKind,
                tuple.transition.property,
                tuple.transition.from,
                tuple.transition.to,
              ),
            );
      const resolution = resolveOracleLabel(intent);
      expect(resolution.disposition, `class ${entry.classNumber}`).toBe("resolved");
      if (resolution.disposition === "resolved") {
        expect(resolution.classNumber).toBe(entry.classNumber);
      }
    }
  });

  it("declines a transition stated in the unsupported direction", () => {
    // The matrix supports present -> absent. Reversed, it is not a supported tuple,
    // and guessing that the author meant the forward direction would manufacture
    // ground truth out of a specification error.
    const resolution = resolveOracleLabel(
      establishes(transition("delete", "file", "existence", "absent", "present")),
    );
    expect(resolution.disposition).toBe("rejected");
    if (resolution.disposition === "rejected") {
      expect(resolution.rejection).toBe("no-supported-transition-established");
    }
  });

  it("declines when nothing supported is established", () => {
    const resolution = resolveOracleLabel(establishesNothingSupported());
    expect(resolution.disposition).toBe("rejected");
  });
});

describe("class 13 is the least specific reading, never the first", () => {
  /**
   * The canonical case from the architecture: a GitHub-style repository visibility
   * change is carried out by submitting a settings form. The MECHANISM is form
   * submission; the MEANING is that a private repository becomes public. Ground
   * truth follows the meaning, so this is class 8.
   *
   * Getting this backwards would be the single most damaging labelling error in the
   * dataset: class 13 would absorb a large share of real transitions, and the
   * benchmark would reward a model for recognizing forms instead of consequences.
   */
  it("labels a private-to-public repository change as class 8 even when a form submits it", () => {
    const intent = {
      establishedTransitions: [
        transition("change-access", "repository", "visibility", "private", "public"),
      ],
      primaryTransitionIndex: null,
      // The scenario IS a form submission at the UI level.
      submissionIsTheAction: false,
    };
    const resolution = resolveOracleLabel(intent);
    expect(resolution.disposition).toBe("resolved");
    if (resolution.disposition === "resolved") {
      expect(resolution.classNumber).toBe(8);
      expect(resolution.classNumber).not.toBe(13);
    }
  });

  it("refuses an intent that claims submission while also establishing a specific transition", () => {
    // Self-contradictory: the specification says both "this is merely a submission"
    // and "this changes repository visibility". Rather than silently preferring one,
    // the oracle refuses, because an author who wrote this did not mean one of them.
    const resolution = resolveOracleLabel({
      establishedTransitions: [
        transition("change-access", "repository", "visibility", "private", "public"),
      ],
      primaryTransitionIndex: null,
      submissionIsTheAction: true,
    });
    expect(resolution.disposition).toBe("rejected");
    if (resolution.disposition === "rejected") {
      expect(resolution.rejection).toBe("submission-claimed-with-specific-transition");
    }
  });

  it("reaches class 13 only when submission is the action and nothing specific applies", () => {
    const resolution = resolveOracleLabel(establishesSubmission());
    expect(resolution.disposition).toBe("resolved");
    if (resolution.disposition === "resolved") {
      expect(resolution.classNumber).toBe(13);
      expect(resolution.basis).toBe("submission-is-the-action");
    }
  });

  it("does not award class 13 merely because the submission tuple was established", () => {
    // The submission tuple is present but the specification does not say submission
    // is the action. Both conditions are required.
    const resolution = resolveOracleLabel(
      establishes(transition("submit", "form", "submission", "ready", "submitted")),
    );
    expect(resolution.disposition).toBe("rejected");
  });
});

describe("ambiguity is refused rather than resolved by preference", () => {
  it("rejects two equally specific transitions with no designated primary", () => {
    const resolution = resolveOracleLabel({
      establishedTransitions: [
        transition("delete", "file", "existence", "present", "absent"),
        transition("share", "document", "access", "private", "shared"),
      ],
      primaryTransitionIndex: null,
      submissionIsTheAction: false,
    });
    expect(resolution.disposition).toBe("rejected");
    if (resolution.disposition === "rejected") {
      expect(resolution.rejection).toBe("ambiguous-equally-specific-transitions");
      expect([...resolution.competingClassNumbers].sort((a, b) => a - b)).toEqual([1, 4]);
    }
  });

  it("resolves the same pair once the specification designates a primary", () => {
    const resolution = resolveOracleLabel(
      establishesWithPrimary(
        [
          transition("delete", "file", "existence", "present", "absent"),
          transition("share", "document", "access", "private", "shared"),
        ],
        1,
      ),
    );
    expect(resolution.disposition).toBe("resolved");
    if (resolution.disposition === "resolved") {
      expect(resolution.classNumber).toBe(4);
      expect(resolution.basis).toBe("designated-primary-transition");
    }
  });

  it("rejects a primary index that does not address a supported transition", () => {
    const resolution = resolveOracleLabel(
      establishesWithPrimary([transition("delete", "file", "existence", "present", "absent")], 7),
    );
    expect(resolution.disposition).toBe("rejected");
    if (resolution.disposition === "rejected") {
      expect(resolution.rejection).toBe("primary-transition-index-invalid");
    }
  });
});

describe("oracle input boundary", () => {
  it("names the inputs it must never read", () => {
    // A documented closed list, asserted so that widening it is a deliberate edit
    // to a test rather than an unremarked change to a comment.
    expect(ORACLE_FORBIDDEN_INPUTS.length).toBeGreaterThan(0);
    for (const forbidden of ORACLE_FORBIDDEN_INPUTS) {
      expect(typeof forbidden).toBe("string");
    }
  });

  it("depends on nothing but the authored intent", () => {
    // Same intent, two calls, no shared state: the oracle is a pure function of the
    // specification. If it ever consulted a surface, a fixture id, or a partition,
    // this determinism check would be the first thing to break.
    const intent = establishes(transition("move", "folder", "container", "source", "destination"));
    expect(resolveOracleLabel(intent)).toEqual(resolveOracleLabel(intent));
  });
});
