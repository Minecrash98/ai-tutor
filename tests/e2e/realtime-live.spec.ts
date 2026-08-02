import { expect, test, type Locator, type Page } from "@playwright/test";

const liveRealtime = process.env.AI_TUTOR_LIVE_REALTIME === "1";
const SESSION_TIMEOUT_MS = 90_000;

interface SemanticSummary {
  readonly projectCount: number;
  readonly comparisonCount: number;
  readonly maximumRevisionCount: number;
}

interface RealtimeLogExportLike {
  readonly records: readonly {
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

const scenarios = [
  {
    topic: "box-model",
    label: "盒模型",
    request: "给我做一个能看懂 padding 变化的盒模型小实验，我想自己拖动看看。",
    changeRequest: "把演示里的 padding 改成 40px，并做一个修改前后的视觉对比。",
    property: "padding",
  },
  {
    topic: "flex",
    label: "Flex",
    request: "做一个三个小方块的 Flex 演示，让我能调它们之间的间距。",
    changeRequest: "把三个方块的间距改成 32px，并做一个修改前后的视觉对比。",
    property: "gap",
  },
  {
    topic: "positioning",
    label: "定位",
    request: "做一个 relative 和 absolute 的定位演示，让我能改变小标签离顶部的距离。",
    changeRequest: "把小标签离顶部的距离改成 36px，并做一个修改前后的视觉对比。",
    property: "top",
  },
] as const;

async function connectRealtime(
  page: Page,
  topic: (typeof scenarios)[number]["topic"],
): Promise<{ tutor: Locator; status: Locator }> {
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const status = tutor.locator("[data-realtime-status]");
  await tutor.getByLabel("教学主题").selectOption(topic);
  await tutor.getByRole("checkbox").check();
  await tutor.getByRole("radio", { name: /持续聆听/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect
    .poll(() => status.getAttribute("data-realtime-status"), {
      timeout: 60_000,
    })
    .toMatch(/^(connected|listening|error)$/);
  if ((await status.getAttribute("data-realtime-status")) === "error") {
    const alert = await tutor.getByRole("alert").innerText();
    throw new Error(`Codex realtime did not connect: ${alert}`);
  }
  await expect
    .poll(() => status.getAttribute("data-realtime-status"))
    .toMatch(/^(connected|listening)$/);
  return { tutor, status };
}

async function sendNaturalLanguage(tutor: Locator, text: string): Promise<void> {
  const input = tutor.getByLabel("文字询问 CSS 问题");
  await input.fill(text);
  await tutor.getByRole("button", { name: "发送" }).click();
  await expect(tutor.locator('[data-role="user"]').last()).toContainText(text, {
    timeout: 30_000,
  });
}

async function readSemanticSummary(page: Page): Promise<SemanticSummary | null> {
  return page.evaluate(() => {
    const stored = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
    if (!stored) return null;
    const state = JSON.parse(stored) as {
      projects: readonly [
        string,
        { readonly revisions: readonly unknown[] },
      ][];
      comparisons: readonly unknown[];
    };
    return {
      projectCount: state.projects.length,
      comparisonCount: state.comparisons.length,
      maximumRevisionCount: Math.max(
        0,
        ...state.projects.map(([, project]) => project.revisions.length),
      ),
    };
  });
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

function expectRequiredToolEvidence(
  exported: RealtimeLogExportLike,
): void {
  const actions = exported.courseSummaryMaterial.teachingActions;
  const successfulTools = actions
    .filter((action) => action.result?.success)
    .map((action) => action.tool);
  expect(successfulTools).toEqual(
    expect.arrayContaining([
      "read_canvas_state",
      "create_demo_block",
      "apply_css_change",
      "create_css_controller",
      "create_comparison",
    ]),
  );
}

function expectTextCanvasOutputGateEvidence(
  exported: RealtimeLogExportLike,
): void {
  const suppressedRequests = exported.records.filter(
    (record) =>
      record.event === "client.canvas_preamble_suppressed" &&
      record.payload.trigger === "text",
  );
  expect(suppressedRequests.length).toBeGreaterThanOrEqual(2);
  expect(
    exported.records.some(
      (record) => record.event === "client.canvas_result_audio_resumed",
    ),
  ).toBe(true);
  expect(
    exported.records.some(
      (record) => record.event === "client.canvas_ack_play_failed",
    ),
  ).toBe(false);
}

test.describe("P6 natural-language live realtime acceptance", () => {
  test.describe.configure({ mode: "serial" });

  for (const scenario of scenarios) {
    test(`${scenario.label} creates a demo, controller, revision, and comparison`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      test.skip(
        !liveRealtime,
        "Set AI_TUTOR_LIVE_REALTIME=1 for the account-dependent Codex voice acceptance tests.",
      );

      const { tutor, status } = await connectRealtime(page, scenario.topic);

      if (scenario.topic === "box-model") {
        const mute = tutor.getByRole("button", { name: "关闭麦克风" });
        await mute.click();
        await expect(tutor.getByRole("button", { name: "打开麦克风" }))
          .toHaveAttribute("aria-pressed", "true");
        await page.waitForTimeout(1_000);
        await tutor.getByRole("button", { name: "打开麦克风" }).click();
        await expect(tutor.getByRole("button", { name: "关闭麦克风" }))
          .toHaveAttribute("aria-pressed", "false");
      }

      await sendNaturalLanguage(tutor, scenario.request);
      await expect
        .poll(async () => {
          const summary = await readSemanticSummary(page);
          return summary?.projectCount ?? 0;
        }, { timeout: SESSION_TIMEOUT_MS })
        .toBe(1);
      const controller = page.locator('[data-block-kind="css-controller"]').last();
      await expect(controller).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
      await expect(controller).toContainText(scenario.property);

      await sendNaturalLanguage(tutor, scenario.changeRequest);
      await expect
        .poll(async () => {
          const summary = await readSemanticSummary(page);
          return Boolean(
            summary &&
              summary.maximumRevisionCount >= 2 &&
              summary.comparisonCount >= 1,
          );
        }, { timeout: SESSION_TIMEOUT_MS })
        .toBe(true);
      await expect(page.locator(".comparison-runtime").last())
        .toBeVisible({ timeout: SESSION_TIMEOUT_MS });

      if (scenario.topic === "box-model") {
        await page.getByRole("button", { name: "Move focus to canvas" }).focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "回到内容" }).click();
        await expect(controller).toBeVisible({ timeout: 10_000 });
        const slider = controller.getByRole("slider", {
          name: `${scenario.property} 控制器`,
        });
        const revisionCountBeforeDrag =
          (await readSemanticSummary(page))?.maximumRevisionCount ?? 0;
        const liveAfterFrame = page
          .locator(".comparison-runtime")
          .last()
          .locator(".static-html-runtime-frame")
          .nth(1)
          .contentFrame();
        await slider.fill("44");
        await expect(liveAfterFrame.locator("#demo")).toHaveCSS(
          "padding-top",
          "44px",
        );
        await expect
          .poll(
            async () =>
              (await readSemanticSummary(page))?.maximumRevisionCount ?? 0,
          )
          .toBe(revisionCountBeforeDrag);
        await slider.press("Tab");
        await expect(controller).toContainText("已保存", {
          timeout: 15_000,
        });
        await expect
          .poll(
            async () =>
              (await readSemanticSummary(page))?.maximumRevisionCount ?? 0,
            { timeout: 15_000 },
          )
          .toBeGreaterThan(revisionCountBeforeDrag);

        await sendNaturalLanguage(
          tutor,
          "我刚才改了什么？页面为什么变成这样？",
        );
        await expect(tutor.locator('[data-role="assistant"]').last())
          .toContainText(/44|四十四|四四/, { timeout: SESSION_TIMEOUT_MS });
      }

      await page.waitForTimeout(1_500);
      const assistantText = (
        await tutor.locator('[data-role="assistant"]').allInnerTexts()
      ).join(" ");
      expect(assistantText).not.toMatch(
        /我先|接着|我会依次|每一步|第一步|第二步/,
      );

      const semanticStateBeforeStop = await readSemanticSummary(page);
      const exported = await stopAndReadLog(page, tutor, status);
      expectRequiredToolEvidence(exported);
      expectTextCanvasOutputGateEvidence(exported);

      if (scenario.topic === "box-model") {
        expect(
          exported.courseSummaryMaterial.teachingActions.some(
            (action) =>
              action.tool === "read_canvas_state" &&
              action.result?.message.includes("padding: 44px"),
          ),
        ).toBe(true);
        const logEvents = exported.records.map((record) => record.event);
        expect(logEvents).toEqual(
          expect.arrayContaining([
            "microphone.user_muted",
            "microphone.user_unmuted",
          ]),
        );

        await tutor.getByRole("button", { name: "开始语音讲解" }).click();
        await expect
          .poll(() => status.getAttribute("data-realtime-status"), {
            timeout: 60_000,
          })
          .toMatch(/^(connected|listening)$/);
        expect(await readSemanticSummary(page)).toEqual(semanticStateBeforeStop);
        await tutor.getByRole("button", { name: "立即停止" }).click();
        await expect(status).toHaveAttribute("data-realtime-status", "stopped", {
          timeout: 10_000,
        });
      }
    });
  }
});
