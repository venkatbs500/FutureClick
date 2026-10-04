/**
 * FC-008 Sprint 1 — shared fail-closed validation primitives.
 *
 * Every FC-008 contract is validated from untrusted input using these helpers.
 * They never throw, never invoke an attacker-controlled getter more than once,
 * and never coerce a value through `toString`.
 *
 * Rejection categories enforced here (repository convention, matching
 * `inspectSafePlainObject` in FC-007 and `readOwnProperty` in action-schema):
 * - non-plain objects and non-null/non-Object prototypes (prototype pollution)
 * - symbol-keyed properties
 * - accessor properties (getters and setters)
 * - unknown own keys (closed shape)
 * - own keys present with value `undefined` where a value is required
 * - sparse arrays
 */

import {
  type ValidationIssue,
  type ValidationResult,
  captureDenseArray,
  isPlainObject,
} from "@futureclick/action-schema";

export type { ValidationIssue, ValidationResult };

/** FC-008 validation issue codes. */
export const FC008_VALIDATION_CODES = Object.freeze({
  notPlainObject: "FC008_NOT_PLAIN_OBJECT",
  symbolKey: "FC008_SYMBOL_KEY",
  accessorProperty: "FC008_ACCESSOR_PROPERTY",
  unknownKey: "FC008_UNKNOWN_KEY",
  missingKey: "FC008_MISSING_KEY",
  undefinedValue: "FC008_UNDEFINED_VALUE",
  readError: "FC008_READ_ERROR",
  typeMismatch: "FC008_TYPE_MISMATCH",
  enumViolation: "FC008_ENUM_VIOLATION",
  boundExceeded: "FC008_BOUND_EXCEEDED",
  patternViolation: "FC008_PATTERN_VIOLATION",
  sparseArray: "FC008_SPARSE_ARRAY",
  duplicateValue: "FC008_DUPLICATE_VALUE",
  invariantViolation: "FC008_INVARIANT_VIOLATION",
} as const);

/**
 * Formats an untrusted value for diagnostics without invoking its `toString`.
 * Mirrors `safeFormatValue` in action-graph validation.
 */
export function safeFormatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 50 ? `${value.slice(0, 47)}...` : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return typeof value;
}

export function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "error" };
}

export type ClosedObjectInspection =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, unknown> }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Inspects an untrusted value as a closed-shape plain object.
 *
 * Returns a detached map of own data-property values. Any symbol key, accessor
 * property, unknown key, or missing required key fails closed.
 */
export function inspectClosedObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): ClosedObjectInspection {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [
        issue(
          FC008_VALIDATION_CODES.notPlainObject,
          path,
          "Value must be a non-null plain object with Object.prototype or a null prototype.",
        ),
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const allowed = new Set<string>([...requiredKeys, ...optionalKeys]);
  const fields = new Map<string, unknown>();

  let ownKeys: readonly (string | symbol)[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return {
      ok: false,
      issues: [issue(FC008_VALIDATION_CODES.readError, path, "Failed to enumerate own keys.")],
    };
  }

  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.symbolKey,
          path,
          "Symbol-keyed properties are not permitted on FC-008 contracts.",
        ),
      );
      continue;
    }
    if (!allowed.has(key)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.unknownKey,
          `${path}.${key}`,
          `Unknown property "${key}" is not part of this closed contract.`,
        ),
      );
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.readError,
          `${path}.${key}`,
          `Failed to read property descriptor for "${key}".`,
        ),
      );
      continue;
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.accessorProperty,
          `${path}.${key}`,
          `Property "${key}" must be a plain data property, not an accessor.`,
        ),
      );
      continue;
    }
    fields.set(key, descriptor.value);
  }

  for (const required of requiredKeys) {
    if (!fields.has(required)) {
      if (!issues.some((i) => i.path === `${path}.${required}`)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.missingKey,
            `${path}.${required}`,
            `Required property "${required}" is absent.`,
          ),
        );
      }
    } else if (fields.get(required) === undefined) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.undefinedValue,
          `${path}.${required}`,
          `Required property "${required}" must not be undefined.`,
        ),
      );
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, fields };
}

export function readString(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = fields.get(key);
  if (typeof value !== "string") {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.typeMismatch,
        `${path}.${key}`,
        `Property "${key}" must be a string, received ${safeFormatValue(value)}.`,
      ),
    );
    return undefined;
  }
  return value;
}

export function readBoolean(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  const value = fields.get(key);
  if (typeof value !== "boolean") {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.typeMismatch,
        `${path}.${key}`,
        `Property "${key}" must be a boolean, received ${safeFormatValue(value)}.`,
      ),
    );
    return undefined;
  }
  return value;
}

/** Reads a bounded non-negative integer in the inclusive range [0, max]. */
export function readBoundedInteger(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  max: number,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  const value = fields.get(key);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.typeMismatch,
        `${path}.${key}`,
        `Property "${key}" must be an integer, received ${safeFormatValue(value)}.`,
      ),
    );
    return undefined;
  }
  if (value < 0 || value > max) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.${key}`,
        `Property "${key}" must be within [0, ${max}], received ${value}.`,
      ),
    );
    return undefined;
  }
  return value;
}

/** Reads a finite number in the inclusive range [min, max]. */
export function readBoundedNumber(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  min: number,
  max: number,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  const value = fields.get(key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.typeMismatch,
        `${path}.${key}`,
        `Property "${key}" must be a finite number, received ${safeFormatValue(value)}.`,
      ),
    );
    return undefined;
  }
  if (value < min || value > max) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.${key}`,
        `Property "${key}" must be within [${min}, ${max}], received ${value}.`,
      ),
    );
    return undefined;
  }
  return value;
}

export function readEnum<T extends string>(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
  issues: ValidationIssue[],
): T | undefined {
  const value = fields.get(key);
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.${key}`,
        `Property "${key}" must be one of the ${allowed.length} declared values, received ${safeFormatValue(value)}.`,
      ),
    );
    return undefined;
  }
  return value as T;
}

export type BoundedArrayCapture =
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Captures a dense array no longer than `max`. Sparse arrays fail closed. */
export function captureBoundedArray(
  value: unknown,
  max: number,
  path: string,
): BoundedArrayCapture {
  const capture = captureDenseArray(value);
  if (!capture.valid) {
    return {
      ok: false,
      issues: [
        issue(
          FC008_VALIDATION_CODES.sparseArray,
          path,
          `Value must be a dense array (${capture.reason}).`,
        ),
      ],
    };
  }
  if (capture.values.length > max) {
    return {
      ok: false,
      issues: [
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          path,
          `Array length ${capture.values.length} exceeds the frozen cap of ${max}.`,
        ),
      ],
    };
  }
  return { ok: true, values: capture.values };
}

export function invalid<T>(issues: readonly ValidationIssue[]): ValidationResult<T> {
  return { valid: false, issues };
}

export function valid<T>(value: T): ValidationResult<T> {
  return { valid: true, value, issues: [] };
}

// ============================================================================
// INERTNESS AND IMMUTABILITY INSPECTION (AI-1)
// ============================================================================

/**
 * Walks a value and returns the path of the first non-inert member found, or
 * null when the whole structure is inert.
 *
 * Inert means: null, string, number, boolean, dense array, or plain object.
 * Anything else — a function, a class instance, a Map, a Date, a Promise, a
 * symbol, or any host object such as an `Element`, `Node`, or `Event` — is
 * non-inert and must never appear in an FC-008 contract.
 */
export function findNonInertPath(value: unknown, path = "$"): string | null {
  if (value === null) {
    return null;
  }
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return null;
  }
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") {
    return `${path} (${type})`;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNonInertPath(value[i], `${path}[${i}]`);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isPlainObject(value)) {
    return `${path} (exotic object)`;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      return `${path}[symbol]`;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return `${path}.${key} (accessor)`;
    }
    const found = findNonInertPath(descriptor.value, `${path}.${key}`);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Returns the path of the first non-frozen object reachable from the value, or
 * null when every reachable object is frozen.
 */
export function findUnfrozenPath(value: unknown, path = "$"): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (!Object.isFrozen(value)) {
    return path;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnfrozenPath(value[i], `${path}[${i}]`);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const found = findUnfrozenPath((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Returns every property key reachable from a value, so tests can assert that
 * no prohibited feature-input name appears anywhere in the projector input.
 */
export function collectReachableKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") {
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReachableKeys(item, into);
    }
    return into;
  }
  for (const key of Object.keys(value)) {
    into.add(key);
    collectReachableKeys((value as Record<string, unknown>)[key], into);
  }
  return into;
}
