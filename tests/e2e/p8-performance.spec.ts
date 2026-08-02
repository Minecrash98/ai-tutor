import { expect, test } from "@playwright/test";

interface BrowserPerformanceMemory extends Performance {
  readonly memory?: {
    readonly usedJSHeapSize: number;
  };
}

function nearestRankP95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

test("stays responsive with 20 runtimes and 50 teaching blocks", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __p8LongTasks?: Array<{
        readonly startTime: number;
        readonly duration: number;
      }>;
      __p8PointerActive?: boolean;
      __p8PointerWindow?: {
        readonly startedAt: number;
        endedAt: number | null;
      };
      __p8PointerFrameIntervals?: number[];
      __p8WorkspacePuts?: Array<{
        readonly at: number;
        readonly pointerActive: boolean;
      }>;
    };
    state.__p8LongTasks = [];
    state.__p8WorkspacePuts = [];
    state.__p8PointerFrameIntervals = [];
    let previousPointerFrame: number | null = null;
    const samplePointerFrames = (now: number) => {
      if (state.__p8PointerActive === true) {
        if (previousPointerFrame !== null) {
          state.__p8PointerFrameIntervals?.push(now - previousPointerFrame);
        }
        previousPointerFrame = now;
      } else {
        previousPointerFrame = null;
      }
      requestAnimationFrame(samplePointerFrames);
    };
    requestAnimationFrame(samplePointerFrames);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, key) {
      if (
        this.name === "workspace-state" &&
        this.transaction.db.name === "ai-tutor-workspace" &&
        key === "latest"
      ) {
        state.__p8WorkspacePuts?.push({
          at: performance.now(),
          pointerActive: state.__p8PointerActive === true,
        });
      }
      return originalPut.call(this, value, key);
    };
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.__p8LongTasks?.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Long-task observation is optional; CDP metrics still provide a bound.
      }
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();

  const importDurations: number[] = [];
  const stressStartedAt = Date.now();
  const advanced = page.locator(".block-library__advanced");
  await advanced.locator("summary").click();
  const explanationButton = advanced.locator(
    ".block-library__list button",
  ).first();
  await expect(explanationButton).toBeEnabled();
  for (let index = 0; index < 30; index += 1) {
    await explanationButton.click();
  }
  for (let index = 0; index < 20; index += 1) {
    const startedAt = Date.now();
    await upload.setInputFiles([
      {
        name: `runtime-${index}.html`,
        mimeType: "text/html",
        buffer: Buffer.from(
          `<!doctype html><html><body><main id="card-${index}">runtime ${index}</main></body></html>`,
        ),
      },
      {
        name: `runtime-${index}.css`,
        mimeType: "text/css",
        buffer: Buffer.from(
          `body{margin:0;display:grid;place-items:center;min-height:100vh}#card-${index}{padding:${12 + index}px;border:2px solid #162219}`,
        ),
      },
    ]);
    await expect(page.locator(".canvas-metrics")).toContainText(
      `${index + 1}个实验`,
      { timeout: 15_000 },
    );
    const importedRuntime = page
      .locator(".teaching-block--runnable")
      .filter({ hasText: `导入 · runtime-${index}.html` });
    await expect(importedRuntime.locator("[data-runtime-status]")).toHaveAttribute(
      "data-runtime-status",
      "ready",
      { timeout: 15_000 },
    );
    importDurations.push(Date.now() - startedAt);
  }

  await expect(page.locator(".canvas-metrics")).toContainText("50个内容");
  await expect(page.locator(".canvas-metrics")).toContainText("20个实验");
  const setupReadyMs = Date.now() - stressStartedAt;
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "保持不变" }).click();
  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const paddingSlider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await expect(paddingSlider).toHaveValue("16");
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const state = window as typeof window & {
      __p8LongTasks?: Array<{
        readonly startTime: number;
        readonly duration: number;
      }>;
      __p8WorkspacePuts?: unknown[];
    };
    state.__p8LongTasks = [];
    state.__p8WorkspacePuts = [];
    performance.clearMeasures("ai-tutor:controller-preview");
  });

  const sliderBounds = await paddingSlider.boundingBox();
  if (!sliderBounds) throw new Error("padding slider has no browser bounds");
  const sliderY = sliderBounds.y + sliderBounds.height / 2;
  const minimum = Number(await paddingSlider.getAttribute("min"));
  const maximum = Number(await paddingSlider.getAttribute("max"));
  const positionForValue = (value: number) =>
    sliderBounds.x +
    4 +
    ((value - minimum) / (maximum - minimum)) * (sliderBounds.width - 8);
  const dragValues = [
    ...Array.from({ length: 16 }, (_, index) => index + 17),
    ...Array.from({ length: 16 }, (_, index) => 31 - index),
    ...Array.from({ length: 16 }, (_, index) => index + 17),
  ];
  await page.mouse.move(positionForValue(16), sliderY);
  await page.evaluate(() => {
    const state = window as typeof window & {
      __p8PointerActive?: boolean;
      __p8PointerWindow?: {
        readonly startedAt: number;
        endedAt: number | null;
      };
    };
    state.__p8PointerActive = true;
    state.__p8PointerWindow = {
      startedAt: performance.now(),
      endedAt: null,
    };
  });
  await page.mouse.down();
  for (const value of dragValues) {
    await page.mouse.move(positionForValue(value), sliderY);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        }),
    );
  }
  await page.mouse.up();
  await page.evaluate(() => {
    const state = window as typeof window & {
      __p8PointerActive?: boolean;
      __p8PointerWindow?: {
        readonly startedAt: number;
        endedAt: number | null;
      };
    };
    state.__p8PointerActive = false;
    if (state.__p8PointerWindow) {
      state.__p8PointerWindow.endedAt = performance.now();
    }
  });
  await expect(controller).toContainText("已保存", { timeout: 15_000 });
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
  );
  await page.waitForTimeout(650);
  const interactionMetrics = await page.evaluate(() => {
    const state = window as typeof window & {
      __p8LongTasks?: Array<{
        readonly startTime: number;
        readonly duration: number;
      }>;
      __p8PointerWindow?: {
        readonly startedAt: number;
        readonly endedAt: number | null;
      };
      __p8WorkspacePuts?: Array<{
        readonly at: number;
        readonly pointerActive: boolean;
      }>;
      __p8PointerFrameIntervals?: number[];
    };
    return {
      longTasks: state.__p8LongTasks ?? [],
      pointerWindow: state.__p8PointerWindow ?? null,
      previewLatencies: performance
        .getEntriesByName("ai-tutor:controller-preview")
        .map((entry) => entry.duration),
      workspacePuts: state.__p8WorkspacePuts ?? [],
      pointerFrameIntervals: state.__p8PointerFrameIntervals ?? [],
    };
  });
  expect(interactionMetrics.previewLatencies.length).toBeGreaterThanOrEqual(30);
  expect(
    nearestRankP95(interactionMetrics.previewLatencies),
  ).toBeLessThanOrEqual(50);
  const pointerLongTasks = interactionMetrics.longTasks.filter(
    (entry) =>
      entry.duration > 50 &&
      interactionMetrics.pointerWindow !== null &&
      interactionMetrics.pointerWindow.endedAt !== null &&
      entry.startTime >= interactionMetrics.pointerWindow.startedAt &&
      entry.startTime <= interactionMetrics.pointerWindow.endedAt,
  );
  console.log(
    `P8_POINTER_FRAME_EVIDENCE=${JSON.stringify({
      samples: interactionMetrics.pointerFrameIntervals.length,
      p95Ms: nearestRankP95(interactionMetrics.pointerFrameIntervals),
      maxMs: Math.max(...interactionMetrics.pointerFrameIntervals),
      over20Ms: interactionMetrics.pointerFrameIntervals.filter(
        (duration) => duration > 20,
      ).length,
      pointerLongTasks,
    })}`,
  );
  expect(pointerLongTasks).toEqual([]);
  expect(
    interactionMetrics.workspacePuts.filter((entry) => entry.pointerActive),
  ).toEqual([]);
  expect(interactionMetrics.workspacePuts).toHaveLength(1);
  expect(interactionMetrics.pointerFrameIntervals.length).toBeGreaterThanOrEqual(
    30,
  );

  const frameIntervals = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const intervals: number[] = [];
        let previous = performance.now();
        const sample = (now: number) => {
          intervals.push(now - previous);
          previous = now;
          if (intervals.length >= 120) {
            resolve(intervals.slice(1));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const browserMetrics = await page.evaluate(() => {
    const state = window as typeof window & {
      __p8LongTasks?: Array<{
        readonly startTime: number;
        readonly duration: number;
      }>;
    };
    const serializedStorageBytes = Object.entries(localStorage).reduce(
      (total, [key, value]) => total + key.length + value.length,
      0,
    );
    return {
      domNodes: document.querySelectorAll("*").length,
      heapBytes:
        (performance as BrowserPerformanceMemory).memory?.usedJSHeapSize ??
        null,
      longTasks: state.__p8LongTasks ?? [],
      serializedStorageBytes,
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const cdpResult = await cdp.send("Performance.getMetrics");
  const cdpMetrics = Object.fromEntries(
    cdpResult.metrics.map((metric) => [metric.name, metric.value]),
  );
  await cdp.detach();

  const firstReadyMs = setupReadyMs;
  const teachingBlockCountBeforeReload = Number.parseInt(
    (await page
      .locator(".canvas-metrics > span")
      .first()
      .locator("strong")
      .textContent()) ?? "0",
    10,
  );
  const persistedRuntimeCount = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("ai-tutor-p6-semantic-state-v1");
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as {
        projects?: unknown[];
      };
      return Array.isArray(parsed.projects) ? parsed.projects.length : 0;
    });
  const runtimeCountBeforeReload = await persistedRuntimeCount();
  expect(teachingBlockCountBeforeReload).toBeGreaterThanOrEqual(50);
  expect(runtimeCountBeforeReload).toBeGreaterThanOrEqual(20);
  const beforeReload = Date.now();
  await page.reload();
  await expect(page.locator(".canvas-metrics")).toContainText(
    teachingBlockCountBeforeReload + "个内容",
    { timeout: 15_000 },
  );
  await expect(page.locator(".canvas-metrics")).toContainText(
    runtimeCountBeforeReload + "个实验",
    { timeout: 20_000 },
  );
  await expect.poll(persistedRuntimeCount).toBe(runtimeCountBeforeReload);
  await expect(
    page.locator('[data-runtime-status="ready"]').first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page
      .getByRole("region", { name: "一分钟盒模型课" })
      .locator("[data-lesson-phase]"),
  ).toHaveAttribute("data-lesson-phase", "explain");
  const reloadRecoveryMs = Date.now() - beforeReload;

  const evidence = {
    scenario: {
      minimumRuntimes: 20,
      minimumTeachingBlocks: 50,
      observedRuntimes: runtimeCountBeforeReload,
      observedTeachingBlocks: teachingBlockCountBeforeReload,
    },
    budgets: {
      importP95Ms: 3_000,
      totalSetupMs: 30_000,
      reloadRecoveryMs: 20_000,
      rafP95Ms: 18.5,
      rafMaxMs: 250,
      heapBytes: 300 * 1024 * 1024,
      domNodes: 20_000,
      longestTaskMs: 750,
      serializedStorageBytes: 10 * 1024 * 1024,
      interactionPreviewP95Ms: 50,
      interactionPreviewMinimumSamples: 30,
      interactionPointerFrameP95Ms: 18.5,
      interactionLongTasksOver50Ms: 0,
      interactionWorkspacePuts: 1,
    },
    actual: {
      importP95Ms: nearestRankP95(importDurations),
      totalSetupMs: firstReadyMs,
      reloadRecoveryMs,
      rafP95Ms: nearestRankP95(frameIntervals),
      rafMaxMs: Math.max(...frameIntervals),
      heapBytes:
        browserMetrics.heapBytes ??
        Math.round(cdpMetrics.JSHeapUsedSize ?? 0),
      domNodes: Math.round(cdpMetrics.Nodes ?? browserMetrics.domNodes),
      longestTaskMs: Math.max(
        0,
        ...browserMetrics.longTasks.map((entry) => entry.duration),
      ),
      longTaskCount: browserMetrics.longTasks.length,
      serializedStorageBytes: browserMetrics.serializedStorageBytes,
      interactionPreviewSamples: interactionMetrics.previewLatencies.length,
      interactionPreviewP95Ms: nearestRankP95(
        interactionMetrics.previewLatencies,
      ),
      interactionPreviewMaxMs: Math.max(
        ...interactionMetrics.previewLatencies,
      ),
      interactionPointerFrameSamples:
        interactionMetrics.pointerFrameIntervals.length,
      interactionPointerFrameP95Ms: nearestRankP95(
        interactionMetrics.pointerFrameIntervals,
      ),
      interactionLongTasksOver50Ms: pointerLongTasks.length,
      interactionWorkspacePuts: interactionMetrics.workspacePuts.length,
    },
  };
  console.log(`P8_PERFORMANCE_EVIDENCE=${JSON.stringify(evidence)}`);

  expect(evidence.actual.importP95Ms).toBeLessThanOrEqual(
    evidence.budgets.importP95Ms,
  );
  expect(evidence.actual.totalSetupMs).toBeLessThanOrEqual(
    evidence.budgets.totalSetupMs,
  );
  expect(evidence.actual.reloadRecoveryMs).toBeLessThanOrEqual(
    evidence.budgets.reloadRecoveryMs,
  );
  expect(evidence.actual.rafP95Ms).toBeLessThanOrEqual(
    evidence.budgets.rafP95Ms,
  );
  expect(evidence.actual.rafMaxMs).toBeLessThanOrEqual(
    evidence.budgets.rafMaxMs,
  );
  expect(evidence.actual.heapBytes).toBeLessThanOrEqual(
    evidence.budgets.heapBytes,
  );
  expect(evidence.actual.domNodes).toBeLessThanOrEqual(
    evidence.budgets.domNodes,
  );
  expect(evidence.actual.longestTaskMs).toBeLessThanOrEqual(
    evidence.budgets.longestTaskMs,
  );
  expect(evidence.actual.serializedStorageBytes).toBeLessThanOrEqual(
    evidence.budgets.serializedStorageBytes,
  );
  expect(evidence.actual.interactionPointerFrameP95Ms).toBeLessThanOrEqual(
    evidence.budgets.interactionPointerFrameP95Ms,
  );
});
