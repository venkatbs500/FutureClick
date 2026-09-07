/**
 * Research dashboard application placeholder.
 * Architectural interface for inspecting consequence metrics and benchmark evaluations.
 */

export interface ResearchDashboardConfig {
  readonly port: number;
  readonly host: string;
  readonly futureBenchConnected: boolean;
}

export function getDefaultDashboardConfig(): ResearchDashboardConfig {
  return {
    port: 3000,
    host: "127.0.0.1",
    futureBenchConnected: false,
  };
}
