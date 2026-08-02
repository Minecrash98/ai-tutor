import { expect, test } from "@playwright/test";

test("completes the student learn-fix-continue path at 390 by 844", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const route = page.getByRole("region", { name: "学习任务路线" });
  await expect(route).toBeVisible();
  await expect(route).toHaveAttribute("data-task-stage", "learn");
  await expect(
    route.locator('li[data-task-state="current"]'),
  ).toContainText("学一个概念");

  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "会变大" }).click();
  await expect(route).toHaveAttribute("data-task-stage", "fix");
  await expect(
    route.locator('li[data-task-state="current"]'),
  ).toContainText("修一个页面");

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const slider = controller.getByRole("slider", { name: "padding 控制器" });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );
  await expect(route).toHaveAttribute("data-task-stage", "fix");

  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "transfer",
    { timeout: 10_000 },
  );
  await expect(route).toHaveAttribute("data-task-stage", "continue");
  await expect(
    route.locator('li[data-task-state="current"]'),
  ).toContainText("继续上次学习");

  await route.getByRole("button", { name: "收起学习任务路线" }).click();
  await expect(route).toHaveAttribute("data-task-collapsed", "true");
  await expect(route.locator("ol")).toHaveCount(0);
  await route.getByRole("button", { name: "展开学习任务路线" }).click();
  await expect(route.locator("ol")).toBeVisible();

  await lesson.getByLabel("补写 CSS 声明").fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );
  await expect(route).toContainText("第一课已完成");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
