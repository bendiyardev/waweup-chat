import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests exercise the real app against real Vercel Blob + Pusher
 * credentials from the environment. Without those secrets the realtime/
 * storage dependent specs skip themselves explicitly — no fake green runs.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          ...(process.env as Record<string, string>),
          // Without real secrets the server runs in storage-free smoke mode
          // so the non-realtime specs still exercise the real app logic.
          ...(process.env.BLOB_READ_WRITE_TOKEN ? {} : { WAWE_TEST_MODE: "1" }),
        },
      },
});
