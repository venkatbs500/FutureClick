/**
 * FC-007 Sprint 1 — passive capture helpers (no event cancellation).
 */

import {
  type ContractResult,
  type FullContractRecognition,
  type PrivateRecognitionSession,
  recognizeFc007ContractV1,
  recognizeFullContractFromSession,
  recognizePrivateSettingsSession,
} from "./contract.js";
import type { ModalPredicate } from "./dialog-inventory.js";
import {
  type ContractResultV2,
  type FullContractRecognitionV2,
  recognizeFc007ContractV2,
} from "./v2/contract-v2.js";

export type { ContractResult, FullContractRecognition, PrivateRecognitionSession };
export type { ContractResultV2, FullContractRecognitionV2 };

export function capturePrivateSettingsSession(
  doc: Document = document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname"> = location,
  options?: { readonly requireTopFrame?: boolean; readonly win?: Window },
): ReturnType<typeof recognizePrivateSettingsSession> {
  return recognizePrivateSettingsSession(doc, loc, options);
}

export function captureFullContract(
  doc: Document = document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname"> = location,
  options?: {
    readonly requireTopFrame?: boolean;
    readonly win?: Window;
    readonly matchesModal?: ModalPredicate;
  },
): ContractResult {
  return recognizeFc007ContractV1(doc, loc, options);
}

export function captureFullContractFromSession(
  session: PrivateRecognitionSession,
  options?: { readonly matchesModal?: ModalPredicate },
): ContractResult {
  return recognizeFullContractFromSession(session, options);
}

export function captureFullContractV2(
  doc: Document = document,
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname"> = location,
  options?: {
    readonly requireTopFrame?: boolean;
    readonly win?: Window;
    readonly matchesModal?: ModalPredicate;
    readonly ownedPreviewHost?: HTMLDivElement;
    readonly onDialogNodeVisit?: () => void;
    readonly onDialogPageElementVisit?: () => void;
    readonly onDialogFirstChildRead?: () => void;
    readonly onDialogNextSiblingRead?: () => void;
  },
): ContractResultV2 {
  return recognizeFc007ContractV2(doc, loc, options);
}
