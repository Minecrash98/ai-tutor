import { expect, test, type Locator, type Page } from "@playwright/test";

async function saveSlider(controller: Locator, value: string) {
  const slider = controller.getByRole("slider", { name: "top 控制器" });
  await slider.fill(value);
  await slider.focus();
  await slider.press("Tab");
  await expect(controller).toContainText("已保存", { timeout: 10_000 });
}

async function startIsolatedPage(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          (window as typeof window & { __microphoneCalls?: number })
            .__microphoneCalls =
            ((window as typeof window & { __microphoneCalls?: number })
              .__microphoneCalls ?? 0) + 1;
          return Promise.reject(new Error("physical microphone must not run"));
        },
      },
    });
  });
  await page.route("**/api/learning/**", (route) => route.abort("failed"));
  await page.goto("/");
  return page.getByRole("region", { name: "Flex 与定位小课" });
}

async function flexGeometry(block: Locator) {
  return block.frameLocator("iframe").locator("#demo").evaluate((container) => {
    const containerRect = container.getBoundingClientRect();
    const items = [...container.querySelectorAll("article")].map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      container: {
        left: containerRect.left,
        top: containerRect.top,
        right: containerRect.right,
        bottom: containerRect.bottom,
      },
      items,
    };
  });
}

async function positioningGeometry(block: Locator) {
  return block.frameLocator("iframe").locator(".stage").evaluate((stage) => {
    const stageRect = stage.getBoundingClientRect();
    const targetRect = stage.querySelector("#demo")!.getBoundingClientRect();
    const afterRect = stage.querySelector(".after")!.getBoundingClientRect();
    return {
      stageTop: stageRect.top,
      targetTop: targetRect.top,
      afterTop: afterRect.top,
    };
  });
}

test("completes the full Flex learning loop from normal flow to replay", async ({
  page,
}) => {
  const lesson = await startIsolatedPage(page);
  await lesson.getByRole("button", { name: "开始 Flex 小课" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
  );
  await expect(
    page
      .locator(".teaching-block--runnable")
      .filter({ hasText: "普通文档流 · 原页面" }),
  ).toBeVisible();
  const flexBlock = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "Flex 分支 · 同一页面" });
  await expect(flexBlock).toBeVisible();
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);

  await lesson
    .getByRole("button", { name: "每个方块都会跟着变大" })
    .click();

  const gapController = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "项目之间留多大空隙" });
  const gap = gapController.getByRole("slider", { name: "gap 控制器" });
  await gap.fill("20");
  await gap.focus();
  await gap.press("Tab");
  await expect(gapController).toContainText("已保存");
  const geometryAt20 = await flexGeometry(flexBlock);
  await expect(lesson.locator("[data-scenario-progress]")).toContainText("0 / 3");
  await gap.fill("32");
  await gap.focus();
  await gap.press("Tab");
  const geometryAt32 = await flexGeometry(flexBlock);
  expect(geometryAt32.items[1]!.left - geometryAt32.items[0]!.right).toBeCloseTo(
    32,
    0,
  );
  expect(geometryAt32.items.map((item) => item.width)).toEqual(
    geometryAt20.items.map((item) => item.width),
  );
  expect(geometryAt32.items.map((item) => item.height)).toEqual(
    geometryAt20.items.map((item) => item.height),
  );
  await expect(lesson.locator("[data-scenario-progress]")).toContainText("1 / 3");

  const mainAxis = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "主轴怎么排列" });
  const beforeMainAxis = await flexGeometry(flexBlock);
  await mainAxis
    .getByRole("combobox", { name: "justify-content 控制器" })
    .selectOption("center");
  const afterMainAxis = await flexGeometry(flexBlock);
  expect(afterMainAxis.items[0]!.left).toBeGreaterThan(
    beforeMainAxis.items[0]!.left + 10,
  );
  await expect(mainAxis).toContainText("已保存");
  await expect(lesson.locator("[data-scenario-progress]")).toContainText("2 / 3");

  const crossAxis = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "交叉轴怎么对齐" });
  const beforeCrossAxis = await flexGeometry(flexBlock);
  await crossAxis
    .getByRole("combobox", { name: "align-items 控制器" })
    .selectOption("flex-end");
  const afterCrossAxis = await flexGeometry(flexBlock);
  expect(afterCrossAxis.items[0]!.top).toBeGreaterThan(
    beforeCrossAxis.items[0]!.top + 40,
  );
  expect(
    Math.max(...afterCrossAxis.items.map((item) => item.bottom)) -
      Math.min(...afterCrossAxis.items.map((item) => item.bottom)),
  ).toBeLessThanOrEqual(1.5);
  await expect(crossAxis).toContainText("已保存");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );

  await lesson
    .getByRole("button", { name: "gap 会改变每个方块的宽高" })
    .click();
  await lesson
    .getByRole("button", {
      name: "主轴和交叉轴分工，gap 只管项目间距",
    })
    .click();

  const code = lesson.getByLabel("补写 Flex CSS 声明");
  await expect(code).toBeEnabled({ timeout: 10_000 });
  await code.fill("display:flex; gap:24px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.getByRole("alert")).toContainText("需要四条声明");
  await code.fill(
    "body { display:flex; gap:24px; justify-content:space-between; align-items:center; }",
  );
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "transfer",
  );
  await code.fill(
    "display:flex; gap:24px; justify-content:space-between; align-items:center;",
  );
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );
  await expect(
    lesson.getByRole("button", { name: "继续学习定位" }),
  ).toBeVisible();
  const transferStyle = await page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "新页面 · 工具栏" })
    .frameLocator("iframe")
    .locator(".toolbar")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        gap: style.gap,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
      };
    });
  expect(transferStyle).toEqual({
    display: "flex",
    gap: "24px",
    justifyContent: "space-between",
    alignItems: "center",
  });

  await lesson.getByText("查看这次记录为什么成立").click();
  await expect(lesson.locator("[data-evidence-passed=false]")).not.toHaveCount(0);
  await expect(lesson.locator("[data-evidence-passed=true]")).not.toHaveCount(0);
  await lesson.getByRole("button", { name: "回放学习过程" }).click();
  const replay = page.getByRole("dialog", { name: "学习过程回放" });
  await expect(replay).toHaveAttribute("data-scenario-replay", "flex-v1");
  await expect(replay.getByRole("button", { name: "关闭回放" })).toBeFocused();
  await expect(replay.locator("[data-replay-final-match]")).toHaveAttribute(
    "data-replay-final-match",
    "true",
  );
  await replay.getByRole("button", { name: "关闭回放" }).click();

  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls ?? 0,
    ),
  ).toBe(0);
  await page.reload();
  const restored = page.getByRole("region", { name: "Flex 与定位小课" });
  await expect(restored).toHaveAttribute("data-scenario-kind", "flex-v1");
  await expect(restored.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
  );
  await expect(
    restored.getByRole("button", { name: "继续学习定位" }),
  ).toBeVisible();
});

test("compares static, relative, and absolute before positioning replay", async ({
  page,
}) => {
  const lesson = await startIsolatedPage(page);
  await lesson.getByRole("button", { name: "开始定位小课" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
  );
  for (const title of [
    "static · 跟着队伍",
    "relative · 留着原位",
    "absolute · 离开队伍",
  ]) {
    await expect(
      page.locator(".teaching-block--runnable").filter({ hasText: title }),
    ).toBeVisible();
  }
  const staticBlock = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "static · 跟着队伍" });
  const relativeBlock = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "relative · 留着原位" });
  const absoluteBlock = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "absolute · 离开队伍" });
  await expect(
    page
      .locator(".teaching-block--explanation")
      .filter({ hasText: "虚线框就是这次的包含块" }),
  ).toBeVisible();

  await lesson
    .getByRole("button", { name: "relative 会离开普通队伍" })
    .click();

  const staticBefore = await positioningGeometry(staticBlock);
  await saveSlider(
    page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "static：写 top 看看" }),
    "40",
  );
  const staticAfter = await positioningGeometry(staticBlock);
  expect(staticAfter.targetTop).toBeCloseTo(staticBefore.targetTop, 0);
  expect(staticAfter.afterTop).toBeCloseTo(staticBefore.afterTop, 0);
  await expect(lesson.locator("[data-scenario-progress]")).toContainText("1 / 3");
  const relativeBefore = await positioningGeometry(relativeBlock);
  await saveSlider(
    page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "relative：向下移动" }),
    "40",
  );
  const relativeAfter = await positioningGeometry(relativeBlock);
  expect(relativeAfter.targetTop - relativeBefore.targetTop).toBeCloseTo(40, 0);
  expect(relativeAfter.afterTop).toBeCloseTo(relativeBefore.afterTop, 0);
  await expect(lesson.locator("[data-scenario-progress]")).toContainText("2 / 3");
  const absoluteBefore = await positioningGeometry(absoluteBlock);
  await saveSlider(
    page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "absolute：从包含块向下" }),
    "48",
  );
  const absoluteAfter = await positioningGeometry(absoluteBlock);
  expect(absoluteAfter.targetTop - absoluteBefore.targetTop).toBeCloseTo(48, 0);
  expect(absoluteAfter.afterTop).toBeCloseTo(absoluteBefore.afterTop, 0);
  expect(absoluteAfter.targetTop - absoluteAfter.stageTop).toBeGreaterThan(45);
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );
  await expect(page.locator(".comparison-runtime")).toHaveCount(3);

  await lesson
    .getByRole("button", { name: "永远从浏览器左上角开始量" })
    .click();
  await lesson
    .getByRole("button", { name: "从最近的已定位祖先开始量" })
    .click();
  const code = lesson.getByLabel("补写定位 CSS 声明");
  await expect(code).toBeEnabled({ timeout: 10_000 });
  await code.fill("position:absolute; top:16px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.getByRole("alert")).toContainText("需要三条声明");
  await code.fill(".wrong { position:absolute; top:16px; right:16px; }");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "transfer",
  );
  await code.fill("position:absolute; top:16px; right:16px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );
  const badgeStyle = await page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "新页面 · 海报角标" })
    .frameLocator("iframe")
    .locator(".badge")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        top: style.top,
        right: style.right,
      };
    });
  expect(badgeStyle).toEqual({
    position: "absolute",
    top: "16px",
    right: "16px",
  });

  await lesson.getByRole("button", { name: "回放学习过程" }).click();
  const replay = page.getByRole("dialog", { name: "学习过程回放" });
  await expect(replay).toHaveAttribute(
    "data-scenario-replay",
    "positioning-v1",
  );
  await expect(replay.locator("[data-replay-final-match]")).toHaveAttribute(
    "data-replay-final-match",
    "true",
  );
  const scrubber = replay.getByRole("slider", { name: "回放步骤" });
  await scrubber.fill("2");
  await expect(replay).toContainText("动手观察");
  await replay.getByRole("button", { name: "关闭回放" }).click();

  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls ?? 0,
    ),
  ).toBe(0);
  await page.reload();
  const restored = page.getByRole("region", { name: "Flex 与定位小课" });
  await expect(restored).toHaveAttribute(
    "data-scenario-kind",
    "positioning-v1",
  );
  await expect(restored.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
  );
});

async function completeAuthoritativeScenario(
  page: Page,
  kind: "flex-v1" | "positioning-v1",
) {
  await page.goto("/");
  const lesson = page.getByRole("region", { name: "Flex 与定位小课" });
  await lesson
    .getByRole("button", {
      name: kind === "flex-v1" ? "开始 Flex 小课" : "开始定位小课",
    })
    .click();
  await lesson
    .getByRole("button", {
      name:
        kind === "flex-v1"
          ? "方块不变，只把相邻间距拉开"
          : "absolute 会离开普通队伍",
    })
    .click();
  if (kind === "flex-v1") {
    const gap = page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "项目之间留多大空隙" })
      .getByRole("slider", { name: "gap 控制器" });
    await gap.fill("32");
    await gap.focus();
    await gap.press("Tab");
    await page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "主轴怎么排列" })
      .getByRole("combobox", { name: "justify-content 控制器" })
      .selectOption("center");
    await page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: "交叉轴怎么对齐" })
      .getByRole("combobox", { name: "align-items 控制器" })
      .selectOption("flex-end");
  } else {
    await saveSlider(
      page
        .locator(".teaching-block--css-controller")
        .filter({ hasText: "static：写 top 看看" }),
      "40",
    );
    await saveSlider(
      page
        .locator(".teaching-block--css-controller")
        .filter({ hasText: "relative：向下移动" }),
      "40",
    );
    await saveSlider(
      page
        .locator(".teaching-block--css-controller")
        .filter({ hasText: "absolute：从包含块向下" }),
      "48",
    );
  }
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
  );
  await lesson
    .getByRole("button", {
      name:
        kind === "flex-v1"
          ? "主轴和交叉轴分工，gap 只管项目间距"
          : "从最近的已定位祖先开始量",
    })
    .click();
  const code = lesson.getByLabel(
    kind === "flex-v1" ? "补写 Flex CSS 声明" : "补写定位 CSS 声明",
  );
  await expect(code).toBeEnabled({ timeout: 10_000 });
  await code.fill(
    kind === "flex-v1"
      ? "display:flex; gap:24px; justify-content:space-between; align-items:center;"
      : "position:absolute; top:16px; right:16px;",
  );
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
  );
  await expect(lesson.locator("[data-learning-save]")).toHaveAttribute(
    "data-learning-save",
    "synced",
    { timeout: 15_000 },
  );
  return lesson;
}

for (const kind of ["flex-v1", "positioning-v1"] as const) {
  test(`persists and restores the authoritative ${kind} browser replay`, async ({
    page,
  }) => {
    test.skip(
      process.env.AI_TUTOR_P7_DATABASE !== "1",
      "requires the isolated PostgreSQL acceptance stack",
    );
    const lesson = await completeAuthoritativeScenario(page, kind);
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
    const authoritative = await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/learning/sessions/${id}`, {
              cache: "no-store",
            });
            return response.ok ? response.json() : null;
          }, sessionId),
        { timeout: 15_000 },
      )
      .not.toBeNull();
    void authoritative;
    const replayBundle = await page.evaluate(async (id) => {
      const response = await fetch(`/api/learning/sessions/${id}`, {
        cache: "no-store",
      });
      return response.json() as Promise<{
        events: unknown[];
        session: {
          lessonKind: string;
          status: string;
          latestSequence: number;
        };
        latestSnapshot: {
          throughSequence: number;
          lessonState: { phase: string; lessonKind: string };
        } | null;
      }>;
    }, sessionId);
    expect(replayBundle.session).toMatchObject({
      lessonKind: kind,
      status: "completed",
      latestSequence: 8,
    });
    expect(replayBundle.events).toHaveLength(8);
    expect(replayBundle.latestSnapshot).toMatchObject({
      throughSequence: 8,
      lessonState: { phase: "complete", lessonKind: kind },
    });

    await page.reload();
    const restored = page.getByRole("region", { name: "Flex 与定位小课" });
    await expect(restored.locator("[data-lesson-phase]")).toHaveAttribute(
      "data-lesson-phase",
      "complete",
    );
    await restored.getByRole("button", { name: "回放学习过程" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "学习过程回放" })
        .locator("[data-replay-final-match]"),
    ).toHaveAttribute("data-replay-final-match", "true");
    await expect(lesson).toHaveAttribute("data-scenario-kind", kind);
  });
}
