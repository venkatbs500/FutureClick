/**
 * FC-007 — retained native DOM accessors (isolated-world safe).
 *
 * Ordinary inherited properties on HTMLFormElement can be shadowed by
 * named form controls (`name="nextSibling"`). Acquisition MUST invoke
 * captured prototype getters via Reflect.apply — never ordinary lookup.
 *
 * If a required native getter/method cannot be captured at module init:
 * throw — callers fail closed. No ordinary-property fallbacks.
 *
 * Form association work model (V2):
 * - Explicit form.elements / collection.item probes are capped at
 *   FORM_ELEMENTS_MAX + 1.
 * - Cold collection.item may construct Chromium's listed-element cache
 *   (HTMLFormElement::CollectAndCacheListedElements). Its scope is the form,
 *   or the tree-scope root (the Document) when parser/form= associates exist.
 *   The non-autofill walk is Traversal<HTMLElement>::DescendantsOf(scope):
 *   light-DOM only, no shadow trees, but it does include Document-level
 *   siblings of documentElement. inventoryDocumentV2 counts those too.
 * - Therefore form.elements is reachable ONLY with a completed bounded
 *   document inventory token (see markCompletedDocumentInventory). Native
 *   work is bounded by DOCUMENT_MAX_NODE_VISITS_V2 / DOCUMENT_MAX_ELEMENTS_V2
 *   — NOT by O(25).
 * - Do NOT claim collection-local O(FORM_ELEMENTS_MAX).
 */

type NativeGetter = (this: unknown) => unknown;

function captureNativeGetter(proto: object, name: string): NativeGetter {
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  if (!desc || typeof desc.get !== "function") {
    throw new Error(`FC007_NATIVE_DOM_UNAVAILABLE:${name}`);
  }
  return desc.get;
}

function captureNativeMethod(proto: object, name: string): (...args: unknown[]) => unknown {
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  const fn = desc?.value;
  if (typeof fn !== "function") {
    throw new Error(`FC007_NATIVE_DOM_UNAVAILABLE:${name}`);
  }
  return fn as (...args: unknown[]) => unknown;
}

const getFirstChild = captureNativeGetter(Node.prototype, "firstChild");
const getNextSibling = captureNativeGetter(Node.prototype, "nextSibling");
const getParentNode = captureNativeGetter(Node.prototype, "parentNode");
const getNodeType = captureNativeGetter(Node.prototype, "nodeType");
const nativeContainsFn = captureNativeMethod(Node.prototype, "contains");

if (typeof CharacterData === "undefined") {
  throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:CharacterData");
}
const getTextData = captureNativeGetter(CharacterData.prototype, "data");

if (typeof HTMLFormElement === "undefined") {
  throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:HTMLFormElement");
}
const getFormElements = captureNativeGetter(HTMLFormElement.prototype, "elements");

/**
 * Prefer HTMLFormControlsCollection.prototype.item when present (Chrome / happy-dom),
 * else HTMLCollection.prototype.item. Captured at module init — no instance getPrototypeOf.
 */
function captureFormCollectionItem(): (...args: unknown[]) => unknown {
  if (typeof HTMLFormControlsCollection !== "undefined") {
    try {
      return captureNativeMethod(HTMLFormControlsCollection.prototype, "item");
    } catch {
      // fall through
    }
  }
  if (typeof HTMLCollection === "undefined") {
    throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:HTMLCollection");
  }
  return captureNativeMethod(HTMLCollection.prototype, "item");
}
const collectionItem = captureFormCollectionItem();

if (typeof Element === "undefined") {
  throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:Element");
}
const elementHasAttribute = captureNativeMethod(Element.prototype, "hasAttribute");
const elementGetAttribute = captureNativeMethod(Element.prototype, "getAttribute");

/*
 * HTMLFormElement is [LegacyOverrideBuiltIns]: ANY ordinary property lookup on a
 * form (e.g. `form.tagName`) runs NamedPropertyQuery → HasNamedElements →
 * elements()->HasNamedItems, building the listed/named-item cache over the
 * form's association scope. Pre-inventory classification must therefore use
 * these retained getters, which never consult the instance's named interceptor.
 */
const getTagName = captureNativeGetter(Element.prototype, "tagName");
const getFirstElementChild = captureNativeGetter(Element.prototype, "firstElementChild");
const getNextElementSibling = captureNativeGetter(Element.prototype, "nextElementSibling");
if (typeof HTMLElement === "undefined") {
  throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:HTMLElement");
}
const getHtmlLang = captureNativeGetter(HTMLElement.prototype, "lang");

/** Built-in form-associated element `.form` getters — module-init only. */
function requireCtor(name: string, v: unknown): object {
  if (typeof v === "undefined" || v === null) {
    throw new Error(`FC007_NATIVE_DOM_UNAVAILABLE:${name}`);
  }
  const proto = (v as { prototype?: object }).prototype;
  if (proto == null || typeof proto !== "object") {
    throw new Error(`FC007_NATIVE_DOM_UNAVAILABLE:${name}.prototype`);
  }
  return proto;
}

const getInputForm = captureNativeGetter(requireCtor("HTMLInputElement", HTMLInputElement), "form");
const getButtonForm = captureNativeGetter(
  requireCtor("HTMLButtonElement", HTMLButtonElement),
  "form",
);
const getSelectForm = captureNativeGetter(
  requireCtor("HTMLSelectElement", HTMLSelectElement),
  "form",
);
const getTextAreaForm = captureNativeGetter(
  requireCtor("HTMLTextAreaElement", HTMLTextAreaElement),
  "form",
);
const getFieldSetForm = captureNativeGetter(
  requireCtor("HTMLFieldSetElement", HTMLFieldSetElement),
  "form",
);
const getObjectForm = captureNativeGetter(
  requireCtor("HTMLObjectElement", HTMLObjectElement),
  "form",
);
const getOutputForm = captureNativeGetter(
  requireCtor("HTMLOutputElement", HTMLOutputElement),
  "form",
);

/** DOM nodeType constants (numeric — do not read from possibly-shadowed Node). */
export const FC007_NODE_ELEMENT = 1;
export const FC007_NODE_TEXT = 3;
export const FC007_NODE_COMMENT = 8;
export const FC007_NODE_DOCUMENT = 9;
export const FC007_NODE_DOCUMENT_FRAGMENT = 11;

/**
 * Element arrays produced by a SUCCESSFUL complete bounded document inventory.
 * Only inventoryDocumentV2 marks (frozen) arrays; form.elements access requires one.
 */
const completedDocumentInventories = new WeakSet<readonly Element[]>();

/** Test/harness counters — production ignores; reset before probes. */
let formElementsGetterCalls = 0;
let formCollectionItemCalls = 0;
let completedInventoryMarks = 0;
let completedInventoryMarksAtFirstGetter = -1;
let formAccessRejectedWithoutInventory = 0;

export function resetFormCollectionAccessCounters(): void {
  formElementsGetterCalls = 0;
  formCollectionItemCalls = 0;
  completedInventoryMarks = 0;
  completedInventoryMarksAtFirstGetter = -1;
  formAccessRejectedWithoutInventory = 0;
}

export function getFormCollectionAccessCounters(): {
  readonly elementsGetterCalls: number;
  readonly itemCalls: number;
  readonly completedInventoryMarks: number;
  /** -1 when the getter was never called since reset. */
  readonly completedInventoryMarksAtFirstGetter: number;
  readonly rejectedWithoutCompletedInventory: number;
} {
  return {
    elementsGetterCalls: formElementsGetterCalls,
    itemCalls: formCollectionItemCalls,
    completedInventoryMarks,
    completedInventoryMarksAtFirstGetter,
    rejectedWithoutCompletedInventory: formAccessRejectedWithoutInventory,
  };
}

export function markCompletedDocumentInventory(elements: readonly Element[]): void {
  completedDocumentInventories.add(elements);
  completedInventoryMarks += 1;
}

export function isCompletedDocumentInventory(elements: readonly Element[]): boolean {
  return completedDocumentInventories.has(elements);
}

export function nativeFirstChild(node: Node): Node | null {
  const v = Reflect.apply(getFirstChild, node, []);
  return v instanceof Node ? v : null;
}

export function nativeNextSibling(node: Node): Node | null {
  const v = Reflect.apply(getNextSibling, node, []);
  return v instanceof Node ? v : null;
}

export function nativeParentNode(node: Node): Node | null {
  const v = Reflect.apply(getParentNode, node, []);
  return v instanceof Node ? v : null;
}

export function nativeNodeType(node: Node): number {
  const v = Reflect.apply(getNodeType, node, []);
  return typeof v === "number" ? v : -1;
}

export function nativeParentElement(node: Node): Element | null {
  let cur: Node | null = nativeParentNode(node);
  while (cur) {
    if (nativeNodeType(cur) === FC007_NODE_ELEMENT) {
      return cur as Element;
    }
    cur = nativeParentNode(cur);
  }
  return null;
}

export function nativeContains(host: Node, other: Node | null): boolean {
  if (other == null) return false;
  const v = Reflect.apply(nativeContainsFn, host, [other]);
  return v === true;
}

export function nativeButtonForm(button: HTMLButtonElement): HTMLFormElement | null {
  const v = Reflect.apply(getButtonForm, button, []);
  return v instanceof HTMLFormElement ? v : null;
}

/**
 * Retained native `.form` for built-in form-associated element types.
 * Returns null when the element is not one of the supported built-in categories
 * (e.g. FACE custom elements — those are discovered via form.elements).
 */
export function nativeBuiltInAssociatedForm(el: Element): HTMLFormElement | null {
  let getter: NativeGetter | null = null;
  if (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement) {
    getter = getInputForm;
  } else if (typeof HTMLButtonElement !== "undefined" && el instanceof HTMLButtonElement) {
    getter = getButtonForm;
  } else if (typeof HTMLSelectElement !== "undefined" && el instanceof HTMLSelectElement) {
    getter = getSelectForm;
  } else if (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement) {
    getter = getTextAreaForm;
  } else if (typeof HTMLFieldSetElement !== "undefined" && el instanceof HTMLFieldSetElement) {
    getter = getFieldSetForm;
  } else if (typeof HTMLObjectElement !== "undefined" && el instanceof HTMLObjectElement) {
    getter = getObjectForm;
  } else if (typeof HTMLOutputElement !== "undefined" && el instanceof HTMLOutputElement) {
    getter = getOutputForm;
  }
  if (!getter) return null;
  const v = Reflect.apply(getter, el, []);
  return v instanceof HTMLFormElement ? v : null;
}

/** True when el is a native built-in form-associated element category. */
export function isNativeBuiltInFormAssociatedElement(el: Element): boolean {
  return (
    (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement) ||
    (typeof HTMLButtonElement !== "undefined" && el instanceof HTMLButtonElement) ||
    (typeof HTMLSelectElement !== "undefined" && el instanceof HTMLSelectElement) ||
    (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement) ||
    (typeof HTMLFieldSetElement !== "undefined" && el instanceof HTMLFieldSetElement) ||
    (typeof HTMLObjectElement !== "undefined" && el instanceof HTMLObjectElement) ||
    (typeof HTMLOutputElement !== "undefined" && el instanceof HTMLOutputElement)
  );
}

export function nativeTagName(el: Element): string {
  const v = Reflect.apply(getTagName, el, []);
  if (typeof v !== "string") {
    throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:Element.tagName");
  }
  return v;
}

export function nativeFirstElementChild(el: Element): Element | null {
  const v = Reflect.apply(getFirstElementChild, el, []);
  return v instanceof Element ? v : null;
}

export function nativeNextElementSibling(el: Element): Element | null {
  const v = Reflect.apply(getNextElementSibling, el, []);
  return v instanceof Element ? v : null;
}

/** HTMLElement `lang` via retained getter; "" for non-HTML elements. */
export function nativeHtmlLang(el: Element): string {
  if (!(el instanceof HTMLElement)) return "";
  const v = Reflect.apply(getHtmlLang, el, []);
  return typeof v === "string" ? v : "";
}

/**
 * The Document's element child (documentElement semantics) via retained
 * firstChild/nextSibling, scanning at most `maxChildren` Document children.
 */
export function nativeDocumentElement(
  doc: Document,
  maxChildren: number,
): { readonly status: "ok"; readonly root: Element | null } | { readonly status: "overflow" } {
  let child = nativeFirstChild(doc);
  let seen = 0;
  while (child) {
    seen += 1;
    if (seen > maxChildren) return { status: "overflow" };
    if (nativeNodeType(child) === FC007_NODE_ELEMENT) {
      return { status: "ok", root: child as Element };
    }
    child = nativeNextSibling(child);
  }
  return { status: "ok", root: null };
}

export function nativeHasAttribute(el: Element, name: string): boolean {
  return Reflect.apply(elementHasAttribute, el, [name]) === true;
}

export function nativeGetAttribute(el: Element, name: string): string | null {
  const v = Reflect.apply(elementGetAttribute, el, [name]);
  return typeof v === "string" ? v : null;
}

/**
 * Obtain native form.elements collection (counts as one getter access).
 * NEVER reads collection.length. Requires a completed document inventory token.
 */
function nativeFormElementsCollection(
  form: HTMLFormElement,
  completedInventory: readonly Element[],
): object {
  if (!completedDocumentInventories.has(completedInventory)) {
    formAccessRejectedWithoutInventory += 1;
    throw new Error("FC007_DOCUMENT_INVENTORY_INCOMPLETE");
  }
  if (formElementsGetterCalls === 0) {
    completedInventoryMarksAtFirstGetter = completedInventoryMarks;
  }
  formElementsGetterCalls += 1;
  const collection = Reflect.apply(getFormElements, form, []);
  if (collection == null || typeof collection !== "object") {
    throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:HTMLFormElement.elements");
  }
  return collection;
}

/**
 * Bounded native form.elements iteration via collection.item.
 * NEVER reads collection.length. Requests indexes 0..maxAccepted inclusive
 * (maxAccepted+1 probes) until null — semantic overflow proof only.
 *
 * Actual native association-cache construction may walk the completed
 * bounded document; do not treat probe count as O(native work).
 * `completedInventory` must be the frozen element array of a successful
 * inventoryDocumentV2 — otherwise the getter is never invoked.
 */
export function iterateNativeFormControls(
  form: HTMLFormElement,
  maxAccepted: number,
  completedInventory: readonly Element[],
):
  | { readonly status: "ok"; readonly controls: readonly Element[] }
  | { readonly status: "overflow"; readonly controls: readonly Element[] }
  | { readonly status: "unavailable"; readonly reason: string } {
  const controls: Element[] = [];
  try {
    const collection = nativeFormElementsCollection(form, completedInventory);
    for (let i = 0; i <= maxAccepted; i += 1) {
      formCollectionItemCalls += 1;
      const item = Reflect.apply(collectionItem, collection, [i]);
      if (item == null) {
        return { status: "ok", controls };
      }
      if (!(item instanceof Element)) {
        throw new Error("FC007_NATIVE_DOM_UNAVAILABLE:HTMLCollection.item");
      }
      if (i === maxAccepted) {
        controls.push(item);
        return { status: "overflow", controls };
      }
      controls.push(item);
    }
    return { status: "ok", controls };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "NATIVE_FORM_ELEMENTS_UNAVAILABLE";
    return { status: "unavailable", reason: msg };
  }
}

export function nativeTextData(node: Node): string {
  if (nativeNodeType(node) !== FC007_NODE_TEXT && nativeNodeType(node) !== FC007_NODE_COMMENT) {
    return "";
  }
  const v = Reflect.apply(getTextData, node, []);
  return typeof v === "string" ? v : "";
}

export function isNativeElement(node: Node): node is Element {
  return nativeNodeType(node) === FC007_NODE_ELEMENT;
}
