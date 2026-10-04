/**
 * FC-007 Sprint 1D V2 — semantic GitHubVisibilityObservation with stage discrimination.
 */

import { isValidIsoTimestamp } from "@futureclick/shared";
import { asciiLower, isSupportedOwnerSegment, isSupportedRepoSegment } from "../location.js";
import type { Fc007V2Stage } from "./stages.js";

export const FC007_V2_CONTRACT_ID = "github.repository-visibility.private-to-public.v2";
export const FC007_V2_CONTRACT_VERSION = "2.0";
export const FC007_V2_ADAPTER_ID = "browser.github.repository-visibility-observation";
export const FC007_V2_ADAPTER_VERSION = "2.0";
export const FC007_V2_EVIDENCE_BASIS = "github-settings-ui-contract-v2";

export type Fc007V2StageSemantics =
  | { readonly kind: "settings-private" }
  | { readonly kind: "intent-confirmation" }
  | { readonly kind: "effects-acknowledgement" }
  | {
      readonly kind: "final-confirmation";
      readonly buttonSemantics: "submit";
      readonly formModalSemantics: "native-dialog-post-set_visibility";
      readonly readiness: "enabled";
    };

export interface GitHubVisibilityObservationV2 {
  readonly contractId: typeof FC007_V2_CONTRACT_ID;
  readonly contractVersion: typeof FC007_V2_CONTRACT_VERSION;
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
  readonly stage: Fc007V2Stage;
  readonly stageSemantics: Fc007V2StageSemantics;
  readonly buttonSemantics: "none" | "acknowledgement" | "submit";
  readonly formModalSemantics:
    | "none"
    | "stage-non-actionable"
    | "native-dialog-intermediate"
    | "native-dialog-post-set_visibility";
  readonly readiness: "n/a" | "enabled";
  readonly evidenceBasis: typeof FC007_V2_EVIDENCE_BASIS;
  readonly adapter: {
    readonly id: typeof FC007_V2_ADAPTER_ID;
    readonly version: typeof FC007_V2_ADAPTER_VERSION;
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
  "stage",
  "stageSemantics",
  "buttonSemantics",
  "formModalSemantics",
  "readiness",
  "evidenceBasis",
  "adapter",
] as const;

const ROUTE_KEYS = ["origin", "pathnameExact", "pathnameCanonical"] as const;
const ADAPTER_KEYS = ["id", "version"] as const;

export type ObservationValidationResultV2 =
  | { readonly status: "ok"; readonly value: GitHubVisibilityObservationV2 }
  | { readonly status: "invalid"; readonly reason: string };

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

function validateStageSemantics(
  stage: Fc007V2Stage,
  raw: unknown,
):
  | { readonly ok: true; readonly value: Fc007V2StageSemantics }
  | { readonly ok: false; readonly reason: string } {
  if (stage === "final-confirmation") {
    const extended = inspectSafePlainObject(raw, [
      "kind",
      "buttonSemantics",
      "formModalSemantics",
      "readiness",
    ]);
    if (!extended.ok) return { ok: false, reason: `STAGE_SEMANTICS_${extended.reason}` };
    const ed = extended.descriptors;
    if (readDataString(ed, "kind") !== "final-confirmation") {
      return { ok: false, reason: "STAGE_SEMANTICS_KIND_MISMATCH" };
    }
    if (ed.buttonSemantics?.value !== "submit") {
      return { ok: false, reason: "STAGE_SEMANTICS_BUTTON" };
    }
    if (ed.formModalSemantics?.value !== "native-dialog-post-set_visibility") {
      return { ok: false, reason: "STAGE_SEMANTICS_FORM_MODAL" };
    }
    if (ed.readiness?.value !== "enabled") {
      return { ok: false, reason: "STAGE_SEMANTICS_READINESS" };
    }
    return {
      ok: true,
      value: {
        kind: "final-confirmation",
        buttonSemantics: "submit",
        formModalSemantics: "native-dialog-post-set_visibility",
        readiness: "enabled",
      },
    };
  }

  const obj = inspectSafePlainObject(raw, ["kind"]);
  if (!obj.ok) return { ok: false, reason: `STAGE_SEMANTICS_${obj.reason}` };
  const kind = readDataString(obj.descriptors, "kind");
  if (kind !== stage) {
    return { ok: false, reason: "STAGE_SEMANTICS_KIND_MISMATCH" };
  }
  return { ok: true, value: { kind: stage } as Fc007V2StageSemantics };
}

export function validateFc007GitHubVisibilityObservationV2(
  input: unknown,
): ObservationValidationResultV2 {
  try {
    return validateFc007GitHubVisibilityObservationV2Inner(input);
  } catch {
    return { status: "invalid", reason: "VALIDATION_EXCEPTION" };
  }
}

function validateFc007GitHubVisibilityObservationV2Inner(
  input: unknown,
): ObservationValidationResultV2 {
  const top = inspectSafePlainObject(input, TOP_KEYS);
  if (!top.ok) return { status: "invalid", reason: top.reason };
  const td = top.descriptors;

  const contractId = readDataString(td, "contractId");
  if (contractId !== FC007_V2_CONTRACT_ID) return { status: "invalid", reason: "CONTRACT_ID" };

  const contractVersion = readDataString(td, "contractVersion");
  if (contractVersion !== FC007_V2_CONTRACT_VERSION) {
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

  const stageRaw = readDataString(td, "stage");
  const validStages: Fc007V2Stage[] = [
    "settings-private",
    "intent-confirmation",
    "effects-acknowledgement",
    "final-confirmation",
  ];
  if (!stageRaw || !validStages.includes(stageRaw as Fc007V2Stage)) {
    return { status: "invalid", reason: "STAGE" };
  }
  const stage = stageRaw as Fc007V2Stage;

  const stageSemanticsResult = validateStageSemantics(stage, td.stageSemantics?.value);
  if (!stageSemanticsResult.ok) {
    return { status: "invalid", reason: stageSemanticsResult.reason };
  }

  const buttonSemantics = readDataString(td, "buttonSemantics");
  const formModalSemantics = readDataString(td, "formModalSemantics");
  const readiness = readDataString(td, "readiness");

  if (stage === "settings-private") {
    if (buttonSemantics !== "none" || formModalSemantics !== "none" || readiness !== "n/a") {
      return { status: "invalid", reason: "STAGE_A_LITERALS" };
    }
  } else if (stage === "intent-confirmation" || stage === "effects-acknowledgement") {
    if (
      buttonSemantics !== "acknowledgement" ||
      formModalSemantics !== "native-dialog-intermediate" ||
      readiness !== "n/a"
    ) {
      return { status: "invalid", reason: "STAGE_BC_LITERALS" };
    }
  } else if (stage === "final-confirmation") {
    if (
      buttonSemantics !== "submit" ||
      formModalSemantics !== "native-dialog-post-set_visibility" ||
      readiness !== "enabled"
    ) {
      return { status: "invalid", reason: "STAGE_D_LITERALS" };
    }
  }

  if (td.evidenceBasis?.value !== FC007_V2_EVIDENCE_BASIS) {
    return { status: "invalid", reason: "EVIDENCE_BASIS" };
  }

  const adapterRaw = td.adapter?.value;
  const adapter = inspectSafePlainObject(adapterRaw, ADAPTER_KEYS);
  if (!adapter.ok) return { status: "invalid", reason: `ADAPTER_${adapter.reason}` };
  const ad = adapter.descriptors;
  if (ad.id?.value !== FC007_V2_ADAPTER_ID) return { status: "invalid", reason: "ADAPTER_ID" };
  if (ad.version?.value !== FC007_V2_ADAPTER_VERSION) {
    return { status: "invalid", reason: "ADAPTER_VERSION" };
  }

  const safeRoute = Object.freeze({
    origin: "https://github.com",
    pathnameExact,
    pathnameCanonical: expectedCanonical,
  });
  const safeAdapter = Object.freeze({
    id: FC007_V2_ADAPTER_ID,
    version: FC007_V2_ADAPTER_VERSION,
  });
  const safe: GitHubVisibilityObservationV2 = Object.freeze({
    contractId: FC007_V2_CONTRACT_ID,
    contractVersion: FC007_V2_CONTRACT_VERSION,
    observedAt,
    ownerDisplay,
    ownerNormalized,
    repoDisplay,
    repoNormalized,
    currentVisibility: "private",
    requestedVisibility: "public",
    routeIdentity: safeRoute,
    supportedLocale: localeOut,
    stage,
    stageSemantics: Object.freeze(stageSemanticsResult.value),
    buttonSemantics: buttonSemantics as GitHubVisibilityObservationV2["buttonSemantics"],
    formModalSemantics: formModalSemantics as GitHubVisibilityObservationV2["formModalSemantics"],
    readiness: readiness as GitHubVisibilityObservationV2["readiness"],
    evidenceBasis: FC007_V2_EVIDENCE_BASIS,
    adapter: safeAdapter,
  });

  return { status: "ok", value: safe };
}

export function observationSemanticFingerprintV2(obs: GitHubVisibilityObservationV2): string {
  const stageSem =
    obs.stageSemantics.kind === "final-confirmation"
      ? [
          obs.stageSemantics.kind,
          obs.stageSemantics.buttonSemantics,
          obs.stageSemantics.formModalSemantics,
          obs.stageSemantics.readiness,
        ].join(":")
      : obs.stageSemantics.kind;

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
    obs.stage,
    stageSem,
    obs.buttonSemantics,
    obs.formModalSemantics,
    obs.readiness,
    obs.adapter.id,
    obs.adapter.version,
    obs.evidenceBasis,
  ].join("|");
}

export function isGitHubVisibilityObservationV2(
  obs: unknown,
): obs is GitHubVisibilityObservationV2 {
  return (
    typeof obs === "object" &&
    obs !== null &&
    (obs as { contractVersion?: string }).contractVersion === FC007_V2_CONTRACT_VERSION
  );
}

function stageLiterals(stage: Fc007V2Stage): {
  readonly buttonSemantics: GitHubVisibilityObservationV2["buttonSemantics"];
  readonly formModalSemantics: GitHubVisibilityObservationV2["formModalSemantics"];
  readonly readiness: GitHubVisibilityObservationV2["readiness"];
  readonly stageSemantics: Fc007V2StageSemantics;
} {
  switch (stage) {
    case "settings-private":
      return {
        buttonSemantics: "none",
        formModalSemantics: "none",
        readiness: "n/a",
        stageSemantics: { kind: "settings-private" },
      };
    case "intent-confirmation":
      return {
        buttonSemantics: "acknowledgement",
        formModalSemantics: "native-dialog-intermediate",
        readiness: "n/a",
        stageSemantics: { kind: "intent-confirmation" },
      };
    case "effects-acknowledgement":
      return {
        buttonSemantics: "acknowledgement",
        formModalSemantics: "native-dialog-intermediate",
        readiness: "n/a",
        stageSemantics: { kind: "effects-acknowledgement" },
      };
    case "final-confirmation":
      return {
        buttonSemantics: "submit",
        formModalSemantics: "native-dialog-post-set_visibility",
        readiness: "enabled",
        stageSemantics: {
          kind: "final-confirmation",
          buttonSemantics: "submit",
          formModalSemantics: "native-dialog-post-set_visibility",
          readiness: "enabled",
        },
      };
  }
}

export function createGitHubVisibilityObservationV2(args: {
  readonly observedAt: string;
  readonly ownerDisplay: string;
  readonly ownerNormalized: string;
  readonly repoDisplay: string;
  readonly repoNormalized: string;
  readonly pathnameExact: string;
  readonly pathnameCanonical: string;
  readonly origin: string;
  readonly supportedLocale: string;
  readonly stage: Fc007V2Stage;
}): GitHubVisibilityObservationV2 {
  const literals = stageLiterals(args.stage);
  const candidate = {
    contractId: FC007_V2_CONTRACT_ID,
    contractVersion: FC007_V2_CONTRACT_VERSION,
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
    stage: args.stage,
    stageSemantics: literals.stageSemantics,
    buttonSemantics: literals.buttonSemantics,
    formModalSemantics: literals.formModalSemantics,
    readiness: literals.readiness,
    evidenceBasis: FC007_V2_EVIDENCE_BASIS,
    adapter: {
      id: FC007_V2_ADAPTER_ID,
      version: FC007_V2_ADAPTER_VERSION,
    },
  };
  const validated = validateFc007GitHubVisibilityObservationV2(candidate);
  if (validated.status !== "ok") {
    throw new Error(`FC007_V2_OBSERVATION_INVALID:${validated.reason}`);
  }
  return validated.value;
}
