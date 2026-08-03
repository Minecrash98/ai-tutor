import { expect, test } from "@playwright/test";

test("starts text tutoring without touching microphone APIs and really stops", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __microphoneCalls?: number };
    state.__microphoneCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.__microphoneCalls = (state.__microphoneCalls ?? 0) + 1;
        throw new Error("Text mode must not request a microphone");
      },
    });
  });

  let sessionRequest: Record<string, unknown> | null = null;
  let submittedText: string | null = null;
  let stopped = false;

  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sessionRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: sessionRequest.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "browser-boundary-test",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "status",
        state: "connected",
        at: new Date().toISOString(),
      })}\n\n`,
    }),
  );
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" }),
  );
  await page.route("**/api/realtime/session/*/input", async (route) => {
    submittedText = (route.request().postDataJSON() as { text: string }).text;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });
  await page.route(/\/api\/realtime\/session\/[^/]+$/, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    stopped = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled();
  expect(sessionRequest).toMatchObject({
    mode: "text",
    topic: "box-model",
    saveLearningRecord: false,
  });
  expect(sessionRequest).not.toHaveProperty("sdp");
  expect(sessionRequest).not.toHaveProperty("voice");
  expect(await page.evaluate(() =>
    (window as typeof window & { __microphoneCalls?: number }).__microphoneCalls,
  )).toBe(0);

  await tutor.getByLabel("文字询问 CSS 问题").fill("padding 为什么会让卡片变大？");
  await tutor.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => submittedText).toBe("padding 为什么会让卡片变大？");

  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeDisabled();
  await expect.poll(() => stopped).toBe(true);
});

test("stops an unbound Tutor session when a lesson starts, then binds the restart", async ({
  page,
}) => {
  const sessionRequests: Record<string, unknown>[] = [];
  const stoppedSessionIds: string[] = [];

  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const request = route.request().postDataJSON() as Record<string, unknown>;
    sessionRequests.push(request);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: request.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "lesson-binding-test",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "status",
        state: "connected",
        at: new Date().toISOString(),
      })}\n\n`,
    }),
  );
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    }),
  );
  await page.route(/\/api\/realtime\/session\/([^/]+)$/, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    stoppedSessionIds.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
  });

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled();
  expect(sessionRequests[0]).not.toHaveProperty("learningSessionId");

  const firstTutorSessionId = sessionRequests[0]?.clientSessionId as string;
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
  );
  await expect
    .poll(() => stoppedSessionIds)
    .toContain(firstTutorSessionId);
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeDisabled();
  await expect(tutor).toContainText(
    "课程已经切换。为确保学习步骤正确，请重新开始学习搭档。",
  );

  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled();
  await expect.poll(() => sessionRequests.length).toBe(2);
  expect(sessionRequests[1]?.learningSessionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("rejects cross-site and oversized session requests before provider startup", async ({
  request,
  baseURL,
}) => {
  const crossSite = await request.post("/api/realtime/session", {
    headers: { Origin: "https://attacker.invalid" },
    data: { mode: "text", topic: "box-model" },
  });
  expect(crossSite.status()).toBe(403);
  await expect(crossSite.json()).resolves.toMatchObject({
    code: "REALTIME_CROSS_SITE_BLOCKED",
  });

  const crossSitePreflight = await request.get("/api/realtime/capabilities", {
    headers: { Origin: "https://attacker.invalid" },
  });
  expect(crossSitePreflight.status()).toBe(403);

  const oversized = await request.post("/api/realtime/session", {
    headers: { Origin: new URL(baseURL ?? "http://127.0.0.1:3100").origin },
    data: {
      mode: "text",
      topic: "box-model",
      padding: "x".repeat(1_050_100),
    },
  });
  expect(oversized.status()).toBe(413);
  await expect(oversized.json()).resolves.toMatchObject({
    code: "REALTIME_BODY_TOO_LARGE",
  });
});

test("checks voice capability before any microphone request", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __capabilityReady?: boolean;
      __microphoneCalls?: number;
      __preflightBeforeMicrophone?: boolean;
    };
    state.__capabilityReady = false;
    state.__microphoneCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.__microphoneCalls = (state.__microphoneCalls ?? 0) + 1;
        state.__preflightBeforeMicrophone = state.__capabilityReady === true;
        throw new DOMException("Synthetic permission denial", "NotAllowedError");
      },
    });
  });

  let sessionPosts = 0;
  await page.route("**/api/realtime/capabilities", async (route) => {
    await page.evaluate(() => {
      (
        window as typeof window & { __capabilityReady?: boolean }
      ).__capabilityReady = true;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        checkedAt: new Date().toISOString(),
        textAvailable: true,
        voiceAvailable: true,
      }),
    });
  });
  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() === "POST") sessionPosts += 1;
    await route.fulfill({ status: 500, body: "{}" });
  });

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect(tutor.locator("[data-realtime-status]")).toHaveAttribute(
    "data-realtime-status",
    "error",
  );
  const evidence = await page.evaluate(() => {
    const state = window as typeof window & {
      __microphoneCalls?: number;
      __preflightBeforeMicrophone?: boolean;
    };
    return {
      calls: state.__microphoneCalls,
      ordered: state.__preflightBeforeMicrophone,
    };
  });
  expect(evidence).toEqual({ calls: 1, ordered: true });
  expect(sessionPosts).toBe(0);
});

test("keeps the lesson, upload, and text Tutor reachable at 390 by 844", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "开始一分钟盒模型课" })).toBeVisible();
  await expect(page.getByText("载入我的页面", { exact: true })).toBeVisible();
  const textStart = page.getByRole("button", { name: "开始文字问答" });
  await textStart.scrollIntoViewIfNeeded();
  await expect(textStart).toBeVisible();
});
