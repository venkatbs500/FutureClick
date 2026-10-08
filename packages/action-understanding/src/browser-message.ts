/**
 * FC-008 Sprint 5B — closed browser message schema.
 *
 * Even though the current extension has no background/service-worker hop, any
 * value that could cross a process boundary must already be a sanitized
 * ActionObservation payload. Raw DOM, HTML, events, and secrets are unnameable.
 */

import { MAX_FRESHNESS_COUNTER } from "./freshness.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  inspectClosedObject,
  invalid,
  issue,
  readBoundedInteger,
  readEnum,
  readString,
  valid,
} from "./validation.js";

export const FC008_BROWSER_MESSAGE_TYPE = "fc008.understand-action" as const;
export const FC008_BROWSER_MESSAGE_SCHEMA_VERSION = "1.0" as const;

export const FC008_BROWSER_MESSAGE_KEYS = Object.freeze([
  "type",
  "schemaVersion",
  "observationSequence",
  "inputFingerprint",
  "observation",
] as const);

/**
 * Keys that must never appear on an FC-008 browser message. Presence is a
 * closed-shape rejection, not a redaction.
 */
export const FC008_BROWSER_MESSAGE_FORBIDDEN_KEYS = Object.freeze([
  "html",
  "innerHTML",
  "outerHTML",
  "dom",
  "document",
  "element",
  "node",
  "event",
  "nativeEvent",
  "selector",
  "cssPath",
  "xpath",
  "password",
  "token",
  "cookie",
  "cookies",
  "storage",
  "screenshot",
  "clipboard",
  "keystrokes",
  "axDump",
  "accessibilityTree",
] as const);

export interface Fc008UnderstandActionMessage {
  readonly type: typeof FC008_BROWSER_MESSAGE_TYPE;
  readonly schemaVersion: typeof FC008_BROWSER_MESSAGE_SCHEMA_VERSION;
  readonly observationSequence: number;
  readonly inputFingerprint: string;
  readonly observation: unknown;
}

export function validateFc008BrowserMessage(
  input: unknown,
  path = "fc008BrowserMessage",
): ValidationResult<Fc008UnderstandActionMessage> {
  const inspection = inspectClosedObject(input, FC008_BROWSER_MESSAGE_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;
  const type = readEnum(fields, "type", [FC008_BROWSER_MESSAGE_TYPE], path, issues);
  const schemaVersion = readEnum(
    fields,
    "schemaVersion",
    [FC008_BROWSER_MESSAGE_SCHEMA_VERSION],
    path,
    issues,
  );
  const observationSequence = readBoundedInteger(
    fields,
    "observationSequence",
    MAX_FRESHNESS_COUNTER,
    path,
    issues,
  );
  const inputFingerprint = readString(fields, "inputFingerprint", path, issues);
  const observation = fields.get("observation");
  if (observation === undefined) {
    issues.push(
      issue(FC008_VALIDATION_CODES.missingKey, `${path}.observation`, "observation is required."),
    );
  }
  if (issues.length > 0 || type === undefined || schemaVersion === undefined) {
    return invalid(issues);
  }
  if (observationSequence === undefined || inputFingerprint === undefined) {
    return invalid(issues);
  }
  return valid(
    Object.freeze({
      type,
      schemaVersion,
      observationSequence,
      inputFingerprint,
      observation,
    }),
  );
}
