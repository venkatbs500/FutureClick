import { describe, expect, it } from "vitest";
import { getInitialExtensionConfig } from "../src/index.js";

describe("browser-extension placeholder", () => {
  it("provides baseline inactive extension configuration", () => {
    const config = getInitialExtensionConfig();
    expect(config.manifestVersion).toBe(3);
    expect(config.interceptActions).toBe(false);
    expect(config.telemetryEnabled).toBe(false);
  });
});
