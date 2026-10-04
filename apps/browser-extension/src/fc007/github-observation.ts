/**
 * FC-007 Sprint 1 — semantic GitHubVisibilityObservation (no DOM refs).
 *
 * validateFc007GitHubVisibilityObservation is a runtime trust boundary:
 * safe plain objects only, closed shapes, reconstructed frozen output.
 */

import { isValidIsoTimestamp } from "@futureclick/shared";
import { asciiLower, isSupportedOwnerSegment, isSupportedRepoSegment } from "./location.js";

export const FC007_CONTRACT_ID = "github.repository-visibility.private-to-public.v1";
export const FC007_CONTRACT_VERSION = "1.0";
export const FC007_ADAPTER_ID = "browser.github.repository-visibility-interception";
export const FC007_ADAPTER_VERSION = "1.0";
export const FC007_EVIDENCE_BASIS = "github-settings-ui-contract-v1";

export interface GitHubVisibilityObservation {
  readonly contractId: typeof FC007_CONTRACT_ID;
  readonly contractVersion: typeof FC007_CONTRACT_VERSION;
  readonly observedAt: string;
  readonly ownerDisplay: string;
  readonly ownerNormalized: string;
  readonly repoDisplay: string;
  readonly repoNormalized: string;
  readonly currentVisibility: "private";
  readonly requestedVisibility: "public";
  readonly routeIdentity: {
    readonly origin: string;
    readonly pathnameExact: string;
    readonly pathnameCanonical: string;
  };
  readonly supportedLocale: "en" | "en-US";
  readonly buttonSemantics: "submit";
  readonly formModalSemantics: "native-dialog-post-set_visibility";
  readonly readiness: "enabled";
  readonly evidenceBasis: typeof FC007_EVIDENCE_BASIS;
  readonly adapter: {
    readonly id: typeof FC007_ADAPTER_ID;
    readonly version: typeof FC007_ADAPTER_VERSION;
  };
}

const TOP_KEYS = [
  "contractId",
  "contractVersion",
  "observedAt",
  "ownerDisplay",
  "ownerNormalized",
  "repoDisplay",
  "repoNormalized",
  "currentVisibility",
  "requestedVisibility",
  "routeIdentity",
  "supportedLocale",
  "buttonSemantics",
  "formModalSemantics",
  "readiness",
  "evidenceBasis",
  "adapter",
] as const;

const ROUTE_KEYS = ["origin", "pathnameExact", "pathnameCanonical"] as const;
const ADAPTER_KEYS = ["id", "version"] as const;

export type ObservationValidationResult =
  | { readonly status: "ok"; readonly value: GitHubVisibilityObservation }
  | { readonly status: "invalid"; readonly reason: string };

/**
 * Reject arrays, null, Date, class instances, unexpected prototypes,
 * accessors, and symbol keys — without invoking getters.
 */
function inspectSafePlainObject(
  value: unknown,
  expectedKeys: readonly string[],
):
  | { readonly ok: true; readonly descriptors: PropertyDescriptorMap }
  | { readonly ok: false; readonly reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "NOT_PLAIN_OBJECT" };
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return { ok: false, reason: "UNEXPECTED_PROTOTYPE" };
  }

  const ownKeys = Reflect.ownKeys(value);
  for (const k of ownKeys) {
    if (typeof k === "symbol") {
      return { ok: false, reason: "SYMBOL_KEY" };
    }
  }

  if (ownKeys.length !== expectedKeys.length) {
    return { ok: false, reason: "KEY_COUNT" };
  }
  for (const k of expectedKeys) {
    if (!ownKeys.includes(k)) {
      return { ok: false, reason: `MISSING_${k}` };
    }
  }
  for (const k of ownKeys) {
    if (typeof k === "string" && !expectedKeys.includes(k)) {
      return { ok: false, reason: "UNEXPECTED_KEY" };
    }
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const k of expectedKeys) {
    const d = descriptors[k];
    if (!d) return { ok: false, reason: `MISSING_DESC_${k}` };
    if (d.get !== undefined || d.set !== undefined) {
      return { ok: false, reason: "ACCESSOR_PROPERTY" };
    }
    if (d.value === undefined && !("value" in d)) {
      return { ok: false, reason: "ACCESSOR_PROPERTY" };
    }
  }

  return { ok: true, descriptors };
}

function readDataString(descriptors: PropertyDescriptorMap, key: string): string | null {
  const d = descriptors[key];
  if (!d || typeof d.value !== "string") return null;
  return d.value;
}

export function validateFc007GitHubVisibilityObservation(
  input: unknown,
): ObservationValidationResult {
  try {
    return validateFc007GitHubVisibilityObservationInner(input);
  } catch {
    return { status: "invalid", reason: "VALIDATION_EXCEPTION" };
  }
}

function validateFc007GitHubVisibilityObservationInner(
  input: unknown,
): ObservationValidationResult {
  const top = inspectSafePlainObject(input, TOP_KEYS);
  if (!top.ok) return { status: "invalid", reason: top.reason };
  const td = top.descriptors;

  const contractId = readDataString(td, "contractId");
  if (contractId !== FC007_CONTRACT_ID) return { status: "invalid", reason: "CONTRACT_ID" };

  const contractVersion = readDataString(td, "contractVersion");
  if (contractVersion !== FC007_CONTRACT_VERSION) {
    return { status: "invalid", reason: "CONTRACT_VERSION" };
  }

  const observedAt = readDataString(td, "observedAt");
  if (!observedAt || !isValidIsoTimestamp(observedAt)) {
    return { status: "invalid", reason: "OBSERVED_AT" };
  }

  const ownerDisplay = readDataString(td, "ownerDisplay");
  const ownerNormalized = readDataString(td, "ownerNormalized");
  const repoDisplay = readDataString(td, "repoDisplay");
  const repoNormalized = readDataString(td, "repoNormalized");
  if (!ownerDisplay || !ownerNormalized || !repoDisplay || !repoNormalized) {
    return { status: "invalid", reason: "IDENTITY_FIELDS" };
  }
  if (!isSupportedOwnerSegment(ownerDisplay) || !isSupportedRepoSegment(repoDisplay)) {
    return { status: "invalid", reason: "IDENTITY_GRAMMAR" };
  }
  if (ownerNormalized !== asciiLower(ownerDisplay)) {
    return { status: "invalid", reason: "OWNER_NORMALIZED_MISMATCH" };
  }
  if (repoNormalized !== asciiLower(repoDisplay)) {
    return { status: "invalid", reason: "REPO_NORMALIZED_MISMATCH" };
  }

  if (td.currentVisibility?.value !== "private") {
    return { status: "invalid", reason: "CURRENT_VISIBILITY" };
  }
  if (td.requestedVisibility?.value !== "public") {
    return { status: "invalid", reason: "REQUESTED_VISIBILITY" };
  }

  const routeRaw = td.routeIdentity?.value;
  const route = inspectSafePlainObject(routeRaw, ROUTE_KEYS);
  if (!route.ok) return { status: "invalid", reason: `ROUTE_${route.reason}` };
  const rd = route.descriptors;
  const origin = readDataString(rd, "origin");
  const pathnameExact = readDataString(rd, "pathnameExact");
  const pathnameCanonical = readDataString(rd, "pathnameCanonical");
  if (!origin || !pathnameExact || !pathnameCanonical) {
    return { status: "invalid", reason: "ROUTE_IDENTITY_FIELDS" };
  }
  if (origin !== "https://github.com") {
    return { status: "invalid", reason: "ROUTE_ORIGIN" };
  }
  if (origin.includes("?") || origin.includes("#") || origin.includes("@")) {
    return { status: "invalid", reason: "ROUTE_ORIGIN_UNSAFE" };
  }
  if (
    pathnameExact.includes("?") ||
    pathnameExact.includes("#") ||
    pathnameCanonical.includes("?") ||
    pathnameCanonical.includes("#")
  ) {
    return { status: "invalid", reason: "ROUTE_QUERY_OR_FRAGMENT" };
  }

  const expectedExactA = `/${ownerDisplay}/${repoDisplay}/settings`;
  const expectedExactB = `/${ownerDisplay}/${repoDisplay}/settings/`;
  if (pathnameExact !== expectedExactA && pathnameExact !== expectedExactB) {
    return { status: "invalid", reason: "ROUTE_PATHNAME_EXACT" };
  }
  const expectedCanonical = `/${ownerNormalized}/${repoNormalized}/settings`;
  if (pathnameCanonical !== expectedCanonical) {
    return { status: "invalid", reason: "ROUTE_PATHNAME_CANONICAL" };
  }

  const localeRaw = readDataString(td, "supportedLocale");
  if (localeRaw !== "en" && localeRaw !== "en-US") {
    return { status: "invalid", reason: "LOCALE" };
  }
  const localeOut: "en" | "en-US" = localeRaw;

  if (td.buttonSemantics?.value !== "submit") {
    return { status: "invalid", reason: "BUTTON_SEMANTICS" };
  }
  if (td.formModalSemantics?.value !== "native-dialog-post-set_visibility") {
    return { status: "invalid", reason: "FORM_MODAL_SEMANTICS" };
  }
  if (td.readiness?.value !== "enabled") {
    return { status: "invalid", reason: "READINESS" };
  }
  if (td.evidenceBasis?.value !== FC007_EVIDENCE_BASIS) {
    return { status: "invalid", reason: "EVIDENCE_BASIS" };
  }

  const adapterRaw = td.adapter?.value;
  const adapter = inspectSafePlainObject(adapterRaw, ADAPTER_KEYS);
  if (!adapter.ok) return { status: "invalid", reason: `ADAPTER_${adapter.reason}` };
  const ad = adapter.descriptors;
  if (ad.id?.value !== FC007_ADAPTER_ID) return { status: "invalid", reason: "ADAPTER_ID" };
  if (ad.version?.value !== FC007_ADAPTER_VERSION) {
    return { status: "invalid", reason: "ADAPTER_VERSION" };
  }

  // Reconstruct safe output — never return the untrusted input object.
  const safeRoute = Object.freeze({
    origin: "https://github.com",
    pathnameExact,
    pathnameCanonical: expectedCanonical,
  });
  const safeAdapter = Object.freeze({
    id: FC007_ADAPTER_ID,
    version: FC007_ADAPTER_VERSION,
  });
  const safe: GitHubVisibilityObservation = Object.freeze({
    contractId: FC007_CONTRACT_ID,
    contractVersion: FC007_CONTRACT_VERSION,
    observedAt,
    ownerDisplay,
    ownerNormalized,
    repoDisplay,
    repoNormalized,
    currentVisibility: "private",
    requestedVisibility: "public",
    routeIdentity: safeRoute,
    supportedLocale: localeOut,
    buttonSemantics: "submit",
    formModalSemantics: "native-dialog-post-set_visibility",
    readiness: "enabled",
    evidenceBasis: FC007_EVIDENCE_BASIS,
    adapter: safeAdapter,
  });

  return { status: "ok", value: safe };
}

/** Decision-relevant fingerprint (excludes observedAt). */
export function observationSemanticFingerprint(obs: GitHubVisibilityObservation): string {
  return [
    obs.contractId,
    obs.contractVersion,
    obs.ownerNormalized,
    obs.repoNormalized,
    obs.routeIdentity.origin,
    obs.routeIdentity.pathnameCanonical,
    obs.supportedLocale,
    obs.currentVisibility,
    obs.requestedVisibility,
    obs.buttonSemantics,
    obs.formModalSemantics,
    obs.readiness,
    obs.adapter.id,
    obs.adapter.version,
    obs.evidenceBasis,
  ].join("|");
}

export function createGitHubVisibilityObservation(args: {
  readonly observedAt: string;
  readonly ownerDisplay: string;
  readonly ownerNormalized: string;
  readonly repoDisplay: string;
  readonly repoNormalized: string;
  readonly pathnameExact: string;
  readonly pathnameCanonical: string;
  readonly origin: string;
  readonly supportedLocale: string;
}): GitHubVisibilityObservation {
  const candidate = {
    contractId: FC007_CONTRACT_ID,
    contractVersion: FC007_CONTRACT_VERSION,
    observedAt: args.observedAt,
    ownerDisplay: args.ownerDisplay,
    ownerNormalized: args.ownerNormalized,
    repoDisplay: args.repoDisplay,
    repoNormalized: args.repoNormalized,
    currentVisibility: "private" as const,
    requestedVisibility: "public" as const,
    routeIdentity: {
      origin: args.origin,
      pathnameExact: args.pathnameExact,
      pathnameCanonical: args.pathnameCanonical,
    },
    supportedLocale: args.supportedLocale,
    buttonSemantics: "submit" as const,
    formModalSemantics: "native-dialog-post-set_visibility" as const,
    readiness: "enabled" as const,
    evidenceBasis: FC007_EVIDENCE_BASIS,
    adapter: {
      id: FC007_ADAPTER_ID,
      version: FC007_ADAPTER_VERSION,
    },
  };
  const validated = validateFc007GitHubVisibilityObservation(candidate);
  if (validated.status !== "ok") {
    throw new Error(`FC007_OBSERVATION_INVALID:${validated.reason}`);
  }
  return validated.value;
}
