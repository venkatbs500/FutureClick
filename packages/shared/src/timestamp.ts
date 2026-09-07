/**
 * Timestamp utilities enforcing canonical UTC ISO-8601 string representation.
 *
 * FutureClick canonical format:
 * `YYYY-MM-DDTHH:mm:ss.sssZ` (strictly UTC with millisecond precision,
 * matching JavaScript Date.prototype.toISOString()).
 */

import type { Brand } from "./id.js";

export type IsoTimestamp = Brand<string, "IsoTimestamp">;

/**
 * Strict regex pattern for canonical UTC ISO-8601 strings:
 * Exactly 4-digit year, 2-digit month, 2-digit day, 'T',
 * 2-digit hour (00-23), 2-digit minute (00-59), 2-digit second (00-59),
 * 3-digit millisecond (000-999), and 'Z' timezone marker.
 */
const CANONICAL_ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Returns current timestamp in canonical UTC ISO-8601 format.
 */
export function currentIsoTimestamp(): IsoTimestamp {
  return new Date().toISOString() as IsoTimestamp;
}

/**
 * Validates whether a value is a strictly valid canonical UTC ISO-8601 timestamp string.
 *
 * Rejects:
 * - Natural language dates ("January 1, 2024")
 * - Ambiguous locale dates ("01/02/2024")
 * - Impossible calendar dates ("2024-02-30T00:00:00.000Z")
 * - Missing time or timezone components ("2024-01-01", "2024-01-01T00:00:00")
 * - Non-canonical millisecond precision
 * - Any string where round-trip Date.toISOString() does not match exactly
 */
export function isValidIsoTimestamp(value: string): value is IsoTimestamp {
  if (typeof value !== "string" || !CANONICAL_ISO_UTC_REGEX.test(value)) {
    return false;
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }
  return parsedDate.toISOString() === value;
}

/**
 * Safely casts a validated string to IsoTimestamp or throws an explicit descriptive error.
 */
export function parseIsoTimestamp(value: string): IsoTimestamp {
  if (!isValidIsoTimestamp(value)) {
    throw new Error(
      `Invalid canonical ISO timestamp: "${value}". Expected format: YYYY-MM-DDTHH:mm:ss.sssZ`,
    );
  }
  return value;
}
