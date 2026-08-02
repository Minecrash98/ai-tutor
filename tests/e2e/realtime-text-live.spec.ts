import { expect, test } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";

test.describe.configure({ mode: "serial" });

test("live text tutoring uses no microphone, exposes no thread id, and stops cleanly", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(!liveRealtime, "Set AI_TUTOR_LIVE_REALTIME=1 for the authorized live check.");

  await page.addInitScript(() => {
    const state = window as typeof window & { __liveMicrophoneCalls?: number };
    state.__liveMicrophoneCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.__liveMicrophoneCalls = (state.__liveMicrophoneCalls ?? 0) + 1;
        throw new Error("Live text mode must not request a microphone");
      },
    });
  });

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("checkbox").check();
  const sessionResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/realtime/session" &&
      response.request().method() === "POST",
  );
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as {
    sessionId: string;
    mode: string;
    learningRecordEnabled: boolean;
    threadId?: unknown;
  };
  expect(session).toMatchObject({ mode: "text", learningRecordEnabled: true });
  expect(session).not.toHaveProperty("threadId");

  const textInput = tutor.getByLabel("文字询问 CSS 问题");
  await expect(textInput).toBeEnabled({ timeout: 45_000 });
  expect(await page.evaluate(() =>
    (window as typeof window & { __liveMicrophoneCalls?: number })
      .__liveMicrophoneCalls,
  )).toBe(0);

  await textInput.fill("请只用一句大白话解释 padding 为什么会让卡片变大。");
  await tutor.getByRole("button", { name: "发送" }).click();
  const assistantTranscript = tutor.locator('article[data-role="assistant"]');
  await expect(assistantTranscript.last()).not.toHaveText("", { timeout: 60_000 });

  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(textInput).toBeDisabled();
  const transcriptCountAfterStop = await tutor.locator("article").count();
  await page.waitForTimeout(1_500);
  expect(await tutor.locator("article").count()).toBe(transcriptCountAfterStop);
  expect(await page.evaluate(() =>
    (window as typeof window & { __liveMicrophoneCalls?: number })
      .__liveMicrophoneCalls,
  )).toBe(0);

  const logResponse = await page.request.get(
    `/api/realtime/session/${session.sessionId}/log`,
    { headers: { Cookie: (await page.context().cookies()).map((item) => `${item.name}=${item.value}`).join("; ") } },
  );
  expect(logResponse.status()).toBe(200);
  const log = (await logResponse.json()) as {
    records: { event: string; payload: Record<string, unknown> }[];
  };
  const capabilityRecord = log.records.find(
    (record) => record.event === "capability_profile.applied",
  );
  expect(capabilityRecord?.payload).toMatchObject({
    shellEnabled: false,
    webSearchEnabled: false,
    appsEnabled: false,
    dynamicToolNames: [
      "read_canvas_state",
      "inspect_selected_element",
      "read_relevant_source",
      "read_last_student_action",
      "read_teaching_assertion_evidence",
      "create_explanation_block",
      "create_demo_block",
      "apply_css_change",
      "create_css_controller",
      "create_comparison",
      "focus_block",
    ],
  });
  expect(
    log.records.some(
      (record) =>
        record.event === "performance.turn_t0" &&
        record.payload.mode === "text" &&
        record.payload.t0Source === "before-text-input-http-request",
    ),
  ).toBe(true);
  expect(
    log.records.some(
      (record) =>
        record.event === "performance.first_meaningful_caption" &&
        typeof record.payload.latencyMs === "number",
    ),
  ).toBe(true);
  await testInfo.attach("realtime-text-live-log.json", {
    body: Buffer.from(JSON.stringify(log, null, 2)),
    contentType: "application/json",
  });
});

test("live stop interrupts an active text turn with no later transcript or tool action", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(!liveRealtime, "Set AI_TUTOR_LIVE_REALTIME=1 for the authorized live check.");

  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new Error("Live text cancellation must not request a microphone");
      },
    });
  });
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("checkbox").check();
  const sessionResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/realtime/session" &&
      response.request().method() === "POST",
  );
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as { sessionId: string };
  const textInput = tutor.getByLabel("文字询问 CSS 问题");
  await expect(textInput).toBeEnabled({ timeout: 45_000 });

  await textInput.fill(
    "请详细比较 content-box 和 border-box，并给出很多逐步例子让我慢慢看。",
  );
  const inputResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/${session.sessionId}/input`) &&
      response.request().method() === "POST",
  );
  await tutor.getByRole("button", { name: "发送" }).click();
  expect((await inputResponsePromise).status()).toBe(200);
  const articlesAtStop = await tutor.locator("article").count();
  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(textInput).toBeDisabled();
  await page.waitForTimeout(2_500);
  expect(await tutor.locator("article").count()).toBe(articlesAtStop);

  const cookies = (await page.context().cookies())
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  const logResponse = await page.request.get(
    `/api/realtime/session/${session.sessionId}/log`,
    { headers: { Cookie: cookies } },
  );
  expect(logResponse.status()).toBe(200);
  const log = (await logResponse.json()) as {
    records: {
      sequence: number;
      event: string;
      payload: Record<string, unknown>;
    }[];
  };
  expect(log.records.some((record) => record.event === "turn.interrupted")).toBe(
    true,
  );
  const stoppedRecord = [...log.records]
    .reverse()
    .find(
      (record) =>
        record.event === "session.status" && record.payload.state === "stopped",
    );
  expect(stoppedRecord).toBeTruthy();
  expect(
    log.records.filter(
      (record) =>
        record.sequence > stoppedRecord!.sequence &&
        ["realtime.transcript", "tool.call"].includes(record.event),
    ),
  ).toEqual([]);
});

test("opt-out exposes only a deletable 24-hour operational record", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(!liveRealtime, "Set AI_TUTOR_LIVE_REALTIME=1 for the authorized live check.");

  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new Error("Operational text record test must not request a microphone");
      },
    });
  });
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");
  await expect(tutor.getByRole("checkbox")).not.toBeChecked();
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled({
    timeout: 45_000,
  });

  const recordLink = tutor.getByRole("link", { name: "下载本次连接记录" });
  await expect(recordLink).toBeVisible();
  await expect(tutor).toContainText("不含对话和页面内容，24 小时后自动删除");
  const href = await recordLink.getAttribute("href");
  expect(href).toBeTruthy();
  const exportResponse = await page.request.get(href!);
  expect(exportResponse.ok()).toBe(true);
  const exported = (await exportResponse.json()) as {
    recordKind: string;
    records: { event: string; payload: Record<string, unknown> }[];
    courseSummaryMaterial: {
      transcript: unknown[];
      teachingActions: unknown[];
    };
  };
  expect(exported.recordKind).toBe("operational");
  expect(exported.records.length).toBeGreaterThan(0);
  const forbiddenPayloadKeys = new Set([
    "arguments",
    "label",
    "message",
    "result",
    "settings",
    "stderr",
    "text",
    "transcript",
    "userAgent",
  ]);
  for (const record of exported.records) {
    expect(
      Object.keys(record.payload).filter((key) => forbiddenPayloadKeys.has(key)),
    ).toEqual([]);
  }
  expect(exported.courseSummaryMaterial.transcript).toEqual([]);
  expect(exported.courseSummaryMaterial.teachingActions).toEqual([]);

  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === href &&
      response.request().method() === "DELETE",
  );
  await tutor.getByRole("button", { name: "立即删除" }).click();
  expect((await deleteResponsePromise).status()).toBe(200);
  await expect(recordLink).toHaveCount(0);
  expect((await page.request.get(href!)).status()).toBe(404);

  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(status).toHaveAttribute("data-realtime-status", "stopped");
});
