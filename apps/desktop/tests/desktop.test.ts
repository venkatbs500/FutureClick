import { describe, expect, it } from "vitest";
import { createDesktopConfig } from "../src/index.js";

describe("desktop placeholder", () => {
  it("initializes inactive desktop configuration for target platform", () => {
    const macConfig = createDesktopConfig("macos");
    expect(macConfig.platform).toBe("macos");
    expect(macConfig.nativeBridgeEnabled).toBe(false);

    const winConfig = createDesktopConfig("windows");
    expect(winConfig.platform).toBe("windows");
    expect(winConfig.daemonRunning).toBe(false);
  });
});
