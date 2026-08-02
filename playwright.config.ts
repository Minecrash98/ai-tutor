import { defineConfig, devices } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";
const fakeAudioCapture = process.env.AI_TUTOR_FAKE_AUDIO_CAPTURE;
const e2ePort = process.env.AI_TUTOR_E2E_PORT ?? "3100";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const visualTestIgnore =
  process.env.AI_TUTOR_SKIP_VISUAL === "1"
    ? ["**/p8-visual.spec.ts"]
    : [];

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: visualTestIgnore,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    permissions: liveRealtime ? ["microphone"] : [],
    launchOptions: liveRealtime
      ? {
          args: [
            "--mute-audio",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            ...(fakeAudioCapture
              ? [
                  `--use-file-for-fake-audio-capture=${fakeAudioCapture.replaceAll("\\", "/")}`,
                ]
              : []),
          ],
        }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ["**/p8-performance.spec.ts", ...visualTestIgnore],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "performance",
      testMatch: ["**/p8-performance.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chrome",
      testIgnore: ["**/p8-visual.spec.ts"],
      use: { channel: "chrome", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "edge",
      testIgnore: ["**/p8-visual.spec.ts"],
      use: { channel: "msedge", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "firefox",
      testIgnore: ["**/p8-visual.spec.ts"],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: ["**/p8-visual.spec.ts"],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-touch",
      testIgnore: ["**/p8-visual.spec.ts"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @ai-tutor/web dev --hostname 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: process.env.AI_TUTOR_E2E_REUSE_SERVER === "1",
  },
});
