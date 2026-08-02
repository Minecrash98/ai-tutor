import { expect, test, type Locator, type Page } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";
const fakeAudioCapture = process.env.AI_TUTOR_FAKE_AUDIO_CAPTURE;
const latencyOnly = process.env.AI_TUTOR_VOICE_LATENCY_ONLY === "1";
const explicitCanvasRequest =
  /(?:(?:给我|请)\s*)?(?:做|创建|建)\s*一个.*盒模型.*实验/i;
const canvasVisibleConfirmation = "画布已经更新，你可以先看看。";

interface RealtimeLogExportLike {
  readonly records: readonly {
    readonly at: string;
    readonly event: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[];
}

async function readCurrentLog(
  page: Page,
  tutor: Locator,
): Promise<RealtimeLogExportLike | null> {
  const href = await tutor.locator("a[download]").getAttribute("href");
  if (!href) return null;
  const response = await page.request.get(href);
  if (!response.ok()) return null;
  return (await response.json()) as RealtimeLogExportLike;
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

type StartupKind = "cold" | "warm";

async function collectLatencySample(
  page: Page,
  tutor: Locator,
  status: Locator,
  startupKind: StartupKind,
): Promise<Readonly<Record<string, unknown>>> {
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect(tutor.locator("article")).toHaveCount(0, { timeout: 5_000 });
  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 60_000,
    })
    .toMatch(/^(connected|listening)$/);
  const userTranscript = tutor.locator('[data-role="user"]').last();
  await expect(userTranscript).toContainText(explicitCanvasRequest, {
    timeout: 90_000,
  });
  const recognizedRequest = (await userTranscript.textContent())?.trim() ?? "";
  let activeSnapshot: RealtimeLogExportLike | null = null;
  await expect
    .poll(
      async () => {
        activeSnapshot = await readCurrentLog(page, tutor);
        const confirmation = activeSnapshot?.records.find(
          (record) =>
            record.event === "performance.confirmation_audio" &&
            record.payload.startupKind === startupKind,
        );
        const turnId = confirmation?.payload.turnId;
        if (!turnId) return false;
        const hasMatching = (event: string) =>
          activeSnapshot?.records.some(
            (record) =>
              record.event === event && record.payload.turnId === turnId,
          ) ?? false;
        return (
          hasMatching("performance.input_transcript_final") &&
          hasMatching("client.voice_intent_gate_resolved") &&
          hasMatching("performance.first_meaningful_caption") &&
          hasMatching("performance.first_model_audio") &&
          hasMatching("performance.canvas_visible_t1")
        );
      },
      { timeout: 60_000, intervals: [1_000, 4_000] },
    )
    .toBe(true);
  await expect(
    tutor
      .locator('[data-role="assistant"]')
      .filter({ hasText: canvasVisibleConfirmation })
      .last(),
  ).toContainText(canvasVisibleConfirmation, { timeout: 5_000 });

  const exported = await stopAndReadLog(page, tutor, status);
  const confirmation = exported.records.find(
    (record) =>
      record.event === "performance.confirmation_audio" &&
      record.payload.startupKind === startupKind,
  );
  expect(confirmation).toBeDefined();
  expect(confirmation?.payload.t0Source).toBe(
    "last-above-threshold-vad-sample",
  );
  const turnId = confirmation?.payload.turnId;
  const latencyMs = confirmation?.payload.latencyMs;
  expect(latencyMs).toEqual(expect.any(Number));
  expect(latencyMs as number).toBeGreaterThanOrEqual(0);
  expect(latencyMs as number).toBeLessThan(10_000);

  const matching = (event: string) =>
    exported.records.find(
      (record) => record.event === event && record.payload.turnId === turnId,
    );
  const inputTranscript = matching("performance.input_transcript_final");
  const intentGate = matching("client.voice_intent_gate_resolved");
  const caption = matching("performance.first_meaningful_caption");
  const modelAudio = matching("performance.first_model_audio");
  const canvasVisible = matching("performance.canvas_visible_t1");
  expect(inputTranscript?.payload.latencyMs).toEqual(expect.any(Number));
  expect(intentGate?.payload.canvasGrounded).toBe(true);
  expect(intentGate?.payload.suppressedCharacterCount).toEqual(
    expect.any(Number),
  );
  expect(caption?.payload.latencyMs).toEqual(expect.any(Number));
  expect(caption?.payload.source).toBe("canvas-visible-confirmation");
  expect(modelAudio?.payload.latencyMs).toEqual(expect.any(Number));
  expect(canvasVisible?.payload.latencyMs).toEqual(expect.any(Number));
  expect(modelAudio?.payload.source).toMatch(
    /^(remote-audio-energy|remote-audio-playing|data-channel)$/,
  );

  return {
    startupKind,
    turnId,
    recognizedRequest,
    confirmationAudioMs: latencyMs,
    inputTranscriptFinalMs: inputTranscript?.payload.latencyMs,
    firstMeaningfulCaptionMs: caption?.payload.latencyMs,
    firstMeaningfulCaptionSource: caption?.payload.source,
    firstModelAudioMs: modelAudio?.payload.latencyMs,
    canvasVisibleT1Ms: canvasVisible?.payload.latencyMs,
    voiceIntentGateSuppressedCharacters:
      intentGate?.payload.suppressedCharacterCount,
    t0Source: confirmation?.payload.t0Source,
    modelAudioSource: modelAudio?.payload.source,
  };
}

test("records paired cold and warm isolated voice latency samples", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  test.skip(
    !liveRealtime || !fakeAudioCapture || !latencyOnly,
    "Set the live, fake-audio, and latency-only environment flags to collect a voice latency sample.",
  );

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");
  await tutor.getByRole("checkbox").check();
  await tutor.getByLabel("教学主题").selectOption("box-model");
  await tutor.getByRole("radio", { name: /持续聆听/ }).check();
  const cold = await collectLatencySample(page, tutor, status, "cold");
  const warm = await collectLatencySample(page, tutor, status, "warm");
  console.log(
    `VOICE_LATENCY_SAMPLE_JSON=${JSON.stringify({
      pairIndex: testInfo.repeatEachIndex,
      cold,
      warm,
    })}`,
  );
});
