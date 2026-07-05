import { defineConfig, devices } from "@playwright/test";

// Local-only, browser-driven e2e tests for the TODO feature. Assumes the
// full stack (mysql + flask + nextjs) is already running, e.g. via
// `docker compose up --build`. Not part of ./run_tests.sh.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.NEXTJS_URL || "http://localhost:5000",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
