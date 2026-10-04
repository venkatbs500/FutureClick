/**
 * Cross-package constant parity.
 *
 * The sanitizer lives in `@futureclick/privacy` and the extraction caps live here.
 * Several of their numbers have to agree, and nothing in either package's type
 * system notices when they drift. A silent disagreement would not break the build;
 * it would quietly change how much text survives, which is exactly the kind of
 * regression that only shows up as an unexplained accuracy change months later.
 */

import {
  MAX_SANITIZED_SEGMENT_CHARS,
  MAX_SANITIZED_TOKEN_CHARS,
  TEXT_SANITIZER_VERSION,
} from "@futureclick/privacy";
import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import { MAX_TOKEN_SEGMENT_CHARS } from "../src/observation.js";

describe("sanitizer and extraction caps agree", () => {
  it("uses one segment length on both sides of the boundary", () => {
    expect(MAX_SANITIZED_SEGMENT_CHARS).toBe(MAX_TOKEN_SEGMENT_CHARS);
  });

  it("keeps the sanitizer token ceiling within the extraction label cap", () => {
    // A sanitizer that emitted longer tokens than extraction accepts would have its
    // output silently truncated downstream, defeating the point of a single
    // authority over what text is safe.
    expect(MAX_SANITIZED_TOKEN_CHARS).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxLabelChars);
  });

  it("records a sanitizer version that provenance can pin", () => {
    expect(TEXT_SANITIZER_VERSION).toMatch(/^\d+\.\d+$/);
  });
});
