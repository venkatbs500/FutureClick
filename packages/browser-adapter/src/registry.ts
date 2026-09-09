/**
 * Browser Action Adapter Registry (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Immutable trusted static registry of BrowserActionAdapters.
 *
 * Guarantees:
 * - One-time dense array snapshotting prevents live array mutation / getter bypass.
 * - Enforces unique AdapterIds across all registered adapters.
 * - Deeply freezes the registry, adapter array, and adapter instances.
 */

import { syntheticRepositoryVisibilityAdapter } from "./adapters/synthetic-repository-visibility.js";
import {
  captureDenseArrayOnce,
  hasControlCharacters,
  isPlainObject,
  isValidMachineToken,
  isValidVersionToken,
  readOwnProperty,
  safeIsArray,
} from "./helpers.js";
import type {
  AdapterId,
  AdapterVersion,
  BrowserActionAdapter,
  BrowserAdapterRegistry,
} from "./types.js";

export const MAX_ADAPTER_ID_LENGTH = 128;
export const MAX_ADAPTER_VERSION_LENGTH = 32;
export const MAX_ADAPTER_DESCRIPTION_LENGTH = 256;

export interface AdapterValidationSuccess {
  readonly valid: true;
  readonly value: BrowserActionAdapter;
}

export interface AdapterValidationFailure {
  readonly valid: false;
  readonly message: string;
}

export type AdapterValidationResult = AdapterValidationSuccess | AdapterValidationFailure;

/**
 * Validates an individual untrusted adapter definition against structural invariants.
 */
export function validateBrowserActionAdapter(
  input: unknown,
  contextName = "adapter",
): AdapterValidationResult {
  if (!isPlainObject(input)) {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName} must be a plain object.`,
    };
  }

  const allowedKeys = new Set(["id", "version", "description", "assess"]);
  let keys: string[];
  try {
    keys = Object.keys(input);
  } catch {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] Failed reading keys of ${contextName}.`,
    };
  }
  for (const k of keys) {
    if (!allowedKeys.has(k)) {
      return {
        valid: false,
        message: `[INVALID_ADAPTER] Unexpected property "${k}" on ${contextName}.`,
      };
    }
  }

  // 1. id
  const idRead = readOwnProperty(input, "id");
  if (idRead.status !== "present" || typeof idRead.value !== "string") {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.id is required and must be a string.`,
    };
  }
  const idStr = idRead.value.trim();
  if (
    idStr.length === 0 ||
    idStr.length > MAX_ADAPTER_ID_LENGTH ||
    hasControlCharacters(idStr) ||
    !isValidMachineToken(idStr, MAX_ADAPTER_ID_LENGTH)
  ) {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.id must be a valid machine token (<= ${MAX_ADAPTER_ID_LENGTH} chars).`,
    };
  }

  // 2. version
  const verRead = readOwnProperty(input, "version");
  if (verRead.status !== "present" || typeof verRead.value !== "string") {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.version is required and must be a string.`,
    };
  }
  const verStr = verRead.value.trim();
  if (
    verStr.length === 0 ||
    verStr.length > MAX_ADAPTER_VERSION_LENGTH ||
    hasControlCharacters(verStr) ||
    !isValidVersionToken(verStr, MAX_ADAPTER_VERSION_LENGTH)
  ) {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.version must be a valid machine token (<= ${MAX_ADAPTER_VERSION_LENGTH} chars).`,
    };
  }

  // 3. description
  const descRead = readOwnProperty(input, "description");
  if (descRead.status !== "present" || typeof descRead.value !== "string") {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.description is required and must be a string.`,
    };
  }
  const descStr = descRead.value.trim();
  if (
    descStr.length === 0 ||
    descStr.length > MAX_ADAPTER_DESCRIPTION_LENGTH ||
    hasControlCharacters(descStr)
  ) {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.description must be non-empty (<= ${MAX_ADAPTER_DESCRIPTION_LENGTH} chars, no control chars).`,
    };
  }

  // 4. assess
  const assessRead = readOwnProperty(input, "assess");
  if (assessRead.status !== "present" || typeof assessRead.value !== "function") {
    return {
      valid: false,
      message: `[INVALID_ADAPTER] ${contextName}.assess must be a function.`,
    };
  }

  const validatedAdapter: BrowserActionAdapter = Object.freeze({
    id: idStr as AdapterId,
    version: verStr as AdapterVersion,
    description: descStr,
    assess: assessRead.value as BrowserActionAdapter["assess"],
  });

  return {
    valid: true,
    value: validatedAdapter,
  };
}

/**
 * Creates an immutable, trusted BrowserAdapterRegistry from an array of adapter definitions.
 * Performs safe dense array snapshotting and rejects duplicate AdapterIds.
 */
export const MAX_BROWSER_ADAPTER_COUNT = 256;

export function createBrowserAdapterRegistry(
  adapters: readonly BrowserActionAdapter[],
): BrowserAdapterRegistry {
  try {
    if (!safeIsArray(adapters)) {
      throw new Error("[INVALID_CONFIGURATION] Adapters must be provided as an array.");
    }

    const captureRes = captureDenseArrayOnce<BrowserActionAdapter>(
      adapters,
      "adapters",
      MAX_BROWSER_ADAPTER_COUNT,
    );
    if (!captureRes.ok) {
      throw new Error(
        captureRes.error.message.startsWith("[INVALID_CONFIGURATION]")
          ? captureRes.error.message
          : `[INVALID_CONFIGURATION] ${captureRes.error.message}`,
      );
    }

    const capturedAdapters = captureRes.value;
    const registeredAdapters: BrowserActionAdapter[] = [];
    const adapterMap = new Map<string, BrowserActionAdapter>();

    for (let i = 0; i < capturedAdapters.length; i++) {
      const rawAdapter = capturedAdapters[i];
      const validation = validateBrowserActionAdapter(rawAdapter, `adapters[${i}]`);
      if (!validation.valid) {
        throw new Error(
          validation.message.startsWith("[INVALID_CONFIGURATION]")
            ? validation.message
            : `[INVALID_CONFIGURATION] ${validation.message}`,
        );
      }

      const adapter = validation.value;
      if (adapterMap.has(adapter.id)) {
        throw new Error(
          `[INVALID_CONFIGURATION] Duplicate AdapterId "${adapter.id}". Each registered adapter must have a unique ID.`,
        );
      }

      adapterMap.set(adapter.id, adapter);
      registeredAdapters.push(adapter);
    }

    const frozenAdapters = Object.freeze([...registeredAdapters]);

    const registry: BrowserAdapterRegistry = {
      adapters: frozenAdapters,
      getAdapter(id: AdapterId): BrowserActionAdapter | undefined {
        return adapterMap.get(id);
      },
      hasAdapter(id: AdapterId): boolean {
        return adapterMap.has(id);
      },
    };

    return Object.freeze(registry);
  } catch (thrown) {
    if (
      thrown instanceof Error &&
      (thrown.message.startsWith("[INVALID_CONFIGURATION]") ||
        thrown.message.startsWith("[INVALID_ARRAY]") ||
        thrown.message.startsWith("[SPARSE_ARRAY]") ||
        thrown.message.startsWith("[INVALID_ADAPTER]"))
    ) {
      throw thrown;
    }
    throw new Error("[INVALID_CONFIGURATION] Failed creating adapter registry.");
  }
}

/**
 * Creates the default BrowserAdapterRegistry with built-in adapters.
 */
export function createDefaultBrowserAdapterRegistry(): BrowserAdapterRegistry {
  return createBrowserAdapterRegistry([syntheticRepositoryVisibilityAdapter]);
}
