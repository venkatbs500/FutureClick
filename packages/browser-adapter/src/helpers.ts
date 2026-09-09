/**
 * Safe Property Access, Dense Array Capture, and Token Helpers (Sprint FC-005)
 *
 * Epistemological Boundary:
 * All property access across untrusted input boundaries must be safe, non-throwing,
 * and guarded against hostile getters, sparse arrays, and prototype tampering.
 */

// ============================================================================
// 1. SAFE PROPERTY ACCESS
// ============================================================================

export type SafePropertyRead =
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly value: unknown }
  | { readonly status: "error"; readonly error: Error };

/**
 * Normalizes an unknown thrown value into a standard Error.
 */
export function normalizeThrownError(cause: unknown, fallbackMessage: string): Error {
  try {
    if (cause instanceof Error) {
      return new Error(`${fallbackMessage}: ${cause.message}`);
    }
    if (typeof cause === "string" && cause.trim().length > 0) {
      return new Error(`${fallbackMessage}: ${cause.trim()}`);
    }
  } catch {
    return new Error(fallbackMessage);
  }
  return new Error(fallbackMessage);
}

/**
 * Safely inspects an own property on target and invokes its getter at most once.
 * Distinguishes absent, present, and read-error states without throwing.
 */
export function readOwnProperty(target: unknown, key: PropertyKey): SafePropertyRead {
  if (typeof target !== "object" || target === null) {
    return { status: "absent" };
  }
  try {
    const hasOwn = Object.prototype.hasOwnProperty.call(target, key);
    if (!hasOwn) {
      return { status: "absent" };
    }
    const value = (target as Record<PropertyKey, unknown>)[key];
    return { status: "present", value };
  } catch {
    return {
      status: "error",
      error: new Error("Failed reading own property."),
    };
  }
}

/**
 * Safely checks if a value is an Array without throwing on revoked Proxies.
 */
export function safeIsArray(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Determines whether a value is a plain JavaScript object (Object.prototype or null prototype).
 * Safe against hostile objects or revoked Proxies whose getPrototypeOf trap throws.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

// ============================================================================
// 2. DENSE ARRAY CAPTURE
// ============================================================================

export type DenseArrayCaptureResult<T> =
  | { readonly ok: true; readonly value: readonly T[] }
  | { readonly ok: false; readonly error: Error };

/**
 * Captures a dense snapshot of an array-like structure exactly once.
 *
 * Guarantees:
 * - Reads length exactly once.
 * - Enforces maxLength bound BEFORE any allocation or index iteration.
 * - Checks and reads each index [0..length-1] exactly once.
 * - Rejects sparse arrays (missing keys/holes).
 * - Catches hostile getters with fail-closed errors.
 * - Produces a detached, frozen ordinary array.
 */
export function captureDenseArrayOnce<T = unknown>(
  input: unknown,
  contextName = "array",
  maxLength?: number,
): DenseArrayCaptureResult<T> {
  if (!safeIsArray(input)) {
    return {
      ok: false,
      error: new Error(`[INVALID_ARRAY] Expected ${contextName} to be an array.`),
    };
  }

  let rawLength: unknown;
  try {
    rawLength = (input as { readonly length: unknown }).length;
  } catch {
    return {
      ok: false,
      error: new Error(`[INVALID_ARRAY] Failed reading length of ${contextName}.`),
    };
  }

  if (typeof rawLength !== "number" || !Number.isSafeInteger(rawLength) || rawLength < 0) {
    return {
      ok: false,
      error: new Error(
        `[INVALID_ARRAY] ${contextName}.length must be a non-negative safe integer.`,
      ),
    };
  }

  if (maxLength !== undefined && rawLength > maxLength) {
    return {
      ok: false,
      error: new Error(
        `[INVALID_ARRAY] ${contextName}.length exceeds maximum allowed length of ${maxLength}.`,
      ),
    };
  }

  if (rawLength > 4294967295) {
    return {
      ok: false,
      error: new Error(`[INVALID_ARRAY] ${contextName}.length exceeds maximum array length.`),
    };
  }

  const length = rawLength;
  let snapshot: T[];
  try {
    snapshot = new Array(length);
  } catch {
    return {
      ok: false,
      error: new Error(`[INVALID_ARRAY] Failed allocating snapshot for ${contextName}.`),
    };
  }

  for (let i = 0; i < length; i++) {
    let hasIndex = false;
    try {
      hasIndex = Object.prototype.hasOwnProperty.call(input, i) || i in (input as object);
    } catch {
      return {
        ok: false,
        error: new Error(`[INVALID_ARRAY] Failed checking index ${i} in ${contextName}.`),
      };
    }

    if (!hasIndex) {
      return {
        ok: false,
        error: new Error(
          `[SPARSE_ARRAY] ${contextName} contains missing index at [${i}]. Sparse arrays are rejected.`,
        ),
      };
    }

    let element: unknown;
    try {
      element = (input as Record<number, unknown>)[i];
    } catch {
      return {
        ok: false,
        error: new Error(
          `[INVALID_ARRAY] Failed reading element at index [${i}] in ${contextName}.`,
        ),
      };
    }

    snapshot[i] = element as T;
  }

  return {
    ok: true,
    value: Object.freeze(snapshot),
  };
}

// ============================================================================
// 3. TOKEN GRAMMAR & STRING BOUNDS
// ============================================================================

export const MACHINE_TOKEN_REGEX = /^[a-z][a-zA-Z0-9_.-]*$/;
export const VERSION_TOKEN_REGEX = /^[a-z0-9][a-z0-9_.-]*$/;
export const ROLE_TOKEN_REGEX = /^[a-z][a-z0-9_-]*$/;
export const ORIGIN_REGEX = /^https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/;
export const REASON_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;
export const ERROR_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;

export function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isValidMachineToken(value: unknown, maxLength = 64): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return MACHINE_TOKEN_REGEX.test(value);
}

export function isValidVersionToken(value: unknown, maxLength = 32): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return VERSION_TOKEN_REGEX.test(value);
}

export function isValidRoleToken(value: unknown, maxLength = 32): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return ROLE_TOKEN_REGEX.test(value);
}

export function isValidOrigin(value: unknown, maxLength = 256): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return ORIGIN_REGEX.test(value);
}

export function isValidReasonCode(value: unknown, maxLength = 64): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return REASON_CODE_REGEX.test(value);
}

export function isValidErrorCode(value: unknown, maxLength = 64): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (hasControlCharacters(value)) return false;
  return ERROR_CODE_REGEX.test(value);
}

// ============================================================================
// 4. DEEP FREEZE & UTF-8 SIZING
// ============================================================================

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  try {
    if (value === null || typeof value !== "object") {
      return value;
    }

    try {
      if (seen.has(value as object)) {
        return value;
      }
      seen.add(value as object);
    } catch {
      return value;
    }

    let isArr = false;
    try {
      isArr = safeIsArray(value);
    } catch {
      return value;
    }

    if (isArr) {
      let len = 0;
      try {
        len = (value as unknown[]).length;
      } catch {
        return value;
      }
      for (let i = 0; i < len; i++) {
        try {
          deepFreeze((value as unknown[])[i], seen);
        } catch {
          // Continue
        }
      }
    } else {
      let keys: string[] = [];
      try {
        keys = Object.keys(value as object);
      } catch {
        // Cannot enumerate keys
      }
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k !== undefined) {
          try {
            deepFreeze((value as Record<string, unknown>)[k], seen);
          } catch {
            // Continue
          }
        }
      }
    }

    try {
      return Object.freeze(value) as Readonly<T>;
    } catch {
      return value;
    }
  } catch {
    return value;
  }
}

interface GlobalWithEncoder {
  readonly TextEncoder?: new () => {
    readonly encode: (input: string) => { readonly length: number };
  };
}

export function getUtf8ByteLength(str: string): number {
  const g = globalThis as unknown as GlobalWithEncoder;
  if (typeof g.TextEncoder === "function") {
    return new g.TextEncoder().encode(str).length;
  }
  // Pure fallback: calculate UTF-8 byte length manually
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const codePoint = str.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
      i++; // Surrogate pair
    }
  }
  return bytes;
}
