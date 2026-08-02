import { expect, test } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";

interface RealtimeLogExportLike {
  readonly records: readonly {
    readonly event: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[];
  readonly courseSummaryMaterial: {
    readonly teachingActions: readonly {
      readonly requestId: string;
      readonly tool: string;
      readonly result: { readonly success: boolean } | null;
    }[];
  };
}

test("replays unseen SSE events after a real browser disconnect without duplicate tools", async ({
  context,
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  test.skip(
    !liveRealtime,
    "Set AI_TUTOR_LIVE_REALTIME=1 for the account-dependent reconnect test.",
  );

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");
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
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled({
    timeout: 45_000,
  });
  const logHref = await tutor.locator("a[download]").getAttribute("href");
  expect(logHref).toBeTruthy();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(logHref!);
        if (!response.ok()) return 0;
        const log = (await response.json()) as RealtimeLogExportLike;
        return log.records.filter(
          (record) => record.event === "sse.event_received",
        ).length;
      },
      { timeout: 10_000, intervals: [500, 1_000, 2_000] },
    )
    .toBeGreaterThan(0);

  const ownerCookie = (await context.cookies())
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  await context.setOffline(true);
  await expect(status).toHaveAttribute("data-realtime-status", "reconnecting", {
    timeout: 10_000,
  });

  const inputResponse = await fetch(
    `${baseURL ?? "http://127.0.0.1:3100"}/api/realtime/session/${session.sessionId}/input`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerCookie,
      },
      body: JSON.stringify({
        text: "请创建一个盒模型小实验，并加一个可以调 padding 的滑块。",
      }),
    },
  );
  expect(inputResponse.status).toBe(200);
  await page.waitForTimeout(2_500);
  await context.setOffline(false);

  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 30_000,
    })
    .toMatch(/^(connected|thinking|doing|speaking)$/);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
          if (!raw) return 0;
          const state = JSON.parse(raw) as { projects: readonly unknown[] };
          return state.projects.length;
        }),
      { timeout: 90_000 },
    )
    .toBe(1);
  await expect(
    page.locator('[data-block-kind="css-controller"]'),
  ).toHaveCount(1, { timeout: 30_000 });

  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(status).toHaveAttribute("data-realtime-status", "stopped", {
    timeout: 10_000,
  });

  const logResponse = await page.request.get(logHref!);
  expect(logResponse.ok()).toBe(true);
  const exported = (await logResponse.json()) as RealtimeLogExportLike;
  expect(
    exported.records.filter((record) => record.event === "sse.open").length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    exported.records.some((record) => record.event === "sse.browser_offline"),
  ).toBe(true);
  expect(
    exported.records.some((record) => record.event === "sse.browser_online"),
  ).toBe(true);
  const onlineRecord = exported.records.find(
    (record) => record.event === "sse.browser_online",
  );
  expect(Number(onlineRecord?.payload.resumeAfterEventId)).toBeGreaterThan(0);

  const eventIds = exported.records
    .filter((record) => record.event === "sse.event_received")
    .map((record) => Number(record.payload.eventId))
    .filter((eventId) => Number.isSafeInteger(eventId) && eventId > 0);
  expect(eventIds).toEqual([...new Set(eventIds)].sort((a, b) => a - b));

  const successfulActions = exported.courseSummaryMaterial.teachingActions.filter(
    (action) => action.result?.success,
  );
  expect(
    successfulActions.filter((action) => action.tool === "create_demo_block"),
  ).toHaveLength(1);
  expect(
    successfulActions.filter((action) => action.tool === "create_css_controller"),
  ).toHaveLength(1);
  expect(new Set(successfulActions.map((action) => action.requestId)).size).toBe(
    successfulActions.length,
  );
});
