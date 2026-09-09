/**
 * FC-005A Hardening and Trust Boundary Regression Tests
 *
 * Verifies fixes for:
 * - H1: Runtime adapter decision validation & closed synthetic repository draft validation
 * - H2: EntityKey machine token grammar & decoupling from canonical display labels
 * - H3: Strict adapter scope enforcement (origin, route, interaction, element, contract, operation)
 * - M1: Hostile boundaries (revoked proxies, prototype inspection, ID generator throwing all primitives/objects)
 * - M2: Registry ingress hardening against forged/mutable registries
 * - M5: Closed adapter error contract (no arbitrary messages or prose leakage)
 */

import { describe, expect, it } from "vitest";
import type { IsoTimestamp } from "@futureclick/shared";
import {
  type ActionEvaluationContext,
  validateActionEvaluationContext,
} from "@futureclick/action-schema";
import {
  type AdapterDecision,
  type AdapterId,
  type AdapterVersion,
  BROWSER_ADAPTER_ERROR_CODES,
  type BrowserActionAdapter,
  type BrowserAdapterRegistry,
  BrowserAdapterEngine,
  type BrowserAdaptationOutcome,
  type BrowserContextDraft,
  type BrowserObservation,
  constructCanonicalContext,
  createBrowserAdapterEngine,
  createBrowserAdapterRegistry,
  createBrowserObservation,
  captureDenseArrayOnce,
  deepFreeze,
  isPlainObject,
  MAX_ADAPTER_MISSING_COUNT,
  MAX_BROWSER_ADAPTER_COUNT,
  readOwnProperty,
  syntheticRepositoryVisibilityAdapter,
  validateAdapterDecision,
  validateBrowserContextDraft,
  validateBrowserObservation,
} from "../src/index.js";

function createValidBaseObservation(): BrowserObservation {
  return createBrowserObservation({
    id: "obs-valid-base" as import("../src/types.js").BrowserObservationId,
    capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
    page: {
      origin: "http://127.0.0.1:4173",
      routeId: "synthetic.repository-visibility",
    },
    metadata: {
      fixtureContract: "fc005.repository-visibility.v1",
      operation: "repository.visibility.change",
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

function createValidDraft(): BrowserContextDraft {
  return {
    kind: "synthetic.repository-visibility",
    entityKey: "fixture-repository",
    entityKind: "repository",
    currentVisibility: "private",
    requestedVisibility: "public",
    intent: {
      verb: "change-access",
      domain: "version_control",
    },
    targetRole: "primary",
  };
}

describe("H1: Decision and Draft Authoritative Validation", () => {
  it("rejects non-object, null, undefined, primitive, and array decisions", () => {
    expect(validateAdapterDecision(null).ok).toBe(false);
    expect(validateAdapterDecision(undefined).ok).toBe(false);
    expect(validateAdapterDecision("matched").ok).toBe(false);
    expect(validateAdapterDecision(42).ok).toBe(false);
    expect(validateAdapterDecision([]).ok).toBe(false);
    expect(validateAdapterDecision({ status: "invalid-status" }).ok).toBe(false);
  });

  it("rejects matched decision with missing or malformed draft", () => {
    expect(validateAdapterDecision({ status: "matched" }).ok).toBe(false);
    expect(validateAdapterDecision({ status: "matched", draft: null }).ok).toBe(false);
    expect(validateAdapterDecision({ status: "matched", draft: {} }).ok).toBe(false);
  });

  it("rejects matched decision with forbidden extra properties", () => {
    const res = validateAdapterDecision({
      status: "matched",
      draft: createValidDraft(),
      extraField: "hostile",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects not-applicable decision with forbidden fields or invalid reasonCode", () => {
    // Extra fields
    expect(
      validateAdapterDecision({
        status: "not-applicable",
        reasonCode: "UNMATCHED_SCOPE",
        draft: createValidDraft(),
      }).ok,
    ).toBe(false);

    // Invalid reasonCode
    expect(
      validateAdapterDecision({
        status: "not-applicable",
        reasonCode: "PASSWORD=secret",
      }).ok,
    ).toBe(false);
  });

  it("rejects insufficient-evidence decision with invalid missing array or extra fields", () => {
    // Missing not an array
    expect(
      validateAdapterDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_DATA",
        missing: "metadata.currentVisibility",
      }).ok,
    ).toBe(false);

    // Empty missing array
    expect(
      validateAdapterDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_DATA",
        missing: [],
      }).ok,
    ).toBe(false);

    // Hostile item in missing array (e.g. email or secret)
    expect(
      validateAdapterDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_DATA",
        missing: ["user@example.com"],
      }).ok,
    ).toBe(false);

    // Extra property
    expect(
      validateAdapterDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_DATA",
        missing: ["metadata.currentVisibility"],
        leakedData: "abc",
      }).ok,
    ).toBe(false);
  });

  it("rejects error decision with arbitrary message or invalid code (Finding M5)", () => {
    // Arbitrary message forbidden in trusted decision
    expect(
      validateAdapterDecision({
        status: "error",
        code: "INTERNAL_ERROR",
        message: "Secret error info leaked",
      }).ok,
    ).toBe(false);

    // Invalid error code
    expect(
      validateAdapterDecision({
        status: "error",
        code: "invalid-code-123!",
      }).ok,
    ).toBe(false);
  });

  it("strictly validates closed draft schema and rejects deviations", () => {
    const valid = createValidDraft();
    expect(validateBrowserContextDraft(valid).ok).toBe(true);

    // Wrong kind
    expect(validateBrowserContextDraft({ ...valid, kind: "document" }).ok).toBe(false);

    // Wrong entityKind
    expect(validateBrowserContextDraft({ ...valid, entityKind: "document" }).ok).toBe(false);
    expect(validateBrowserContextDraft({ ...valid, entityKind: "banana" }).ok).toBe(false);

    // Invented currentVisibility
    expect(validateBrowserContextDraft({ ...valid, currentVisibility: "public" }).ok).toBe(false);
    expect(validateBrowserContextDraft({ ...valid, currentVisibility: "banana" }).ok).toBe(false);

    // Wrong requestedVisibility
    expect(validateBrowserContextDraft({ ...valid, requestedVisibility: "private" }).ok).toBe(
      false,
    );

    // Wrong verb
    expect(
      validateBrowserContextDraft({
        ...valid,
        intent: { verb: "delete", domain: "version_control" },
      }).ok,
    ).toBe(false);

    // Wrong domain
    expect(
      validateBrowserContextDraft({
        ...valid,
        intent: { verb: "change-access", domain: "filesystem" },
      }).ok,
    ).toBe(false);

    // Wrong targetRole
    expect(validateBrowserContextDraft({ ...valid, targetRole: "recipient" }).ok).toBe(false);

    // Extra field on draft
    expect(validateBrowserContextDraft({ ...valid, extraProperty: "forbidden" }).ok).toBe(false);

    // Hostile getter on draft property
    const hostileDraft = { ...valid };
    Object.defineProperty(hostileDraft, "kind", {
      enumerable: true,
      get() {
        throw new Error("Detonated hostile getter");
      },
    });
    expect(validateBrowserContextDraft(hostileDraft).ok).toBe(false);
  });
});

describe("H2: EntityKey Grammar and Canonical Label Decoupling", () => {
  it("rejects hostile entityKey with spaces, newlines, emails, or secret-looking sentences", () => {
    const hostileKeys = [
      "PASSWORD=super-secret user@example.com",
      "user@example.com",
      "my secret repository",
      "repo\nwith\nnewline",
      "<script>alert(1)</script>",
      "repo=secret",
    ];

    for (const key of hostileKeys) {
      const raw = {
        id: "obs-hostile-ent",
        schemaVersion: "1.0",
        capturedAt: "2026-09-08T15:00:00.000Z",
        page: {
          origin: "http://127.0.0.1:4173",
          routeId: "synthetic.repository-visibility",
        },
        interaction: { kind: "activate" },
        element: { kind: "button", role: "button", buttonType: "button" },
        metadata: {
          fixtureContract: "fc005.repository-visibility.v1",
          operation: "repository.visibility.change",
          entityKey: key,
          currentVisibility: "private",
          requestedVisibility: "public",
        },
      };

      const res = validateBrowserObservation(raw);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.some((iss) => iss.path === "observation.metadata.entityKey")).toBe(true);
    }
  });

  it("canonical context uses predefined label 'Synthetic Repository', not page-provided entityKey", () => {
    const obs = createValidBaseObservation();
    const draft = createValidDraft();
    const adapter: BrowserActionAdapter = {
      id: "test.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Test adapter",
      assess: () => ({ status: "matched", draft }),
    };

    const ctxRes = constructCanonicalContext(draft, obs, adapter);
    expect(ctxRes.ok).toBe(true);
    if (!ctxRes.ok) return;

    const ctx = ctxRes.value;
    const entity = ctx.state.entities[0];
    expect(entity).toBeDefined();
    if (!entity) return;

    expect(entity.label).toBe("Synthetic Repository");
    expect(entity.label).not.toBe(obs.metadata.entityKey);

    // Verify context passes FC-002 canonical validation
    expect(validateActionEvaluationContext(ctx).valid).toBe(true);
  });
});

describe("H3: Adapter Authoritative Scope Enforcement", () => {
  it("rejects directly supplied observation from untrusted origin as NOT_APPLICABLE", () => {
    const untrustedObs = createBrowserObservation({
      id: "obs-untrusted-origin" as import("../src/types.js").BrowserObservationId,
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: {
        origin: "https://untrusted.example",
        routeId: "synthetic.repository-visibility",
      },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    });

    const decision = syntheticRepositoryVisibilityAdapter.assess(untrustedObs);
    expect(decision.status).toBe("not-applicable");
    if (decision.status !== "not-applicable") return;
    expect(decision.reasonCode).toBe("UNAUTHORIZED_ORIGIN");

    // Engine also returns unsupported (zero canonical context produced)
    const engine = new BrowserAdapterEngine();
    const outcome = engine.adapt(untrustedObs);
    expect(outcome.status).toBe("unsupported");
  });

  it("returns NOT_APPLICABLE for wrong interaction, element kind, role, or buttonType", () => {
    const baseInput = {
      capturedAt: "2026-09-08T15:00:00.000Z" as IsoTimestamp,
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "synthetic.repository-visibility",
      },
      interaction: { kind: "activate" },
      element: { kind: "button", role: "button", buttonType: "button" },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    };

    // Wrong interaction kind
    const wrongInter = createBrowserObservation({
      ...baseInput,
      interaction: { kind: "hover" },
    });
    expect(syntheticRepositoryVisibilityAdapter.assess(wrongInter).status).toBe("not-applicable");

    // Wrong element kind
    const wrongKind = createBrowserObservation({
      ...baseInput,
      element: { kind: "link", role: "button", buttonType: "button" },
    });
    expect(syntheticRepositoryVisibilityAdapter.assess(wrongKind).status).toBe("not-applicable");

    // Wrong role
    const wrongRole = createBrowserObservation({
      ...baseInput,
      element: { kind: "button", role: "link", buttonType: "button" },
    });
    expect(syntheticRepositoryVisibilityAdapter.assess(wrongRole).status).toBe("not-applicable");

    // Wrong buttonType
    const wrongType = createBrowserObservation({
      ...baseInput,
      element: { kind: "button", role: "button", buttonType: "submit" },
    });
    expect(syntheticRepositoryVisibilityAdapter.assess(wrongType).status).toBe("not-applicable");
  });
});

describe("M1: Hostile Boundary Protection", () => {
  it("safely handles revoked Proxy and throwing getPrototypeOf / ownKeys traps", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    // isPlainObject handles revoked proxy safely without throwing
    expect(isPlainObject(proxy)).toBe(false);

    // readOwnProperty handles revoked proxy safely without throwing
    const read = readOwnProperty(proxy, "prop");
    expect(read.status).toBe("error");

    // validateBrowserObservation handles revoked proxy safely
    const valRes = validateBrowserObservation(proxy);
    expect(valRes.ok).toBe(false);
  });

  it("safely catches and normalizes ID generator throwing Error, string, null, or Object.create(null)", () => {
    const obs = createValidBaseObservation();
    const draft = createValidDraft();
    const adapter = syntheticRepositoryVisibilityAdapter;

    const throwingGenerators = [
      {
        generate: () => {
          throw new Error("ID gen error");
        },
      },
      {
        generate: () => {
          throw "string throw";
        },
      },
      {
        generate: () => {
          throw null;
        },
      },
      {
        generate: () => {
          throw Object.create(null);
        },
      },
      {
        generate: () => {
          throw { toString: null };
        },
      },
    ];

    for (const idGen of throwingGenerators) {
      const res = constructCanonicalContext(draft, obs, adapter, {
        idGenerator: idGen as unknown as import("@futureclick/shared").IdGenerator,
      });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.message).toContain("[INVALID_CONFIGURATION]");
    }
  });
});

describe("M2: Engine Registry Ingress Snapshotting & Immutability", () => {
  it("rejects invalid forged registry objects safely", () => {
    // Missing adapters array
    expect(
      () => new BrowserAdapterEngine({ registry: {} as unknown as BrowserAdapterRegistry }),
    ).toThrow();

    // Registry with invalid adapter member
    const invalidRegistry = {
      adapters: [
        {
          id: "invalid id with spaces",
          version: "1.0",
          description: "desc",
          assess: () => ({ status: "not-applicable", reasonCode: "UNMATCHED" }),
        },
      ],
    };
    expect(
      () =>
        new BrowserAdapterEngine({
          registry: invalidRegistry as unknown as BrowserAdapterRegistry,
        }),
    ).toThrow();
  });

  it("snapshots and detaches adapter definitions so caller mutations have zero effect", () => {
    const dummyAdapter: BrowserActionAdapter = {
      id: "dummy.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Dummy adapter",
      assess: () => ({ status: "not-applicable", reasonCode: "UNMATCHED" }) as AdapterDecision,
    };

    const callerAdapters = [dummyAdapter];
    const engine = new BrowserAdapterEngine({ registry: callerAdapters });

    // Mutate caller array
    callerAdapters.push(syntheticRepositoryVisibilityAdapter);
    expect(callerAdapters.length).toBe(2);

    // Engine's internal registry remains detached with exactly 1 adapter
    const obs = createValidBaseObservation();
    const outcome = engine.adapt(obs);
    // Since only dummyAdapter is in the engine, it returns unsupported rather than matching
    expect(outcome.status).toBe("unsupported");
  });
});

describe("FC-005B M1: Hostile Boundary, Schema Coercion & Generator Safety", () => {
  it("hostile schemaVersion Symbol.toPrimitive produces fixed invalid-observation failure without arbitrary throw or secret retention", () => {
    const raw = {
      ...createValidBaseObservation(),
      schemaVersion: {
        [Symbol.toPrimitive]() {
          throw "PASSWORD=secret";
        },
      },
    };

    const valRes = validateBrowserObservation(raw);
    expect(valRes.ok).toBe(false);

    const engine = new BrowserAdapterEngine();
    const outcome = engine.adapt(raw as unknown as BrowserObservation);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_OBSERVATION);

    const json = JSON.stringify(outcome);
    expect(json).not.toContain("PASSWORD");
    expect(json).not.toContain("secret");
  });

  it("hostile schemaVersion toString produces fixed invalid-observation failure without arbitrary throw or secret retention", () => {
    const raw = {
      ...createValidBaseObservation(),
      schemaVersion: {
        toString() {
          throw "PASSWORD=secret";
        },
      },
    };

    const valRes = validateBrowserObservation(raw);
    expect(valRes.ok).toBe(false);

    const engine = new BrowserAdapterEngine();
    const outcome = engine.adapt(raw as unknown as BrowserObservation);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_OBSERVATION);

    const json = JSON.stringify(outcome);
    expect(json).not.toContain("PASSWORD");
    expect(json).not.toContain("secret");
  });

  it("revoked observation Proxy is safely handled fail-closed without escaping exceptions", () => {
    const { proxy, revoke } = Proxy.revocable(createValidBaseObservation(), {});
    revoke();

    const valRes = validateBrowserObservation(proxy);
    expect(valRes.ok).toBe(false);

    const engine = new BrowserAdapterEngine();
    const outcome = engine.adapt(proxy as unknown as BrowserObservation);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_OBSERVATION);
  });

  it("deepFreeze handles hostile ownKeys, getPrototypeOf, getOwnPropertyDescriptor, get, and revoked Proxy without throwing", () => {
    // 1. Revoked proxy
    const { proxy: revProxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => deepFreeze(revProxy)).not.toThrow();

    // 2. Proxy throwing ownKeys
    const throwingOwnKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("Hostile ownKeys trap");
        },
      },
    );
    expect(() => deepFreeze(throwingOwnKeys)).not.toThrow();

    // 3. Proxy throwing getOwnPropertyDescriptor
    const throwingDesc = new Proxy(
      { a: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error("Hostile descriptor trap");
        },
      },
    );
    expect(() => deepFreeze(throwingDesc)).not.toThrow();

    // 4. Proxy throwing get
    const throwingGet = new Proxy(
      { a: 1 },
      {
        get() {
          throw new Error("Hostile get trap");
        },
      },
    );
    expect(() => deepFreeze(throwingGet)).not.toThrow();

    // 5. Proxy throwing getPrototypeOf
    const throwingProto = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("Hostile getPrototypeOf trap");
        },
      },
    );
    expect(() => deepFreeze(throwingProto)).not.toThrow();

    // 6. Nested hostile object
    const nestedHostile = {
      level1: {
        level2: throwingGet,
      },
    };
    expect(() => deepFreeze(nestedHostile)).not.toThrow();
  });

  it("ID generator returning non-string values fails safely with fixed INVALID_CONFIGURATION code and zero secret", () => {
    const obs = createValidBaseObservation();
    const draft = createValidDraft();
    const adapter = syntheticRepositoryVisibilityAdapter;

    const { proxy: revProxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const invalidReturnGenerators: unknown[] = [
      null,
      undefined,
      123,
      {},
      [],
      Object.create(null),
      { toString: null },
      new Proxy(
        {},
        {
          get() {
            throw new Error("PASSWORD=secret-proxy");
          },
        },
      ),
      revProxy,
      {
        [Symbol.toPrimitive]() {
          throw "PASSWORD=secret-toPrimitive";
        },
      },
      {
        toString() {
          throw "PASSWORD=secret-toString";
        },
      },
    ];

    for (const retVal of invalidReturnGenerators) {
      const hostileIdGen = {
        generate: () => retVal,
      };

      const res = constructCanonicalContext(draft, obs, adapter, {
        idGenerator: hostileIdGen as unknown as import("@futureclick/shared").IdGenerator,
      });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.message).toContain("[INVALID_CONFIGURATION]");
      expect(res.error.message).not.toContain("PASSWORD");

      // Verify at the BrowserAdapterEngine public boundary
      const engine = new BrowserAdapterEngine({
        idGenerator: hostileIdGen as unknown as import("@futureclick/shared").IdGenerator,
      });
      const outcome = engine.adapt(obs);
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") continue;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_CONFIGURATION);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("PASSWORD");
    }
  });

  it("ID generator throwing secrets fails with fixed INVALID_CONFIGURATION code and zero secret prose in public outcome", () => {
    const obs = createValidBaseObservation();
    const throwingGenerators = [
      () => {
        throw new Error("PASSWORD=super-secret-error");
      },
      () => {
        throw "PASSWORD=super-secret-string";
      },
      () => {
        throw null;
      },
      () => {
        throw Object.create(null);
      },
      () => {
        throw { toString: null };
      },
    ];

    for (const throwFn of throwingGenerators) {
      const hostileGen = { generate: throwFn };
      const engine = new BrowserAdapterEngine({
        idGenerator: hostileGen as unknown as import("@futureclick/shared").IdGenerator,
      });
      const outcome = engine.adapt(obs);
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") continue;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_CONFIGURATION);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("PASSWORD");
      expect(json).not.toContain("super-secret");
    }
  });
});

describe("FC-005B M2: Hostile Registry, Configuration & Constructor Boundaries", () => {
  it("safely rejects revoked registry Proxy", () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();

    expect(
      () =>
        new BrowserAdapterEngine({
          registry: proxy as unknown as BrowserAdapterRegistry,
        }),
    ).toThrow(/INVALID_CONFIGURATION/);
    const factoryRes = createBrowserAdapterEngine({
      registry: proxy as unknown as BrowserAdapterRegistry,
    });
    expect(factoryRes.ok).toBe(false);
  });

  it("safely rejects registry whose adapters getter throws Error, string, or null without leaking secrets", () => {
    // Getter throws Error with secret
    const hostileRegErr = {
      get adapters() {
        throw new Error("PASSWORD=secret-reg-error");
      },
    };
    try {
      new BrowserAdapterEngine({
        registry: hostileRegErr as unknown as BrowserAdapterRegistry,
      });
      expect.unreachable("Should have thrown");
    } catch (thrown) {
      expect((thrown as Error).message).toContain("[INVALID_CONFIGURATION]");
      expect((thrown as Error).message).not.toContain("PASSWORD");
    }

    // Getter throws string
    const hostileRegStr = {
      get adapters() {
        throw "PASSWORD=secret-reg-str";
      },
    };
    try {
      new BrowserAdapterEngine({
        registry: hostileRegStr as unknown as BrowserAdapterRegistry,
      });
      expect.unreachable("Should have thrown");
    } catch (thrown) {
      expect((thrown as Error).message).toContain("[INVALID_CONFIGURATION]");
      expect((thrown as Error).message).not.toContain("PASSWORD");
    }

    // Getter throws null
    const hostileRegNull = {
      get adapters() {
        throw null;
      },
    };
    expect(
      () =>
        new BrowserAdapterEngine({
          registry: hostileRegNull as unknown as BrowserAdapterRegistry,
        }),
    ).toThrow(/INVALID_CONFIGURATION/);
  });

  it("safely rejects adapters array Proxy with throwing length or index", () => {
    // Length throws
    const hostileLen = new Proxy([syntheticRepositoryVisibilityAdapter], {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("PASSWORD=secret-len");
        return Reflect.get(target, prop, receiver);
      },
    });
    try {
      new BrowserAdapterEngine({ registry: hostileLen });
      expect.unreachable("Should have thrown");
    } catch (thrown) {
      expect((thrown as Error).message).not.toContain("PASSWORD");
    }

    // Index throws
    const hostileIdx = new Proxy([syntheticRepositoryVisibilityAdapter], {
      get(target, prop, receiver) {
        if (prop === "0") throw new Error("PASSWORD=secret-idx");
        return Reflect.get(target, prop, receiver);
      },
    });
    try {
      new BrowserAdapterEngine({ registry: hostileIdx });
      expect.unreachable("Should have thrown");
    } catch (thrown) {
      expect((thrown as Error).message).not.toContain("PASSWORD");
    }
  });

  it("safely rejects revoked engine options/config Proxy and throwing options getters", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(
      () =>
        new BrowserAdapterEngine(
          proxy as unknown as import("../src/engine.js").BrowserAdapterEngineOptions,
        ),
    ).toThrow(/INVALID_CONFIGURATION/);

    const throwingOptions = {
      get registry() {
        throw new Error("PASSWORD=secret-options");
      },
    };
    try {
      new BrowserAdapterEngine(
        throwingOptions as unknown as import("../src/engine.js").BrowserAdapterEngineOptions,
      );
      expect.unreachable("Should have thrown");
    } catch (thrown) {
      expect((thrown as Error).message).toContain("[INVALID_CONFIGURATION]");
      expect((thrown as Error).message).not.toContain("PASSWORD");
    }
  });
});

describe("FC-005B M5: Adapter Thrown Exception Privacy & Diagnostic Masking", () => {
  it("adapter throwing Error with secret returns code-only ADAPTER_EXECUTION_FAILED with zero secret prose", () => {
    const throwingAdapter: BrowserActionAdapter = {
      id: "throw.error.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Throws secret error",
      assess: () => {
        throw new Error("PASSWORD=super-secret user@example.com");
      },
    };

    const engine = new BrowserAdapterEngine({ registry: [throwingAdapter] });
    const obs = createValidBaseObservation();
    const outcome = engine.adapt(obs);

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.ADAPTER_EXECUTION_FAILED);

    // Deep recursive check for secrets in the outcome object
    const json = JSON.stringify(outcome);
    expect(json).not.toContain("PASSWORD");
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("user@example.com");
  });

  it("adapter throwing string with secret returns code-only ADAPTER_EXECUTION_FAILED with zero secret prose", () => {
    const throwingAdapter: BrowserActionAdapter = {
      id: "throw.string.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Throws secret string",
      assess: () => {
        throw "PASSWORD=super-secret user@example.com";
      },
    };

    const engine = new BrowserAdapterEngine({ registry: [throwingAdapter] });
    const obs = createValidBaseObservation();
    const outcome = engine.adapt(obs);

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.ADAPTER_EXECUTION_FAILED);

    const json = JSON.stringify(outcome);
    expect(json).not.toContain("PASSWORD");
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("user@example.com");
  });

  it("adapter throwing hostile objects or proxies returns code-only ADAPTER_EXECUTION_FAILED with zero secret prose", () => {
    const { proxy: revProxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const hostileThrows = [
      { secret: "super-secret" },
      Object.create(null),
      new Proxy(
        {},
        {
          get() {
            throw new Error("nested");
          },
        },
      ),
      revProxy,
    ];

    for (const thrownVal of hostileThrows) {
      const adapter: BrowserActionAdapter = {
        id: "throw.hostile.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Throws hostile object",
        assess: () => {
          throw thrownVal;
        },
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const obs = createValidBaseObservation();
      const outcome = engine.adapt(obs);

      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") continue;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.ADAPTER_EXECUTION_FAILED);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("super-secret");
    }
  });

  it("malformed property-name diagnostic PASSWORD_super_secret never reaches public outcome", () => {
    const base = createValidBaseObservation();
    const badObs = {
      ...base,
      metadata: {
        ...base.metadata,
        PASSWORD_super_secret: "leak-attempt",
      },
    };

    const engine = new BrowserAdapterEngine();
    const outcome = engine.adapt(badObs as unknown as BrowserObservation);

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_OBSERVATION);

    const json = JSON.stringify(outcome);
    expect(json).not.toContain("PASSWORD_super_secret");
    expect(json).not.toContain("leak-attempt");
  });
});

describe("FC-005C M1: Hostile Oversized Missing Array & Dense Array Length Safety", () => {
  it("exact Codex reproduction: oversized missing length 4294967296 returns INVALID_ADAPTER_OUTPUT without RangeError", () => {
    const oversizedMissing = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") {
          return 4294967296;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const hostileAdapter: BrowserActionAdapter = {
      id: "oversized.missing.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Returns oversized missing array",
      assess: () =>
        ({
          status: "insufficient-evidence",
          reasonCode: "MISSING_DATA",
          missing: oversizedMissing,
        }) as unknown as AdapterDecision,
    };

    const engine = new BrowserAdapterEngine({ registry: [hostileAdapter] });
    const obs = createValidBaseObservation();

    // Must not throw RangeError: Invalid array length
    let outcome: BrowserAdaptationOutcome | undefined;
    expect(() => {
      outcome = engine.adapt(obs);
    }).not.toThrow();

    expect(outcome).toBeDefined();
    expect(outcome?.status).toBe("error");
    if (outcome?.status !== "error") return;
    expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);

    // Verify raw hostile length or diagnostic prose does not leak
    const json = JSON.stringify(outcome);
    expect(json).not.toContain("4294967296");
    expect(json).not.toContain("RangeError");
  });

  describe("boundary length tests (0, 1, 16, 17, 4294967295, 4294967296, MAX_SAFE_INTEGER)", () => {
    it("missing length = 0 returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const emptyAdapter: BrowserActionAdapter = {
        id: "len0.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns empty missing array",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: [],
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [emptyAdapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("missing length = 1 is valid insufficient-evidence", () => {
      const len1Adapter: BrowserActionAdapter = {
        id: "len1.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns 1 missing entry",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: ["token_one"],
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [len1Adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("insufficient-evidence");
      if (outcome.status !== "insufficient-evidence") return;
      expect(outcome.reasonCode).toBe("MISSING_DATA");
      expect(outcome.missing).toEqual(["token_one"]);
    });

    it("missing length = 16 is valid insufficient-evidence", () => {
      const sixteenTokens = Array.from({ length: 16 }, (_, i) => `token_${i}`);
      const len16Adapter: BrowserActionAdapter = {
        id: "len16.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns 16 missing entries",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: sixteenTokens,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [len16Adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("insufficient-evidence");
      if (outcome.status !== "insufficient-evidence") return;
      expect(outcome.reasonCode).toBe("MISSING_DATA");
      expect(outcome.missing).toHaveLength(16);
      expect(outcome.missing).toEqual(sixteenTokens);
    });

    it("missing length = 17 returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const seventeenTokens = Array.from({ length: 17 }, (_, i) => `token_${i}`);
      const len17Adapter: BrowserActionAdapter = {
        id: "len17.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns 17 missing entries",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: seventeenTokens,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [len17Adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("missing length = 4294967295 returns fixed INVALID_ADAPTER_OUTPUT without allocation", () => {
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 4294967295;
          return Reflect.get(target, prop, receiver);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "len4294967295.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns 4294967295 length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("missing length = 4294967296 returns fixed INVALID_ADAPTER_OUTPUT without RangeError", () => {
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 4294967296;
          return Reflect.get(target, prop, receiver);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "len4294967296.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns 4294967296 length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("missing length = Number.MAX_SAFE_INTEGER returns fixed INVALID_ADAPTER_OUTPUT without allocation", () => {
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return Number.MAX_SAFE_INTEGER;
          return Reflect.get(target, prop, receiver);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "lenMaxSafe.adapter" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Returns Number.MAX_SAFE_INTEGER length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });
  });

  describe("hostile length getter tests", () => {
    it("length getter throwing Error returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const proxy = new Proxy([], {
        get(target, prop) {
          if (prop === "length") {
            throw new Error("PASSWORD=secret-length-error");
          }
          return Reflect.get(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "throw.length.err" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Throws on length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("PASSWORD");
      expect(json).not.toContain("secret-length-error");
    });

    it("length getter throwing string returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const proxy = new Proxy([], {
        get(target, prop) {
          if (prop === "length") {
            throw "PASSWORD=secret-length-string";
          }
          return Reflect.get(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "throw.length.str" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Throws string on length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("PASSWORD");
      expect(json).not.toContain("secret-length-string");
    });

    it("length getter throwing null returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const proxy = new Proxy([], {
        get(target, prop) {
          if (prop === "length") {
            throw null;
          }
          return Reflect.get(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "throw.length.null" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Throws null on length",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("length getter changing value between reads is read exactly once", () => {
      let lengthReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") {
            lengthReads++;
            return lengthReads === 1 ? 1 : 100;
          }
          if (prop === "0") {
            return "valid_token";
          }
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          if (prop === "0") return true;
          return Reflect.has(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "changing.length" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Changing length getter",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("insufficient-evidence");
      if (outcome.status !== "insufficient-evidence") return;
      expect(outcome.missing).toEqual(["valid_token"]);
      expect(lengthReads).toBe(1);
    });
  });

  describe("hostile index tests within accepted limit", () => {
    it("index getter throwing Error returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 2;
          if (prop === "0") return "valid_token";
          if (prop === "1") throw new Error("PASSWORD=secret-index-error");
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          if (prop === "0" || prop === "1") return true;
          return Reflect.has(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "throw.index.err" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Throws on index 1",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);

      const json = JSON.stringify(outcome);
      expect(json).not.toContain("PASSWORD");
      expect(json).not.toContain("secret-index-error");
    });

    it("sparse missing array returns fixed INVALID_ADAPTER_OUTPUT", () => {
      const sparseArr: string[] = [];
      sparseArr[1] = "second_token"; // index 0 is empty hole

      const adapter: BrowserActionAdapter = {
        id: "sparse.missing" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Sparse missing array",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: sparseArr,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.INVALID_ADAPTER_OUTPUT);
    });

    it("changing index value is read exactly once into detached frozen array", () => {
      let index0Reads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 1;
          if (prop === "0") {
            index0Reads++;
            return index0Reads === 1 ? "token_one" : "token_mutated";
          }
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          if (prop === "0") return true;
          return Reflect.has(target, prop);
        },
      });

      const adapter: BrowserActionAdapter = {
        id: "changing.index" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Changing index getter",
        assess: () =>
          ({
            status: "insufficient-evidence",
            reasonCode: "MISSING_DATA",
            missing: proxy,
          }) as unknown as AdapterDecision,
      };

      const engine = new BrowserAdapterEngine({ registry: [adapter] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("insufficient-evidence");
      if (outcome.status !== "insufficient-evidence") return;
      expect(outcome.missing).toEqual(["token_one"]);
      expect(index0Reads).toBe(1);
    });
  });

  describe("direct captureDenseArrayOnce bounds tests", () => {
    it("captureDenseArrayOnce enforces maxLength before allocation or iteration", () => {
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 4294967296;
          return Reflect.get(target, prop, receiver);
        },
      });

      const resWithMax = captureDenseArrayOnce(proxy, "missing", 16);
      expect(resWithMax.ok).toBe(false);
      if (resWithMax.ok) return;
      expect(resWithMax.error.message).toContain("exceeds maximum allowed length of 16");

      // Without explicit maxLength, it still protects against 4294967295 exceeding JS max array length
      const resWithoutMax = captureDenseArrayOnce(proxy, "array");
      expect(resWithoutMax.ok).toBe(false);
      if (resWithoutMax.ok) return;
      expect(resWithoutMax.error.message).toContain("exceeds maximum array length");
    });
  });
});

describe("FC-005D: Registry Resource-Bound & Adapter Count Safety", () => {
  function createMinimalValidAdapter(index: number): BrowserActionAdapter {
    return {
      id: `test.adapter.${index}` as AdapterId,
      version: "1.0" as AdapterVersion,
      description: `Test adapter ${index}`,
      assess: () => ({ status: "not-applicable", reasonCode: "TEST" }),
    };
  }

  it("exact Codex reproduction 1: length = 4294967295 rejected immediately with 0 index reads", () => {
    let indexReads = 0;
    const proxy = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") return 4294967295;
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          indexReads++;
          return createMinimalValidAdapter(0);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const factoryRes = createBrowserAdapterEngine({
      registry: proxy as unknown as BrowserAdapterRegistry,
    });
    expect(factoryRes.ok).toBe(false);
    if (factoryRes.ok) return;
    expect(factoryRes.error.message).toContain("[INVALID_CONFIGURATION]");
    expect(indexReads).toBe(0);

    expect(
      () =>
        new BrowserAdapterEngine({
          registry: proxy as unknown as BrowserAdapterRegistry,
        }),
    ).toThrow(/INVALID_CONFIGURATION/);
    expect(indexReads).toBe(0);
  });

  it("exact Codex reproduction 2: length = 100000 rejected immediately with 0 index reads", () => {
    let indexReads = 0;
    const proxy = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") return 100000;
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          indexReads++;
          return createMinimalValidAdapter(0);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const factoryRes = createBrowserAdapterEngine({
      registry: proxy as unknown as BrowserAdapterRegistry,
    });
    expect(factoryRes.ok).toBe(false);
    if (factoryRes.ok) return;
    expect(factoryRes.error.message).toContain("[INVALID_CONFIGURATION]");
    expect(indexReads).toBe(0);

    expect(
      () =>
        new BrowserAdapterEngine({
          registry: proxy as unknown as BrowserAdapterRegistry,
        }),
    ).toThrow(/INVALID_CONFIGURATION/);
    expect(indexReads).toBe(0);
  });

  describe("registry boundary tests (0, 1, 16, 17, 255, 256, 257, 100000, 4294967295, 4294967296, MAX_SAFE_INTEGER)", () => {
    it("0 adapters: empty registry accepted, engine reports NO_REGISTERED_ADAPTERS", () => {
      const registry = createBrowserAdapterRegistry([]);
      expect(registry.adapters).toHaveLength(0);

      const engine = new BrowserAdapterEngine({ registry: [] });
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("unsupported");
      if (outcome.status !== "unsupported") return;
      expect(outcome.reasonCode).toBe("NO_REGISTERED_ADAPTERS");
    });

    it("1 adapter: accepted", () => {
      const adapter = createMinimalValidAdapter(0);
      const registry = createBrowserAdapterRegistry([adapter]);
      expect(registry.adapters).toHaveLength(1);
      expect(registry.hasAdapter(adapter.id)).toBe(true);
    });

    it("16 adapters: accepted", () => {
      const adapters = Array.from({ length: 16 }, (_, i) => createMinimalValidAdapter(i));
      const registry = createBrowserAdapterRegistry(adapters);
      expect(registry.adapters).toHaveLength(16);
    });

    it("17 adapters: accepted", () => {
      const adapters = Array.from({ length: 17 }, (_, i) => createMinimalValidAdapter(i));
      const registry = createBrowserAdapterRegistry(adapters);
      expect(registry.adapters).toHaveLength(17);
    });

    it("255 adapters: accepted", () => {
      const adapters = Array.from({ length: 255 }, (_, i) => createMinimalValidAdapter(i));
      const registry = createBrowserAdapterRegistry(adapters);
      expect(registry.adapters).toHaveLength(255);
    });

    it("256 adapters (MAX_BROWSER_ADAPTER_COUNT): accepted", () => {
      const adapters = Array.from({ length: MAX_BROWSER_ADAPTER_COUNT }, (_, i) =>
        createMinimalValidAdapter(i),
      );
      const registry = createBrowserAdapterRegistry(adapters);
      expect(registry.adapters).toHaveLength(256);
    });

    it("257 adapters: rejected BEFORE allocation or index traversal", () => {
      let indexReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 257;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            indexReads++;
            return createMinimalValidAdapter(0);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      expect(() =>
        createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
      ).toThrow(/INVALID_CONFIGURATION/);
      expect(indexReads).toBe(0);

      const factoryRes = createBrowserAdapterEngine({
        registry: proxy as unknown as BrowserAdapterRegistry,
      });
      expect(factoryRes.ok).toBe(false);
      expect(indexReads).toBe(0);
    });

    it("100000 adapters: rejected before traversal", () => {
      let indexReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 100000;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            indexReads++;
            return createMinimalValidAdapter(0);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      expect(() =>
        createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
      ).toThrow(/INVALID_CONFIGURATION/);
      expect(indexReads).toBe(0);
    });

    it("4294967295 adapters: rejected before allocation/traversal", () => {
      let indexReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 4294967295;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            indexReads++;
            return createMinimalValidAdapter(0);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      expect(() =>
        createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
      ).toThrow(/INVALID_CONFIGURATION/);
      expect(indexReads).toBe(0);
    });

    it("4294967296 adapters: rejected safely", () => {
      let indexReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return 4294967296;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            indexReads++;
            return createMinimalValidAdapter(0);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      expect(() =>
        createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
      ).toThrow(/INVALID_CONFIGURATION/);
      expect(indexReads).toBe(0);
    });

    it("Number.MAX_SAFE_INTEGER adapters: rejected safely", () => {
      let indexReads = 0;
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") return Number.MAX_SAFE_INTEGER;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            indexReads++;
            return createMinimalValidAdapter(0);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      expect(() =>
        createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
      ).toThrow(/INVALID_CONFIGURATION/);
      expect(indexReads).toBe(0);
    });
  });

  describe("single length read & oversized index access guarantee", () => {
    it("hostile changing length getter is read exactly once", () => {
      let lengthReads = 0;
      const validAdapter = createMinimalValidAdapter(0);
      const proxy = new Proxy([], {
        get(target, prop, receiver) {
          if (prop === "length") {
            lengthReads++;
            return lengthReads === 1 ? 1 : 100000;
          }
          if (prop === "0") {
            return validAdapter;
          }
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          if (prop === "0") return true;
          return Reflect.has(target, prop);
        },
      });

      const registry = createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]);
      expect(lengthReads).toBe(1);
      expect(registry.adapters).toHaveLength(1);
      expect(registry.adapters[0]?.id).toBe(validAdapter.id);
    });

    it("oversized lengths (257, 100000, 4294967295) perform exactly 0 index reads", () => {
      for (const len of [257, 100000, 4294967295]) {
        let indexReads = 0;
        const proxy = new Proxy([], {
          get(target, prop, receiver) {
            if (prop === "length") return len;
            if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
              indexReads++;
              return createMinimalValidAdapter(0);
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        expect(() =>
          createBrowserAdapterRegistry(proxy as unknown as BrowserActionAdapter[]),
        ).toThrow(/INVALID_CONFIGURATION/);
        expect(indexReads).toBe(0);
      }
    });
  });

  describe("valid maximum registry (MAX_BROWSER_ADAPTER_COUNT = 256) snapshot & mutation isolation", () => {
    it("captures 256 adapters once, remains frozen and isolated from source mutations", () => {
      // First adapter is synthetic repository visibility adapter, remaining 255 are test adapters
      const sourceAdapters: BrowserActionAdapter[] = [
        syntheticRepositoryVisibilityAdapter,
        ...Array.from({ length: 255 }, (_, i) => createMinimalValidAdapter(i + 1)),
      ];
      expect(sourceAdapters).toHaveLength(MAX_BROWSER_ADAPTER_COUNT);

      const engine = new BrowserAdapterEngine({ registry: sourceAdapters });
      expect(engine).toBeDefined();

      // Adapt valid observation: syntheticRepositoryVisibilityAdapter matches
      const outcome = engine.adapt(createValidBaseObservation());
      expect(outcome.status).toBe("matched");
      if (outcome.status !== "matched") return;
      expect(outcome.adapterId).toBe("browser.synthetic.repository-visibility");

      // Verify mutation isolation
      sourceAdapters.length = 0;
      sourceAdapters.push(createMinimalValidAdapter(999));

      const outcomeAfterMutation = engine.adapt(createValidBaseObservation());
      expect(outcomeAfterMutation.status).toBe("matched");
      if (outcomeAfterMutation.status !== "matched") return;
      expect(outcomeAfterMutation.adapterId).toBe("browser.synthetic.repository-visibility");

      // Verify registry creation directly produces frozen detached array
      const registry = createBrowserAdapterRegistry([
        syntheticRepositoryVisibilityAdapter,
        ...Array.from({ length: 255 }, (_, i) => createMinimalValidAdapter(i + 1)),
      ]);
      expect(registry.adapters).toHaveLength(256);
      expect(Object.isFrozen(registry.adapters)).toBe(true);
      expect(registry.hasAdapter("browser.synthetic.repository-visibility" as AdapterId)).toBe(
        true,
      );
      expect(registry.hasAdapter("test.adapter.255" as AdapterId)).toBe(true);
      expect(registry.hasAdapter("test.adapter.256" as AdapterId)).toBe(false);
    });
  });
});
