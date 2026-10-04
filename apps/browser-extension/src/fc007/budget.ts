/**
 * FC-007 Sprint 1 — explicit work budgets.
 *
 * Every visited ELEMENT, inspected direct child Node, and raw text code unit
 * counts — including rejected/irrelevant candidates.
 */

export type BudgetOverflowKind = "elements" | "child-nodes" | "text-units";

export class RecognitionBudget {
  private elementVisits = 0;
  private childNodeInspections = 0;
  private textUnits = 0;
  private overflow: BudgetOverflowKind | null = null;

  constructor(
    private readonly maxElements: number,
    private readonly maxTextUnits: number,
    private readonly maxChildNodeInspections: number = Number.POSITIVE_INFINITY,
  ) {}

  get isOverflowed(): boolean {
    return this.overflow !== null;
  }

  get overflowKind(): BudgetOverflowKind | null {
    return this.overflow;
  }

  get elementCount(): number {
    return this.elementVisits;
  }

  get textUnitCount(): number {
    return this.textUnits;
  }

  visitElement(): boolean {
    if (this.overflow) return false;
    this.elementVisits += 1;
    if (this.elementVisits > this.maxElements) {
      this.overflow = "elements";
      return false;
    }
    return true;
  }

  inspectChildNode(): boolean {
    if (this.overflow) return false;
    this.childNodeInspections += 1;
    if (this.childNodeInspections > this.maxChildNodeInspections) {
      this.overflow = "child-nodes";
      return false;
    }
    return true;
  }

  consumeTextUnits(n: number): boolean {
    if (this.overflow) return false;
    const units = n < 0 ? 0 : n;
    this.textUnits += units;
    if (this.textUnits > this.maxTextUnits) {
      this.overflow = "text-units";
      return false;
    }
    return true;
  }

  markOverflow(kind: BudgetOverflowKind): void {
    if (!this.overflow) this.overflow = kind;
  }
}

export const MAIN_MAX_ELEMENTS = 512;
export const SETTINGS_MAX_TEXT_UNITS = 16_384;
/**
 * Historical V2 broad candidate-text cap (pre-FC-007H).
 * V2 global acquisition no longer uses this — see SETTINGS_ANCHOR_TEXT_MAX.
 */
export const SETTINGS_CANDIDATE_MAX_TEXT_UNITS = 4_096;
/** FC-007H V2 scoped main structural cap (V1 MAIN_MAX_ELEMENTS remains 512). */
export const MAIN_MAX_ELEMENTS_V2 = 2_048;
/**
 * Total DOM nodes visited under retained <main> (elements + text/comment/…).
 * Element cap remains MAIN_MAX_ELEMENTS_V2; this bounds non-element work.
 * Valid dense fixture main ≈ <1250 nodes; 4096 ≈ 3×+ headroom.
 */
export const MAIN_MAX_NODE_VISITS_V2 = 4_096;
/** FC-007H V2 global anchor-candidate own-text budget (H/role/STRONG only). */
export const SETTINGS_ANCHOR_TEXT_MAX = 2_048;
export const VISIBILITY_SECTION_MAX_ELEMENTS = 48;
export const VISIBILITY_SECTION_MAX_TEXT_UNITS = 4_096;
/**
 * Total DOM nodes visited under visibility LI (elements + text/comment/…).
 * Element cap remains VISIBILITY_SECTION_MAX_ELEMENTS.
 */
export const VISIBILITY_LI_MAX_NODE_VISITS_V2 = 256;
export const DIALOG_MAX_ELEMENTS = 64;
/**
 * Hard cap on TOTAL DOM nodes visited during dialog inventory (elements +
 * text/comment/other). Pointer traversal only — no HTMLCollection materialization.
 * 4× DIALOG_MAX_ELEMENTS; valid Stage-D fixtures use ~26 node visits.
 */
export const DIALOG_MAX_NODE_VISITS = 256;
export const DIALOG_MAX_TEXT_UNITS = 4_096;
export const DIALOG_COLLECTION_MAX = 4;
/**
 * Bounded document-level pointer walk (documentElement DFS).
 * Valid dense V2 fixture ≈ 1257 nodes / 899 elements; caps leave ~3× headroom.
 * Independent of attacker DOM size — fail closed on overflow.
 */
export const DOCUMENT_MAX_NODE_VISITS_V2 = 4_096;
export const DOCUMENT_MAX_ELEMENTS_V2 = 3_072;
export const MUTATION_ROOT_MAX = 16;
export const MUTATION_CANDIDATE_MAX_ELEMENTS = 64;
export const MUTATION_DELIVERY_MAX_ELEMENTS = 256;
export const FORM_ELEMENTS_MAX = 24;
export const PRIVATE_TO_LI_MAX_HOPS = 4;
export const FORM_TO_DIALOG_MAX_HOPS = 6;
export const OWN_TEXT_MAX_CHILD_NODES = 32;
export const OWN_TEXT_MAX_TEXT_NODES = 8;
export const OWN_TEXT_MAX_RAW_UNITS = 160;
