import { defineConfig, devices } from "@playwright/test";

process.env.AI_TUTOR_P7_DATABASE = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-compose", open: "never" }]],
  use: {
    baseURL:
      process.env.AI_TUTOR_COMPOSE_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    permissions: [],
  },
  projects: [
    {
      name: "compose-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
