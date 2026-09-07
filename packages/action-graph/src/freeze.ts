/**
 * ActionGraph Deep Runtime Immutability (Sprint FC-003A)
 *
 * Provides a zero-dependency trusted deep-freeze utility for validated,
 * detached ActionGraph structures.
 *
 * Guarantees:
 * - Operates safely on detached, trusted validated graph records.
 * - Recursively freezes objects and arrays down to primitives.
 * - Uses a WeakSet to handle shared references safely and prevent infinite recursion.
 * - Leaves primitive values and null untouched.
 */

/**
 * Recursively freezes a detached, trusted ActionGraph value and all its nested
 * domain objects, arrays, canonical subjects, and source records.
 *
 * @param value The value to deeply freeze.
 * @param seen Internal WeakSet tracking visited objects to prevent cycles.
 * @returns The frozen value typed as immutable T.
 */
export function deepFreezeActionGraphValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      deepFreezeActionGraphValue(value[i], seen);
    }
    return Object.freeze(value);
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (desc && "value" in desc) {
      deepFreezeActionGraphValue(desc.value, seen);
    }
  }

  return Object.freeze(value);
}
