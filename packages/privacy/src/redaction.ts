/**
 * Primitives for field redaction, password exclusion, and sensitive data protection.
 */

const KNOWN_PASSWORD_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth[_-]?code/i,
  /cvv/i,
  /credit[_-]?card/i,
  /ssn/i,
];

/**
 * Inspects element identifiers, input types, or accessibility labels
 * to detect password or secret fields that must NEVER be captured.
 */
export function isPasswordFieldIdentifier(identifier: string): boolean {
  if (!identifier || identifier.trim().length === 0) {
    return false;
  }
  return KNOWN_PASSWORD_PATTERNS.some((pattern) => pattern.test(identifier));
}

export const REDACTED_MARKER = "[REDACTED]";

/**
 * Safe string redaction utility.
 */
export function redactSensitiveString(input: string): string {
  if (!input) {
    return "";
  }
  return REDACTED_MARKER;
}

/**
 * Mask secret string preserving only the length hint if permissible.
 */
export function maskSecret(value: string): string {
  if (!value) {
    return "";
  }
  return "*".repeat(Math.min(value.length, 8));
}
