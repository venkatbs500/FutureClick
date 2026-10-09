/**
 * Deep freeze for public FC-009 structures. Caller mutation must not leak in.
 */

function isFrozenObject(value: object): boolean {
  return Object.isFrozen(value);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (isFrozenObject(value) && !Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      const child = Reflect.get(value, key);
      deepFreeze(child);
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  for (const key of Reflect.ownKeys(value)) {
    const child = Reflect.get(value, key);
    deepFreeze(child);
  }
  return Object.freeze(value);
}
