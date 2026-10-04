/**
 * FC-007 Sprint 1D V2 — Contract orchestration (passive recognition).
 */

import { currentIsoTimestamp } from "@futureclick/shared";
import type { PrivateRecognitionSession } from "../contract.js";
import type { ModalPredicate } from "../dialog-inventory.js";
import { DOCUMENT_MAX_NODE_VISITS_V2 } from "../budget.js";
import { buildRepoIdentity } from "../identity.js";
import {
  type Fc007AuthorizedRoute,
  authorizeFc007SettingsLocation,
  isSupportedEnglishLocale,
} from "../location.js";
import { nativeDocumentElement, nativeHtmlLang } from "../native-dom.js";
import { normalizedOwnText } from "../own-text.js";
import {
  inventorySoleActualModal,
  recognizeStageB,
  recognizeStageC,
  recognizeStageD,
} from "./dialog-inventory-v2.js";
import { type DialogTraversalHook, inventoryDialogPageElements } from "./dialog-page-elements.js";
import { inventoryDocumentV2 } from "./document-inventory-v2.js";
import {
  type GitHubVisibilityObservationV2,
  createGitHubVisibilityObservationV2,
} from "./github-observation-v2.js";
import type { Fc007V2Stage } from "./stages.js";
import { CURRENT_PRIVATE_TEXT, recognizeVisibilitySectionV2 } from "./visibility-section-v2.js";

export interface FullContractRecognitionV2 {
  readonly session: PrivateRecognitionSession;
  readonly observation: GitHubVisibilityObservationV2;
  readonly stage: Fc007V2Stage;
  readonly dialog?: HTMLDialogElement;
  readonly finalButton?: HTMLButtonElement;
  readonly form?: HTMLFormElement;
  /** Exact Stage-D effects region when stage is final-confirmation. */
  readonly effectsRegion?: HTMLDivElement;
}

export type ContractResultV2 =
  | { readonly status: "matched"; readonly value: FullContractRecognitionV2 }
  | { readonly status: "abstain"; readonly reason: string };

function localeFromDocument(lang: string): "en" | "en-US" | null {
  if (!isSupportedEnglishLocale(lang)) return null;
  const t = lang.trim();
  if (t === "en-US" || t.toLowerCase() === "en-us") return "en-US";
  if (t === "en" || t.toLowerCase() === "en") return "en";
  return null;
}

function buildSession(
  doc: Document,
  route: Fc007AuthorizedRoute,
  locale: "en" | "en-US",
  visibility: {
    readonly main: HTMLElement;
    readonly section: HTMLLIElement;
    readonly privateStateElement: HTMLDivElement;
  },
): PrivateRecognitionSession {
  return {
    document: doc,
    route,
    locale,
    visibilitySection: visibility.section,
    privateStateElement: visibility.privateStateElement,
    main: visibility.main,
  };
}

function buildObservation(
  session: PrivateRecognitionSession,
  stage: Fc007V2Stage,
): GitHubVisibilityObservationV2 {
  return createGitHubVisibilityObservationV2({
    observedAt: currentIsoTimestamp(),
    ownerDisplay: session.route.ownerDisplay,
    ownerNormalized: session.route.ownerNormalized,
    repoDisplay: session.route.repoDisplay,
    repoNormalized: session.route.repoNormalized,
    pathnameExact: session.route.pathnameExact,
    pathnameCanonical: session.route.pathnameCanonical,
    origin: session.route.origin,
    supportedLocale: session.locale,
    stage,
  });
}

export function recognizeFc007ContractV2(
  doc: Document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname">,
  options?: {
    readonly requireTopFrame?: boolean;
    readonly win?: Window;
    readonly matchesModal?: ModalPredicate;
    /** Exact privately retained FutureClick preview host (object identity only). */
    readonly ownedPreviewHost?: HTMLDivElement;
    /** Test/harness: total DOM node visit attempts during dialog inventory. */
    readonly onDialogNodeVisit?: DialogTraversalHook;
    readonly onDialogPageElementVisit?: DialogTraversalHook;
    readonly onDialogFirstChildRead?: DialogTraversalHook;
    readonly onDialogNextSiblingRead?: DialogTraversalHook;
  },
): ContractResultV2 {
  const routeResult = authorizeFc007SettingsLocation(loc, options);
  if (routeResult.status !== "authorized") {
    return { status: "abstain", reason: routeResult.reason };
  }

  // Pre-inventory: retained getters only (the root may be any page element, even a form).
  const rootScan = nativeDocumentElement(doc, DOCUMENT_MAX_NODE_VISITS_V2);
  if (rootScan.status === "overflow") {
    return { status: "abstain", reason: "DOCUMENT_NODE_BUDGET_EXHAUSTED" };
  }
  const locale = localeFromDocument(rootScan.root ? nativeHtmlLang(rootScan.root) : "");
  if (!locale) {
    return { status: "abstain", reason: "UNSUPPORTED_LOCALE" };
  }

  // One bounded document inventory per capture — mains, dialogs, exterior elements.
  const docInv = inventoryDocumentV2(doc, {
    ...(options?.ownedPreviewHost ? { ownedPreviewHost: options.ownedPreviewHost } : {}),
  });
  if (docInv.status === "abstain") {
    return { status: "abstain", reason: docInv.reason };
  }

  const visibility = recognizeVisibilitySectionV2(doc, { documentInventory: docInv });
  if (visibility.status !== "matched") {
    return { status: "abstain", reason: visibility.reason };
  }

  const privateOwn = normalizedOwnText(visibility.value.privateStateElement);
  if (privateOwn.status !== "ok" || privateOwn.text !== CURRENT_PRIVATE_TEXT) {
    return { status: "abstain", reason: "PRIVATE_TEXT_MISMATCH" };
  }

  const identity = buildRepoIdentity(routeResult.route.ownerDisplay, routeResult.route.repoDisplay);
  if (!identity) {
    return { status: "abstain", reason: "IDENTITY_BUILD_FAILED" };
  }

  const session = buildSession(doc, routeResult.route, locale, visibility.value);
  const modalResult = inventorySoleActualModal(doc, options?.matchesModal, {
    documentInventory: docInv,
  });

  if (modalResult.status === "abstain") {
    if (modalResult.reason === "NO_ACTUAL_MODAL") {
      return {
        status: "matched",
        value: {
          session,
          observation: buildObservation(session, "settings-private"),
          stage: "settings-private",
        },
      };
    }
    if (
      modalResult.reason === "DIALOG_COLLECTION_TOO_LARGE" ||
      modalResult.reason === "MULTIPLE_ACTUAL_MODALS" ||
      modalResult.reason === "MODAL_PSEUDO_UNSUPPORTED" ||
      modalResult.reason === "NATIVE_DIALOG_UNAVAILABLE" ||
      modalResult.reason === "DOCUMENT_NODE_BUDGET_EXHAUSTED" ||
      modalResult.reason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" ||
      modalResult.reason === "DOCUMENT_DUPLICATE_NODE" ||
      modalResult.reason === "MAIN_NOT_UNIQUE"
    ) {
      return { status: "abstain", reason: modalResult.reason };
    }
    return {
      status: "matched",
      value: {
        session,
        observation: buildObservation(session, "settings-private"),
        stage: "settings-private",
      },
    };
  }

  const dialog = modalResult.value;

  // One bounded page-controlled inventory per capture — reused across Stage D/C/B.
  const pageInv = inventoryDialogPageElements(dialog, {
    ...(options?.ownedPreviewHost ? { ownedPreviewHost: options.ownedPreviewHost } : {}),
    ...(options?.onDialogNodeVisit ? { onNodeVisit: options.onDialogNodeVisit } : {}),
    ...(options?.onDialogPageElementVisit
      ? { onPageElementVisit: options.onDialogPageElementVisit }
      : {}),
    ...(options?.onDialogFirstChildRead
      ? { onFirstChildRead: options.onDialogFirstChildRead }
      : {}),
    ...(options?.onDialogNextSiblingRead
      ? { onNextSiblingRead: options.onDialogNextSiblingRead }
      : {}),
  });
  if (pageInv.status === "element_overflow") {
    return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
  }
  if (pageInv.status === "node_overflow") {
    return { status: "abstain", reason: "DIALOG_NODE_BUDGET_EXHAUSTED" };
  }
  if (pageInv.status === "duplicate_node") {
    return { status: "abstain", reason: "DIALOG_DUPLICATE_NODE" };
  }
  if (pageInv.status === "owned_host_missing") {
    return { status: "abstain", reason: "OWNED_HOST_NOT_IN_DIALOG" };
  }

  const stageOpts = {
    ...(options?.matchesModal ? { matchesModal: options.matchesModal } : {}),
    retainedDocument: doc,
    ...(options?.ownedPreviewHost ? { ownedPreviewHost: options.ownedPreviewHost } : {}),
    pageElements: pageInv.elements,
    documentElements: docInv.elements,
  };

  const stageD = recognizeStageD(dialog, identity, stageOpts);
  if (stageD.status === "matched") {
    return {
      status: "matched",
      value: {
        session,
        observation: buildObservation(session, "final-confirmation"),
        stage: "final-confirmation",
        dialog: stageD.value.dialog,
        finalButton: stageD.value.finalButton,
        form: stageD.value.form,
        effectsRegion: stageD.value.effectsRegion,
      },
    };
  }
  if (
    stageD.reason.startsWith("OWNED_HOST_") ||
    stageD.reason === "DIALOG_ELEMENT_BUDGET_EXHAUSTED" ||
    stageD.reason === "DIALOG_NODE_BUDGET_EXHAUSTED" ||
    stageD.reason === "DIALOG_DUPLICATE_NODE" ||
    stageD.reason === "DOCUMENT_NODE_BUDGET_EXHAUSTED" ||
    stageD.reason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED"
  ) {
    return { status: "abstain", reason: stageD.reason };
  }

  const stageC = recognizeStageC(dialog, identity, stageOpts);
  if (stageC.status === "matched") {
    return {
      status: "matched",
      value: {
        session,
        observation: buildObservation(session, "effects-acknowledgement"),
        stage: "effects-acknowledgement",
        dialog: stageC.value.dialog,
      },
    };
  }

  const stageB = recognizeStageB(dialog, identity, stageOpts);
  if (stageB.status === "matched") {
    return {
      status: "matched",
      value: {
        session,
        observation: buildObservation(session, "intent-confirmation"),
        stage: "intent-confirmation",
        dialog: stageB.value.dialog,
      },
    };
  }

  return { status: "abstain", reason: "MODAL_STAGE_UNMATCHED" };
}
