import { expect, test, type Page } from "@playwright/test";

async function completeBoxModelLesson(page: Page) {
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const paddingSlider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await paddingSlider.fill("32");
  await paddingSlider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );

  await lesson
    .getByRole("button", { name: "因为外边距把边框撑大了" })
    .click();
  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  const code = lesson.getByLabel("补写 CSS 声明");
  await expect(code).toBeEnabled({ timeout: 10_000 });
  await code.fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );
  return lesson;
}

async function activeLearningSessionId(page: Page) {
  return page.evaluate(() => {
    const indexRaw = localStorage.getItem("ai-tutor-learning-proof-index-v2");
    if (!indexRaw) throw new Error("learning proof local index missing");
    return (JSON.parse(indexRaw) as { activeSessionId: string }).activeSessionId;
  });
}

test("keeps the learning outbox through an offline refresh and replays it", async ({
  page,
}) => {
  await page.route("**/api/learning/**", (route) => route.abort("failed"));
  await page.goto("/");
  const lesson = await completeBoxModelLesson(page);
  await expect(lesson.locator("[data-learning-save]")).toHaveAttribute(
    "data-learning-save",
    "local",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const indexRaw = localStorage.getItem("ai-tutor-learning-proof-index-v2");
        if (!indexRaw) return null;
        const sessionId = (JSON.parse(indexRaw) as { activeSessionId: string })
          .activeSessionId;
        const raw = localStorage.getItem(
          `ai-tutor-learning-proof-session-v2:${sessionId}`,
        );
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          payload?: { events?: unknown[]; acknowledgedSequence?: number };
        };
        return {
          events: parsed.payload?.events?.length ?? 0,
          acknowledged: parsed.payload?.acknowledgedSequence ?? -1,
        };
      }),
    )
    .toEqual({ events: 7, acknowledged: 0 });

  await page.reload();
  const restored = page.getByRole("region", { name: "一分钟盒模型课" });
  await expect(restored.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
  );
  const replayOpener = restored.getByRole("button", { name: "回放学习过程" });
  await replayOpener.click();
  const replay = page.getByRole("dialog", { name: "学习过程回放" });
  await expect(replay).toBeVisible();
  await expect(replay.getByRole("button", { name: "关闭回放" })).toBeFocused();
  expect(
    await replay.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.right - 24, rect.top + 24);
      return Boolean(topmost && element.contains(topmost));
    }),
  ).toBe(true);
  await expect(replay.locator("[data-replay-final-match]")).toHaveAttribute(
    "data-replay-final-match",
    "true",
  );
  await expect(
    replay.locator("[data-replay-authoritative-match]"),
  ).toHaveAttribute("data-replay-authoritative-match", "unavailable");
  const scrubber = replay.getByRole("slider", { name: "回放步骤" });
  await scrubber.fill("2");
  await expect(replay).toContainText("动手观察");
  await page.keyboard.press("Escape");
  await expect(replay).toBeHidden();
  await expect(replayOpener).toBeFocused();
});

test("keeps multiple courses and reopens an earlier completed record", async ({
  page,
}) => {
  await page.goto("/");
  const boxLesson = await completeBoxModelLesson(page);
  const boxSessionId = await activeLearningSessionId(page);
  const scenario = page.getByRole("region", { name: "Flex 与定位小课" });
  await scenario.getByRole("button", { name: "开始 Flex 小课" }).click();
  await expect(scenario.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
    { timeout: 10_000 },
  );
  expect(await activeLearningSessionId(page)).not.toBe(boxSessionId);

  const history = page.locator(".learning-history");
  await history.locator("summary").click();
  await expect(history.getByRole("listitem")).toHaveCount(2);
  const boxRecord = history
    .getByRole("listitem")
    .filter({ hasText: "盒模型：卡片为什么会变大" });
  await boxRecord.getByRole("button", { name: "打开记录" }).click();
  await expect(boxLesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 15_000 },
  );
  await expect(
    page
      .getByRole("region", { name: "Flex 与定位小课" })
      .locator("[data-lesson-phase]"),
  ).toHaveAttribute("data-lesson-phase", "idle");
  await expect(boxRecord.getByRole("button", { name: "正在查看" })).toBeDisabled();
  expect(await activeLearningSessionId(page)).toBe(boxSessionId);
});

test("persists, reloads, exports, and replays the authoritative PostgreSQL record", async ({
  page,
}) => {
  test.skip(
    process.env.AI_TUTOR_P7_DATABASE !== "1",
    "requires the isolated P7 PostgreSQL acceptance database",
  );
  await page.goto("/");
  const lesson = await completeBoxModelLesson(page);
  await expect(lesson.locator("[data-learning-save]")).toHaveAttribute(
    "data-learning-save",
    "synced",
    { timeout: 15_000 },
  );

  const sessionId = await page.evaluate(() => {
    const indexRaw = localStorage.getItem("ai-tutor-learning-proof-index-v2");
    if (!indexRaw) throw new Error("learning proof local index missing");
    const activeSessionId = (
      JSON.parse(indexRaw) as { activeSessionId: string }
    ).activeSessionId;
    const raw = localStorage.getItem(
      `ai-tutor-learning-proof-session-v2:${activeSessionId}`,
    );
    if (!raw) throw new Error("learning proof local record missing");
    return (JSON.parse(raw) as { payload: { sessionId: string } }).payload
      .sessionId;
  });
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const response = await fetch(`/api/learning/sessions/${id}`, {
            cache: "no-store",
          });
          if (!response.ok) return null;
          return response.json() as Promise<{
            events: unknown[];
            session: { status: string; latestSequence: number };
            latestSnapshot: {
              throughSequence: number;
              lessonState: { phase: string };
            } | null;
          }>;
        }, sessionId),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  const authoritative = await page.evaluate(async (id) => {
    const response = await fetch(`/api/learning/sessions/${id}`, {
      cache: "no-store",
    });
    return response.json() as Promise<{
      events: unknown[];
      session: { status: string; latestSequence: number };
      latestSnapshot: {
        throughSequence: number;
        lessonState: { phase: string };
      } | null;
    }>;
  }, sessionId);
  expect(authoritative.events).toHaveLength(7);
  expect(authoritative.session).toMatchObject({
    status: "completed",
    latestSequence: 7,
  });
  expect(authoritative.latestSnapshot).toMatchObject({
    throughSequence: 7,
    lessonState: { phase: "complete" },
  });

  const download = page.waitForEvent("download");
  await lesson.getByRole("button", { name: "导出我的记录" }).click();
  await expect((await download).suggestedFilename()).toBe(
    `learning-proof-${sessionId}.json`,
  );

  await page.reload();
  const restored = page.getByRole("region", { name: "一分钟盒模型课" });
  await expect(restored.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
  );
  await restored.getByRole("button", { name: "回放学习过程" }).click();
  const replay = page.getByRole("dialog", { name: "学习过程回放" });
  await expect(replay.locator("[data-replay-final-match]")).toHaveAttribute(
    "data-replay-final-match",
    "true",
  );
  await expect(
    replay.locator("[data-replay-authoritative-match]"),
  ).toHaveAttribute("data-replay-authoritative-match", "true");
});

test("retries a final snapshot after events were already acknowledged", async ({
  page,
}) => {
  test.skip(
    process.env.AI_TUTOR_P7_DATABASE !== "1",
    "requires the isolated P7 PostgreSQL acceptance database",
  );
  let failedFinalSnapshot = false;
  let finalSnapshotAttempts = 0;
  await page.route("**/api/learning/sessions/*/snapshot", async (route) => {
    const payload = route.request().postDataJSON() as {
      lessonState?: { phase?: string };
    } | null;
    if (payload?.lessonState?.phase === "complete") {
      finalSnapshotAttempts += 1;
      if (!failedFinalSnapshot) {
        failedFinalSnapshot = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SIMULATED_SNAPSHOT_OUTAGE" }),
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/");
  const lesson = await completeBoxModelLesson(page);
  await expect.poll(() => failedFinalSnapshot).toBe(true);
  await expect(lesson.locator("[data-learning-save]")).toHaveAttribute(
    "data-learning-save",
    "synced",
    { timeout: 30_000 },
  );
  expect(finalSnapshotAttempts).toBeGreaterThanOrEqual(2);

  const sessionId = await activeLearningSessionId(page);
  const state = await page.evaluate((id) => {
    const raw = localStorage.getItem(
      `ai-tutor-learning-proof-session-v2:${id}`,
    );
    if (!raw) throw new Error("learning proof session envelope missing");
    return (JSON.parse(raw) as {
      payload: {
        acknowledgedSequence: number;
        snapshotThroughSequence: number;
      };
    }).payload;
  }, sessionId);
  expect(state).toMatchObject({
    acknowledgedSequence: 7,
    snapshotThroughSequence: 7,
  });
  const replay = await page.evaluate(async (id) => {
    const response = await fetch(`/api/learning/sessions/${id}`);
    return response.json() as Promise<{
      session: { status: string };
      latestSnapshot: { throughSequence: number } | null;
    }>;
  }, sessionId);
  expect(replay).toMatchObject({
    session: { status: "completed" },
    latestSnapshot: { throughSequence: 7 },
  });
});

test("replays Tutor messages, tool results, and canvas actions without storing opted-out text", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const state = window as typeof window & { __timelineMicrophoneCalls?: number };
    state.__timelineMicrophoneCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.__timelineMicrophoneCalls =
          (state.__timelineMicrophoneCalls ?? 0) + 1;
        throw new Error("The text timeline fixture must never request a microphone.");
      },
    });
  });

  const toolResults: Array<{ success?: boolean }> = [];
  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const request = route.request().postDataJSON() as {
      clientSessionId: string;
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: request.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "isolated-learning-timeline",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/events", async (route) => {
    const blockId = await page
      .locator(".teaching-block--runnable")
      .first()
      .getAttribute("data-teaching-block-id");
    if (!blockId) throw new Error("lesson block missing for Tutor fixture");
    const at = new Date().toISOString();
    const events = [
      { type: "status", state: "connected", at },
      {
        type: "transcript",
        role: "assistant",
        text: "先看页面，再自己判断。",
        final: true,
        at,
      },
      {
        type: "tool_call",
        requestId: "timeline-tool-1",
        callId: "timeline-call-1",
        tool: "focus_block",
        arguments: { requestId: "timeline-focus-1", blockId },
        at,
      },
      {
        type: "tool_call",
        requestId: "timeline-tool-2",
        callId: "timeline-call-2",
        tool: "read_teaching_assertion_evidence",
        arguments: { requestId: "timeline-fact-1", blockId },
        at,
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `retry: 60000\n${events
        .map(
          (event, index) =>
            `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join("")}`,
    });
  });
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    }),
  );
  await page.route(
    /\/api\/realtime\/session\/[^/]+\/tools\/[^/]+$/,
    async (route) => {
      toolResults.push(
        route.request().postDataJSON() as { success?: boolean },
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{\"ok\":true}",
      });
    },
  );
  await page.route(/\/api\/realtime\/session\/[^/]+\/input$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    }),
  );
  await page.route(/\/api\/realtime\/session\/[^/]+$/, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{\"ok\":true}",
        })
      : route.fallback(),
  );

  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
  );
  const lessonRuntime = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "第一课 · 卡片为什么会变大？" })
    .locator(".teaching-block__runtime--live");
  await expect(lessonRuntime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  await lessonRuntime.getByRole("button", { name: "选择页面内容" }).click();
  await lessonRuntime
    .locator(".static-html-runtime-frame")
    .contentFrame()
    .locator("#demo")
    .click({ position: { x: 8, y: 8 } });
  await expect(
    page.getByRole("complementary", { name: "样式调整面板" }),
  ).toContainText("正在调整");

  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await expect(tutor.getByRole("checkbox")).not.toBeChecked();
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  const textInput = tutor.getByLabel("文字询问 CSS 问题");
  await expect(textInput).toBeEnabled();
  await expect(tutor.locator('article[data-role="assistant"]')).toContainText(
    "先看页面",
  );
  await textInput.fill("我先自己判断，再请你核对。");
  await tutor.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => toolResults.length).toBe(2);
  expect(toolResults).toEqual([
    expect.objectContaining({ success: true }),
    expect.objectContaining({ success: true }),
  ]);

  await lesson.getByRole("button", { name: "保持不变" }).click();
  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const paddingSlider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await paddingSlider.fill("32");
  await paddingSlider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );
  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  const code = lesson.getByLabel("补写 CSS 声明");
  await expect(code).toBeEnabled({ timeout: 10_000 });
  await code.fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );

  const stored = await page.evaluate(() => {
    const indexRaw = localStorage.getItem("ai-tutor-learning-proof-index-v2");
    if (!indexRaw) throw new Error("learning proof index missing");
    const sessionId = (JSON.parse(indexRaw) as { activeSessionId: string })
      .activeSessionId;
    const raw = localStorage.getItem(
      `ai-tutor-learning-proof-session-v2:${sessionId}`,
    );
    if (!raw) throw new Error("learning proof envelope missing");
    return (JSON.parse(raw) as {
      payload: {
        events: Array<{
          type: string;
          role?: string;
          text?: string | null;
          contentStored?: boolean;
          success?: boolean;
          mutatesCanvas?: boolean;
        }>;
      };
    }).payload.events;
  });
  const messages = stored.filter(
    (event) => event.type === "audit-tutor-message",
  );
  expect(messages.map((event) => event.role)).toEqual(
    expect.arrayContaining(["assistant", "user"]),
  );
  expect(
    messages.every(
      (event) => event.contentStored === false && event.text === null,
    ),
  ).toBe(true);
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "audit-tutor-tool",
        success: true,
        mutatesCanvas: true,
      }),
      expect.objectContaining({ type: "audit-canvas-action" }),
      expect.objectContaining({ type: "audit-fact-receipt" }),
    ]),
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __timelineMicrophoneCalls?: number })
          .__timelineMicrophoneCalls,
    ),
  ).toBe(0);

  await lesson.getByRole("button", { name: "回放学习过程" }).click();
  const replay = page.getByRole("dialog", { name: "学习过程回放" });
  const scrubber = replay.getByRole("slider", { name: "回放步骤" });
  const userMessageSequence =
    stored.findIndex(
      (event) =>
        event.type === "audit-tutor-message" && event.role === "user",
    ) + 1;
  expect(userMessageSequence).toBeGreaterThan(0);
  await scrubber.fill(String(userMessageSequence));
  await expect(replay.locator(".learning-replay__stage")).toContainText(
    "正文未保存",
  );
  if (process.env.AI_TUTOR_CAPTURE_EVIDENCE === "1") {
    await page.screenshot({
      path: "output/playwright/p8-unified-learning-proof-replay-2026-08-03.png",
      fullPage: true,
    });
  }
  const factSequence =
    stored.findIndex((event) => event.type === "audit-fact-receipt") + 1;
  expect(factSequence).toBeGreaterThan(0);
  await scrubber.fill(String(factSequence));
  await expect(replay.locator(".learning-replay__stage")).toContainText(
    "页面事实",
  );
  await scrubber.fill(String(stored.length));
  await expect(replay.locator("[data-replay-final-match]")).toHaveAttribute(
    "data-replay-final-match",
    "true",
  );
});
