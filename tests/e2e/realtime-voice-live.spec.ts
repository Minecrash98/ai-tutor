import { expect, test, type Locator, type Page } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";
const fakeAudioCapture = process.env.AI_TUTOR_FAKE_AUDIO_CAPTURE;

interface RealtimeLogExportLike {
  readonly records: readonly {
    readonly at: string;
    readonly event: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[];
  readonly courseSummaryMaterial: {
    readonly teachingActions: readonly {
      readonly tool: string;
      readonly result: { readonly success: boolean; readonly message: string } | null;
    }[];
  };
}

async function stopAndReadLog(
  page: Page,
  tutor: Locator,
  status: Locator,
): Promise<RealtimeLogExportLike> {
  const href = await tutor.locator("a[download]").getAttribute("href");
  expect(href).toBeTruthy();
  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(status).toHaveAttribute("data-realtime-status", "stopped", {
    timeout: 10_000,
  });
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  return (await response.json()) as RealtimeLogExportLike;
}

test("synthetic Chinese speech reaches Realtime and creates the requested canvas lesson", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !liveRealtime || !fakeAudioCapture,
    "Set AI_TUTOR_LIVE_REALTIME=1 and AI_TUTOR_FAKE_AUDIO_CAPTURE to run the isolated voice smoke test.",
  );

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");
  await tutor.getByRole("checkbox").check();
  await tutor.getByLabel("教学主题").selectOption("box-model");
  await tutor.getByRole("radio", { name: /持续聆听/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 60_000,
    })
    .toMatch(/^(connected|listening)$/);

  const userTranscript = tutor.locator('[data-role="user"]').last();
  await expect(userTranscript).toContainText(/实验|控制器/i, {
    timeout: 90_000,
  });
  await expect(page.locator('[data-block-kind="css-controller"]')).toContainText(
    "padding",
    { timeout: 90_000 },
  );

  const exported = await stopAndReadLog(page, tutor, status);
  const acknowledgements = exported.records.filter(
    (record) => record.event === "client.canvas_ack_playing",
  );
  const speechStops = exported.records.filter(
    (record) => record.event === "microphone.speech_stopped",
  );
  const voiceTurnStarts = exported.records.filter(
    (record) =>
      record.event === "performance.turn_t0" && record.payload.mode === "voice",
  );
  const confirmationMilestones = exported.records.filter(
    (record) =>
      record.event === "performance.confirmation_audio" &&
      record.payload.mode === "voice",
  );
  expect(acknowledgements.length).toBeGreaterThanOrEqual(1);
  expect(speechStops.length).toBeGreaterThanOrEqual(1);
  expect(
    exported.records.some(
      (record) => record.event === "microphone.noise_calibrated",
    ),
  ).toBe(true);
  expect(acknowledgements[0]?.payload.trigger).toBe("voice");
  expect(acknowledgements[0]?.payload.latencyMs).toEqual(expect.any(Number));
  expect(voiceTurnStarts.length).toBeGreaterThanOrEqual(1);
  const fastConfirmation = confirmationMilestones.find(
    (record) =>
      typeof record.payload.latencyMs === "number" &&
      record.payload.latencyMs >= 0 &&
      record.payload.latencyMs < 2_500,
  );
  expect(fastConfirmation).toBeDefined();
  expect(
    voiceTurnStarts.some(
      (record) => record.payload.turnId === fastConfirmation?.payload.turnId,
    ),
  ).toBe(true);
  expect(fastConfirmation?.payload.t0Source).toBe(
    "last-above-threshold-vad-sample",
  );
  const firstModelAudio = exported.records.find(
    (record) =>
      record.event === "performance.first_model_audio" &&
      record.payload.turnId === fastConfirmation?.payload.turnId,
  );
  expect(firstModelAudio).toBeDefined();
  expect(firstModelAudio?.payload.latencyMs).toEqual(expect.any(Number));
  expect(firstModelAudio?.payload.source).toMatch(
    /^(remote-audio-energy|remote-audio-playing|data-channel)$/,
  );
  expect(
    exported.records.some(
      (record) => record.event === "client.canvas_ack_play_failed",
    ),
  ).toBe(false);
  expect(
    exported.records.some(
      (record) => record.event === "performance.turn_t0",
    ),
  ).toBe(true);
  expect(
    exported.records.some(
      (record) => record.event === "performance.confirmation_audio",
    ),
  ).toBe(true);
  expect(
    exported.records.some(
      (record) => record.event === "performance.canvas_visible_t1",
    ),
  ).toBe(true);

  const successfulTools = exported.courseSummaryMaterial.teachingActions
    .filter((action) => action.result?.success)
    .map((action) => action.tool);
  expect(successfulTools).toEqual(
    expect.arrayContaining([
      "create_demo_block",
      "create_css_controller",
    ]),
  );
});
