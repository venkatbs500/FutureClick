/**
 * Safe canonical JSON serialization and parsing helpers for FutureClick domain objects (Sprint FC-002 / FC-002A / FC-002B).
 *
 * Enforces:
 * - Deterministic serialization without undefined, functions, symbols, bigints, sparse arrays, or circular references
 * - Serialization of the validated canonical representation (not untrusted original structures)
 * - Domain-specific parsing with immediate structural and semantic validation
 * - Removal of generic unchecked casts (parseJsonValue and typed parseCanonical requiring validators)
 * - Complete exception safety: hostile throws (null-prototype objects, { toString: null }, etc.) fail closed into Result error
 * - Consistent depth policy: JsonValue payloads are validated from their own roots without whole-envelope double budgeting
 */

import { type Result, err, ok } from "@futureclick/shared";
import { validateJsonValue } from "./json.js";
import type {
  ActionEvaluationContext,
  Consequence,
  ConsequenceAssessment,
  JsonValue,
  ProposedAction,
  StateSnapshot,
} from "./types.js";
import {
  type ValidationResult,
  validateActionEvaluationContext,
  validateConsequence,
  validateConsequenceAssessment,
  validateProposedAction,
  validateStateSnapshot,
} from "./validation.js";

/**
 * Normalizes an unknown thrown value into a standard Error.
 * Protects against hostile prototypes, missing toString, and throwing getters.
 */
export function normalizeThrownError(cause: unknown, fallbackMessage: string): Error {
  try {
    if (cause instanceof Error) {
      return cause;
    }
    if (typeof cause === "string" && cause.trim().length > 0) {
      return new Error(cause);
    }
  } catch {
    return new Error(fallbackMessage);
  }
  return new Error(fallbackMessage);
}

/**
 * Serializes a standalone JSON-safe value to a JSON string.
 * Validates the value from its own root against MAX_JSON_VALUE_DEPTH.
 */
export function serializeJsonValue(value: unknown): Result<string, Error> {
  const jsonCheck = validateJsonValue(value);
  if (!jsonCheck.valid) {
    const errorMsg = jsonCheck.issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`).join("; ");
    return err(new Error(`Canonical serialization failed: value is not JSON-safe: ${errorMsg}`));
  }

  try {
    const serialized = JSON.stringify(jsonCheck.value);
    return ok(serialized);
  } catch (thrown) {
    return err(normalizeThrownError(thrown, "JSON stringify failed"));
  }
}

/**
 * Serializes any canonical domain object or JSON-safe value to a JSON string.
 * When a validator is supplied, it validates the object using domain rules and serializes
 * the validated normalized representation without applying whole-envelope double depth budgeting.
 */
export function serializeCanonical<T = unknown>(
  value: unknown,
  validator?: (input: unknown) => ValidationResult<T>,
): Result<string, Error> {
  if (validator) {
    let validation: ValidationResult<T>;
    try {
      validation = validator(value);
    } catch (thrown) {
      return err(
        normalizeThrownError(
          thrown,
          "Domain validation threw an unexpected error during serialization",
        ),
      );
    }
    if (!validation.valid) {
      const errorMsg = validation.issues
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
        .join("; ");
      return err(new Error(`Cannot serialize invalid canonical domain object: ${errorMsg}`));
    }
    try {
      const serialized = JSON.stringify(validation.value);
      return ok(serialized);
    } catch (thrown) {
      return err(normalizeThrownError(thrown, "JSON stringify failed"));
    }
  }

  return serializeJsonValue(value);
}

/**
 * Parses a JSON string and validates that it contains strictly valid JSON values.
 * Returns a validated JsonValue without arbitrary type casting.
 */
export function parseJsonValue(json: string): Result<JsonValue, Error> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (thrown) {
    return err(normalizeThrownError(thrown, "JSON parse failed"));
  }

  const jsonCheck = validateJsonValue(parsed);
  if (!jsonCheck.valid) {
    const errorMsg = jsonCheck.issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`).join("; ");
    return err(
      new Error(`Canonical parsing failed: parsed structure is not JSON-safe: ${errorMsg}`),
    );
  }
  return ok(jsonCheck.value);
}

/**
 * Authoritative typed parser that requires an explicit domain validator function.
 * Prevents unsound arbitrary casting of JSON values into domain types.
 * Exception-safe: catches validator throws and hostile causes safely.
 */
export function parseCanonical<T>(
  json: string,
  validator: (input: unknown) => ValidationResult<T>,
): Result<T, Error> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (thrown) {
    return err(normalizeThrownError(thrown, "JSON parse failed"));
  }

  let validation: ValidationResult<T>;
  try {
    validation = validator(parsed);
  } catch (thrown) {
    return err(
      normalizeThrownError(thrown, "Domain validation threw an unexpected error during parsing"),
    );
  }

  if (!validation.valid) {
    const errorMsg = validation.issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`).join("; ");
    return err(new Error(`Domain validation failed during parsing: ${errorMsg}`));
  }
  return ok(validation.value);
}

export function serializeStateSnapshot(snapshot: StateSnapshot): Result<string, Error> {
  return serializeCanonical(snapshot, validateStateSnapshot);
}

export function parseStateSnapshot(json: string): Result<StateSnapshot, Error> {
  return parseCanonical(json, validateStateSnapshot);
}

export function serializeProposedAction(action: ProposedAction): Result<string, Error> {
  return serializeCanonical(action, validateProposedAction);
}

export function parseProposedAction(json: string): Result<ProposedAction, Error> {
  return parseCanonical(json, validateProposedAction);
}

export function serializeConsequence(consequence: Consequence): Result<string, Error> {
  return serializeCanonical(consequence, validateConsequence);
}

export function parseConsequence(json: string): Result<Consequence, Error> {
  return parseCanonical(json, validateConsequence);
}

export function serializeActionEvaluationContext(
  context: ActionEvaluationContext,
): Result<string, Error> {
  return serializeCanonical(context, validateActionEvaluationContext);
}

export function parseActionEvaluationContext(json: string): Result<ActionEvaluationContext, Error> {
  return parseCanonical(json, validateActionEvaluationContext);
}

export function serializeConsequenceAssessment(
  assessment: ConsequenceAssessment,
): Result<string, Error> {
  return serializeCanonical(assessment, validateConsequenceAssessment);
}

export function parseConsequenceAssessment(json: string): Result<ConsequenceAssessment, Error> {
  return parseCanonical(json, validateConsequenceAssessment);
}
