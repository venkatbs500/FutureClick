import { describe, expect, it } from "vitest";
import { getDefaultDashboardConfig } from "../src/index.js";

describe("research-dashboard placeholder", () => {
  it("provides valid default dashboard networking and telemetry configuration", () => {
    const config = getDefaultDashboardConfig();
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.futureBenchConnected).toBe(false);
  });
});
