import { expect, test } from "@playwright/test";

const VISUAL_OPTIONS = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.005,
  scale: "css" as const,
};

test("keeps the desktop first-task entry visually stable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeEnabled();
  await expect(page.locator(".canvas-status strong")).toHaveText("当前任务");
  await page.addStyleTag({ content: "*{caret-color:transparent!important}" });
  await expect(page).toHaveScreenshot("p8-desktop-entry.png", VISUAL_OPTIONS);
});

test("keeps element selection, overlay, and inspection visually stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "上传静态 HTML 和 CSS 文件" }),
  ).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "visual-inspect.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<!doctype html><html><body><main id="card" aria-label="demo card"><span>inspect me</span></main></body></html>',
      ),
    },
    {
      name: "visual-inspect.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        'body{margin:0;color:#14283c;font-family:Arial,sans-serif}#card{width:120px;margin:8px;border:2px solid #111;padding:12px}#card::before{content:"demo"}',
      ),
    },
  ]);
  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "visual-inspect.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  await runtime.locator(".teaching-block__runtime-bar button[aria-pressed]").click();
  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  // Click the card padding so the selected event target is the card itself,
  // not the inline child that happens to cover its visual center.
  await frame.locator("#card").click({ position: { x: 4, y: 4 } });
  const inspector = page.locator(".style-workbench-layer .element-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: "查看 CSS 详情" }).click();
  await expect(inspector.locator(".element-inspector__target code")).toHaveText(
    "main#card",
  );
  await page.addStyleTag({ content: "*{caret-color:transparent!important}" });
  await expect(page).toHaveScreenshot(
    "p8-selected-element-inspector.png",
    VISUAL_OPTIONS,
  );
});

const scenarios = [
  {
    option: "box-model",
    button: "打开内容周围的空隙演示",
    snapshot: "p8-box-model-demo.png",
  },
  {
    option: "flex",
    button: "打开横向排列与间距演示",
    snapshot: "p8-flex-demo.png",
  },
  {
    option: "positioning",
    button: "打开把元素放到指定位置演示",
    snapshot: "p8-positioning-demo.png",
  },
] as const;

for (const scenario of scenarios) {
  test(`keeps the ${scenario.option} scenario visually stable`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const tutor = page.getByRole("region", { name: "AI 学习搭档" });
    await tutor.getByLabel("教学主题").selectOption(scenario.option);
    await tutor.getByRole("button", { name: scenario.button }).click();
    await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
      "data-demo-mode",
      "ready",
      { timeout: 15_000 },
    );
    await expect(page.locator(".comparison-runtime")).toHaveCount(1);
    await page.addStyleTag({
      content: "*{caret-color:transparent!important}",
    });
    await expect(page).toHaveScreenshot(scenario.snapshot, VISUAL_OPTIONS);
  });
}

test("keeps the 390 by 844 entry visually stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeEnabled();
  await expect(page).toHaveScreenshot("p8-mobile-entry.png", VISUAL_OPTIONS);
});

test("keeps the connection error and demo recovery visually stable", async ({
  page,
}) => {
  await page.route("**/api/realtime/capabilities", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "语音服务暂时不可用。" }),
    }),
  );
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect(tutor.getByRole("alert")).toBeVisible();
  await expect(tutor.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(tutor).toHaveScreenshot("p8-connection-error.png", VISUAL_OPTIONS);
});
