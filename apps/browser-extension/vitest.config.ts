import { defineConfig } from "vitest/config";

/**
 * Scope happy-dom only to FC-007 DOM tests via projects.
 * FC-005/FC-006 keep the default node environment.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "fc007-dom",
          include: ["tests/fc007-*.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        test: {
          name: "extension-node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/fc007-*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
