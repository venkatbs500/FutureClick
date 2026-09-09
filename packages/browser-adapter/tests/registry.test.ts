import { describe, expect, it } from "vitest";
import {
  type AdapterDecision,
  type AdapterId,
  type AdapterVersion,
  type BrowserActionAdapter,
  createBrowserAdapterRegistry,
  createDefaultBrowserAdapterRegistry,
  syntheticRepositoryVisibilityAdapter,
  validateBrowserActionAdapter,
} from "../src/index.js";

const dummyAdapter1: BrowserActionAdapter = Object.freeze({
  id: "test.adapter.one" as AdapterId,
  version: "1.0" as AdapterVersion,
  description: "Test adapter one",
  assess: (): AdapterDecision => ({ status: "not-applicable", reasonCode: "TEST_NOT_APPLICABLE" }),
});

const dummyAdapter2: BrowserActionAdapter = Object.freeze({
  id: "test.adapter.two" as AdapterId,
  version: "1.0" as AdapterVersion,
  description: "Test adapter two",
  assess: (): AdapterDecision => ({ status: "not-applicable", reasonCode: "TEST_NOT_APPLICABLE" }),
});

describe("Browser Action Adapter Registry", () => {
  it("Probe 1: Default registry contains synthetic repository visibility adapter", () => {
    const registry = createDefaultBrowserAdapterRegistry();
    expect(registry.adapters.length).toBe(1);
    expect(registry.hasAdapter(syntheticRepositoryVisibilityAdapter.id)).toBe(true);
    expect(registry.getAdapter(syntheticRepositoryVisibilityAdapter.id)).toEqual(
      syntheticRepositoryVisibilityAdapter,
    );
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.adapters)).toBe(true);
  });

  it("Probe 2: Successfully creates registry with multiple distinct adapters", () => {
    const registry = createBrowserAdapterRegistry([dummyAdapter1, dummyAdapter2]);
    expect(registry.adapters.length).toBe(2);
    expect(registry.hasAdapter(dummyAdapter1.id)).toBe(true);
    expect(registry.hasAdapter(dummyAdapter2.id)).toBe(true);
  });

  it("Probe 3: Rejects duplicate AdapterIds fail-closed", () => {
    const duplicateAdapter: BrowserActionAdapter = Object.freeze({
      id: dummyAdapter1.id,
      version: "2.0" as AdapterVersion,
      description: "Another adapter with duplicate id",
      assess: (): AdapterDecision => ({ status: "not-applicable", reasonCode: "DUPLICATE" }),
    });

    expect(() => {
      createBrowserAdapterRegistry([dummyAdapter1, duplicateAdapter]);
    }).toThrow(/Duplicate AdapterId/);
  });

  it("Probe 4: Rejects non-array input for adapters", () => {
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      createBrowserAdapterRegistry("not-an-array" as any);
    }).toThrow(/Adapters must be provided as an array/);
  });

  it("Probe 5: Rejects sparse arrays (dense array snapshotting)", () => {
    const sparseArray: BrowserActionAdapter[] = [];
    sparseArray[0] = dummyAdapter1;
    sparseArray[2] = dummyAdapter2; // missing index 1

    expect(() => {
      createBrowserAdapterRegistry(sparseArray);
    }).toThrow(/Sparse arrays are rejected/);
  });

  it("Probe 6: Hostile getter on array length is safely caught", () => {
    const hostileArray = new Proxy([dummyAdapter1], {
      get(target, prop, receiver) {
        if (prop === "length") {
          throw new Error("Hostile array length getter!");
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(() => {
      createBrowserAdapterRegistry(hostileArray);
    }).toThrow(/Failed reading length of adapters/);
  });

  it("Probe 7: Hostile getter on array index is safely caught", () => {
    const hostileArray = [dummyAdapter1];
    Object.defineProperty(hostileArray, 0, {
      get() {
        throw new Error("Hostile element index getter!");
      },
    });

    expect(() => {
      createBrowserAdapterRegistry(hostileArray);
    }).toThrow(/Failed reading element at index/);
  });

  it("Probe 8: Rejects invalid adapter definitions (missing id, version, etc.)", () => {
    expect(validateBrowserActionAdapter(null).valid).toBe(false);
    expect(validateBrowserActionAdapter({}).valid).toBe(false);
    expect(
      validateBrowserActionAdapter({
        id: "valid.id",
        version: "1.0",
        description: "Missing assess",
      }).valid,
    ).toBe(false);
  });

  it("Probe 9: Source array mutation does not affect registered registry", () => {
    const mutableAdapters = [dummyAdapter1];
    const registry = createBrowserAdapterRegistry(mutableAdapters);
    expect(registry.adapters.length).toBe(1);

    mutableAdapters.push(dummyAdapter2);
    expect(registry.adapters.length).toBe(1);
    expect(registry.hasAdapter(dummyAdapter2.id)).toBe(false);
  });
});
