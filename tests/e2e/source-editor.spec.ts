import { expect, test } from "@playwright/test";

test("edits, safely runs, saves, restores, and compares full HTML/CSS versions", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles([
    {
      name: "index.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<!doctype html><html><body><main id="card"><h1>旧标题</h1></main></body></html>',
      ),
    },
    {
      name: "styles.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        'body { margin: 0; }\n#card {\n  color: rgb(180, 20, 20);\n  padding: 12px;\n}',
      ),
    },
    {
      name: "theme.css",
      mimeType: "text/css",
      buffer: Buffer.from('#card { background: rgb(240, 240, 220); }'),
    },
  ]);

  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "index.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 15_000,
  });
  const revisionCount = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
      if (!raw) return 0;
      const state = JSON.parse(raw) as {
        projects: [string, { revisions: unknown[] }][];
      };
      return state.projects[0]?.[1].revisions.length ?? 0;
    });
  await expect.poll(revisionCount).toBe(1);

  await runtime.getByRole("button", { name: "编辑 HTML/CSS" }).click();
  const editor = page.getByRole("dialog", { name: "编辑 HTML 和 CSS" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("navigation", { name: "源码文件" }).getByRole("button"))
    .toHaveCount(3);
  await expect(editor.getByRole("button", { name: "index.html" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "styles.css" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "theme.css" })).toBeVisible();
  await expect(editor.getByLabel("index.html 语法着色预览")).toBeVisible();

  const safeFrame = editor.locator(".source-editor__preview iframe").contentFrame();
  await expect(safeFrame.locator("#card h1")).toHaveText("旧标题", {
    timeout: 10_000,
  });
  await editor.getByRole("button", { name: "styles.css" }).click();
  const cssEditor = editor.getByLabel("编辑 styles.css");
  await cssEditor.fill(
    'body { margin: 0; }\n#card {\n  color: rgb(20, 120, 60);\n  padding: 24px;\n',
  );
  await editor.getByRole("button", { name: "运行修改" }).click();
  await expect(editor.getByRole("region", { name: "源码问题" })).toContainText(
    "styles.css · 第 2 行",
  );
  await expect(safeFrame.locator("#card h1")).toHaveText("旧标题");
  await expect(safeFrame.locator("#card")).toHaveCSS(
    "color",
    "rgb(180, 20, 20)",
  );
  expect(await revisionCount()).toBe(1);

  await cssEditor.fill(
    'body { margin: 0; }\n#card {\n  color: rgb(20, 120, 60);\n  padding: 24px;\n}',
  );
  await editor.getByRole("button", { name: "index.html" }).click();
  const htmlEditor = editor.getByLabel("编辑 index.html");
  await htmlEditor.fill(
    '<!doctype html><html><body><main id="card"><h1>新标题</h1><p>已安全运行</p></main></body></html>',
  );
  await editor.getByRole("button", { name: "运行修改" }).click();
  await expect(editor).toHaveAttribute("data-editor-status", "safe-preview", {
    timeout: 15_000,
  });
  await expect(safeFrame.locator("#card h1")).toHaveText("新标题");
  await expect(safeFrame.locator("#card")).toHaveCSS(
    "color",
    "rgb(20, 120, 60)",
  );
  expect(await revisionCount()).toBe(1);

  await htmlEditor.fill(`${await htmlEditor.inputValue()} `);
  await expect(editor.getByRole("button", { name: "保存为新版本" })).toBeDisabled();
  await editor.getByRole("button", { name: "运行修改" }).click();
  await expect(editor.getByRole("button", { name: "保存为新版本" })).toBeEnabled({
    timeout: 15_000,
  });
  await editor.getByLabel("版本说明").fill("更新标题和卡片样式");
  await editor.getByRole("button", { name: "保存为新版本" }).dblclick();
  await expect(editor).toBeHidden();
  await expect.poll(revisionCount).toBe(2);

  const currentFrame = runtime.locator(".static-html-runtime-frame").contentFrame();
  await expect(currentFrame.locator("#card h1")).toHaveText("新标题", {
    timeout: 15_000,
  });
  await expect(currentFrame.locator("#card")).toHaveCSS(
    "color",
    "rgb(20, 120, 60)",
  );
  const comparison = page.locator(".comparison-runtime").last();
  await expect(comparison.locator(".static-html-runtime-frame")).toHaveCount(2);
  await expect(
    comparison.locator(".static-html-runtime-frame").nth(0).contentFrame().locator("#card h1"),
  ).toHaveText("旧标题");
  await expect(
    comparison.locator(".static-html-runtime-frame").nth(1).contentFrame().locator("#card h1"),
  ).toHaveText("新标题");

  await page.reload();
  const restoredRuntime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "index.html" });
  await expect(restoredRuntime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 15_000,
  });
  const restoredFrame = restoredRuntime
    .locator(".static-html-runtime-frame")
    .contentFrame();
  await expect(restoredFrame.locator("#card h1")).toHaveText("新标题");

  await restoredRuntime.getByRole("button", { name: "选择页面内容" }).click();
  await restoredFrame.locator("#card").click();
  const versionSelect = page.locator(
    ".style-workbench-layer .revision-controls > label select",
  );
  await versionSelect.selectOption({ index: 0 });
  await expect(restoredFrame.locator("#card h1")).toHaveText("旧标题", {
    timeout: 15_000,
  });
  await expect(page.locator(".style-workbench-layer")).toBeHidden();
  await restoredRuntime
    .getByRole("button", { name: "选择页面内容" })
    .click();
  await restoredFrame.locator("#card").click();
  const restoredVersionSelect = page.locator(
    ".style-workbench-layer .revision-controls > label select",
  );
  await restoredVersionSelect.selectOption({ index: 1 });
  await expect(restoredFrame.locator("#card h1")).toHaveText("新标题", {
    timeout: 15_000,
  });
});

test("keeps a stale source draft as an explicit sibling branch", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor
    .getByRole("button", { name: "打开内容周围的空隙演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  const runnable = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "演示模式 · 卡片里的空间" });
  const runtime = runnable.locator(".teaching-block__runtime--live");
  await runtime.getByRole("button", { name: "编辑 HTML/CSS" }).click();
  const editor = page.getByRole("dialog", { name: "编辑 HTML 和 CSS" });
  const html = editor.getByLabel("编辑 index.html");
  await html.fill(
    (await html.inputValue()).replace(
      "</main>",
      "<strong id=\"branch-note\">我的源码分支</strong></main>",
    ),
  );
  await editor.getByRole("button", { name: "运行修改" }).click();
  await expect(editor).toHaveAttribute("data-editor-status", "safe-preview", {
    timeout: 15_000,
  });

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const slider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await slider.fill("44", { force: true });
  await slider.dispatchEvent("pointerup");
  const revisionCount = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
      if (!raw) return 0;
      const state = JSON.parse(raw) as {
        projects: [string, { revisions: unknown[] }][];
      };
      return state.projects[0]?.[1].revisions.length ?? 0;
    });
  await expect.poll(revisionCount).toBe(3);
  await expect(editor).toBeVisible();
  await editor.getByLabel("版本说明").fill("并发保留我的源码");
  await editor.getByRole("button", { name: "保存为新版本" }).click();
  await expect(editor).toBeHidden();
  await expect.poll(revisionCount).toBe(4);
  await expect(page.locator(".canvas-status__activity")).toContainText(
    "都已保留为分支",
  );

  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  await expect(frame.locator("#branch-note")).toHaveText("我的源码分支", {
    timeout: 15_000,
  });
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  await frame.locator("#demo").click();
  const versionSelect = page.locator(
    ".style-workbench-layer .revision-controls > label select",
  );
  await expect(versionSelect.locator("option")).toHaveCount(4);
  await expect(versionSelect.locator("option").last()).toContainText(
    "分支自 V2",
  );
});

test("preserves concurrent student and AI edits with one persistent AI receipt", async ({
  page,
}) => {
  test.setTimeout(60_000);
  let releaseTool!: () => void;
  const toolReady = new Promise<void>((resolve) => {
    releaseTool = resolve;
  });
  let toolResult: { success?: boolean; message?: string } | null = null;
  let eventStreams = 0;
  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const request = route.request().postDataJSON() as {
      clientSessionId: string;
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: request.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "branch-test",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/events", async (route) => {
    eventStreams += 1;
    await toolReady;
    const blockId = await page
      .locator(".teaching-block--runnable")
      .filter({ hasText: "演示模式 · 卡片里的空间" })
      .getAttribute("data-teaching-block-id");
    const events =
      eventStreams === 1
        ? [
            {
              type: "status",
              state: "connected",
              at: new Date().toISOString(),
            },
            {
              type: "tool_call",
              requestId: "tool-event-1",
              callId: "call-1",
              tool: "apply_css_change",
              arguments: {
                requestId: "ai-mutation-1",
                blockId,
                selector: "#demo",
                property: "padding",
                value: "48px",
                teachingAction: {
                  target: `${blockId} #demo`,
                  evidence: [
                    {
                      reference: "selected-element",
                      observation: "目标元素当前 padding 可读取",
                    },
                  ],
                  expectedStudentAction: "比较 AI 分支与自己的分支",
                  successCriterion: "两个不可变分支都保留",
                  hintLevel: 0,
                  feedback: {
                    observedBehavior: "学生已保存一个源码分支",
                    causalEvidence: "当前 revision 与目标 selector 已验证",
                    nextSmallestAction: "只创建一个 AI sibling 分支",
                  },
                },
              },
              at: new Date().toISOString(),
            },
          ]
        : [
            {
              type: "status",
              state: "connected",
              at: new Date().toISOString(),
            },
          ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `retry: 60000\n${events
        .map((event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
        .join("")}`,
    });
  });
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    }),
  );
  await page.route(
    /\/api\/realtime\/session\/[^/]+\/tools\/[^/]+$/,
    async (route) => {
      toolResult = route.request().postDataJSON() as {
        success?: boolean;
        message?: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{\"ok\":true}",
      });
    },
  );

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor
    .getByRole("button", { name: "打开内容周围的空隙演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  const runnable = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "演示模式 · 卡片里的空间" });
  const blockId = await runnable.getAttribute("data-teaching-block-id");
  expect(blockId).toBeTruthy();
  const runtime = runnable.locator(".teaching-block__runtime--live");
  await runtime.getByRole("button", { name: "编辑 HTML/CSS" }).click();
  const editor = page.getByRole("dialog", { name: "编辑 HTML 和 CSS" });
  const html = editor.getByLabel("编辑 index.html");
  await html.fill(
    (await html.inputValue()).replace(
      "</main>",
      "<strong id=\"student-branch\">学生保留的分支</strong></main>",
    ),
  );
  await editor.getByRole("button", { name: "运行修改" }).click();
  await expect(editor).toHaveAttribute("data-editor-status", "safe-preview", {
    timeout: 15_000,
  });

  releaseTool();
  await expect.poll(() => toolResult?.success ?? false).toBe(true);
  await editor.getByLabel("版本说明").fill("学生与 AI 同时修改");
  await editor.getByRole("button", { name: "保存为新版本" }).click();
  await expect(editor).toBeHidden();

  const branchState = await expect
    .poll(() =>
      page.evaluate((id) => {
        const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
        if (!raw) return null;
        const state = JSON.parse(raw) as {
          projects: [
            string,
            {
              currentRevisionId: string;
              revisions: Array<{
                id: string;
                parentRevisionId: string | null;
                authorType: string;
                mutationId?: string;
              }>;
            },
          ][];
          comparisons: [
            string,
            {
              sourceBlockId: string;
              beforeRevisionId: string;
              afterRevisionId: string;
            },
          ][];
        };
        const record = state.projects.find(([projectId]) => projectId === id)?.[1];
        if (!record || record.revisions.length !== 4) return null;
        const comparison = state.comparisons
          .map(([, value]) => value)
          .find((value) => value.sourceBlockId === id);
        return { record, comparison };
      }, blockId),
    )
    .not.toBeNull();
  void branchState;
  const persisted = await page.evaluate((id) => {
    const state = JSON.parse(
      localStorage.getItem("ai-tutor-p6-semantic-state-v1")!,
    ) as {
      projects: [
        string,
        {
          revisions: Array<{
            id: string;
            parentRevisionId: string | null;
            authorType: string;
            mutationId?: string;
          }>;
        },
      ][];
      comparisons: [
        string,
        {
          sourceBlockId: string;
          beforeRevisionId: string;
          afterRevisionId: string;
        },
      ][];
    };
    const record = state.projects.find(([projectId]) => projectId === id)![1];
    return {
      revisions: record.revisions,
      comparison: state.comparisons
        .map(([, value]) => value)
        .find((value) => value.sourceBlockId === id),
    };
  }, blockId);
  const aiRevision = persisted.revisions[2]!;
  const studentRevision = persisted.revisions[3]!;
  expect(aiRevision).toMatchObject({
    authorType: "ai",
    mutationId: "ai-mutation-1",
  });
  expect(studentRevision).toMatchObject({
    authorType: "user",
    parentRevisionId: aiRevision.parentRevisionId,
  });
  expect(persisted.comparison).toMatchObject({
    beforeRevisionId: aiRevision.id,
    afterRevisionId: studentRevision.id,
  });
  await expect(page.locator(".canvas-status__activity")).toContainText(
    "都已保留为分支",
  );

  await page.reload();
  const restored = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "演示模式 · 卡片里的空间" })
    .locator(".static-html-runtime-frame")
    .contentFrame();
  await expect(restored.locator("#student-branch")).toHaveText(
    "学生保留的分支",
    { timeout: 15_000 },
  );
});
