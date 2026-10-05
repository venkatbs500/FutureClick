import { defineConfig } from "vitest/config";

/**
 * Load headroom for whole-corpus tests. NOT a correctness workaround.
 *
 * Several tests in this package build the entire 666-record corpus through the real
 * sanitizer and extractor, and a few build it twice to assert rebuild determinism.
 * Serially the slowest sits near 1.1 seconds, comfortably inside Vitest's 5000 ms
 * default. But `pnpm quality` runs Turbo tasks across 18 packages at once, and under
 * that contention these tests have occasionally crossed 5000 ms.
 *
 * Every observed failure was `Test timed out in 5000ms` with ZERO assertion failures,
 * and the frozen dataset, vocabulary, and manifest hashes were identical in every
 * run that completed. So the tests were not detecting a defect; the default timeout
 * was measuring machine load. Raising it to 15000 ms restores roughly the same margin
 * under parallel load that the default gives serially.
 *
 * Deliberately NOT done instead: skipping or retrying the tests, or weakening what
 * they assert. A retry would hide genuine nondeterminism in exactly the tests whose
 * entire purpose is to prove the corpus is reproducible, which is the one place in
 * this package where a flake must stay visible.
 *
 * Scoped to this package on purpose. The repository-wide default stays at 5000 ms,
 * because every other suite is fast and a global increase would slow down the signal
 * when a genuinely hung test appears elsewhere.
 */
export default defineConfig({
  test: {
    testTimeout: 15000,
  },
});
