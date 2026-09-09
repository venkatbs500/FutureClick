/**
 * Privacy Boundaries, URL Minimization, and Sensitive Control Exclusions (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Enforces strict data minimization at the browser capture boundary.
 * - Zero form or editable field values are ever captured.
 * - URLs are strictly sanitized to origin + static routeId (no query/hash/credentials/path).
 * - Sensitive elements (passwords, OTPs, payment fields, textareas) are rejected fail-closed.
 */

import { isPasswordFieldIdentifier } from "@futureclick/privacy";

// ============================================================================
// 1. EXACT LOCAL FIXTURE AUTHORIZATION
// ============================================================================

export const AUTHORIZED_FIXTURE_ORIGIN = "http://127.0.0.1:4173";
export const AUTHORIZED_FIXTURE_PATHNAME = "/fc005/repository-visibility.html";
export const AUTHORIZED_FIXTURE_ROUTE_ID = "synthetic.repository-visibility";

export interface UrlAuthorizationComponents {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
}

export interface UrlAuthorizationResult {
  readonly authorized: boolean;
  readonly origin?: string | undefined;
  readonly routeId?: string | undefined;
  readonly rejectionReason?: string | undefined;
}

/**
 * Authorizes a location strictly against the exact local FC-005 fixture boundary.
 * Never retains or exposes query strings, search parameters, fragments, or credentials.
 */
export function authorizeFixtureLocation(
  components: UrlAuthorizationComponents,
): UrlAuthorizationResult {
  if (components.protocol !== "http:") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PROTOCOL" };
  }
  if (components.hostname !== "127.0.0.1") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_HOSTNAME" };
  }
  if (components.port !== "4173") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PORT" };
  }
  if (components.pathname !== AUTHORIZED_FIXTURE_PATHNAME) {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PATHNAME" };
  }

  return {
    authorized: true,
    origin: AUTHORIZED_FIXTURE_ORIGIN,
    routeId: AUTHORIZED_FIXTURE_ROUTE_ID,
  };
}

// ============================================================================
// 2. SENSITIVE CONTROL EXCLUSION
// ============================================================================

const EXCLUDED_TAG_NAMES = new Set([
  "input",
  "textarea",
  "select",
  "option",
  "form",
  "fieldset",
  "datalist",
  "keygen",
  "output",
]);

const SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth[_-]?code/i,
  /otp/i,
  /cvv/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /ssn/i,
  /security[_-]?answer/i,
  /private[_-]?key/i,
];

export interface ControlDescriptorForPrivacyCheck {
  readonly tagName: string;
  readonly isContentEditable?: boolean | undefined;
  readonly inputType?: string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly className?: string | undefined;
  readonly ariaRole?: string | undefined;
}

export interface ControlPrivacyAssessment {
  readonly permitted: boolean;
  readonly reasonCode?: string | undefined;
}

/**
 * Assesses whether a DOM control element is permitted for observation.
 *
 * Strict policy:
 * - Only native <button type="button"> or plain button controls are permitted.
 * - Any input, textarea, select, contenteditable, file input, or sensitive field is rejected.
 * - Never inspects or reads the control's value.
 */
export function assessControlPrivacy(
  control: ControlDescriptorForPrivacyCheck,
): ControlPrivacyAssessment {
  const tag = control.tagName.toLowerCase().trim();

  // 1. Reject editable / form tags
  if (EXCLUDED_TAG_NAMES.has(tag)) {
    return { permitted: false, reasonCode: "EXCLUDED_FORM_TAG" };
  }

  // 2. Reject contenteditable
  if (control.isContentEditable === true) {
    return { permitted: false, reasonCode: "CONTENTEDITABLE_EXCLUDED" };
  }

  // 3. Reject non-button tags
  if (tag !== "button") {
    return { permitted: false, reasonCode: "NON_BUTTON_ELEMENT" };
  }

  // 4. Reject submit / reset buttons (only type="button" allowed for synthetic activation)
  if (control.inputType !== undefined) {
    const btnType = control.inputType.toLowerCase().trim();
    if (btnType !== "button" && btnType !== "") {
      return { permitted: false, reasonCode: "UNSUPPORTED_BUTTON_TYPE" };
    }
  }

  // 5. Defense-in-depth: inspect element structural attributes for password/secret markers
  const identifiers = [control.id, control.name, control.className, control.ariaRole].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  for (const idStr of identifiers) {
    if (isPasswordFieldIdentifier(idStr)) {
      return { permitted: false, reasonCode: "SENSITIVE_IDENTIFIER_EXCLUDED" };
    }
    if (SENSITIVE_PATTERNS.some((pat) => pat.test(idStr))) {
      return { permitted: false, reasonCode: "SENSITIVE_PATTERN_EXCLUDED" };
    }
  }

  return { permitted: true };
}
