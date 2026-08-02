import { expect, test, type Page } from "@playwright/test";

interface PersonalizedScenario {
  readonly name: string;
  readonly html: string;
  readonly css: string;
  readonly target: string;
  readonly topic: string;
  readonly property: "padding" | "gap" | "top";
  readonly trial: string;
  readonly prediction: string;
  readonly explanation: string;
  readonly courseId: "box-model-v1" | "flex-v1" | "positioning-v1";
  readonly hiddenItemId: string;
  readonly sourceLine: number;
}

const scenarios: readonly PersonalizedScenario[] = [
  {
    name: "my-box",
    html: '<!doctype html><html><body><main id="card">我的卡片</main></body></html>',
    css: "\n#card { width: 280px; padding: 20px; border: 4px solid #171912; }",
    target: "#card",
    topic: "盒模型",
    property: "padding",
    trial: "36px",
    prediction: "外框会变宽",
    explanation: "这里是 content-box，width 之外还要加左右留白",
    courseId: "box-model-v1",
    hiddenItemId: "box-transfer-b-1",
    sourceLine: 2,
  },
  {
    name: "my-flex",
    html: '<!doctype html><html><body><nav class="toolbar"><b>一</b><b>二</b><b>三</b></nav></body></html>',
    css: "\n.toolbar { display: flex; gap: 8px; }\n.toolbar b { width: 40px; height: 40px; }",
    target: ".toolbar",
    topic: "Flex 排列",
    property: "gap",
    trial: "24px",
    prediction: "项目不变，相邻空隙变大",
    explanation: "gap 管项目之间的距离，不直接改项目尺寸",
    courseId: "flex-v1",
    hiddenItemId: "flex-transfer-b-1",
    sourceLine: 2,
  },
  {
    name: "my-position",
    html: '<!doctype html><html><body><main class="stage"><span class="badge">新</span></main></body></html>',
    css: "\n.stage { position: relative; width: 240px; height: 140px; }\n.badge { position: absolute; top: 8px; left: 12px; }",
    target: ".badge",
    topic: "定位",
    property: "top",
    trial: "24px",
    prediction: "会按偏移方向移动",
    explanation: "源码同时设置了 position: absolute 和 top",
    courseId: "positioning-v1",
    hiddenItemId: "positioning-transfer-b-1",
    sourceLine: 3,
  },
];

async function persistedOrigin(page: Page) {
  return page.evaluate(() => {
    const indexRaw = localStorage.getItem("ai-tutor-learning-proof-index-v2");
    if (!indexRaw) return null;
    const sessionId = (JSON.parse(indexRaw) as { activeSessionId?: string })
      .activeSessionId;
    if (!sessionId) return null;
    const sessionRaw = localStorage.getItem(
      `ai-tutor-learning-proof-session-v2:${sessionId}`,
    );
    if (!sessionRaw) return null;
    const stored = JSON.parse(sessionRaw) as {
      payload?: {
        events?: Array<{
          personalizedOrigin?: {
            courseId?: string;
            baseContentHash?: string;
            verifiedRevisionId?: string;
            source?: { filePath?: string; line?: number; selector?: string };
            hiddenTransfer?: { itemId?: string; sha256?: string };
          };
        }>;
      };
    };
    return stored.payload?.events?.[0]?.personalizedOrigin ?? null;
  });
}

for (const scenario of scenarios) {
  test(`turns an imported ${scenario.topic} page into a measured course and evidence receipt`, async ({
    page,
  }) => {
    await page.goto("/");
    const upload = page.getByLabel("上传静态 HTML 和 CSS 文件");
    await expect(upload).toBeEnabled();
    await upload.setInputFiles([
      {
        name: `${scenario.name}.html`,
        mimeType: "text/html",
        buffer: Buffer.from(scenario.html),
      },
      {
        name: `${scenario.name}.css`,
        mimeType: "text/css",
        buffer: Buffer.from(scenario.css),
      },
    ]);

    const runtime = page
      .locator(".teaching-block__runtime--live")
      .filter({ hasText: `${scenario.name}.html` });
    await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
      timeout: 15_000,
    });
    const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
    await expect(frame.locator(scenario.target)).toBeVisible();

    const course = page.getByRole("region", { name: "用我的页面上课" });
    await course.getByRole("button", { name: "用这个页面生成小课" }).click();
    await expect(course).toContainText(scenario.topic, { timeout: 15_000 });
    await expect(course).toContainText(
      `${scenario.name}.css:${scenario.sourceLine}`,
    );
    await expect(course).toContainText(scenario.target);

    await course.getByRole("button", { name: scenario.prediction }).click();
    const controller = page
      .locator(".teaching-block--css-controller")
      .filter({ hasText: `我的页面实验 · ${scenario.property}` });
    const slider = controller.getByRole("slider", {
      name: `${scenario.property} 控制器`,
    });
    await expect(slider).toBeVisible({ timeout: 10_000 });
    await slider.fill(scenario.trial.replace("px", ""));
    await slider.focus();
    await page.keyboard.press("Tab");

    const computedProperty =
      scenario.property === "padding" ? "padding-top" : scenario.property;
    await expect(frame.locator(scenario.target)).toHaveCSS(
      computedProperty,
      scenario.trial,
      { timeout: 15_000 },
    );
    await course.getByRole("button", { name: "我已保存，核对变化" }).click();
    await expect(course).toContainText("保存后浏览器重新", { timeout: 15_000 });
    await course.getByRole("button", { name: scenario.explanation }).click();
    await expect(
      course.getByRole("button", { name: "继续完整小课与隐藏挑战" }),
    ).toBeVisible();
    await course
      .getByRole("button", { name: "继续完整小课与隐藏挑战" })
      .click();

    await expect
      .poll(() => persistedOrigin(page), { timeout: 20_000 })
      .toMatchObject({
        courseId: scenario.courseId,
        baseContentHash: expect.any(String),
        verifiedRevisionId: expect.any(String),
        source: {
          filePath: `${scenario.name}.css`,
          line: scenario.sourceLine,
          selector: scenario.target,
        },
        hiddenTransfer: {
          itemId: scenario.hiddenItemId,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      });
  });
}

test("refuses to guess a personalized course without a direct stable source rule", async ({
  page,
}) => {
  await page.goto("/");
  const upload = page.getByLabel("上传静态 HTML 和 CSS 文件");
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: "no-grounding.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!doctype html><html><body><main style="padding:20px">没有外部规则</main></body></html>',
    ),
  });
  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "no-grounding.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 15_000,
  });
  const course = page.getByRole("region", { name: "用我的页面上课" });
  await course.getByRole("button", { name: "用这个页面生成小课" }).click();
  await expect(course.getByRole("alert")).toContainText("没有找到", {
    timeout: 10_000,
  });
  await expect(page.locator(".teaching-block--css-controller")).toHaveCount(0);
  expect(await persistedOrigin(page)).toBeNull();
});
