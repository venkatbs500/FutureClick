/**
 * The synthetic application families, and which of them is held out.
 *
 * WHY THREE FAMILIES AND NOT TWENTY-SIX
 *
 * Coverage arithmetic would be easy to satisfy dishonestly: two families per class
 * could be twenty-six thin shells, each with one surface and a different colour.
 * That would produce the right numbers and no evidence, because a held-out
 * "application" that shares its author's instincts with the training set is not out
 * of distribution in any sense that matters.
 *
 * So there are three substantial products instead. A and B each cover all thirteen
 * classes through two independently conceived lineages apiece, which gives every
 * class four lineages in distribution — enough to fill train, calibration,
 * policy-validation, and test-id without a class going missing from any of them. C
 * is partial and exists to be held out.
 *
 * WHY A AND B ARE GENUINELY INDEPENDENT
 *
 * They were authored separately, without reference to each other, and they disagree
 * about more than vocabulary. A is a workspace: modal confirmations, noun-first
 * headings, explicit verb buttons, "member". B is a developer control plane:
 * breadcrumb-and-tab navigation, inline chips and switches where A would use a
 * modal, terse verb-first engineer register, "principal". A model that learned
 * "modal dialog plus destructive styling means delete" from A gets no free ride on
 * B, which is the condition under which the out-of-application number means
 * something.
 */

import type { ApplicationFamily } from "../scenario.js";
import { FAMILY_A } from "./family-a.js";
import { FAMILY_B } from "./family-b.js";
import { FAMILY_C } from "./family-c.js";

/** Every family, in a stable order. */
export const FUTUREBENCH_FAMILIES: readonly ApplicationFamily[] = Object.freeze([
  FAMILY_A,
  FAMILY_B,
  FAMILY_C,
]);

/**
 * The family withheld for out-of-application measurement.
 *
 * Held out whole. Holding out a subset of a family's scenarios would leave the
 * model familiar with that product's conventions, which is the very thing the
 * partition is supposed to withhold.
 */
export const FUTUREBENCH_HELD_OUT_FAMILY_IDS: readonly string[] = Object.freeze([
  FAMILY_C.applicationFamilyId,
]);
