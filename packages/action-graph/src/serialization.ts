/**
 * ActionGraph Validated Serialization & Deserialization (Sprint FC-003)
 *
 * Provides fail-closed JSON serialization and parsing for ActionGraph instances,
 * leveraging the hardened FC-002 JSON domain infrastructure.
 *
 * Guarantees:
 * - Pre-serialization authoritative validation (invalid graphs cannot be serialized).
 * - Safe JSON parsing with cycle and prototype tampering protection.
 * - Post-parsing authoritative validation with detached value reconstruction.
 * - Functional Result<T, Error> error propagation without uncaught exceptions.
 */

import type { Result } from "@futureclick/shared";
import { parseCanonical, serializeCanonical } from "@futureclick/action-schema";
import type { ActionGraph } from "./types.js";
import { validateActionGraph } from "./validation.js";

/**
 * Validates and serializes an ActionGraph into a JSON string.
 *
 * @param graph An ActionGraph or candidate graph object.
 * @returns Result containing the serialized JSON string or a descriptive Error.
 */
export function serializeActionGraph(graph: unknown): Result<string, Error> {
  return serializeCanonical<ActionGraph>(graph, validateActionGraph);
}

/**
 * Parses a JSON string and authoritatively validates it as a canonical ActionGraph.
 *
 * @param json The JSON string to parse.
 * @returns Result containing the validated detached ActionGraph or a descriptive Error.
 */
export function parseActionGraph(json: string): Result<ActionGraph, Error> {
  return parseCanonical<ActionGraph>(json, validateActionGraph);
}
