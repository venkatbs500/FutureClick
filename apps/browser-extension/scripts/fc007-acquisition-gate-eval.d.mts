export type GateCaseOutcome = "PASS" | "FAIL" | "BLOCKED";

export interface GateEvaluation {
  readonly results: ReadonlyArray<{
    readonly name: string;
    readonly outcome: GateCaseOutcome;
    readonly detail: string;
  }>;
  readonly passed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly exitCode: number;
}

export declare const FINAL_STAGE: string;
export declare const FORM_ELEMENTS_MAX: number;
export declare const ITEM_PROBE_CAP: number;
export declare const DOCUMENT_MAX_ELEMENTS_V2: number;
export declare const HIDDEN_INPUTS_IN_FIXTURE: number;
export declare const ASSOCIATED_REJECT_KINDS: readonly string[];
export declare const MISSING_GETTER_KINDS: readonly string[];
export declare const NAMED_FORM_COUNTS: Readonly<Record<string, number>>;
export declare const NAMED_FORM_CASES: readonly string[];

export declare function evaluateAcquisitionGateReport(report: unknown): GateEvaluation;
