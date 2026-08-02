import { defineConfig } from "@playwright/test";

const durationMs = Number(process.env.AI_TUTOR_SOAK_DURATION_MS ?? 1_800_000);

export default defineConfig({
  testDir: "./tests/soak",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: durationMs + 180_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.AI_TUTOR_SOAK_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    permissions: [],
  },
  projects: [
    {
      name: "chrome-soak",
      use: {
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
