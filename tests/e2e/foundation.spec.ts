import { expect, test } from "@playwright/test";

test("keeps the teaching canvas interactions and local persistence", async ({
  page,
}) => {
  await page.goto("/");

  const blockCount = page
    .locator(".canvas-metrics > span")
    .first()
    .locator("strong");
  const addKnowledgeButton = page
    .locator(".block-library__list")
    .getByRole("button", { name: /知识卡/ });

  await expect(
    page.getByRole("heading", { name: "先完成一节小课", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".canvas-status strong")).toHaveText("当前任务");
  await expect(page.locator(".canvas-status small")).toContainText(
    "现在开始第一课",
  );
  await page.getByText("自由画布工具", { exact: true }).click();
  await expect(addKnowledgeButton).toBeEnabled();
  await expect(blockCount).toHaveText("0");

  await addKnowledgeButton.click();
  await expect(blockCount).toHaveText("1");
  await expect(page.locator(".teaching-block").first()).toContainText("知识卡");
  await page.waitForTimeout(750);
  await page.reload();

  await expect(blockCount).toHaveText("1");
});

test("completes the box-model predict-observe-explain-transfer lesson without microphone", async ({
  page,
}) => {
  await page.goto("/");

  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await expect(lesson).toBeVisible();
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await expect(lesson.locator("[data-lesson-phase]"))
    .toHaveAttribute("data-lesson-phase", "predict");

  await lesson.getByRole("button", { name: "保持不变" }).click();
  await expect(lesson.locator("[data-lesson-phase]"))
    .toHaveAttribute("data-lesson-phase", "observe");
  await expect(lesson).toContainText("左右各多 16px");
  await expect(lesson.locator(".entry-diagnostic")).toHaveAttribute(
    "data-next-task-variant",
    "box-model-v1:guided-fact-check",
  );
  await expect(lesson.getByText("查看目前学习记录（1/4）")).toBeVisible();
  await lesson.getByText("查看目前学习记录（1/4）").click();
  await expect(lesson).toContainText("还未完成 · 亲手操作");
  await expect(
    page.getByRole("region", { name: "AI 学习搭档" }),
  ).toContainText("总宽增加多少");

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const paddingSlider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await expect(paddingSlider).toHaveValue("16");
  await expect(lesson.getByLabel("当前卡片总宽计算")).toContainText(
    "总宽 320px",
  );
  await paddingSlider.fill("32");
  await expect(lesson.getByLabel("当前卡片总宽计算")).toContainText(
    "总宽 352px",
  );
  await paddingSlider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]"))
    .toHaveAttribute("data-lesson-phase", "explain", { timeout: 10_000 });

  await lesson
    .getByRole("button", { name: "因为外边距把边框撑大了" })
    .click();
  await expect(lesson).toContainText("还没有和页面里的宽度变化对上");
  const adaptation = lesson.locator(".entry-diagnostic");
  await expect(adaptation).toHaveAttribute(
    "data-next-task-variant",
    "box-model-v1:misconception-correction",
  );
  await expect(
    adaptation.getByRole("group", { name: "针对当前困惑的修正题" }),
  ).toContainText("内容区保持 280px，左右各多 16px 后");
  await expect(adaptation).toHaveAttribute(
    "data-adaptation-source-events",
    /^[a-f0-9-]{36},[a-f0-9-]{36}/,
  );
  const support = lesson.locator(".box-lesson__support");
  await support.getByText("卡住了？可以这样继续", { exact: true }).click();
  await support.getByRole("button", { name: "给我一个小提示" }).click();
  await expect(support.locator("[data-hint-level='1']")).toBeVisible();
  await support.getByRole("button", { name: "再看第 2 层提示" }).click();
  await expect(support).toContainText("总宽 = 内容宽");
  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  await expect(lesson.locator("[data-lesson-phase]"))
    .toHaveAttribute("data-lesson-phase", "transfer", { timeout: 10_000 });

  const code = lesson.getByLabel("补写 CSS 声明");
  await expect(code).toBeEnabled();
  await code.fill("margin: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.getByRole("alert")).toContainText("padding");

  await code.fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]"))
    .toHaveAttribute("data-lesson-phase", "complete", { timeout: 10_000 });
  await expect(lesson.locator(".entry-diagnostic")).toHaveAttribute(
    "data-next-task-variant",
    "box-model-v1:hidden-transfer",
  );
  await expect(lesson).toContainText("完成已经解锁的陌生页面挑战");
  await expect(lesson.getByRole("definition")).toHaveCount(4);
  await expect(lesson).toContainText("不代表长期掌握");

  const transferRuntime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "index.html" })
    .last();
  const transferFrame = transferRuntime
    .locator(".static-html-runtime-frame")
    .contentFrame();
  await expect(transferFrame.locator(".notice")).toHaveCSS(
    "padding-top",
    "20px",
  );
});

test("shows the compact P6 realtime tutor without exposing credentials", async ({
  page,
}) => {
  await page.goto("/");

  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await expect(tutor).toBeVisible();
  await expect(tutor).toContainText("AI 学习搭档");
  await expect(tutor.locator("[data-realtime-status]"))
    .toHaveAttribute("data-realtime-status", "idle");
  await expect(tutor.getByRole("button", { name: "开始语音讲解" }))
    .toBeDisabled();
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await expect(tutor.getByRole("button", { name: "开始语音讲解" }))
    .toBeEnabled();

  const topic = tutor.getByLabel("教学主题");
  await topic.selectOption("positioning");
  await expect(topic).toHaveValue("positioning");
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeDisabled();
  await expect(tutor).not.toContainText(/P6|OAuth|gpt-live|安全边界/i);
  await expect(tutor).not.toContainText(/bearer|access[_-]?token|refresh[_-]?token/i);
});

test("imports isolated HTML/CSS blocks without executing uploaded scripts", async ({
  page,
}) => {
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  const dotPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=",
    "base64",
  );

  await upload.setInputFiles([
    {
      name: "index.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<!doctype html>
        <html data-user-script="clean">
          <head>
            <script>document.documentElement.dataset.userScript = "executed"</script>
          </head>
          <body>
            <main id="card" onclick="document.documentElement.dataset.userScript='clicked'">
              isolated one
              <span id="inline" style="border-top: 7px solid black">inline</span>
              <img id="asset" src="./dot.png">
              <img src="https://example.invalid/leak.png">
            </main>
          </body>
        </html>`,
      ),
    },
    {
      name: "base.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        '@import "https://example.invalid/leak.css"; body{margin:0;background:rgb(18, 52, 86)} #asset{background:url("./dot.png")}',
      ),
    },
    {
      name: "extra.css",
      mimeType: "text/css",
      buffer: Buffer.from("#card{color:rgb(240, 230, 120);padding:12px}"),
    },
    { name: "dot.png", mimeType: "image/png", buffer: dotPng },
  ]);

  const firstRuntime = page.locator('[data-runtime-status="ready"]').last();
  await expect(firstRuntime).toBeVisible({ timeout: 10_000 });
  const firstFrame = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "index.html" })
    .locator(".static-html-runtime-frame")
    .contentFrame();
  await expect(firstFrame.locator("body")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await expect(firstFrame.locator("#card")).toHaveCSS(
    "color",
    "rgb(240, 230, 120)",
  );
  await expect(firstFrame.locator("#inline")).toHaveCSS(
    "border-top-width",
    "7px",
  );
  await expect
    .poll(() =>
      firstFrame
        .locator("#asset")
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect(firstFrame.locator("#card")).not.toHaveAttribute("onclick");
  await firstFrame.locator("#card").click();
  await expect(firstFrame.locator("html")).toHaveAttribute(
    "data-user-script",
    "clean",
  );

  await upload.setInputFiles([
    {
      name: "second.html",
      mimeType: "text/html",
      buffer: Buffer.from("<!doctype html><html><body>isolated two</body></html>"),
    },
    {
      name: "second.css",
      mimeType: "text/css",
      buffer: Buffer.from("body{background:rgb(201, 210, 219)}"),
    },
  ]);

  await expect(page.locator(".static-html-runtime-frame")).toHaveCount(2);
  const secondFrame = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "second.html" })
    .locator(".static-html-runtime-frame")
    .contentFrame();
  await expect(secondFrame.locator("body")).toHaveCSS(
    "background-color",
    "rgb(201, 210, 219)",
  );
  await expect(firstFrame.locator("body")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
});

test("selects a sandboxed element and explains its box model and CSS rules", async ({
  page,
}) => {
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles([
    {
      name: "inspect.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<!doctype html>
        <html>
          <body>
            <main id="card" aria-label="demo card">
              <span>inspect me</span>
            </main>
          </body>
        </html>`,
      ),
    },
    {
      name: "inspect.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        `body {
          margin: 0;
          color: rgb(20, 40, 60);
          font-family: Arial, sans-serif;
        }
        #card {
          width: 120px;
          margin: 8px;
          border: 2px solid black;
          padding: 12px;
        }
        #card::before { content: "demo"; }`,
      ),
    },
  ]);

  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "inspect.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });

  const selectButton = runtime.locator(
    '.teaching-block__runtime-bar button[aria-pressed]',
  );
  await selectButton.click();
  await expect(selectButton).toHaveAttribute("aria-pressed", "true");

  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  await frame.locator("#card").hover();
  await expect(
    frame.locator('[data-ai-tutor-overlay="hover"]'),
  ).toHaveCSS("display", "block");

  await frame.locator("#card").click();
  await expect(selectButton).toHaveAttribute("aria-pressed", "false");
  await expect(
    frame.locator('[data-ai-tutor-overlay="selected"]'),
  ).toHaveCSS("display", "block");

  const inspector = page.locator(".style-workbench-layer .element-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector.locator(".element-inspector__header")).toContainText(
    "已选中 内容卡片",
  );
  await expect(
    inspector.getByRole("navigation", {
      name: "所选内容在页面中的位置",
    }),
  ).toContainText("内容卡片");
  await expect(inspector.locator(".element-inspector__rules")).toHaveCount(0);
  await inspector.getByRole("button", { name: "查看 CSS 详情" }).click();
  await expect(inspector.locator(".element-inspector__target code")).toHaveText(
    "main#card",
  );
  await expect(inspector.locator(".inspector-box-model")).toContainText(
    "12px",
  );
  await expect(inspector.locator(".inspector-box-model")).toContainText(
    "120 ×",
  );
  const inspectorScroll = inspector.locator(".element-inspector__scroll");
  const runnableBlock = runtime.locator("xpath=ancestor::article");
  const blockWidthBeforeWheel = (await runnableBlock.boundingBox())?.width ?? 0;
  const scrollTopBeforeWheel = await inspectorScroll.evaluate(
    (element) => element.scrollTop,
  );
  await inspectorScroll.hover();
  await page.mouse.wheel(0, 520);
  await expect
    .poll(() => inspectorScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(scrollTopBeforeWheel);
  const blockWidthAfterWheel = (await runnableBlock.boundingBox())?.width ?? 0;
  expect(Math.abs(blockWidthAfterWheel - blockWidthBeforeWheel)).toBeLessThan(1);
  const cardRule = inspector
    .locator(".element-inspector__rules article")
    .filter({ hasText: "#card" })
    .first();
  await expect(cardRule).toContainText("inspect.css");
  await expect(cardRule).toContainText("padding");
  await expect(inspector.locator(".element-inspector__diagnostics")).toContainText(
    "继承",
  );
  await expect(inspector.locator(".element-inspector__diagnostics")).toContainText(
    "::before",
  );

  await inspector.getByRole("button", { name: "关闭样式调整" }).click();
  await selectButton.click();
  await frame.locator("#card span").click();
  await expect(inspector).toContainText("根据页面结构推测");
  await expect(inspector).toContainText("可能选得太里面了");
  await inspector.getByRole("button", { name: "切换到内容卡片" }).click();
  await expect(inspector.locator(".element-inspector__header")).toContainText(
    "已选中 内容卡片",
  );
  await inspector.getByRole("button", { name: "查看 CSS 详情" }).click();
  await expect(inspector.locator(".element-inspector__target code")).toHaveText(
    "main#card",
  );
  await inspector.getByRole("button", { name: "里面第 1 项：文字" }).click();
  await expect(inspector.locator(".element-inspector__target code")).toHaveText(
    "main#card > span",
  );
  await expect(inspector.locator(".element-inspector__diagnostics")).toContainText(
    "没有直接命中",
  );

  const frameElement = runtime.locator(".static-html-runtime-frame");
  await expect(frameElement).toHaveAttribute("sandbox", "allow-scripts");
  const runtimeInstanceId = await frameElement.evaluate((element) => {
    const source = (element as HTMLIFrameElement).srcdoc;
    const match = source.match(/const runtimeInstanceId = ("[^"]+");/);
    if (!match?.[1]) throw new Error("runtime instance id not found");
    return JSON.parse(match[1]) as string;
  });
  await frame.locator("#card").evaluate((element) => element.remove());
  await frameElement.evaluate((element, runtimeId) => {
    (element as HTMLIFrameElement).contentWindow?.postMessage(
      {
        protocolVersion: 1,
        runtimeInstanceId: runtimeId,
        messageId: "e2e-relocate",
        type: "runtime.render",
        payload: {},
      },
      "*",
    );
  }, runtimeInstanceId);
  await expect(inspector).toContainText("无法定位");
  await inspector
    .getByRole("button", { name: "重新选择页面内容" })
    .click();
  await expect(selectButton).toHaveAttribute("aria-pressed", "true");
  await expect(runtime).toContainText("再点一下想调整的地方");
});

test("runs a simple P5 CSS experiment, immutable versions, comparison, and refresh recovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "整理成组" }),
  ).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "p5.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<!doctype html><html><body><div class="spacer"></div><main id="card">P5 card</main><div class="spacer"></div></body></html>',
      ),
    },
    {
      name: "p5.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        "body{margin:0}.spacer{height:700px}#card{width:160px;border:2px solid black;padding:12px}",
      ),
    },
  ]);

  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "p5.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  await frame.locator("#card").click();

  const inspector = page.locator(".style-workbench-layer .element-inspector");
  await expect(inspector).toContainText("正在调整");
  await expect(inspector.locator(".element-inspector__rules")).toHaveCount(0);
  await expect(inspector.locator(".css-teaching-controls__sliders label")).toHaveCount(3);

  await inspector.getByRole("button", { name: "在页面上标出来" }).click();
  await expect(frame.locator('[data-ai-tutor-overlay="box-padding"]')).toHaveCSS(
    "display",
    "block",
  );

  const paddingControl = inspector
    .locator(".css-teaching-controls__sliders label")
    .filter({ hasText: "里面留白" });
  await paddingControl.locator('input[type="range"]').fill("28");
  await expect(frame.locator("#card")).toHaveCSS("padding-top", "28px");

  await inspector.getByRole("button", { name: "恢复原样" }).click();
  await expect(frame.locator("#card")).toHaveCSS("padding-top", "12px");

  await paddingControl.locator('input[type="range"]').fill("30");
  await inspector.getByRole("button", { name: "保存这次变化" }).click();

  const comparison = page.locator(".comparison-runtime").last();
  await expect(comparison).toBeVisible({ timeout: 10_000 });
  const comparisonFrames = comparison.locator(".static-html-runtime-frame");
  await expect(comparisonFrames).toHaveCount(2);
  const beforeFrame = comparisonFrames.nth(0).contentFrame();
  const afterFrame = comparisonFrames.nth(1).contentFrame();
  await expect(beforeFrame.locator("#card")).toHaveCSS("padding-top", "12px");
  await expect(afterFrame.locator("#card")).toHaveCSS("padding-top", "30px");
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  await frame.locator("#card").click();
  await expect(inspector).toContainText("正在调整");
  await paddingControl.locator('input[type="range"]').fill("44");
  await expect(beforeFrame.locator("#card")).toHaveCSS("padding-top", "12px");
  await expect(afterFrame.locator("#card")).toHaveCSS("padding-top", "44px");
  await expect(
    comparison.getByText("修改后 · 未保存预览", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const stored = await page.evaluate(() =>
        localStorage.getItem("ai-tutor-p6-semantic-state-v1"),
      );
      if (!stored) return 0;
      const state = JSON.parse(stored) as {
        projects: [string, { revisions: unknown[] }][];
      };
      return state.projects[0]?.[1].revisions.length ?? 0;
    })
    .toBe(2);
  await inspector.getByRole("button", { name: "恢复原样" }).click();
  await expect(afterFrame.locator("#card")).toHaveCSS("padding-top", "30px");
  await expect(comparison.getByText("修改后", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "关闭样式调整" }).click();
  await expect(
    beforeFrame.locator('[data-ai-tutor-overlay="selected"]'),
  ).toHaveCSS("display", "block");
  await expect(
    afterFrame.locator('[data-ai-tutor-overlay="selected"]'),
  ).toHaveCSS("display", "block");
  const beforeMeasurement = comparison.getByLabel("修改前目标尺寸");
  const afterMeasurement = comparison.getByLabel("修改后目标尺寸");
  await expect(beforeMeasurement).toHaveText(/^\d+ × \d+ px$/);
  await expect(afterMeasurement).toHaveText(/^\d+ × \d+ px$/);
  expect(await beforeMeasurement.textContent()).not.toBe(
    await afterMeasurement.textContent(),
  );
  const focusedCenters = await Promise.all(
    [beforeFrame, afterFrame].map((comparisonFrame) =>
      comparisonFrame.locator("#card").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          target: rect.top + rect.height / 2,
          viewport: innerHeight / 2,
        };
      }),
    ),
  );
  for (const center of focusedCenters) {
    expect(Math.abs(center.target - center.viewport)).toBeLessThanOrEqual(2);
  }
  await comparison.getByRole("button", { name: "看整页" }).click();
  const pagePosition = comparison.getByRole("slider", { name: "整页同步位置" });
  await pagePosition.fill("50");
  await expect(beforeMeasurement).toBeHidden();
  await expect(afterMeasurement).toBeHidden();
  await expect(
    beforeFrame.locator('[data-ai-tutor-overlay="selected"]'),
  ).toHaveCSS("display", "none");
  const pageRatios = await Promise.all(
    [beforeFrame, afterFrame].map((comparisonFrame) =>
      comparisonFrame.locator("html").evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        const max = Math.max(0, root.scrollHeight - innerHeight);
        return max === 0 ? 0 : root.scrollTop / max;
      }),
    ),
  );
  expect(pageRatios[0]).toBeCloseTo(0.5, 1);
  expect(pageRatios[1]).toBeCloseTo(0.5, 1);
  await comparison.getByRole("button", { name: "看变化位置" }).click();
  await expect(beforeMeasurement).toBeVisible();
  await expect(afterMeasurement).toBeVisible();
  await page.getByRole("button", { name: "Move focus to canvas" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "回到内容" }).click();
  await expect(comparison).toBeVisible({ timeout: 10_000 });
  await comparison.getByRole("button", { name: "实验改动" }).click();
  await expect(
    comparison.getByLabel("实验样式差异（不是完整源码）"),
  ).toContainText(
    "padding: 30px",
  );
  await expect(comparison).toContainText("不是完整源码");
  await comparison.getByRole("button", { name: "完整源码" }).click();
  await expect(
    comparison.getByLabel("完整 HTML 和 CSS 源码差异"),
  ).toContainText("===== p5.html =====");
  await comparison.getByRole("button", { name: "揭示" }).click();
  const wipe = comparison.getByRole("slider", { name: "前后查看比例" });
  await wipe.fill("35");
  await expect(wipe).toHaveValue("35");
  await comparison.getByRole("button", { name: "看整页" }).click();
  await comparison.getByRole("button", { name: "看变化位置" }).click();
  await expect(wipe).toHaveValue("35");

  await expect
    .poll(async () => {
      const stored = await page.evaluate(() =>
        localStorage.getItem("ai-tutor-p6-semantic-state-v1"),
      );
      if (!stored) return null;
      const state = JSON.parse(stored) as {
        projects: [string, { revisions: CodeRevisionLike[] }][];
      };
      const revisions = state.projects[0]?.[1].revisions;
      return revisions
        ? {
            count: revisions.length,
            parent: revisions[1]?.parentRevisionId,
            originalCss:
              revisions[0]?.files["__ai_tutor_experiments.css"]?.content,
          }
        : null;
    })
    .toMatchObject({
      count: 2,
      parent: expect.stringMatching(/^revision-/),
      originalCss: undefined,
    });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "回到内容" }).click();
  await expect(runtime).toBeVisible();
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  // Chrome/Edge channels can mis-map a second synthesized pointer after the
  // tldraw viewport has been zoomed. The first pointer selection above covers
  // real hit-testing; these repeated selections isolate revision switching.
  await frame.locator("#card").dispatchEvent("click");
  const versionSelect = page.locator(
    ".style-workbench-layer .revision-controls > label select",
  );
  await versionSelect.selectOption({ index: 0 });
  await expect(frame.locator("#card")).toHaveCSS("padding-top", "12px");
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  await frame.locator("#card").dispatchEvent("click");
  await expect(inspector).toContainText("正在调整");
  await versionSelect.selectOption({ index: 1 });
  await expect(frame.locator("#card")).toHaveCSS("padding-top", "30px");
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  await frame.locator("#card").dispatchEvent("click");
  await expect(inspector).toContainText("正在调整");
  await page
    .locator(".style-workbench-layer")
    .getByRole("button", { name: "复制成新实验" })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const stored = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
        if (!stored) return 0;
        return (JSON.parse(stored) as { projects: unknown[] }).projects.length;
      }),
    )
    .toBe(2);

  await page.reload();
  const restoredComparison = page.locator(".comparison-runtime").last();
  await expect(restoredComparison).toBeVisible({ timeout: 10_000 });
  await expect(
    restoredComparison.getByRole("button", { name: "揭示" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    restoredComparison.getByRole("slider", { name: "前后查看比例" }),
  ).toHaveValue("35");
});

interface CodeRevisionLike {
  parentRevisionId: string | null;
  files: Record<string, { content: string }>;
}
