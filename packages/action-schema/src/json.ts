/**
 * Safe JSON value validation with recursion protection, cycle detection, and NaN/Infinity rejection.
 */

import type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./types.js";

export interface JsonValidationIssue {
  readonly code: "INVALID_JSON_VALUE" | "CYCLE_DETECTED" | "MAX_DEPTH_EXCEEDED" | "INVALID_TYPE";
  readonly path: string;
  readonly message: string;
}

export type JsonValidationResult =
  | {
      readonly valid: true;
      readonly value: JsonValue;
      readonly issues: readonly JsonValidationIssue[];
    }
  | {
      readonly valid: false;
      readonly issues: readonly JsonValidationIssue[];
    };

export const MAX_JSON_VALUE_DEPTH = 32;

/**
 * Checks whether an object is a plain object (not a function, array, Set, Map, Date, RegExp, etc.).
 * Defensive against hostile prototypes, throwing getters, and revoked proxies.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    if (Array.isArray(value)) {
      return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

export type DenseArrayCaptureResult =
  | { readonly valid: true; readonly values: readonly unknown[] }
  | {
      readonly valid: false;
      readonly reason: "not_array" | "invalid_length" | "sparse_or_read_error";
    };

/**
 * Coherent internal dense-array capture operation (FC-002D).
 * 1. Safely verifies it is an array without throwing on revoked proxies.
 * 2. Captures `length` EXACTLY ONCE into a local variable.
 * 3. Verifies density for indices 0 .. capturedLength - 1.
 * 4. Captures each element into a detached array snapshot.
 * 5. Returns invalid on any proxy trap / read failure / hole.
 */
export function captureDenseArray(input: unknown): DenseArrayCaptureResult {
  if (typeof input !== "object" || input === null) {
    return { valid: false, reason: "not_array" };
  }
  try {
    if (!Array.isArray(input)) {
      return { valid: false, reason: "not_array" };
    }
    // 1. Capture length EXACTLY ONCE
    const len = (input as { readonly length: unknown }).length;
    if (
      typeof len !== "number" ||
      !Number.isInteger(len) ||
      len < 0 ||
      !Number.isSafeInteger(len)
    ) {
      return { valid: false, reason: "invalid_length" };
    }
    // 2. Validate density and capture elements into detached array
    const values: unknown[] = new Array(len);
    for (let i = 0; i < len; i++) {
      if (!Object.prototype.hasOwnProperty.call(input, i)) {
        return { valid: false, reason: "sparse_or_read_error" };
      }
      values[i] = (input as Record<number, unknown>)[i];
    }
    return { valid: true, values };
  } catch {
    return { valid: false, reason: "sparse_or_read_error" };
  }
}

/**
 * Verifies that an array is dense (has no unassigned holes / sparse indices).
 * Exception-safe: proxy traps on length or property checks never throw, returning false.
 * Uses the same coherent capture logic as captureDenseArray.
 */
export function isDenseArray(arr: unknown): arr is unknown[] {
  return captureDenseArray(arr).valid;
}

/**
 * Recursively freezes an already-validated canonical domain object or JSON snapshot.
 * Safe for domain records, arrays, primitives, and null-prototype objects.
 * Uses a WeakSet to handle shared DAG references without redundant traversals.
 * Operates strictly on trusted, validated canonical data.
 */
export function deepFreezeCanonical<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const visited = new WeakSet<object>();

  function freezeRecursive(current: object): void {
    if (visited.has(current)) {
      return;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const item = current[i];
        if (item !== null && typeof item === "object") {
          freezeRecursive(item);
        }
      }
    } else {
      const keys = Object.keys(current);
      for (const key of keys) {
        const prop = (current as Record<string, unknown>)[key];
        if (prop !== null && typeof prop === "object") {
          freezeRecursive(prop);
        }
      }
    }

    Object.freeze(current);
  }

  freezeRecursive(value as object);
  return Object.freeze(value) as Readonly<T>;
}

/**
 * Recursively validates that untrusted input contains strictly JSON-safe values:
 * - Primitives: string, finite number (no NaN, Infinity, -Infinity), boolean, null
 * - Arrays: elements must be JSON-safe and array must be dense (no sparse holes)
 * - Plain objects: keys and values must be JSON-safe
 * - Disallowed: undefined, bigint, symbol, function, class instances, cyclic references
 * - Max depth protection against stack overflow
 * - Active recursion-path cycle detection: allows shared references / DAGs while rejecting cycles
 * - Hostile getter protection: catches throwing getters and reports failure without throwing
 * - Returns a detached, sanitized validated JsonValue snapshot preserving value semantics
 * - Safely constructs own data properties via Object.defineProperty to preserve __proto__, constructor, and prototype
 */
export function validateJsonValue(
  input: unknown,
  options?: {
    readonly maxDepth?: number;
    readonly path?: string;
    readonly requireObject?: boolean;
  },
): JsonValidationResult {
  const rootPath = options?.path ?? "$";
  const maxDepth = options?.maxDepth ?? MAX_JSON_VALUE_DEPTH;
  const issues: JsonValidationIssue[] = [];
  const activeStack = new Set<object>();

  if (options?.requireObject && !isPlainObject(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_TYPE",
          path: rootPath,
          message: "Expected a plain JSON object.",
        },
      ],
    };
  }

  function validateRecursive(
    val: unknown,
    currentPath: string,
    currentDepth: number,
  ): { valid: boolean; snapshot?: JsonValue } {
    if (currentDepth > maxDepth) {
      issues.push({
        code: "MAX_DEPTH_EXCEEDED",
        path: currentPath,
        message: `JSON value exceeds maximum allowed depth of ${maxDepth}.`,
      });
      return { valid: false };
    }

    if (val === null) {
      return { valid: true, snapshot: null };
    }

    if (typeof val === "boolean" || typeof val === "string") {
      return { valid: true, snapshot: val };
    }

    if (typeof val === "number") {
      if (!Number.isFinite(val)) {
        issues.push({
          code: "INVALID_JSON_VALUE",
          path: currentPath,
          message:
            "Non-finite numbers (NaN, Infinity, -Infinity) are not allowed in canonical JSON.",
        });
        return { valid: false };
      }
      return { valid: true, snapshot: val };
    }

    if (val === undefined) {
      issues.push({
        code: "INVALID_JSON_VALUE",
        path: currentPath,
        message: "undefined is not allowed in canonical JSON values.",
      });
      return { valid: false };
    }

    if (typeof val === "bigint" || typeof val === "symbol" || typeof val === "function") {
      issues.push({
        code: "INVALID_JSON_VALUE",
        path: currentPath,
        message: `${typeof val} is not allowed in canonical JSON values.`,
      });
      return { valid: false };
    }

    if (typeof val === "object") {
      if (activeStack.has(val)) {
        issues.push({
          code: "CYCLE_DETECTED",
          path: currentPath,
          message: "Circular reference detected in canonical JSON value.",
        });
        return { valid: false };
      }

      activeStack.add(val);

      try {
        let isArr = false;
        try {
          isArr = Array.isArray(val);
        } catch {
          issues.push({
            code: "INVALID_JSON_VALUE",
            path: currentPath,
            message: "Array inspection failed or proxy was revoked.",
          });
          return { valid: false };
        }

        if (isArr) {
          const captureRes = captureDenseArray(val);
          if (!captureRes.valid) {
            issues.push({
              code: "INVALID_JSON_VALUE",
              path: currentPath,
              message:
                captureRes.reason === "invalid_length"
                  ? "Array length is invalid or could not be read."
                  : "Sparse arrays containing unassigned slots or array read errors are not allowed in canonical JSON.",
            });
            return { valid: false };
          }

          const rawElements = captureRes.values;
          const arrSnapshot: JsonValue[] = [];
          let allValid = true;

          for (let i = 0; i < rawElements.length; i++) {
            const item = rawElements[i];
            const childRes = validateRecursive(item, `${currentPath}[${i}]`, currentDepth + 1);
            if (!childRes.valid) {
              allValid = false;
            } else {
              arrSnapshot.push(childRes.snapshot as JsonValue);
            }
          }
          if (!allValid) {
            return { valid: false };
          }
          return { valid: true, snapshot: arrSnapshot };
        }

        if (isPlainObject(val)) {
          let allValid = true;
          let keys: string[];
          try {
            keys = Object.keys(val);
          } catch {
            issues.push({
              code: "INVALID_JSON_VALUE",
              path: currentPath,
              message: "Object key enumeration threw an error.",
            });
            return { valid: false };
          }

          const objSnapshot: Record<string, JsonValue> = {};
          for (const key of keys) {
            let propVal: unknown;
            try {
              propVal = (val as Record<string, unknown>)[key];
            } catch {
              issues.push({
                code: "INVALID_JSON_VALUE",
                path: currentPath ? `${currentPath}.${key}` : key,
                message: "Object property getter threw an error.",
              });
              return { valid: false };
            }

            const childPath = currentPath ? `${currentPath}.${key}` : key;
            const childRes = validateRecursive(propVal, childPath, currentDepth + 1);
            if (!childRes.valid) {
              allValid = false;
            } else {
              Object.defineProperty(objSnapshot, key, {
                value: childRes.snapshot as JsonValue,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            }
          }
          if (!allValid) {
            return { valid: false };
          }
          return { valid: true, snapshot: objSnapshot };
        }

        // Object is a class instance, Date, RegExp, Map, Set, or revoked proxy
        issues.push({
          code: "INVALID_JSON_VALUE",
          path: currentPath,
          message: "Non-plain object instances are not allowed in canonical JSON.",
        });
        return { valid: false };
      } finally {
        activeStack.delete(val);
      }
    }

    issues.push({
      code: "INVALID_JSON_VALUE",
      path: currentPath,
      message: `Unknown runtime value of type ${typeof val} is not allowed in canonical JSON.`,
    });
    return { valid: false };
  }

  try {
    const result = validateRecursive(input, rootPath, 0);
    const isSuccess = result.valid && issues.length === 0;
    if (isSuccess && result.snapshot !== undefined) {
      return {
        valid: true,
        value: result.snapshot,
        issues,
      };
    }
    return {
      valid: false,
      issues,
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_JSON_VALUE",
          path: rootPath,
          message: "Unexpected error encountered while traversing runtime value.",
        },
      ],
    };
  }
}
