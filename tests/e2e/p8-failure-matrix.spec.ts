import { expect, test, type Page } from "@playwright/test";

const SNAPSHOT_KEY = "ai-tutor-p8-canvas-snapshot-v1";
const SEMANTIC_KEY = "ai-tutor-p6-semantic-state-v1";

async function startBoxDemo(page: Page) {
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor
    .getByRole("button", { name: "打开内容周围的空隙演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  return tutor;
}

test("keeps the local demo usable when browser storage quota is exhausted", async ({
  page,
}) => {
  await page.addInitScript(
    ({ keys }) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (keys.includes(key)) {
          throw new DOMException("Injected quota exhaustion", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function put(value, key) {
        if (key === "latest") {
          throw new DOMException("Injected quota exhaustion", "QuotaExceededError");
        }
        return originalPut.call(this, value, key);
      };
    },
    { keys: [SNAPSHOT_KEY, SEMANTIC_KEY] },
  );
  await page.goto("/");
  await startBoxDemo(page);

  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
  await expect(page.locator(".canvas-status")).toContainText(
    /设备(?:保存)?空间不足/,
  );
  await expect(
    page.locator(".teaching-block--runnable").filter({
      hasText: "演示模式 · 卡片里的空间",
    }),
  ).toBeVisible();
});

test("rolls back an unsaved revision when IndexedDB aborts asynchronously", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, key) {
      const request = originalPut.call(this, value, key);
      const control = window as typeof window & {
        __abortNextWorkspacePut?: boolean;
        __workspaceAbortCount?: number;
      };
      if (
        this.name === "workspace-state" &&
        this.transaction.db.name === "ai-tutor-workspace" &&
        key === "latest" &&
        control.__abortNextWorkspacePut
      ) {
        control.__abortNextWorkspacePut = false;
        const transaction = this.transaction;
        transaction.addEventListener(
          "abort",
          () => {
            control.__workspaceAbortCount =
              (control.__workspaceAbortCount ?? 0) + 1;
          },
          { once: true },
        );
        request.addEventListener("success", () => {
          transaction.abort();
        }, { once: true });
      }
      return request;
    };
  });
  await page.route("**/api/learning/**", (route) => route.abort("failed"));
  await page.goto("/");

  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "observe",
  );

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const slider = controller.getByRole("slider", { name: "padding 控制器" });
  const durableProject = () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ai-tutor-workspace", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = await new Promise<
        { semanticState: string } | undefined
      >(
        (resolve, reject) => {
          const request = database
            .transaction("workspace-state", "readonly")
            .objectStore("workspace-state")
            .get("latest");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      if (!stored) return null;
      const semantic = JSON.parse(stored.semanticState) as {
        projects: Array<[
          string,
          {
            currentRevisionId: string;
            revisions: Array<{ id: string }>;
          },
        ]>;
      };
      const record = semantic.projects[0]?.[1];
      return record
        ? {
            currentRevisionId: record.currentRevisionId,
            revisionCount: record.revisions.length,
          }
        : null;
    });
  const experimentEventCount = () =>
    page.evaluate(() => {
      const indexRaw = localStorage.getItem(
        "ai-tutor-learning-proof-index-v2",
      );
      if (!indexRaw) return 0;
      const sessionId = (JSON.parse(indexRaw) as { activeSessionId: string })
        .activeSessionId;
      const raw = localStorage.getItem(
        "ai-tutor-learning-proof-session-v2:" + sessionId,
      );
      if (!raw) return 0;
      const events = (
        JSON.parse(raw) as {
          payload?: { events?: Array<{ type?: string }> };
        }
      ).payload?.events;
      return (
        events?.filter((event) => event.type === "experiment-saved").length ??
        0
      );
    });

  await expect(slider).toHaveValue("16");
  await expect.poll(durableProject, { timeout: 15_000 }).toMatchObject({
    revisionCount: 1,
    currentRevisionId: expect.any(String),
  });
  const baseProject = await durableProject();
  await slider.fill("32");
  await slider.focus();
  await page.evaluate(() => {
    (
      window as typeof window & { __abortNextWorkspacePut?: boolean }
    ).__abortNextWorkspacePut = true;
  });
  await page.keyboard.press("Tab");

  await expect(controller).toContainText(
    "这次变化没能写进设备，页面已恢复到上次保存的样子",
    { timeout: 15_000 },
  );
  await expect(slider).toHaveValue("16");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "observe",
  );
  await expect(page.locator(".teaching-block--comparison")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __workspaceAbortCount?: number }
          ).__workspaceAbortCount ?? 0,
      ),
    )
    .toBe(1);
  await expect.poll(durableProject, { timeout: 15_000 }).toEqual(baseProject);
  await expect.poll(experimentEventCount).toBe(0);

  await page.reload();
  const restoredLesson = page.getByRole("region", {
    name: "一分钟盒模型课",
  });
  const restoredController = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const restoredSlider = restoredController.getByRole("slider", {
    name: "padding 控制器",
  });
  await expect(restoredLesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "observe",
  );
  await expect(restoredSlider).toHaveValue("16");
  await expect.poll(durableProject, { timeout: 15_000 }).toEqual(baseProject);
  await expect.poll(experimentEventCount).toBe(0);

  await restoredSlider.fill("32");
  await restoredSlider.focus();
  await page.keyboard.press("Tab");
  await expect(restoredController).toContainText("已保存", {
    timeout: 15_000,
  });
  await expect(restoredLesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
  );
  await expect.poll(experimentEventCount).toBe(1);
  await expect.poll(durableProject, { timeout: 15_000 }).toMatchObject({
    revisionCount: 2,
    currentRevisionId: expect.any(String),
  });
  await expect(page.locator(".teaching-block--comparison")).toHaveCount(1);
});

test("preserves a damaged legacy snapshot and offers its original rescue data", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(key, "{this-is-not-json");
    },
    { key: SNAPSHOT_KEY },
  );
  await page.goto("/");

  const rescue = page.getByRole("alert", { name: "设备记录需要抢救" });
  await expect(rescue).toBeVisible();
  await expect(page.locator(".canvas-status")).toContainText(
    "原文没有被覆盖",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    rescue.getByRole("button", { name: "下载原始救援包" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^ai-tutor-workspace-rescue-.*\.json$/,
  );
  expect(
    await page.evaluate(
      ({ key }) => localStorage.getItem(key),
      { key: SNAPSHOT_KEY },
    ),
  ).toBe("{this-is-not-json");
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeEnabled();
  await expect(page.locator(".teaching-block")).toHaveCount(0);
});

test("restores from the atomic workspace when a legacy mirror write fails", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(name, value) {
        if (name === key) {
          throw new DOMException("Injected mirror failure", "QuotaExceededError");
        }
        return original.call(this, name, value);
      };
    },
    { key: SEMANTIC_KEY },
  );
  await page.goto("/");
  await startBoxDemo(page);
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator(".teaching-block--runnable").filter({
      hasText: "演示模式 · 卡片里的空间",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
});

test("restores runnable content and its saved project after clear then undo", async ({
  page,
}) => {
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: "undo-recovery.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!doctype html><html><body><main id="restored">undo recovery</main></body></html>',
    ),
  });
  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "undo-recovery.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(page.locator(".teaching-block")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  await expect(runtime.locator(".static-html-runtime-frame").contentFrame().locator("#restored"))
    .toHaveText("undo recovery");

  await page.waitForTimeout(750);
  await page.reload();
  const restoredRuntime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "undo-recovery.html" });
  await expect(restoredRuntime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 15_000,
  });
  await expect(
    restoredRuntime.locator(".static-html-runtime-frame").contentFrame().locator("#restored"),
  ).toHaveText("undo recovery");
});

test("restores a near-10MB imported project with multiple immutable revisions", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const upload = page.getByLabel("上传静态 HTML 和 CSS 文件");
  await expect(upload).toBeEnabled();
  const binaryBytes = 1_850_000;
  await upload.setInputFiles([
    {
      name: "large-project.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<!doctype html><html><body><main id="large-card">large recovery</main></body></html>',
      ),
    },
    {
      name: "large-project.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        "#large-card{width:280px;padding:20px;border:4px solid #171912}",
      ),
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `unused-asset-${index}.png`,
      mimeType: "image/png",
      buffer: Buffer.alloc(binaryBytes, index + 1),
    })),
  ]);
  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "large-project.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 20_000,
  });
  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  const durableRevisionCount = () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ai-tutor-workspace", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = await new Promise<
        { semanticState: string } | undefined
      >(
        (resolve, reject) => {
          const request = database
            .transaction("workspace-state", "readonly")
            .objectStore("workspace-state")
            .get("latest");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      if (!stored) return 0;
      const semantic = JSON.parse(stored.semanticState) as {
        projects: Array<[
          string,
          {
            revisions: Array<{
              files: Record<string, { content: string }>;
            }>;
          },
        ]>;
      };
      return (
        semantic.projects.find(([, value]) =>
          Object.hasOwn(value.revisions[0]?.files ?? {}, "large-project.html"),
        )?.[1].revisions.length ?? 0
      );
    });
  const inspector = page.getByRole("complementary", { name: "样式调整面板" });
  const padding = inspector
    .locator(".css-teaching-controls__sliders label")
    .filter({ hasText: "里面留白" })
    .locator('input[type="range"]');

  await expect.poll(durableRevisionCount, { timeout: 30_000 }).toBe(1);
  for (const [index, value] of [28, 36].entries()) {
    const selectContent = runtime.getByRole("button", { name: "选择页面内容" });
    await selectContent.click();
    await expect(
      runtime.getByRole("button", { name: "取消选择", exact: true }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await frame.locator("#large-card").click();
    await expect(inspector).toBeVisible({ timeout: 20_000 });
    await padding.fill(String(value));
    await inspector.getByRole("button", { name: "保存这次变化" }).click();
    await expect
      .poll(durableRevisionCount, { timeout: 30_000 })
      .toBe(index + 2);
    await expect(frame.locator("#large-card")).toHaveCSS(
      "padding-top",
      `${value}px`,
      { timeout: 30_000 },
    );
  }

  const durableSummary = () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ai-tutor-workspace", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = await new Promise<{ semanticState: string }>(
        (resolve, reject) => {
          const request = database
            .transaction("workspace-state", "readonly")
            .objectStore("workspace-state")
            .get("latest");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      const semantic = JSON.parse(stored.semanticState) as {
        projects: Array<[
          string,
          {
            currentRevisionId: string;
            revisions: Array<{
              id: string;
              contentHash: string;
              files: Record<string, { content: string }>;
            }>;
          },
        ]>;
      };
      const project = semantic.projects.find(([, value]) =>
        Object.hasOwn(value.revisions[0]?.files ?? {}, "large-project.html"),
      )?.[1];
      return project
        ? {
            revisionCount: project.revisions.length,
            currentRevisionId: project.currentRevisionId,
            baseHash: project.revisions[0]?.contentHash,
            binaryCharacters: Object.entries(project.revisions[0]?.files ?? {})
              .filter(([name]) => name.endsWith(".png"))
              .reduce((sum, [, file]) => sum + file.content.length, 0),
          }
        : null;
    });
  await expect.poll(durableSummary, { timeout: 30_000 }).toMatchObject({
    revisionCount: 3,
    currentRevisionId: expect.any(String),
    baseHash: expect.any(String),
    binaryCharacters: expect.any(Number),
  });
  const beforeReload = await durableSummary();
  expect(beforeReload?.binaryCharacters ?? 0).toBeGreaterThan(12_000_000);

  await page.reload();
  const restored = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "large-project.html" });
  await expect(restored).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 30_000,
  });
  await expect(
    restored.locator(".static-html-runtime-frame").contentFrame().locator("#large-card"),
  ).toHaveCSS("padding-top", "36px");
  await expect.poll(durableSummary, { timeout: 30_000 }).toEqual(beforeReload);
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
});

test("blocks overwrite on an IndexedDB checksum mismatch until the student resets it", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ai-tutor-workspace", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("workspace-state")) {
          request.result.createObjectStore("workspace-state");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("workspace-state", "readwrite");
      transaction.objectStore("workspace-state").put(
        {
          version: 2,
          revisionId: "damaged-revision",
          savedAt: "2026-08-02T12:00:00.000Z",
          writerId: "damaged-writer",
          canvasSnapshot: { document: { store: {} }, session: {} },
          semanticState: "{\"version\":1,\"projects\":[],\"comparisons\":[]}",
          checksum: "not-the-real-checksum",
        },
        "latest",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();

  const rescue = page.getByRole("alert", { name: "设备记录需要抢救" });
  await expect(rescue).toBeVisible();
  await expect(page.locator(".canvas-status")).toContainText("校验失败");
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ai-tutor-workspace", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const checksum = await new Promise<string>((resolve, reject) => {
        const request = database
          .transaction("workspace-state", "readonly")
          .objectStore("workspace-state")
          .get("latest");
        request.onsuccess = () =>
          resolve((request.result as { checksum: string }).checksum);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return checksum;
    }),
  ).toBe("not-the-real-checksum");
  await rescue
    .getByRole("button", { name: "我已保存救援包，开始新记录" })
    .click();
  await expect(rescue).toBeHidden();
  await expect(
    page.getByRole("button", { name: "开始一分钟盒模型课" }),
  ).toBeEnabled();
});

test("warns a second tab and does not overwrite the newer tab on pagehide", async ({
  context,
  page,
}) => {
  const secondTab = await context.newPage();
  await Promise.all([page.goto("/"), secondTab.goto("/")]);
  await startBoxDemo(page);

  await expect(secondTab.locator(".canvas-status")).toContainText(
    "另一个标签页刚更新了画布",
  );
  const latestBeforeClose = await page.evaluate(
    ({ key }) => localStorage.getItem(key),
    { key: SNAPSHOT_KEY },
  );
  expect(latestBeforeClose).not.toBeNull();

  await secondTab.close();
  await expect
    .poll(() =>
      page.evaluate(
        ({ key }) => localStorage.getItem(key),
        { key: SNAPSHOT_KEY },
      ),
    )
    .toBe(latestBeforeClose);
});

test("falls back to the local demo while the browser is offline without touching the microphone", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          const state = window as typeof window & { __microphoneCalls?: number };
          state.__microphoneCalls = (state.__microphoneCalls ?? 0) + 1;
          return Promise.reject(new Error("physical microphone must not run"));
        },
      },
    });
  });
  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await expect(
    tutor.getByRole("button", { name: "开始语音讲解" }),
  ).toBeDisabled();
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await expect(
    tutor.getByRole("button", { name: "开始语音讲解" }),
  ).toBeEnabled();
  await context.setOffline(true);
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect(tutor.getByRole("alert")).toBeVisible();
  await expect(tutor.getByRole("alert")).toContainText("没有改动你的内容");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls ?? 0,
    ),
  ).toBe(0);

  await startBoxDemo(page);
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
  await context.setOffline(false);
});
