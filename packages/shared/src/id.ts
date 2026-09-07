/**
 * Branded identifier helpers and entity ID generators for nominal type safety across FutureClick domains.
 *
 * Uniqueness and Determinism Guarantees:
 * - Production entity IDs (`generateEntityId`) use standard platform-native cryptographic
 *   random UUID generation (RFC 4122 v4 via `globalThis.crypto.randomUUID()`).
 * - Production IDs are opaque, non-semantic, non-deterministic, and collision-resistant across
 *   independent module instances, processes, and runtime targets (Node.js and modern browsers).
 * - Production generation does not rely on wall-clock timestamps, `Date.now()`, `Math.random()`,
 *   or module-global counters.
 * - Determinism is explicitly NOT promised for production IDs.
 * - Deterministic generation is supported ONLY for testing environments via explicitly instantiated
 *   and injected `IdGenerator` instances created via `createDeterministicIdGenerator(seed)`.
 *   State belongs exclusively to that specific generator instance. No process/module-global
 *   singleton exists.
 */

declare const brandKey: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brandKey]: B };

export interface IdGenerator {
  generate<TBrand extends string = string>(prefix?: string): Brand<string, TBrand>;
  nextId<TBrand extends string = string>(prefix?: string): Brand<string, TBrand>;
}

interface WebCryptoLike {
  readonly randomUUID?: () => string;
}

function getSecureRandomUUID(): string {
  const cryptoObj = (globalThis as unknown as { readonly crypto?: WebCryptoLike }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  throw new Error(
    "Secure random UUID generation is unavailable: globalThis.crypto.randomUUID is not supported in this runtime environment.",
  );
}

/**
 * Production entity ID generator using platform cryptographic random UUIDs.
 *
 * @param prefix Optional domain prefix (e.g., 'act', 'state', 'csq') for readability.
 * @returns An opaque, cryptographically random branded identifier.
 */
export function generateEntityId<TBrand extends string>(prefix?: string): Brand<string, TBrand> {
  const uuid = getSecureRandomUUID();
  return (prefix ? `${prefix}-${uuid}` : uuid) as Brand<string, TBrand>;
}

/**
 * Creates an isolated, injectable deterministic generator for testing environments
 * where predictable identifier sequences are required.
 *
 * All state is encapsulated strictly within the returned generator instance.
 */
export function createDeterministicIdGenerator(seed = "det"): IdGenerator {
  let counter = 0;
  const generate = <TBrand extends string = string>(prefix?: string): Brand<string, TBrand> => {
    counter += 1;
    const indexStr = counter.toString().padStart(4, "0");
    return (prefix ? `${prefix}-${seed}-${indexStr}` : `${seed}-${indexStr}`) as Brand<
      string,
      TBrand
    >;
  };
  return {
    generate,
    nextId: generate,
  };
}
