import { expect, test } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";
const fakeAudioCapture = process.env.AI_TUTOR_FAKE_AUDIO_CAPTURE;

interface RealtimeLogExportLike {
  readonly records: readonly {
    readonly event: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[];
}

test("continues an incorrect prediction with one fact-based text follow-up", async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !liveRealtime,
    "Set AI_TUTOR_LIVE_REALTIME=1 for the account-dependent adaptive follow-up test.",
  );

  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");

  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();
  await expect(tutor).toContainText("总宽一共会增加多少像素");

  await tutor.getByRole("checkbox").check();
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 60_000,
    })
    .toMatch(/^(connected|thinking|speaking)$/);

  await expect(tutor.locator('[data-role="assistant"]').last()).toContainText(
    /总宽|增加|像素/,
    { timeout: 60_000 },
  );
  const visibleUserText = (
    await tutor.locator('[data-role="user"]').allInnerTexts()
  ).join(" ");
  expect(visibleUserText).not.toContain("课程状态更新");
  expect(visibleUserText).not.toContain("确定性页面事实");

  const logHref = await tutor.locator("a[download]").getAttribute("href");
  expect(logHref).toBeTruthy();
  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(status).toHaveAttribute("data-realtime-status", "stopped", {
    timeout: 10_000,
  });

  const logResponse = await page.request.get(logHref!);
  expect(logResponse.ok()).toBe(true);
  const exported = (await logResponse.json()) as RealtimeLogExportLike;
  expect(
    exported.records.filter((record) => record.event === "lesson.cue.accepted"),
  ).toHaveLength(1);
  expect(
    exported.records.some(
      (record) => record.event === "lesson.cue.duplicate_ignored",
    ),
  ).toBe(false);
  expect(
    exported.records.some((record) => record.event.startsWith("microphone.")),
  ).toBe(false);
});

test("speaks the same fact-based follow-up once with a silent fake microphone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !liveRealtime || !fakeAudioCapture,
    "Set AI_TUTOR_LIVE_REALTIME=1 and AI_TUTOR_FAKE_AUDIO_CAPTURE to an isolated silent WAV.",
  );

  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");

  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();
  await tutor.getByRole("checkbox").check();
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 60_000,
    })
    .toMatch(/^(connected|listening|thinking|speaking)$/);

  await expect(tutor.locator('[data-role="assistant"]').last()).toContainText(
    /总宽|增加|像素/,
    { timeout: 60_000 },
  );
  const logHref = await tutor.locator("a[download]").getAttribute("href");
  expect(logHref).toBeTruthy();
  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(status).toHaveAttribute("data-realtime-status", "stopped", {
    timeout: 10_000,
  });

  const logResponse = await page.request.get(logHref!);
  expect(logResponse.ok()).toBe(true);
  const exported = (await logResponse.json()) as RealtimeLogExportLike;
  expect(
    exported.records.filter((record) => record.event === "lesson.cue.accepted"),
  ).toHaveLength(1);
  expect(
    exported.records.filter(
      (record) => record.event === "lesson.cue_audio_started",
    ),
  ).toHaveLength(1);
  expect(
    exported.records.some(
      (record) => record.event === "webrtc.input_audio_transcription",
    ),
  ).toBe(false);
});
