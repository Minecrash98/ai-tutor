import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations
    .filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
  expect(blocking).toEqual([]);
}

test("has no serious or critical axe violations on the core entry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeEnabled();
  await page
    .getByRole("region", { name: "AI 学习搭档" })
    .getByText("语音设置", { exact: true })
    .click();
  await expectNoSeriousOrCriticalViolations(page);

  const undersizedControls = await page
    .locator(
      [
        ".student-task-shell > button",
        ".canvas-actionbar button",
        ".box-lesson button",
        ".box-lesson input",
        ".box-lesson select",
        ".box-lesson summary",
        ".realtime-tutor button",
        ".realtime-tutor input:not([type='checkbox']):not([type='radio'])",
        ".realtime-tutor select",
        ".realtime-tutor summary",
        ".style-workbench-layer button",
        ".style-workbench-layer select",
      ].join(","),
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((element) => ({
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().slice(0, 40) ??
            element.tagName,
          pixels: Number.parseFloat(getComputedStyle(element).fontSize),
        }))
        .filter((item) => item.pixels < 12),
    );
  expect(undersizedControls).toEqual([]);
});

test("keeps the completed lesson and replay dialog accessible", async ({
  page,
}) => {
  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "会变大" }).click();
  const slider = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" })
    .getByRole("slider", { name: "padding 控制器" });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  await lesson.getByLabel("补写 CSS 声明").fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 15_000 },
  );
  await lesson.getByRole("button", { name: "回放学习过程" }).click();
  await expect(page.getByRole("dialog", { name: "学习过程回放" })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);
});

test("supports keyboard focus, reduced motion, forced colors, and touch targets", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const start = page.getByRole("button", { name: "开始一分钟盒模型课" });
  await expect(start).toBeEnabled();
  for (let step = 0; step < 12; step += 1) {
    if (
      await start.evaluate((element) => element === document.activeElement)
    ) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(start).toBeFocused();
  const outline = await start.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(outline).not.toBe("none");

  const demo = page.getByRole("button", {
    name: "打开内容周围的空隙演示",
  });
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  const pressToTalkChoice = tutor
    .locator("label")
    .filter({ hasText: "按住说话（推荐）" });
  const voiceSettings = tutor.getByText("语音设置", { exact: true });
  for (const control of [start, demo, pressToTalkChoice, voiceSettings]) {
    const box = await control.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
