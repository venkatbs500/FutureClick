/**
 * FC-007 Sprint 1 — Contract V1 orchestration (passive recognition).
 *
 * Every publication path performs a FRESH complete capture — no cached
 * private/route/locale/section semantics.
 */

import { currentIsoTimestamp } from "@futureclick/shared";
import { type ModalPredicate, inventorySupportedVisibilityDialog } from "./dialog-inventory.js";
import {
  type GitHubVisibilityObservation,
  createGitHubVisibilityObservation,
} from "./github-observation.js";
import { buildRepoIdentity } from "./identity.js";
import {
  type Fc007AuthorizedRoute,
  authorizeFc007SettingsLocation,
  isSupportedEnglishLocale,
} from "./location.js";
import { normalizedOwnText } from "./own-text.js";
import { CURRENT_PRIVATE_TEXT, recognizeVisibilitySection } from "./visibility-section.js";

export interface PrivateRecognitionSession {
  readonly document: Document;
  readonly route: Fc007AuthorizedRoute;
  readonly locale: "en" | "en-US";
  readonly visibilitySection: HTMLLIElement;
  readonly privateStateElement: HTMLDivElement;
  readonly main: HTMLElement;
}

export interface FullContractRecognition {
  readonly session: PrivateRecognitionSession;
  readonly observation: GitHubVisibilityObservation;
  readonly dialog: HTMLDialogElement;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
}

export type ContractResult =
  | { readonly status: "matched"; readonly value: FullContractRecognition }
  | { readonly status: "abstain"; readonly reason: string };

function localeFromDocument(lang: string): "en" | "en-US" | null {
  if (!isSupportedEnglishLocale(lang)) return null;
  const t = lang.trim();
  if (t === "en-US" || t.toLowerCase() === "en-us") return "en-US";
  if (t === "en" || t.toLowerCase() === "en") return "en";
  return null;
}

export function recognizePrivateSettingsSession(
  doc: Document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname">,
  options?: { readonly requireTopFrame?: boolean; readonly win?: Window },
):
  | { readonly status: "matched"; readonly value: PrivateRecognitionSession }
  | {
      readonly status: "abstain";
      readonly reason: string;
    } {
  const routeResult = authorizeFc007SettingsLocation(loc, options);
  if (routeResult.status !== "authorized") {
    return { status: "abstain", reason: routeResult.reason };
  }

  const locale = localeFromDocument(doc.documentElement.lang);
  if (!locale) {
    return { status: "abstain", reason: "UNSUPPORTED_LOCALE" };
  }

  const visibility = recognizeVisibilitySection(doc);
  if (visibility.status !== "matched") {
    return { status: "abstain", reason: visibility.reason };
  }

  // Fresh own-text proof of private sentence (not isConnected alone).
  const privateOwn = normalizedOwnText(visibility.value.privateStateElement);
  if (privateOwn.status !== "ok" || privateOwn.text !== CURRENT_PRIVATE_TEXT) {
    return { status: "abstain", reason: "PRIVATE_TEXT_MISMATCH" };
  }

  return {
    status: "matched",
    value: {
      document: doc,
      route: routeResult.route,
      locale,
      visibilitySection: visibility.value.section,
      privateStateElement: visibility.value.privateStateElement,
      main: visibility.value.main,
    },
  };
}

/**
 * @deprecated Sprint 1A: prefer recognizeFc007ContractV1 for publication.
 * Retained only as a thin wrapper that re-validates private text then continues.
 */
export function recognizeFullContractFromSession(
  session: PrivateRecognitionSession,
  options?: { readonly matchesModal?: ModalPredicate },
): ContractResult {
  // Never trust cached session semantics — re-run from document + route fields.
  return recognizeFc007ContractV1(
    session.document,
    {
      protocol: "https:",
      hostname: "github.com",
      port: "",
      pathname: session.route.pathnameExact,
    },
    options,
  );
}

export function recognizeFc007ContractV1(
  doc: Document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname">,
  options?: {
    readonly requireTopFrame?: boolean;
    readonly win?: Window;
    readonly matchesModal?: ModalPredicate;
  },
): ContractResult {
  const sessionResult = recognizePrivateSettingsSession(doc, loc, options);
  if (sessionResult.status !== "matched") {
    return sessionResult;
  }
  const session = sessionResult.value;

  const identity = buildRepoIdentity(session.route.ownerDisplay, session.route.repoDisplay);
  if (!identity) {
    return { status: "abstain", reason: "IDENTITY_BUILD_FAILED" };
  }

  const dialogResult = inventorySupportedVisibilityDialog(session.document, identity, options);
  if (dialogResult.status !== "matched") {
    return { status: "abstain", reason: dialogResult.reason };
  }

  const observation = createGitHubVisibilityObservation({
    observedAt: currentIsoTimestamp(),
    ownerDisplay: session.route.ownerDisplay,
    ownerNormalized: session.route.ownerNormalized,
    repoDisplay: session.route.repoDisplay,
    repoNormalized: session.route.repoNormalized,
    pathnameExact: session.route.pathnameExact,
    pathnameCanonical: session.route.pathnameCanonical,
    origin: session.route.origin,
    supportedLocale: session.locale,
  });

  return {
    status: "matched",
    value: {
      session,
      observation,
      dialog: dialogResult.value.dialog,
      finalButton: dialogResult.value.finalButton,
      form: dialogResult.value.form,
    },
  };
}
