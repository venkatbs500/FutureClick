import { describe, expect, it } from "vitest";
import * as sharedModule from "../src/index.js";
import {
  createDeterministicIdGenerator,
  currentIsoTimestamp,
  err,
  generateEntityId,
  isErr,
  isOk,
  isValidIsoTimestamp,
  ok,
  parseIsoTimestamp,
  unwrapResult,
} from "../src/index.js";

describe("shared/result", () => {
  it("creates an ok result and unwraps value", () => {
    const res = ok(42);
    expect(isOk(res)).toBe(true);
    expect(isErr(res)).toBe(false);
    expect(unwrapResult(res)).toBe(42);
  });

  it("creates an err result and checks type guards", () => {
    const res = err(new Error("Failed"));
    expect(isOk(res)).toBe(false);
    expect(isErr(res)).toBe(true);
    expect(() => unwrapResult(res)).toThrow("Failed");
  });
});

describe("shared/id", () => {
  it("A. Production generateEntityId returns UUID-backed opaque IDs with optional prefix", () => {
    const idWithPrefix = generateEntityId<"ActionId">("act");
    expect(idWithPrefix.startsWith("act-")).toBe(true);
    const uuidPart = idWithPrefix.slice(4);
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(uuidPart).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const bareId = generateEntityId<"EntityId">();
    expect(bareId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("B. Production generation does not depend on Date.now, wall-clock time, or global sequence counters", () => {
    // Generate two immediate IDs - they should have distinct cryptographic entropy,
    // not incrementing integer suffixes or timestamp bases
    const idA = generateEntityId("test");
    const idB = generateEntityId("test");
    expect(idA).not.toBe(idB);

    const suffixA = idA.slice(5);
    const suffixB = idB.slice(5);
    // Neither should look like a sequential 4-digit number (e.g., "0001", "0002")
    expect(suffixA).not.toMatch(/^\d{4}$/);
    expect(suffixB).not.toMatch(/^\d{4}$/);
    // Both should be valid RFC 4122 v4 UUIDs
    expect(suffixA).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(suffixB).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("C. Two separately created deterministic generators with the SAME seed begin independently", () => {
    const a = createDeterministicIdGenerator("test");
    const b = createDeterministicIdGenerator("test");

    // Both start at index 0001 independently
    expect(a.generate("act")).toBe("act-test-0001");
    expect(b.generate("act")).toBe("act-test-0001");

    // Both progress independently
    expect(a.generate("act")).toBe("act-test-0002");
    expect(b.generate("act")).toBe("act-test-0002");

    // Generator a continues while b is paused
    expect(a.generate("act")).toBe("act-test-0003");
    expect(b.generate("act")).toBe("act-test-0003");

    // Supports nextId alias as well
    expect(a.nextId("act")).toBe("act-test-0004");
  });

  it("D. No repository-exported hidden singleton deterministic generator exists", () => {
    const exportedKeys = Object.keys(sharedModule);
    expect(exportedKeys).not.toContain("createDeterministicId");
    expect((sharedModule as Record<string, unknown>).createDeterministicId).toBeUndefined();
    expect(exportedKeys).toContain("createDeterministicIdGenerator");
    expect(exportedKeys).toContain("generateEntityId");
  });

  it("E. Production generator does not reuse or affect deterministic test state", () => {
    const detGen = createDeterministicIdGenerator("isolated");
    expect(detGen.generate("node")).toBe("node-isolated-0001");

    // Generate production IDs in between
    const prod1 = generateEntityId("node");
    const prod2 = generateEntityId("node");
    expect(prod1).not.toBe(prod2);

    // Deterministic generator sequence is completely unaffected by production generation
    expect(detGen.generate("node")).toBe("node-isolated-0002");
  });

  it("F. Production ID collision smoke test (no collisions observed in 10,000 samples)", () => {
    const SAMPLE_COUNT = 10_000;
    const ids = new Set<string>();
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      ids.add(generateEntityId());
    }
    // Verifies collision resistance across large smoke sample
    expect(ids.size).toBe(SAMPLE_COUNT);
  });
});

describe("shared/timestamp", () => {
  it("accepts canonical valid UTC ISO-8601 timestamps", () => {
    expect(isValidIsoTimestamp("2026-09-06T19:30:12.123Z")).toBe(true);
    expect(isValidIsoTimestamp("2024-02-29T00:00:00.000Z")).toBe(true); // Leap year day
  });

  it("rejects non-ISO and invalid date strings", () => {
    expect(isValidIsoTimestamp("January 1, 2024")).toBe(false);
    expect(isValidIsoTimestamp("01/02/2024")).toBe(false);
    expect(isValidIsoTimestamp("2024-02-30T00:00:00.000Z")).toBe(false); // Impossible date
    expect(isValidIsoTimestamp("2024-01-01")).toBe(false);
    expect(isValidIsoTimestamp("2024-01-01T00:00:00")).toBe(false);
    expect(isValidIsoTimestamp("not-a-date")).toBe(false);
    expect(isValidIsoTimestamp("")).toBe(false);
  });

  it("creates valid canonical timestamps with currentIsoTimestamp", () => {
    const ts = currentIsoTimestamp();
    expect(isValidIsoTimestamp(ts)).toBe(true);
  });

  it("parses valid timestamp or throws on invalid", () => {
    const valid = "2026-09-06T19:30:12.123Z";
    expect(parseIsoTimestamp(valid)).toBe(valid);
    expect(() => parseIsoTimestamp("invalid")).toThrow(/Invalid canonical ISO timestamp/);
  });
});
