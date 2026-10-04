/**
 * Authoring helpers for synthetic scenarios.
 *
 * ANTI-CIRCULARITY IS THE DESIGN CONSTRAINT HERE
 *
 * No function in this module derives surface text from a class, a tuple, or a label.
 * `establishes()` takes the semantic tuple and produces an `AuthoredIntent`;
 * `control()` and `surfaceSnapshot()` take text the author wrote and produce a
 * `RawSurface`. The two never meet. There is deliberately no helper of the shape
 * `textForClass(n)`, because that single convenience would turn the benchmark into
 * string matching: the model would learn the generator's phrasebook rather than the
 * semantics of the interface.
 *
 * Variants are a different matter. A wording or layout variant is a deterministic
 * transformation of an already-authored surface, which is exactly what the variant
 * taxonomy calls for, and it must never change the established meaning. A variant
 * therefore reuses its parent's intent object unchanged — meaning cannot drift
 * because it is not re-stated.
 */

import type { EntityKind } from "@futureclick/action-schema";
import type {
  ControlKind,
  ControlRole,
  FormMethod,
  InteractionKind,
  RawControlCandidate,
  RawStateSignal,
  RawSurface,
  RawTextSlot,
  SurfaceKind,
} from "@futureclick/action-understanding";
import { nameLikeText, semanticText } from "@futureclick/action-understanding";
import type {
  AuthoredConsequenceAnnotation,
  AuthoredIntent,
  AuthoredTransition,
  ScenarioSpecification,
  VariantKind,
} from "./scenario.js";

export { nameLikeText, semanticText };

/** Text the user typed. Always dropped by the sanitizer. */
export function userEnteredText(text: string): RawTextSlot {
  return { text, disposition: "user-entered" };
}

/** A hidden form value. Always dropped. */
export function hiddenValueText(text: string): RawTextSlot {
  return { text, disposition: "hidden-value" };
}

/** A password field value. Always dropped. */
export function passwordText(text: string): RawTextSlot {
  return { text, disposition: "password" };
}

/** One semantic transition, stated as the authoritative specification. */
export function transition(
  verb: string,
  objectKind: EntityKind,
  property: string,
  from: string,
  to: string,
): AuthoredTransition {
  return { verb, objectKind, property, from, to };
}

/**
 * An intent establishing exactly one specific transition.
 *
 * `submissionIsTheAction` is false: whatever UI mechanism invokes it, the semantic
 * action is the transition itself.
 */
export function establishes(single: AuthoredTransition): AuthoredIntent {
  return {
    establishedTransitions: [single],
    primaryTransitionIndex: null,
    submissionIsTheAction: false,
  };
}

/**
 * An intent establishing several transitions with one designated primary.
 *
 * Used where a scenario genuinely does two things and the specification says which
 * one it is about.
 */
export function establishesWithPrimary(
  transitions: readonly AuthoredTransition[],
  primaryIndex: number,
): AuthoredIntent {
  return {
    establishedTransitions: transitions,
    primaryTransitionIndex: primaryIndex,
    submissionIsTheAction: false,
  };
}

/**
 * An intent that is genuinely about submitting a form.
 *
 * The only route to class 13. Note it establishes the submission tuple AND declares
 * submission to be the action; either alone is insufficient.
 */
export function establishesSubmission(): AuthoredIntent {
  return {
    establishedTransitions: [transition("submit", "form", "submission", "ready", "submitted")],
    primaryTransitionIndex: null,
    submissionIsTheAction: true,
  };
}

/** An intent establishing nothing supported. Used for novelty scenarios. */
export function establishesNothingSupported(
  transitions: readonly AuthoredTransition[] = [],
): AuthoredIntent {
  return {
    establishedTransitions: transitions,
    primaryTransitionIndex: null,
    submissionIsTheAction: false,
  };
}

export interface ControlOptions {
  readonly ownText: RawTextSlot;
  readonly accessibleName?: RawTextSlot | null;
  readonly controlKind?: ControlKind;
  readonly controlRole?: ControlRole;
  readonly interactionKind?: InteractionKind;
  readonly formMethod?: FormMethod;
  readonly destructiveStyle?: boolean;
  readonly nearbyLabels?: readonly RawTextSlot[];
  readonly ancestorDepth?: number;
}

/** One candidate control. Defaults describe an ordinary activated button. */
export function control(options: ControlOptions): RawControlCandidate {
  return {
    ownText: options.ownText,
    accessibleName: options.accessibleName ?? null,
    controlKind: options.controlKind ?? "button",
    controlRole: options.controlRole ?? "button",
    interactionKind: options.interactionKind ?? "activate",
    formMethod: options.formMethod ?? "none",
    destructiveStyle: options.destructiveStyle ?? false,
    nearbyLabels: options.nearbyLabels ?? [],
    ancestorDepth: options.ancestorDepth ?? 3,
  };
}

/** A categorical state signal over a frozen transition property. */
export function state(property: string, value: string): RawStateSignal {
  return { property, value };
}

export interface SurfaceOptions {
  readonly surfaceKind?: SurfaceKind;
  readonly headings?: readonly RawTextSlot[];
  readonly stateSignals?: readonly RawStateSignal[];
  readonly objectKindEvidence?: readonly EntityKind[];
  readonly candidates: readonly RawControlCandidate[];
  readonly targetIndex?: number;
}

export function surfaceSnapshot(options: SurfaceOptions): RawSurface {
  return {
    surfaceKind: options.surfaceKind ?? "page",
    headings: options.headings ?? [],
    stateSignals: options.stateSignals ?? [],
    objectKindEvidence: options.objectKindEvidence ?? [],
    candidates: options.candidates,
    targetIndex: options.targetIndex ?? 0,
  };
}

export interface ScenarioOptions {
  readonly scenarioId: string;
  readonly applicationFamilyId: string;
  readonly templateLineageId: string;
  readonly intent: AuthoredIntent;
  readonly surface: RawSurface;
  readonly variantKind?: VariantKind;
  readonly parentLineageId?: string;
  readonly wordingVariantId?: string;
  readonly layoutVariantId?: string;
  readonly consequence?: AuthoredConsequenceAnnotation | null;
  readonly intendedForNovelty?: boolean;
}

export function scenario(options: ScenarioOptions): ScenarioSpecification {
  return {
    scenarioId: options.scenarioId,
    applicationFamilyId: options.applicationFamilyId,
    templateLineageId: options.templateLineageId,
    wordingVariantId: options.wordingVariantId ?? "w0",
    layoutVariantId: options.layoutVariantId ?? "l0",
    variantKind: options.variantKind ?? "canonical",
    parentLineageId: options.parentLineageId ?? options.templateLineageId,
    intent: options.intent,
    surface: options.surface,
    consequence: options.consequence ?? null,
    intendedForNovelty: options.intendedForNovelty ?? false,
  };
}
