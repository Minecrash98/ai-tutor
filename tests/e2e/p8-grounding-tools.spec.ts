import { expect, test } from "@playwright/test";

test("grounds a causal Tutor explanation in selected browser facts, bounded source, and the saved student action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type MockWindow = typeof window & {
      __mockRealtimeSources?: Array<{
        onmessage: ((event: MessageEvent<string>) => void) | null;
      }>;
      __emitMockRealtime?: (
        event: Readonly<Record<string, unknown>>,
        id: number,
      ) => void;
    };
    const control = window as MockWindow;
    control.__mockRealtimeSources = [];

    class MockEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = String(url);
        control.__mockRealtimeSources!.push(this);
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }

      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    control.__emitMockRealtime = (event, id) => {
      for (const source of control.__mockRealtimeSources ?? []) {
        source.onmessage?.({
          data: JSON.stringify(event),
          lastEventId: String(id),
        } as MessageEvent<string>);
      }
    };
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: MockEventSource as unknown as typeof EventSource,
    });
  });

  const toolResults: Array<{
    requestId: string;
    body: { success: boolean; message: string };
  }> = [];
  await page.route("**/api/realtime/session", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fulfill({ status: 405, body: "" });
      return;
    }
    const input = request.postDataJSON() as { clientSessionId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: input.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "isolated-grounding-fixture",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/realtime/session/*/input", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/realtime/session/*/tools/*", async (route) => {
    const requestId = new URL(route.request().url()).pathname.split("/").at(-1)!;
    toolResults.push({
      requestId,
      body: route.request().postDataJSON() as {
        success: boolean;
        message: string;
      },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();

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

  const runnable = page
    .locator(".teaching-block--runnable")
    .filter({ hasText: "第一课 · 卡片为什么会变大？" });
  const runtime = runnable.locator(".teaching-block__runtime--live");
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  await runtime.getByRole("button", { name: "选择页面内容" }).click();
  await expect(
    runtime.getByRole("button", { name: "取消选择" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(100);
  await runtime
    .locator(".static-html-runtime-frame")
    .contentFrame()
    .locator("#demo")
    .click({ position: { x: 8, y: 8 } });
  await expect(
    page.getByRole("complementary", { name: "样式调整面板" }),
  ).toContainText("正在调整");

  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await expect(tutor.getByLabel("文字询问 CSS 问题")).toBeEnabled();
  await tutor
    .getByLabel("文字询问 CSS 问题")
    .fill("这张卡片刚才为什么变大？");
  await tutor.getByRole("button", { name: "发送" }).click();

  const emitTool = async (
    id: number,
    tool: string,
    argumentsValue: Readonly<Record<string, unknown>>,
  ) => {
    await page.evaluate(
      ({ eventId, toolName, args }) => {
        const control = window as typeof window & {
          __emitMockRealtime?: (
            event: Readonly<Record<string, unknown>>,
            id: number,
          ) => void;
        };
        control.__emitMockRealtime?.(
          {
            type: "tool_call",
            requestId: String(args.requestId),
            callId: `call-${eventId}`,
            tool: toolName,
            arguments: args,
            at: new Date().toISOString(),
          },
          eventId,
        );
      },
      { eventId: id, toolName: tool, args: argumentsValue },
    );
  };

  await emitTool(1, "read_canvas_state", {
    requestId: "ground-state",
  });
  await expect.poll(() => toolResults.length).toBe(1);
  expect(toolResults[0]?.body.success).toBe(true);
  const canvasState = JSON.parse(toolResults[0]!.body.message) as {
    runnableBlocks: Array<{ blockId: string }>;
    inspectionAvailableBlockIds: string[];
  };
  const blockId = canvasState.runnableBlocks[0]?.blockId;
  expect(blockId).toBeTruthy();
  expect(canvasState.inspectionAvailableBlockIds).toContain(blockId);

  await Promise.all([
    emitTool(2, "inspect_selected_element", {
      requestId: "ground-element",
      blockId,
    }),
    emitTool(3, "read_relevant_source", {
      requestId: "ground-source",
      blockId,
    }),
    emitTool(4, "read_last_student_action", {
      requestId: "ground-action",
    }),
    emitTool(5, "read_teaching_assertion_evidence", {
      requestId: "ground-assertion",
      blockId,
    }),
  ]);
  await expect.poll(() => toolResults.length).toBe(5);

  const result = (requestId: string) => {
    const item = toolResults.find(
      (candidate) => candidate.requestId === requestId,
    );
    expect(item?.body.success).toBe(true);
    return JSON.parse(item!.body.message) as Record<string, unknown>;
  };
  const element = result("ground-element") as {
    factType: string;
    revisionId: string;
    boxModel: { padding: { left: number } };
    matchedRules: Array<{ source: { filePath: string } }>;
  };
  expect(element.factType).toBe("selected-element");
  expect(element.boxModel.padding.left).toBe(32);
  expect(element.matchedRules.length).toBeGreaterThan(0);

  const source = result("ground-source") as {
    sourceTrust: string;
    maxCharacters: number;
    snippets: Array<{ content: string }>;
    truncated: boolean;
  };
  expect(source.sourceTrust).toBe("untrusted-student-content");
  expect(source.maxCharacters).toBe(4_000);
  expect(
    source.snippets.reduce((total, snippet) => total + snippet.content.length, 0),
  ).toBeLessThanOrEqual(4_000);

  const action = result("ground-action") as {
    action: {
      target: string;
      property: string;
      beforeValue: string;
      afterValue: string;
      transient: boolean;
      saved: boolean;
      revisionId: string;
      task: string;
    };
  };
  expect(action.action).toMatchObject({
    target: "#demo",
    property: "padding",
    beforeValue: "16px",
    afterValue: "32px",
    transient: false,
    saved: true,
    task: "observe",
  });
  expect(action.action.revisionId).toBe(element.revisionId);

  const assertion = result("ground-assertion") as {
    assertionAllowed: boolean;
    evidenceStatus: string;
    checks: {
      hasSavedAction: boolean;
      blockMatches: boolean;
      targetMatches: boolean;
      revisionMatches: boolean;
      hasBeforeAfter: boolean;
      hasMatchingRule: boolean;
    };
    beforeAfter: {
      property: string;
      beforeValue: string;
      afterValue: string;
    };
    relevantRules: unknown[];
  };
  expect(assertion.checks).toEqual({
    hasSavedAction: true,
    blockMatches: true,
    targetMatches: true,
    revisionMatches: true,
    hasBeforeAfter: true,
    hasMatchingRule: true,
  });
  expect(assertion).toMatchObject({
    assertionAllowed: true,
    evidenceStatus: "grounded",
    beforeAfter: {
      property: "padding",
      beforeValue: "16px",
      afterValue: "32px",
    },
  });
  expect(assertion.relevantRules.length).toBeGreaterThan(0);
  expect(JSON.stringify(assertion)).not.toContain(
    "当前版本，请重新选择后再读取",
  );

  await expect(
    tutor.getByText("查看这句话为什么成立", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const control = window as typeof window & {
      __emitMockRealtime?: (
        event: Readonly<Record<string, unknown>>,
        id: number,
      ) => void;
    };
    control.__emitMockRealtime?.(
      {
        type: "transcript",
        role: "assistant",
        text: "卡片变大，是因为你把 padding 从 16px 保存成了 32px。",
        final: true,
        at: new Date().toISOString(),
      },
      6,
    );
  });
  await expect(tutor.locator(".realtime-tutor__transcript")).toContainText(
    "padding 从 16px 保存成了 32px",
  );
});

test("blocks a causal Tutor claim when no matching fact receipt was produced", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type MockWindow = typeof window & {
      __mockRealtimeSources?: Array<{
        onmessage: ((event: MessageEvent<string>) => void) | null;
      }>;
      __emitMockRealtime?: (
        event: Readonly<Record<string, unknown>>,
        id: number,
      ) => void;
    };
    const control = window as MockWindow;
    control.__mockRealtimeSources = [];

    class MockEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = String(url);
        control.__mockRealtimeSources!.push(this);
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }

      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    control.__emitMockRealtime = (event, id) => {
      for (const source of control.__mockRealtimeSources ?? []) {
        source.onmessage?.({
          data: JSON.stringify(event),
          lastEventId: String(id),
        } as MessageEvent<string>);
      }
    };
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: MockEventSource as unknown as typeof EventSource,
    });
  });

  await page.route("**/api/realtime/session", async (route) => {
    const input = route.request().postDataJSON() as { clientSessionId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: input.clientSessionId,
        mode: "text",
        learningRecordEnabled: false,
        model: "isolated-causal-block-fixture",
        protocolVersion: "v3",
      }),
    });
  });
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/realtime/session/*/input", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByRole("button", { name: "开始文字问答" }).click();
  await tutor
    .getByLabel("文字询问 CSS 问题")
    .fill("这张卡片刚才为什么变大？");
  await tutor.getByRole("button", { name: "发送" }).click();

  await page.evaluate(() => {
    const control = window as typeof window & {
      __emitMockRealtime?: (
        event: Readonly<Record<string, unknown>>,
        id: number,
      ) => void;
    };
    control.__emitMockRealtime?.(
      {
        type: "transcript",
        role: "assistant",
        text: "它一定是因为浏览器自动加了 40px 外边距。",
        final: true,
        at: new Date().toISOString(),
      },
      1,
    );
  });

  const transcript = tutor.locator(".realtime-tutor__transcript");
  await expect(transcript).not.toContainText("浏览器自动加了 40px 外边距");
  await expect(transcript).toContainText(
    "还没有拿到能对应当前页面和版本的完整证据",
  );
});
