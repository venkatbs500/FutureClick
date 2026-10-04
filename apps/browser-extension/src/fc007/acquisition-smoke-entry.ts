/**
 * FC-007 acquisition smoke entry — isolated-world harness for Chrome gate.
 * NOT in production manifest.
 */

import { captureFullContractV2 } from "./capture.js";
import { buildRepoIdentity } from "./identity.js";
import {
  getFormCollectionAccessCounters,
  iterateNativeFormControls,
  nativeBuiltInAssociatedForm,
  nativeContains,
  nativeFirstChild,
  nativeNextSibling,
  nativeParentNode,
  resetFormCollectionAccessCounters,
} from "./native-dom.js";
import { inventoryDialogPageElements } from "./v2/dialog-page-elements.js";
import { inventoryDocumentV2 } from "./v2/document-inventory-v2.js";
import { recognizeFormContractV2 } from "./v2/form-contract-v2.js";

declare global {
  var __FC007_ACQ_HARNESS__:
    | {
        capture: typeof captureFullContractV2;
        inventoryDocument: typeof inventoryDocumentV2;
        inventoryDialog: typeof inventoryDialogPageElements;
        recognizeFormContract: typeof recognizeFormContractV2;
        buildRepoIdentity: typeof buildRepoIdentity;
        nativeFirstChild: typeof nativeFirstChild;
        nativeNextSibling: typeof nativeNextSibling;
        nativeParentNode: typeof nativeParentNode;
        nativeContains: typeof nativeContains;
        iterateNativeFormControls: typeof iterateNativeFormControls;
        nativeBuiltInAssociatedForm: typeof nativeBuiltInAssociatedForm;
        resetFormCollectionAccessCounters: typeof resetFormCollectionAccessCounters;
        getFormCollectionAccessCounters: typeof getFormCollectionAccessCounters;
      }
    | undefined;
}

if (typeof globalThis !== "undefined") {
  globalThis.__FC007_ACQ_HARNESS__ = {
    capture: captureFullContractV2,
    inventoryDocument: inventoryDocumentV2,
    inventoryDialog: inventoryDialogPageElements,
    recognizeFormContract: recognizeFormContractV2,
    buildRepoIdentity,
    nativeFirstChild,
    nativeNextSibling,
    nativeParentNode,
    nativeContains,
    iterateNativeFormControls,
    nativeBuiltInAssociatedForm,
    resetFormCollectionAccessCounters,
    getFormCollectionAccessCounters,
  };
  try {
    console.log("__FC007_ACQ_BOOT__ready");
  } catch {
    /* ignore */
  }
}
