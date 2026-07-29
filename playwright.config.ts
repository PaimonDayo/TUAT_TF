import { defineConfig, devices } from "@playwright/test";
import { loadE2EEnv } from "./e2e/support/environment";
import { MEMBER_AUTH_STATE } from "./e2e/support/users";

loadE2EEnv();

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL,
    storageState: MEMBER_AUTH_STATE,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  timeout: 30_000,
  expect: { timeout: 10_000 },
});