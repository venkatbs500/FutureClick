/**
 * Browser Observation Runtime Validation (Sprint FC-005)
 *
 * Epistemological Boundary:
 * All observation inputs crossing from the browser extension into the adapter layer
 * must be strictly and authoritatively validated.
 *
 * Invariants:
 * - Closed object shapes (extra/unexpected fields rejected).
 * - Safe own-property reads (protecting against hostile getters).
 * - String length bounds and machine token grammar validation.
 * - Max UTF-8 serialized size check (<= 4 KiB) on detached valid object.
 * - Zero references to DOM or browser window objects.
 * - Deep runtime immutability on return values.
 */

import { type Result, err, isValidIsoTimestamp, ok } from "@futureclick/shared";
import {
  captureDenseArrayOnce,
  deepFreeze,
  getUtf8ByteLength,
  hasControlCharacters,
  isPlainObject,
  isValidErrorCode,
  isValidMachineToken,
  isValidOrigin,
  isValidReasonCode,
  isValidRoleToken,
  readOwnProperty,
  safeIsArray,
} from "./helpers.js";
import {
  BROWSER_OBSERVATION_SCHEMA_VERSION,
  type AdapterDecision,
  type BrowserContextDraft,
  type BrowserElementDescriptor,
  type BrowserInteractionDescriptor,
  type BrowserObservation,
  type BrowserObservationId,
  type BrowserObservationMetadata,
  type BrowserPageDescriptor,
} from "./types.js";

export const MAX_OBSERVATION_SERIALIZED_BYTES = 4096; // 4 KiB
export const MAX_ID_LENGTH = 128;
export const MAX_ENTITY_KEY_LENGTH = 64;
export const MAX_VISIBILITY_VALUE_LENGTH = 128;
export const MAX_ADAPTER_MISSING_COUNT = 16;

export type ObservationValidationIssueCode =
  | "INVALID_TYPE"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PAGE"
  | "INVALID_INTERACTION"
  | "INVALID_ELEMENT"
  | "INVALID_METADATA"
  | "UNEXPECTED_PROPERTY"
  | "EXPLICIT_UNDEFINED"
  | "READ_ERROR"
  | "OVERSIZED_OBSERVATION";

export interface ObservationValidationIssue {
  readonly code: ObservationValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ObservationValidationResult = Result<
  BrowserObservation,
  readonly ObservationValidationIssue[]
>;

/**
 * Validates a BrowserObservation strictly against the closed FC-005 specification.
 */
export function validateBrowserObservation(input: unknown): ObservationValidationResult {
  const issues: ObservationValidationIssue[] = [];

  if (!isPlainObject(input)) {
    return err([
      {
        code: "INVALID_TYPE",
        path: "observation",
        message: "BrowserObservation must be a plain, non-null object.",
      },
    ]);
  }

  // Check top-level allowed keys
  const allowedTopKeys = new Set([
    "schemaVersion",
    "id",
    "capturedAt",
    "page",
    "interaction",
    "element",
    "metadata",
  ]);

  let topKeys: string[];
  try {
    topKeys = Object.keys(input);
  } catch {
    return err([
      {
        code: "READ_ERROR",
        path: "observation",
        message: "Failed enumerating properties on observation.",
      },
    ]);
  }

  for (const k of topKeys) {
    if (!allowedTopKeys.has(k)) {
      issues.push({
        code: "UNEXPECTED_PROPERTY",
        path: `observation.${k}`,
        message: `Unexpected property "${k}" on BrowserObservation.`,
      });
    }
  }

  // 1. schemaVersion
  const verRead = readOwnProperty(input, "schemaVersion");
  let validVersion: typeof BROWSER_OBSERVATION_SCHEMA_VERSION | undefined;
  if (verRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.schemaVersion",
      message: "Failed reading schemaVersion property.",
    });
  } else if (verRead.status === "absent") {
    issues.push({
      code: "INVALID_SCHEMA_VERSION",
      path: "observation.schemaVersion",
      message: "BrowserObservation must have a schemaVersion.",
    });
  } else if (typeof verRead.value !== "string") {
    issues.push({
      code: "INVALID_SCHEMA_VERSION",
      path: "observation.schemaVersion",
      message: `BrowserObservation schemaVersion must be a string. Expected "${BROWSER_OBSERVATION_SCHEMA_VERSION}".`,
    });
  } else if (verRead.value !== BROWSER_OBSERVATION_SCHEMA_VERSION) {
    issues.push({
      code: "INVALID_SCHEMA_VERSION",
      path: "observation.schemaVersion",
      message: `Unsupported observation schemaVersion. Expected "${BROWSER_OBSERVATION_SCHEMA_VERSION}".`,
    });
  } else {
    validVersion = BROWSER_OBSERVATION_SCHEMA_VERSION;
  }

  // 2. id
  const idRead = readOwnProperty(input, "id");
  let validId: BrowserObservationId | undefined;
  if (idRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.id",
      message: "Failed reading id property.",
    });
  } else if (idRead.status === "absent") {
    issues.push({
      code: "INVALID_ID",
      path: "observation.id",
      message: "BrowserObservation must have an id.",
    });
  } else if (typeof idRead.value !== "string") {
    issues.push({
      code: "INVALID_ID",
      path: "observation.id",
      message: "BrowserObservation id must be a string.",
    });
  } else {
    const trimmed = idRead.value.trim();
    if (trimmed.length === 0) {
      issues.push({
        code: "INVALID_ID",
        path: "observation.id",
        message: "BrowserObservation id must not be empty or whitespace-only.",
      });
    } else if (trimmed.length > MAX_ID_LENGTH) {
      issues.push({
        code: "INVALID_ID",
        path: "observation.id",
        message: `BrowserObservation id exceeds maximum length of ${MAX_ID_LENGTH} characters.`,
      });
    } else if (hasControlCharacters(trimmed)) {
      issues.push({
        code: "INVALID_ID",
        path: "observation.id",
        message: "BrowserObservation id contains forbidden control characters.",
      });
    } else {
      validId = trimmed as BrowserObservationId;
    }
  }

  // 3. capturedAt
  const timeRead = readOwnProperty(input, "capturedAt");
  let validCapturedAt: import("@futureclick/shared").IsoTimestamp | undefined;
  if (timeRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.capturedAt",
      message: "Failed reading capturedAt property.",
    });
  } else if (timeRead.status === "absent") {
    issues.push({
      code: "INVALID_TIMESTAMP",
      path: "observation.capturedAt",
      message: "BrowserObservation must have a capturedAt timestamp.",
    });
  } else if (typeof timeRead.value !== "string" || !isValidIsoTimestamp(timeRead.value)) {
    issues.push({
      code: "INVALID_TIMESTAMP",
      path: "observation.capturedAt",
      message: "capturedAt must be a valid canonical UTC ISO-8601 timestamp string.",
    });
  } else {
    validCapturedAt = timeRead.value;
  }

  // 4. page
  const pageRead = readOwnProperty(input, "page");
  let validPage: BrowserPageDescriptor | undefined;
  if (pageRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.page",
      message: "Failed reading page property.",
    });
  } else if (pageRead.status === "absent") {
    issues.push({
      code: "INVALID_PAGE",
      path: "observation.page",
      message: "BrowserObservation must have a page descriptor.",
    });
  } else if (!isPlainObject(pageRead.value)) {
    issues.push({
      code: "INVALID_PAGE",
      path: "observation.page",
      message: "observation.page must be a plain object.",
    });
  } else {
    const pageObj = pageRead.value;
    const allowedPageKeys = new Set(["origin", "routeId"]);
    let pageKeys: string[];
    try {
      pageKeys = Object.keys(pageObj);
    } catch {
      issues.push({
        code: "READ_ERROR",
        path: "observation.page",
        message: "Failed enumerating properties on observation.page.",
      });
      pageKeys = [];
    }
    for (const k of pageKeys) {
      if (!allowedPageKeys.has(k)) {
        issues.push({
          code: "UNEXPECTED_PROPERTY",
          path: `observation.page.${k}`,
          message: `Unexpected property "${k}" on observation.page.`,
        });
      }
    }

    const originRead = readOwnProperty(pageObj, "origin");
    let validOrigin: string | undefined;
    if (originRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.page.origin",
        message: "Failed reading origin property.",
      });
    } else if (originRead.status === "absent") {
      issues.push({
        code: "INVALID_PAGE",
        path: "observation.page.origin",
        message: "observation.page.origin is required.",
      });
    } else if (typeof originRead.value !== "string" || !isValidOrigin(originRead.value)) {
      issues.push({
        code: "INVALID_PAGE",
        path: "observation.page.origin",
        message:
          "observation.page.origin must be a valid origin (<= 256 chars, no path/query/auth).",
      });
    } else {
      validOrigin = originRead.value;
    }

    const routeRead = readOwnProperty(pageObj, "routeId");
    let validRouteId: string | undefined;
    if (routeRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.page.routeId",
        message: "Failed reading routeId property.",
      });
    } else if (routeRead.status === "absent") {
      issues.push({
        code: "INVALID_PAGE",
        path: "observation.page.routeId",
        message: "observation.page.routeId is required.",
      });
    } else if (typeof routeRead.value !== "string" || !isValidMachineToken(routeRead.value, 64)) {
      issues.push({
        code: "INVALID_PAGE",
        path: "observation.page.routeId",
        message: "observation.page.routeId must be a valid machine token (<= 64 chars).",
      });
    } else {
      validRouteId = routeRead.value;
    }

    if (validOrigin !== undefined && validRouteId !== undefined) {
      validPage = {
        origin: validOrigin,
        routeId: validRouteId,
      };
    }
  }

  // 5. interaction
  const interRead = readOwnProperty(input, "interaction");
  let validInteraction: BrowserInteractionDescriptor | undefined;
  if (interRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.interaction",
      message: "Failed reading interaction property.",
    });
  } else if (interRead.status === "absent") {
    issues.push({
      code: "INVALID_INTERACTION",
      path: "observation.interaction",
      message: "BrowserObservation must have an interaction descriptor.",
    });
  } else if (!isPlainObject(interRead.value)) {
    issues.push({
      code: "INVALID_INTERACTION",
      path: "observation.interaction",
      message: "observation.interaction must be a plain object.",
    });
  } else {
    const interObj = interRead.value;
    const allowedInterKeys = new Set(["kind"]);
    let interKeys: string[];
    try {
      interKeys = Object.keys(interObj);
    } catch {
      issues.push({
        code: "READ_ERROR",
        path: "observation.interaction",
        message: "Failed enumerating properties on observation.interaction.",
      });
      interKeys = [];
    }
    for (const k of interKeys) {
      if (!allowedInterKeys.has(k)) {
        issues.push({
          code: "UNEXPECTED_PROPERTY",
          path: `observation.interaction.${k}`,
          message: `Unexpected property "${k}" on observation.interaction.`,
        });
      }
    }

    const kindRead = readOwnProperty(interObj, "kind");
    if (kindRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.interaction.kind",
        message: "Failed reading kind property.",
      });
    } else if (kindRead.status === "absent") {
      issues.push({
        code: "INVALID_INTERACTION",
        path: "observation.interaction.kind",
        message: "observation.interaction.kind is required.",
      });
    } else if (typeof kindRead.value !== "string" || !isValidRoleToken(kindRead.value, 32)) {
      issues.push({
        code: "INVALID_INTERACTION",
        path: "observation.interaction.kind",
        message: "observation.interaction.kind must be a valid role token (<= 32 chars).",
      });
    } else {
      validInteraction = { kind: kindRead.value };
    }
  }

  // 6. element
  const elemRead = readOwnProperty(input, "element");
  let validElement: BrowserElementDescriptor | undefined;
  if (elemRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.element",
      message: "Failed reading element property.",
    });
  } else if (elemRead.status === "absent") {
    issues.push({
      code: "INVALID_ELEMENT",
      path: "observation.element",
      message: "BrowserObservation must have an element descriptor.",
    });
  } else if (!isPlainObject(elemRead.value)) {
    issues.push({
      code: "INVALID_ELEMENT",
      path: "observation.element",
      message: "observation.element must be a plain object.",
    });
  } else {
    const elemObj = elemRead.value;
    const allowedElemKeys = new Set(["kind", "role", "buttonType"]);
    let elemKeys: string[];
    try {
      elemKeys = Object.keys(elemObj);
    } catch {
      issues.push({
        code: "READ_ERROR",
        path: "observation.element",
        message: "Failed enumerating properties on observation.element.",
      });
      elemKeys = [];
    }
    for (const k of elemKeys) {
      if (!allowedElemKeys.has(k)) {
        issues.push({
          code: "UNEXPECTED_PROPERTY",
          path: `observation.element.${k}`,
          message: `Unexpected property "${k}" on observation.element.`,
        });
      }
    }

    const kindRead = readOwnProperty(elemObj, "kind");
    let validKind: string | undefined;
    if (kindRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.element.kind",
        message: "Failed reading kind property.",
      });
    } else if (kindRead.status === "absent") {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.kind",
        message: "observation.element.kind is required.",
      });
    } else if (typeof kindRead.value !== "string" || !isValidRoleToken(kindRead.value, 32)) {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.kind",
        message: "observation.element.kind must be a valid token (<= 32 chars).",
      });
    } else {
      validKind = kindRead.value;
    }

    const roleRead = readOwnProperty(elemObj, "role");
    let validRole: string | undefined;
    if (roleRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.element.role",
        message: "Failed reading role property.",
      });
    } else if (roleRead.status === "absent") {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.role",
        message: "observation.element.role is required.",
      });
    } else if (typeof roleRead.value !== "string" || !isValidRoleToken(roleRead.value, 32)) {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.role",
        message: "observation.element.role must be a valid role token (<= 32 chars).",
      });
    } else {
      validRole = roleRead.value;
    }

    const typeRead = readOwnProperty(elemObj, "buttonType");
    let validType: string | undefined;
    if (typeRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.element.buttonType",
        message: "Failed reading buttonType property.",
      });
    } else if (typeRead.status === "absent") {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.buttonType",
        message: "observation.element.buttonType is required.",
      });
    } else if (typeof typeRead.value !== "string" || !isValidRoleToken(typeRead.value, 32)) {
      issues.push({
        code: "INVALID_ELEMENT",
        path: "observation.element.buttonType",
        message: "observation.element.buttonType must be a valid token (<= 32 chars).",
      });
    } else {
      validType = typeRead.value;
    }

    if (validKind !== undefined && validRole !== undefined && validType !== undefined) {
      validElement = {
        kind: validKind,
        role: validRole,
        buttonType: validType,
      };
    }
  }

  // 7. metadata
  const metaRead = readOwnProperty(input, "metadata");
  let validMetadata: BrowserObservationMetadata | undefined;
  if (metaRead.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: "observation.metadata",
      message: "Failed reading metadata property.",
    });
  } else if (metaRead.status === "absent") {
    issues.push({
      code: "INVALID_METADATA",
      path: "observation.metadata",
      message: "BrowserObservation must have a metadata descriptor.",
    });
  } else if (!isPlainObject(metaRead.value)) {
    issues.push({
      code: "INVALID_METADATA",
      path: "observation.metadata",
      message: "observation.metadata must be a plain object.",
    });
  } else {
    const metaObj = metaRead.value;
    const allowedMetaKeys = new Set([
      "fixtureContract",
      "operation",
      "entityKey",
      "currentVisibility",
      "requestedVisibility",
    ]);

    let metaKeys: string[];
    try {
      metaKeys = Object.keys(metaObj);
    } catch {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata",
        message: "Failed enumerating properties on observation.metadata.",
      });
      metaKeys = [];
    }

    for (const k of metaKeys) {
      if (!allowedMetaKeys.has(k)) {
        issues.push({
          code: "UNEXPECTED_PROPERTY",
          path: `observation.metadata.${k}`,
          message: `Unexpected property "${k}" on observation.metadata.`,
        });
      }
    }

    const contractRead = readOwnProperty(metaObj, "fixtureContract");
    let validContract: string | undefined;
    if (contractRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata.fixtureContract",
        message: "Failed reading fixtureContract property.",
      });
    } else if (contractRead.status === "absent") {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.fixtureContract",
        message: "observation.metadata.fixtureContract is required.",
      });
    } else if (
      typeof contractRead.value !== "string" ||
      !isValidMachineToken(contractRead.value, 64)
    ) {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.fixtureContract",
        message:
          "observation.metadata.fixtureContract must be a valid machine token (<= 64 chars).",
      });
    } else {
      validContract = contractRead.value;
    }

    const opRead = readOwnProperty(metaObj, "operation");
    let validOperation: string | undefined;
    if (opRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata.operation",
        message: "Failed reading operation property.",
      });
    } else if (opRead.status === "absent") {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.operation",
        message: "observation.metadata.operation is required.",
      });
    } else if (typeof opRead.value !== "string" || !isValidMachineToken(opRead.value, 64)) {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.operation",
        message: "observation.metadata.operation must be a valid machine token (<= 64 chars).",
      });
    } else {
      validOperation = opRead.value;
    }

    const entRead = readOwnProperty(metaObj, "entityKey");
    let validEntityKey: string | undefined;
    if (entRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata.entityKey",
        message: "Failed reading entityKey property.",
      });
    } else if (entRead.status === "absent") {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.entityKey",
        message: "observation.metadata.entityKey is required.",
      });
    } else if (
      typeof entRead.value !== "string" ||
      !isValidMachineToken(entRead.value, MAX_ENTITY_KEY_LENGTH)
    ) {
      issues.push({
        code: "INVALID_METADATA",
        path: "observation.metadata.entityKey",
        message: `observation.metadata.entityKey must be a valid machine token (<= ${MAX_ENTITY_KEY_LENGTH} chars).`,
      });
    } else {
      validEntityKey = entRead.value;
    }

    // Optional currentVisibility
    const curVisRead = readOwnProperty(metaObj, "currentVisibility");
    let validCurVis: string | undefined;
    if (curVisRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata.currentVisibility",
        message: "Failed reading currentVisibility property.",
      });
    } else if (curVisRead.status === "present") {
      if (curVisRead.value === undefined) {
        issues.push({
          code: "EXPLICIT_UNDEFINED",
          path: "observation.metadata.currentVisibility",
          message: "Explicit currentVisibility: undefined is forbidden. Omit property when absent.",
        });
      } else if (
        typeof curVisRead.value !== "string" ||
        curVisRead.value.trim().length === 0 ||
        curVisRead.value.length > MAX_VISIBILITY_VALUE_LENGTH ||
        hasControlCharacters(curVisRead.value)
      ) {
        issues.push({
          code: "INVALID_METADATA",
          path: "observation.metadata.currentVisibility",
          message: `currentVisibility must be a non-empty string (<= ${MAX_VISIBILITY_VALUE_LENGTH} chars, no control chars).`,
        });
      } else {
        validCurVis = curVisRead.value.trim();
      }
    }

    // Optional requestedVisibility
    const reqVisRead = readOwnProperty(metaObj, "requestedVisibility");
    let validReqVis: string | undefined;
    if (reqVisRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: "observation.metadata.requestedVisibility",
        message: "Failed reading requestedVisibility property.",
      });
    } else if (reqVisRead.status === "present") {
      if (reqVisRead.value === undefined) {
        issues.push({
          code: "EXPLICIT_UNDEFINED",
          path: "observation.metadata.requestedVisibility",
          message:
            "Explicit requestedVisibility: undefined is forbidden. Omit property when absent.",
        });
      } else if (
        typeof reqVisRead.value !== "string" ||
        reqVisRead.value.trim().length === 0 ||
        reqVisRead.value.length > MAX_VISIBILITY_VALUE_LENGTH ||
        hasControlCharacters(reqVisRead.value)
      ) {
        issues.push({
          code: "INVALID_METADATA",
          path: "observation.metadata.requestedVisibility",
          message: `requestedVisibility must be a non-empty string (<= ${MAX_VISIBILITY_VALUE_LENGTH} chars, no control chars).`,
        });
      } else {
        validReqVis = reqVisRead.value.trim();
      }
    }

    if (
      validContract !== undefined &&
      validOperation !== undefined &&
      validEntityKey !== undefined
    ) {
      validMetadata = {
        fixtureContract: validContract,
        operation: validOperation,
        entityKey: validEntityKey,
        ...(validCurVis !== undefined ? { currentVisibility: validCurVis } : {}),
        ...(validReqVis !== undefined ? { requestedVisibility: validReqVis } : {}),
      };
    }
  }

  if (
    issues.length > 0 ||
    validVersion === undefined ||
    validId === undefined ||
    validCapturedAt === undefined ||
    validPage === undefined ||
    validInteraction === undefined ||
    validElement === undefined ||
    validMetadata === undefined
  ) {
    return err(issues);
  }

  // Construct detached snapshot
  const detached: BrowserObservation = {
    schemaVersion: validVersion,
    id: validId,
    capturedAt: validCapturedAt,
    page: {
      origin: validPage.origin,
      routeId: validPage.routeId,
    },
    interaction: {
      kind: validInteraction.kind,
    },
    element: {
      kind: validElement.kind,
      role: validElement.role,
      buttonType: validElement.buttonType,
    },
    metadata: {
      fixtureContract: validMetadata.fixtureContract,
      operation: validMetadata.operation,
      entityKey: validMetadata.entityKey,
      ...(validMetadata.currentVisibility !== undefined
        ? { currentVisibility: validMetadata.currentVisibility }
        : {}),
      ...(validMetadata.requestedVisibility !== undefined
        ? { requestedVisibility: validMetadata.requestedVisibility }
        : {}),
    },
  };

  // Enforce UTF-8 serialization size bound (approx. 4 KiB max) on detached object
  const serialized = JSON.stringify(detached);
  const byteLength = getUtf8ByteLength(serialized);
  if (byteLength > MAX_OBSERVATION_SERIALIZED_BYTES) {
    return err([
      {
        code: "OVERSIZED_OBSERVATION",
        path: "observation",
        message: `BrowserObservation serialized byte length (${byteLength} bytes) exceeds maximum limit of ${MAX_OBSERVATION_SERIALIZED_BYTES} bytes.`,
      },
    ]);
  }

  return ok(deepFreeze(detached));
}

// ============================================================================
// 2. CLOSED BROWSER CONTEXT DRAFT VALIDATION (Finding H1)
// ============================================================================

export function validateBrowserContextDraft(input: unknown): Result<BrowserContextDraft, Error> {
  if (!isPlainObject(input)) {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] BrowserContextDraft must be a plain object."));
  }

  const allowedDraftKeys = new Set([
    "kind",
    "entityKey",
    "entityKind",
    "currentVisibility",
    "requestedVisibility",
    "intent",
    "targetRole",
  ]);

  let keys: string[];
  try {
    keys = Object.keys(input);
  } catch {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] Failed reading draft properties."));
  }

  for (const k of keys) {
    if (!allowedDraftKeys.has(k)) {
      return err(
        new Error(`[INVALID_ADAPTER_OUTPUT] Unexpected property "${k}" on BrowserContextDraft.`),
      );
    }
  }

  const kindRead = readOwnProperty(input, "kind");
  if (kindRead.status !== "present" || kindRead.value !== "synthetic.repository-visibility") {
    return err(
      new Error("[INVALID_ADAPTER_OUTPUT] draft.kind must be 'synthetic.repository-visibility'."),
    );
  }

  const entRead = readOwnProperty(input, "entityKey");
  if (
    entRead.status !== "present" ||
    typeof entRead.value !== "string" ||
    !isValidMachineToken(entRead.value, MAX_ENTITY_KEY_LENGTH)
  ) {
    return err(
      new Error(
        `[INVALID_ADAPTER_OUTPUT] draft.entityKey must be a valid machine token (<= ${MAX_ENTITY_KEY_LENGTH} chars).`,
      ),
    );
  }

  const entKindRead = readOwnProperty(input, "entityKind");
  if (entKindRead.status !== "present" || entKindRead.value !== "repository") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.entityKind must be 'repository'."));
  }

  const curVisRead = readOwnProperty(input, "currentVisibility");
  if (curVisRead.status !== "present" || curVisRead.value !== "private") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.currentVisibility must be 'private'."));
  }

  const reqVisRead = readOwnProperty(input, "requestedVisibility");
  if (reqVisRead.status !== "present" || reqVisRead.value !== "public") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.requestedVisibility must be 'public'."));
  }

  const roleRead = readOwnProperty(input, "targetRole");
  if (roleRead.status !== "present" || roleRead.value !== "primary") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.targetRole must be 'primary'."));
  }

  const intentRead = readOwnProperty(input, "intent");
  if (intentRead.status !== "present" || !isPlainObject(intentRead.value)) {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.intent must be a plain object."));
  }

  let intentKeys: string[];
  try {
    intentKeys = Object.keys(intentRead.value);
  } catch {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] Failed reading draft.intent properties."));
  }
  const allowedIntentKeys = new Set(["verb", "domain"]);
  for (const ik of intentKeys) {
    if (!allowedIntentKeys.has(ik)) {
      return err(
        new Error(`[INVALID_ADAPTER_OUTPUT] Unexpected property "${ik}" on draft.intent.`),
      );
    }
  }

  const verbRead = readOwnProperty(intentRead.value, "verb");
  if (verbRead.status !== "present" || verbRead.value !== "change-access") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] draft.intent.verb must be 'change-access'."));
  }

  const domainRead = readOwnProperty(intentRead.value, "domain");
  if (domainRead.status !== "present" || domainRead.value !== "version_control") {
    return err(
      new Error("[INVALID_ADAPTER_OUTPUT] draft.intent.domain must be 'version_control'."),
    );
  }

  const detached: BrowserContextDraft = {
    kind: "synthetic.repository-visibility",
    entityKey: entRead.value,
    entityKind: "repository",
    currentVisibility: "private",
    requestedVisibility: "public",
    intent: {
      verb: "change-access",
      domain: "version_control",
    },
    targetRole: "primary",
  };

  return ok(deepFreeze(detached));
}

// ============================================================================
// 3. RUNTIME ADAPTER DECISION VALIDATION (Findings H1 & M5)
// ============================================================================

export function validateAdapterDecision(input: unknown): Result<AdapterDecision, Error> {
  if (!isPlainObject(input)) {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] AdapterDecision must be a plain object."));
  }

  const statusRead = readOwnProperty(input, "status");
  if (statusRead.status !== "present" || typeof statusRead.value !== "string") {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] AdapterDecision.status must be a string."));
  }

  let keys: string[];
  try {
    keys = Object.keys(input);
  } catch {
    return err(new Error("[INVALID_ADAPTER_OUTPUT] Failed reading decision properties."));
  }

  const status = statusRead.value;

  if (status === "matched") {
    const allowedKeys = new Set(["status", "draft"]);
    for (const k of keys) {
      if (!allowedKeys.has(k)) {
        return err(
          new Error(
            `[INVALID_ADAPTER_OUTPUT] Unexpected property "${k}" on matched AdapterDecision.`,
          ),
        );
      }
    }

    const draftRead = readOwnProperty(input, "draft");
    if (draftRead.status !== "present") {
      return err(
        new Error("[INVALID_ADAPTER_OUTPUT] matched decision must have a draft property."),
      );
    }

    const draftVal = validateBrowserContextDraft(draftRead.value);
    if (!draftVal.ok) {
      return draftVal;
    }

    const matchedDecision: AdapterDecision = {
      status: "matched",
      draft: draftVal.value,
    };
    return ok(deepFreeze(matchedDecision));
  }

  if (status === "not-applicable") {
    const allowedKeys = new Set(["status", "reasonCode"]);
    for (const k of keys) {
      if (!allowedKeys.has(k)) {
        return err(
          new Error(
            `[INVALID_ADAPTER_OUTPUT] Unexpected property "${k}" on not-applicable AdapterDecision.`,
          ),
        );
      }
    }

    const codeRead = readOwnProperty(input, "reasonCode");
    if (
      codeRead.status !== "present" ||
      typeof codeRead.value !== "string" ||
      !isValidReasonCode(codeRead.value, 64)
    ) {
      return err(
        new Error(
          "[INVALID_ADAPTER_OUTPUT] not-applicable decision requires a valid machine token reasonCode (<= 64 chars).",
        ),
      );
    }

    const notApplicableDecision: AdapterDecision = {
      status: "not-applicable",
      reasonCode: codeRead.value,
    };
    return ok(deepFreeze(notApplicableDecision));
  }

  if (status === "insufficient-evidence") {
    const allowedKeys = new Set(["status", "reasonCode", "missing"]);
    for (const k of keys) {
      if (!allowedKeys.has(k)) {
        return err(
          new Error(
            `[INVALID_ADAPTER_OUTPUT] Unexpected property "${k}" on insufficient-evidence AdapterDecision.`,
          ),
        );
      }
    }

    const codeRead = readOwnProperty(input, "reasonCode");
    if (
      codeRead.status !== "present" ||
      typeof codeRead.value !== "string" ||
      !isValidReasonCode(codeRead.value, 64)
    ) {
      return err(
        new Error(
          "[INVALID_ADAPTER_OUTPUT] insufficient-evidence decision requires a valid machine token reasonCode (<= 64 chars).",
        ),
      );
    }

    const missingRead = readOwnProperty(input, "missing");
    if (missingRead.status !== "present" || !safeIsArray(missingRead.value)) {
      return err(
        new Error(
          "[INVALID_ADAPTER_OUTPUT] insufficient-evidence decision requires a missing array.",
        ),
      );
    }

    const capturedMissing = captureDenseArrayOnce<string>(
      missingRead.value,
      "missing",
      MAX_ADAPTER_MISSING_COUNT,
    );
    if (!capturedMissing.ok) {
      return err(new Error(`[INVALID_ADAPTER_OUTPUT] ${capturedMissing.error.message}`));
    }

    if (
      capturedMissing.value.length === 0 ||
      capturedMissing.value.length > MAX_ADAPTER_MISSING_COUNT
    ) {
      return err(
        new Error(
          `[INVALID_ADAPTER_OUTPUT] missing array length must be between 1 and ${MAX_ADAPTER_MISSING_COUNT}.`,
        ),
      );
    }

    for (let i = 0; i < capturedMissing.value.length; i++) {
      const item = capturedMissing.value[i];
      if (typeof item !== "string" || !isValidMachineToken(item, 64)) {
        return err(
          new Error(
            `[INVALID_ADAPTER_OUTPUT] missing[${i}] must be a valid machine token (<= 64 chars).`,
          ),
        );
      }
    }

    const insufficientDecision: AdapterDecision = {
      status: "insufficient-evidence",
      reasonCode: codeRead.value,
      missing: capturedMissing.value,
    };
    return ok(deepFreeze(insufficientDecision));
  }

  if (status === "error") {
    const allowedKeys = new Set(["status", "code"]);
    for (const k of keys) {
      if (!allowedKeys.has(k)) {
        return err(
          new Error(
            `[INVALID_ADAPTER_OUTPUT] Unexpected property "${k}" on error AdapterDecision. Arbitrary messages are forbidden.`,
          ),
        );
      }
    }

    const codeRead = readOwnProperty(input, "code");
    if (
      codeRead.status !== "present" ||
      typeof codeRead.value !== "string" ||
      !isValidErrorCode(codeRead.value, 64)
    ) {
      return err(
        new Error(
          "[INVALID_ADAPTER_OUTPUT] error decision requires a valid machine token code (<= 64 chars).",
        ),
      );
    }

    const errorDecision: AdapterDecision = {
      status: "error",
      code: codeRead.value,
    };
    return ok(deepFreeze(errorDecision));
  }

  return err(new Error("[INVALID_ADAPTER_OUTPUT] Unknown or malformed adapter decision status."));
}
