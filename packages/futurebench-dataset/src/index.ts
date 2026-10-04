/**
 * FutureBench dataset generation (FC-008 Sprint 2).
 *
 * Offline only. Nothing here runs in the browser extension, and the dependency
 * direction is one-way: this package imports `action-understanding`, never the
 * reverse. That is what makes "the extractor cannot reach the oracle" a structural
 * fact — the reverse import would be a cycle the build rejects — rather than a rule
 * someone has to remember.
 */

export * from "./audit.js";
export * from "./authoring.js";
export * from "./canonical.js";
export * from "./dataset.js";
export * from "./manifest.js";
export * from "./oracle.js";
export * from "./partition.js";
export * from "./record.js";
export * from "./scenario.js";
export * from "./variants.js";
export * from "./vocabulary.js";
export { FAMILY_A } from "./apps/family-a.js";
export { FAMILY_B } from "./apps/family-b.js";
export { FAMILY_C } from "./apps/family-c.js";
export { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "./apps/index.js";
