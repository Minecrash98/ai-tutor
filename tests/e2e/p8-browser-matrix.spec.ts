import { expect, test } from "@playwright/test";

test("completes the core box-model lesson", async ({ page }) => {
  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();

  const slider = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" })
    .getByRole("slider", { name: "padding 控制器" });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 15_000 },
  );

  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  const code = lesson.getByLabel("补写 CSS 声明");
  await expect(code).toBeEnabled({ timeout: 15_000 });
  await code.fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 15_000 },
  );
});

test("restores a positioning demo and its comparison", async ({ page }) => {
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByLabel("教学主题").selectOption("positioning");
  await tutor
    .getByRole("button", { name: "打开把元素放到指定位置演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".comparison-runtime")).toHaveCount(1, {
    timeout: 15_000,
  });
});

test("keeps the core entry reachable at 390 by 844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "先完成一节小课", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("上传静态 HTML 和 CSS 文件")).toBeEnabled();
  await expect(page.getByRole("region", { name: "AI 学习搭档" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("starts the first lesson with a real touch event", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-touch",
    "runs only in the hasTouch mobile context",
  );
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "开始一分钟盒模型课",
  });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error("touch target has no visible bounds");
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
    { timeout: 15_000 },
  );
});

test("uses real touch for live style preview and the reveal slider", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-touch",
    "runs only in the isolated hasTouch mobile context",
  );
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByLabel("教学主题").selectOption("positioning");
  await tutor
    .getByRole("button", { name: "打开把元素放到指定位置演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );

  const revisionCount = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as {
        projects: [string, { revisions: unknown[] }][];
      };
      return parsed.projects.reduce(
        (total, [, project]) => total + project.revisions.length,
        0,
      );
    });
  const cdp = await page.context().newCDPSession(page);
  const touchDrag = async (
    slider: ReturnType<typeof page.getByRole>,
    fromRatio: number,
    toRatio: number,
    beforeRelease?: () => Promise<void>,
  ) => {
    await slider.scrollIntoViewIfNeeded();
    const bounds = await slider.boundingBox();
    if (!bounds) throw new Error("touch slider has no visible bounds");
    const y = bounds.y + bounds.height / 2;
    const xAt = (ratio: number) => bounds.x + bounds.width * ratio;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: xAt(fromRatio), y }],
    });
    for (let step = 1; step <= 12; step += 1) {
      const ratio = fromRatio + ((toRatio - fromRatio) * step) / 12;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: xAt(ratio), y }],
      });
      await page.waitForTimeout(17);
    }
    await beforeRelease?.();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ has: page.getByRole("slider", { name: "top 控制器" }) });
  const styleSlider = controller.getByRole("slider", { name: "top 控制器" });
  const revisionsBeforeStyleDrag = await revisionCount();
  await page.evaluate(() => {
    const state = window as typeof window & {
      __touchFrameIntervals?: number[];
      __touchFrameActive?: boolean;
    };
    state.__touchFrameIntervals = [];
    state.__touchFrameActive = true;
    let previous = performance.now();
    const sample = (now: number) => {
      state.__touchFrameIntervals?.push(now - previous);
      previous = now;
      if (state.__touchFrameActive) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await touchDrag(styleSlider, 0.2, 0.75, async () => {
    expect(Number(await styleSlider.inputValue())).toBeGreaterThan(0);
    expect(await revisionCount()).toBe(revisionsBeforeStyleDrag);
  });
  await expect(controller).toContainText("已保存", { timeout: 15_000 });
  await expect.poll(revisionCount).toBe(revisionsBeforeStyleDrag + 1);
  const frameIntervals = await page.evaluate(() => {
    const state = window as typeof window & {
      __touchFrameIntervals?: number[];
      __touchFrameActive?: boolean;
    };
    state.__touchFrameActive = false;
    return state.__touchFrameIntervals ?? [];
  });
  const sortedFrames = [...frameIntervals].sort((left, right) => left - right);
  const frameP95 = sortedFrames[Math.ceil(sortedFrames.length * 0.95) - 1] ?? Infinity;
  expect(frameIntervals.length).toBeGreaterThanOrEqual(8);
  expect(frameP95).toBeLessThanOrEqual(34);

  const workbench = page.locator(".style-workbench-layer");
  if (await workbench.isVisible()) {
    await workbench.getByRole("button", { name: "关闭样式调整" }).click();
  }
  await expect(workbench).toBeHidden();
  const comparison = page.locator(".comparison-runtime").last();
  await comparison.getByRole("button", { name: "揭示" }).click();
  const revealSlider = comparison.getByRole("slider", { name: "前后查看比例" });
  const revisionsBeforeReveal = await revisionCount();
  const revealBefore = Number(await revealSlider.inputValue());
  await touchDrag(revealSlider, 0.25, 0.8);
  await expect
    .poll(async () => Number(await revealSlider.inputValue()))
    .toBeGreaterThan(revealBefore);
  expect(await revisionCount()).toBe(revisionsBeforeReveal);
});
