import { defineConfig } from "@playwright/test";

const HARNESS_PORT = 4180;

export default defineConfig({
  testDir: ".",

  outputDir: "../results/pw-artifacts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${HARNESS_PORT}`,
    headless: true,
  },
  webServer: {
    command: "node bench/browser/build-harness.mjs && node bench/browser/serve.mjs",
    cwd: "../..",
    url: `http://localhost:${HARNESS_PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
