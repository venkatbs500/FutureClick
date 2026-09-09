/**
 * Central Browser Adapter Engine (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Coordinates evaluation of BrowserActionAdapters against a validated, frozen BrowserObservation.
 *
 * Policy for Multiple Adapter Applicability:
 * 1. Any ERROR -> adaptation error (code-only, no secret prose)
 * 2. More than one applicability claim (MATCHED or INSUFFICIENT_EVIDENCE) -> AMBIGUOUS_ADAPTER fail-closed
 * 3. Exactly one MATCHED and rest NOT_APPLICABLE -> canonical ActionEvaluationContext constructed & validated
 * 4. Exactly one INSUFFICIENT_EVIDENCE and rest NOT_APPLICABLE -> abstention with reason and missing fields
 * 5. All NOT_APPLICABLE -> unsupported observation
 */

import type { ActionEvaluationContext } from "@futureclick/action-schema";
import { type IdGenerator, type Result, err, ok } from "@futureclick/shared";
import { constructCanonicalContext } from "./context.js";
import { isPlainObject, readOwnProperty, safeIsArray } from "./helpers.js";
import { createBrowserAdapterRegistry, createDefaultBrowserAdapterRegistry } from "./registry.js";
import {
  type AdapterDecision,
  type AdapterId,
  BROWSER_ADAPTER_ERROR_CODES,
  type BrowserActionAdapter,
  type BrowserAdapterErrorCode,
  type BrowserAdapterRegistry,
  type BrowserContextDraft,
  type BrowserObservation,
} from "./types.js";
import { validateAdapterDecision, validateBrowserObservation } from "./validation.js";

export interface BrowserAdapterEngineOptions {
  readonly registry?: BrowserAdapterRegistry | readonly BrowserActionAdapter[] | undefined;
  readonly idGenerator?: IdGenerator | undefined;
}

export type BrowserAdaptationOutcome =
  | {
      readonly status: "matched";
      readonly adapterId: AdapterId;
      readonly context: ActionEvaluationContext;
    }
  | {
      readonly status: "insufficient-evidence";
      readonly adapterId: AdapterId;
      readonly reasonCode: string;
      readonly missing: readonly string[];
    }
  | {
      readonly status: "unsupported";
      readonly reasonCode: string;
    }
  | {
      readonly status: "error";
      readonly code: BrowserAdapterErrorCode | string;
    };

export class BrowserAdapterEngine {
  private readonly registry: BrowserAdapterRegistry;
  private readonly idGenerator?: IdGenerator | undefined;

  constructor(options?: BrowserAdapterEngineOptions) {
    try {
      if (options !== undefined) {
        if (typeof options !== "object" || options === null) {
          throw new Error("[INVALID_CONFIGURATION] Options must be an object.");
        }

        const regRead = readOwnProperty(options, "registry");
        if (regRead.status === "error") {
          throw new Error("[INVALID_CONFIGURATION] Failed reading options.registry.");
        }

        if (regRead.status === "present" && regRead.value !== undefined) {
          const rawReg = regRead.value;
          if (safeIsArray(rawReg)) {
            this.registry = createBrowserAdapterRegistry(rawReg as readonly BrowserActionAdapter[]);
          } else if (isPlainObject(rawReg)) {
            const adaptersRead = readOwnProperty(rawReg, "adapters");
            if (adaptersRead.status !== "present" || !safeIsArray(adaptersRead.value)) {
              throw new Error("[INVALID_CONFIGURATION] Registry must provide an adapters array.");
            }
            this.registry = createBrowserAdapterRegistry(
              adaptersRead.value as readonly BrowserActionAdapter[],
            );
          } else {
            throw new Error(
              "[INVALID_CONFIGURATION] Registry must be an array or registry object.",
            );
          }
        } else {
          this.registry = createDefaultBrowserAdapterRegistry();
        }

        const idGenRead = readOwnProperty(options, "idGenerator");
        if (idGenRead.status === "error") {
          throw new Error("[INVALID_CONFIGURATION] Failed reading options.idGenerator.");
        }
        if (idGenRead.status === "present" && idGenRead.value !== undefined) {
          const rawIdGen = idGenRead.value;
          if (typeof rawIdGen !== "object" || rawIdGen === null) {
            throw new Error("[INVALID_CONFIGURATION] idGenerator must be an object.");
          }
          const genMethodRead = readOwnProperty(rawIdGen, "generate");
          if (genMethodRead.status !== "present" || typeof genMethodRead.value !== "function") {
            throw new Error("[INVALID_CONFIGURATION] idGenerator must provide a generate method.");
          }
          this.idGenerator = rawIdGen as IdGenerator;
        }
      } else {
        this.registry = createDefaultBrowserAdapterRegistry();
      }
    } catch (thrown) {
      if (
        thrown instanceof Error &&
        (thrown.message.startsWith("[INVALID_CONFIGURATION]") ||
          thrown.message.startsWith("[INVALID_ARRAY]") ||
          thrown.message.startsWith("[SPARSE_ARRAY]") ||
          thrown.message.startsWith("[INVALID_ADAPTER]"))
      ) {
        throw thrown;
      }
      throw new Error("[INVALID_CONFIGURATION] Invalid engine configuration.");
    }
  }

  /**
   * Adapts a validated BrowserObservation to an authoritative ActionEvaluationContext.
   */
  public adapt(observation: BrowserObservation): BrowserAdaptationOutcome {
    // 1. Authoritatively validate observation if untrusted
    const obsValidation = validateBrowserObservation(observation);
    if (!obsValidation.ok) {
      return {
        status: "error",
        code: BROWSER_ADAPTER_ERROR_CODES.INVALID_OBSERVATION,
      };
    }
    const validObs = obsValidation.value;

    // 2. Assess all registered adapters against the same frozen observation
    const adapters = this.registry.adapters;
    if (adapters.length === 0) {
      return {
        status: "unsupported",
        reasonCode: "NO_REGISTERED_ADAPTERS",
      };
    }

    interface AssessmentRecord {
      readonly adapter: BrowserActionAdapter;
      readonly decision: AdapterDecision;
    }

    const assessments: AssessmentRecord[] = [];

    for (const adapter of adapters) {
      let rawDecision: unknown;
      try {
        rawDecision = adapter.assess(validObs);
      } catch {
        return {
          status: "error",
          code: BROWSER_ADAPTER_ERROR_CODES.ADAPTER_EXECUTION_FAILED,
        };
      }

      // Authoritative runtime decision validation (Finding H1)
      const decisionVal = validateAdapterDecision(rawDecision);
      if (!decisionVal.ok) {
        return {
          status: "error",
          code: BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT,
        };
      }
      const decision = decisionVal.value;

      // Check for adapter error return
      if (decision.status === "error") {
        return {
          status: "error",
          code: decision.code,
        };
      }

      assessments.push({ adapter, decision });
    }

    // 3. Count applicability claims (MATCHED or INSUFFICIENT_EVIDENCE)
    const matchedClaims: { adapter: BrowserActionAdapter; draft: BrowserContextDraft }[] = [];
    const insufficientClaims: {
      adapter: BrowserActionAdapter;
      reasonCode: string;
      missing: readonly string[];
    }[] = [];

    for (const record of assessments) {
      if (record.decision.status === "matched") {
        matchedClaims.push({
          adapter: record.adapter,
          draft: record.decision.draft,
        });
      } else if (record.decision.status === "insufficient-evidence") {
        insufficientClaims.push({
          adapter: record.adapter,
          reasonCode: record.decision.reasonCode,
          missing: record.decision.missing,
        });
      }
    }

    const totalClaims = matchedClaims.length + insufficientClaims.length;

    // 4. Multiple applicability claims -> AMBIGUOUS_ADAPTER (order-independent)
    if (totalClaims > 1) {
      return {
        status: "error",
        code: BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER,
      };
    }

    // 5. Exactly one MATCHED claim
    const match = matchedClaims[0];
    if (matchedClaims.length === 1 && match !== undefined) {
      const contextRes = constructCanonicalContext(
        match.draft,
        validObs,
        match.adapter,
        this.idGenerator ? { idGenerator: this.idGenerator } : undefined,
      );

      if (!contextRes.ok) {
        return {
          status: "error",
          code: contextRes.error.message.startsWith("[INVALID_CONFIGURATION]")
            ? BROWSER_ADAPTER_ERROR_CODES.INVALID_CONFIGURATION
            : BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT,
        };
      }

      return {
        status: "matched",
        adapterId: match.adapter.id,
        context: contextRes.value,
      };
    }

    // 6. Exactly one INSUFFICIENT_EVIDENCE claim
    const claim = insufficientClaims[0];
    if (insufficientClaims.length === 1 && claim !== undefined) {
      return {
        status: "insufficient-evidence",
        adapterId: claim.adapter.id,
        reasonCode: claim.reasonCode,
        missing: claim.missing,
      };
    }

    // 7. All adapters NOT_APPLICABLE -> unsupported observation
    return {
      status: "unsupported",
      reasonCode: "NO_APPLICABLE_ADAPTER",
    };
  }
}

/**
 * Result-returning factory for BrowserAdapterEngine.
 */
export function createBrowserAdapterEngine(
  options?: BrowserAdapterEngineOptions,
): Result<BrowserAdapterEngine, Error> {
  try {
    const engine = new BrowserAdapterEngine(options);
    return ok(engine);
  } catch (thrown) {
    return err(
      thrown instanceof Error &&
        (thrown.message.startsWith("[INVALID_CONFIGURATION]") ||
          thrown.message.startsWith("[INVALID_ARRAY]") ||
          thrown.message.startsWith("[SPARSE_ARRAY]") ||
          thrown.message.startsWith("[INVALID_ADAPTER]"))
        ? thrown
        : new Error("[INVALID_CONFIGURATION] Invalid engine configuration."),
    );
  }
}
