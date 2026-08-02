import { expect, test } from "@playwright/test";

test("restarts the isolated box lesson ten times without clearing history", async ({
  page,
}) => {
  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  for (let attempt = 1; attempt < 10; attempt += 1) {
    await lesson.getByRole("button", { name: "重新开始这节课" }).click();
    await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
      "data-lesson-phase",
      "predict",
    );
    const currentBlockId = await lesson.getAttribute("data-lesson-block-id");
    expect(currentBlockId).toBeTruthy();
    const slider = page
      .locator(
        `.teaching-block--css-controller[data-source-block-id="${currentBlockId}"]`,
      )
      .getByRole("slider", { name: "padding 控制器" });
    await expect(slider).toHaveValue("16");
  }
  const history = page.getByRole("region", { name: "设备上的学习记录" });
  await history.getByText("我的学习记录（10）", { exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(10);
  await expect(page.locator(".canvas-metrics")).toContainText("20个内容");
});

test("supports undo, redo, single-card delete, and a non-destructive lesson exit", async ({
  page,
}) => {
  await page.goto("/");
  const actionbar = page.getByRole("navigation", { name: "画布快捷操作" });
  await page.getByText("自由画布工具", { exact: true }).click();
  await page
    .locator(".block-library__list")
    .getByRole("button", { name: /知识卡/ })
    .click();
  await expect(page.locator(".canvas-metrics")).toContainText("1个内容");
  await actionbar.getByRole("button", { name: "删除所选" }).click();
  await expect(page.locator(".canvas-metrics")).toContainText("0个内容");
  await actionbar.getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".canvas-metrics")).toContainText("1个内容");
  await actionbar.getByRole("button", { name: "重做" }).click();
  await expect(page.locator(".canvas-metrics")).toContainText("0个内容");

  await actionbar.getByRole("button", { name: "暂时收起小课" }).click();
  await expect(page.getByText("小课已暂时收起")).toBeVisible();
  await page.getByRole("button", { name: "继续小课" }).first().click();
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeVisible();
});

test("restores runnable code versions and comparisons after delete then undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("自由画布工具", { exact: true }).click();
  const tools = page.locator(".block-library__list");
  const actionbar = page.getByRole("navigation", { name: "画布快捷操作" });
  await tools.getByRole("button", { name: /实验页面/ }).click();
  await tools.getByRole("button", { name: /拖动调一调/ }).click();
  const slider = page
    .locator(".teaching-block--css-controller")
    .getByRole("slider", { name: "padding 控制器" });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".teaching-block--comparison")).toHaveCount(1);

  const runnable = page.locator(".teaching-block--runnable");
  const blockId = await runnable.getAttribute("data-teaching-block-id");
  expect(blockId).toBeTruthy();
  await page.keyboard.press("Escape");
  await actionbar.getByRole("button", { name: "回到内容" }).click();
  await expect(runnable).toBeInViewport();
  await page.keyboard.press("Control+A");
  await actionbar.getByRole("button", { name: "删除所选" }).click();
  await expect(runnable).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
        if (!raw) return false;
        const state = JSON.parse(raw) as { projects: [string, unknown][] };
        return state.projects.some(([projectId]) => projectId === id);
      }, blockId),
    )
    .toBe(false);

  await actionbar.getByRole("button", { name: "撤销" }).click();
  await expect(runnable).toHaveCount(1);
  await expect(
    runnable.locator(".teaching-block__runtime--live"),
  ).toHaveAttribute("data-runtime-status", "ready", { timeout: 15_000 });
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
        if (!raw) return 0;
        const state = JSON.parse(raw) as {
          projects: [string, { revisions: unknown[] }][];
        };
        return (
          state.projects.find(([projectId]) => projectId === id)?.[1]
            .revisions.length ?? 0
        );
      }, blockId),
    )
    .toBe(2);
  await expect(page.locator(".comparison-runtime")).toBeVisible();
});

test("advanced tools create usable content or guidance instead of empty shells", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("自由画布工具", { exact: true }).click();
  const tools = page.locator(".block-library__list");
  const metrics = page.locator(".canvas-metrics");

  await tools.getByRole("button", { name: /看看哪里变了/ }).click();
  await expect(metrics).toContainText("0个内容");
  await expect(page.locator(".canvas-status__activity")).toContainText(
    "先添加或载入一个实验页面",
  );
  await tools.getByRole("button", { name: /拖动调一调/ }).click();
  await expect(metrics).toContainText("0个内容");
  await tools.getByRole("button", { name: /整理成一组/ }).click();
  await expect(metrics).toContainText("0个内容");

  await tools.getByRole("button", { name: /实验页面/ }).click();
  await expect(page.locator(".teaching-block--runnable")).toHaveCount(1);
  await expect(metrics).toContainText("1个内容");
  await tools.getByRole("button", { name: /拖动调一调/ }).click();
  const controller = page.locator(".teaching-block--css-controller");
  await expect(controller).toHaveCount(1);
  await expect(controller.getByRole("slider", { name: "padding 控制器" })).toBeVisible();

  await tools.getByRole("button", { name: /看看哪里变了/ }).click();
  await expect(metrics).toContainText("2个内容");
  await expect(page.locator(".canvas-status__activity")).toContainText(
    "先在这个实验里保存一次变化",
  );
  const slider = controller.getByRole("slider", { name: "padding 控制器" });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await expect(controller).toContainText("已保存", { timeout: 10_000 });
  await expect(page.locator(".teaching-block--comparison")).toHaveCount(1);
  await expect(metrics).toContainText("3个内容");
  await tools.getByRole("button", { name: /看看哪里变了/ }).click();
  await expect(page.locator(".teaching-block--comparison")).toHaveCount(1);
  await expect(metrics).toContainText("3个内容");
  await expect(page.locator(".canvas-status__activity")).toContainText(
    "已找到这个实验的修改前后对比",
  );
});

test("records progressive help and labels a demonstrated route as guided", async ({
  page,
}) => {
  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  const support = lesson.locator(".box-lesson__support");
  await support.getByText("卡住了？可以这样继续", { exact: true }).click();
  await support.getByRole("button", { name: "给我一个小提示" }).click();
  await expect(support.locator("[data-hint-level='1']")).toBeVisible();
  await support.getByRole("button", { name: "再看第 2 层提示" }).click();
  await expect(support.locator("[data-hint-level='2']")).toBeVisible();
  await support.getByRole("button", { name: "再看第 3 层提示" }).click();
  await expect(support.locator("[data-hint-level='3']")).toContainText("演示");

  await support.getByRole("button", { name: "跳过这一步" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "observe",
  );
  if ((await support.getAttribute("open")) === null) {
    await support.getByText("卡住了？可以这样继续", { exact: true }).click();
  }
  await support.getByRole("button", { name: "跳过这一步" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
  );

  const wrongExplanation = lesson.getByRole("button", {
    name: "因为外边距把边框撑大了",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wrongExplanation.click();
  }
  await expect(lesson.getByRole("status")).toContainText("已完成 3 次解释尝试");
  if ((await support.getAttribute("open")) === null) {
    await support.getByText("卡住了？可以这样继续", { exact: true }).click();
  }
  await support.getByRole("button", { name: "直接看示范" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "transfer",
  );
  await lesson.getByRole("textbox", { name: "补写 CSS 声明" }).fill("padding: 20px");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();

  await expect(lesson).toContainText("这次在帮助下完成了路线");
  await expect(lesson).toContainText("不记作独立达成");
  await lesson.getByText(/查看目前学习记录/).click();
  await lesson.getByText("逐步查看原始过程", { exact: true }).click();
  await expect(
    lesson.locator(
      ".learning-progress-receipt__events li[data-feedback-status='supported']",
    ),
  ).toHaveCount(6);
});

for (const scenario of [
  {
    label: "Flex",
    start: "开始 Flex 小课",
    input: "补写 Flex CSS 声明",
    code: "display:flex; gap:24px; justify-content:space-between; align-items:center;",
  },
  {
    label: "定位",
    start: "开始定位小课",
    input: "补写定位 CSS 声明",
    code: "position:absolute; top:16px; right:16px;",
  },
] as const) {
  test(`${scenario.label} records skipped stages and demonstration as guided`, async ({
    page,
  }) => {
    await page.goto("/");
    const lesson = page.getByRole("region", { name: "Flex 与定位小课" });
    await lesson.getByRole("button", { name: scenario.start }).click();
    const support = lesson.locator(".box-lesson__support");
    await support.getByText("卡住了？可以这样继续", { exact: true }).click();
    await support.getByRole("button", { name: "跳过这一步" }).click();
    await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
      "data-lesson-phase",
      "observe",
    );
    if ((await support.getAttribute("open")) === null) {
      await support.getByText("卡住了？可以这样继续", { exact: true }).click();
    }
    await support.getByRole("button", { name: "跳过这一步" }).click();
    await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
      "data-lesson-phase",
      "explain",
    );
    if ((await support.getAttribute("open")) === null) {
      await support.getByText("卡住了？可以这样继续", { exact: true }).click();
    }
    await support.getByRole("button", { name: "直接看示范" }).click();
    await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
      "data-lesson-phase",
      "transfer",
    );
    await lesson.getByRole("textbox", { name: scenario.input }).fill(scenario.code);
    await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
    await expect(lesson).toContainText("这次在帮助下完成了路线");
    await expect(lesson).toContainText("不记作独立达成");
  });
}
