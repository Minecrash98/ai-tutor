import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface PerformanceMemory extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

interface RafMinuteBucket {
  minute: number;
  count: number;
  totalMs: number;
  maxMs: number;
  over50Ms: number;
}

interface SoakWindow extends Window {
  __soakLongTasks?: number[];
  __soakRafIntervals?: number[];
  __soakRafMinuteBuckets?: RafMinuteBucket[];
  __soakMicrophoneCalls?: number;
}

function nearestRank(values: readonly number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? 0
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function maximum(values: readonly number[]): number {
  return values.reduce(
    (current, value) => (value > current ? value : current),
    0,
  );
}

test("holds 20 runtimes and 50 blocks for the qualified duration", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    process.env.AI_TUTOR_RUN_SOAK !== "1",
    "30-minute stability evidence is opt-in",
  );
  const durationMs = Number(
    process.env.AI_TUTOR_SOAK_DURATION_MS ?? 1_800_000,
  );
  const qualification = durationMs >= 1_800_000;
  const runId =
    process.env.AI_TUTOR_SOAK_RUN_ID ??
    new Date().toISOString().replace(/[:.]/g, "-");
  test.setTimeout(durationMs + 180_000);

  await page.addInitScript(() => {
    const state = window as SoakWindow;
    state.__soakLongTasks = [];
    state.__soakRafIntervals = [];
    state.__soakRafMinuteBuckets = [];
    state.__soakMicrophoneCalls = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          state.__soakMicrophoneCalls =
            (state.__soakMicrophoneCalls ?? 0) + 1;
          return Promise.reject(new Error("physical microphone is forbidden"));
        },
      },
    });
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const tasks = state.__soakLongTasks ?? [];
          for (const entry of list.getEntries()) tasks.push(entry.duration);
          state.__soakLongTasks = tasks;
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // CDP metrics still provide the primary memory and DOM samples.
      }
    }
    let previous = performance.now();
    const sample = (now: number) => {
      const interval = now - previous;
      const intervals = state.__soakRafIntervals ?? [];
      intervals.push(interval);
      state.__soakRafIntervals = intervals;
      const minute = Math.floor(now / 60_000);
      const buckets = state.__soakRafMinuteBuckets ?? [];
      const bucket = buckets[minute] ?? {
        minute,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        over50Ms: 0,
      };
      bucket.count += 1;
      bucket.totalMs += interval;
      bucket.maxMs = Math.max(bucket.maxMs, interval);
      if (interval > 50) bucket.over50Ms += 1;
      buckets[minute] = bucket;
      state.__soakRafMinuteBuckets = buckets;
      previous = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const localRequestFailures: string[] = [];
  const localHttpErrors: string[] = [];
  const soakOrigin = new URL(
    process.env.AI_TUTOR_SOAK_BASE_URL ?? "http://127.0.0.1:3000",
  ).origin;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(soakOrigin)) {
      localRequestFailures.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      );
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(soakOrigin) && response.status() >= 400) {
      localHttpErrors.push(
        `${response.request().method()} ${response.url()} HTTP ${response.status()}`,
      );
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect((await health.json()).database).toMatchObject({
    configured: true,
    ready: true,
  });

  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByLabel("教学主题").selectOption("box-model");
  await tutor
    .getByRole("button", { name: "打开内容周围的空隙演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );

  const upload = page.locator('input[type="file"]');
  for (let index = 0; index < 19; index += 1) {
    await upload.setInputFiles([
      {
        name: `soak-${index}.html`,
        mimeType: "text/html",
        buffer: Buffer.from(
          `<!doctype html><html><body><main id="card-${index}">runtime ${index}</main></body></html>`,
        ),
      },
      {
        name: `soak-${index}.css`,
        mimeType: "text/css",
        buffer: Buffer.from(
          `body{margin:0;display:grid;place-items:center;min-height:100vh}#card-${index}{padding:${12 + index}px;border:2px solid #162219}`,
        ),
      },
    ]);
    await expect(page.locator('[data-runtime-status="ready"]')).toHaveCount(
      index + 4,
      { timeout: 10_000 },
    );
  }

  const advanced = page.locator(".block-library__advanced");
  await advanced.locator("summary").click();
  const explanationButton = advanced
    .locator(".block-library__list button")
    .first();
  for (let index = 0; index < 27; index += 1) {
    await explanationButton.click();
  }
  await expect(page.locator(".canvas-metrics")).toContainText("50个内容");
  await expect(page.locator(".canvas-metrics")).toContainText("20个实验");

  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const slider = controller.getByRole("slider", {
    name: "padding 控制器",
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const samples: Array<{
    elapsedMs: number;
    heapBytes: number;
    nodes: number;
    listeners: number;
    documents: number;
    storageBytes: number;
    health: string;
  }> = [];
  const collect = async (elapsedMs: number) => {
    await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
    const metrics = await cdp.send("Performance.getMetrics");
    const values = Object.fromEntries(
      metrics.metrics.map((metric) => [metric.name, metric.value]),
    );
    const local = await page.evaluate(() => ({
      heapBytes:
        (performance as PerformanceMemory).memory?.usedJSHeapSize ?? null,
      storageBytes: Object.entries(localStorage).reduce(
        (total, [key, value]) => total + key.length + value.length,
        0,
      ),
    }));
    const response = await page.request.get("/api/health");
    samples.push({
      elapsedMs,
      heapBytes: Math.round(local.heapBytes ?? values.JSHeapUsedSize ?? 0),
      nodes: Math.round(values.Nodes ?? 0),
      listeners: Math.round(values.JSEventListeners ?? 0),
      documents: Math.round(values.Documents ?? 0),
      storageBytes: local.storageBytes,
      health: response.ok()
        ? ((await response.json()) as { status: string }).status
        : `http-${response.status()}`,
    });
    console.log(
      `P8_SOAK_PROGRESS=${JSON.stringify(samples.at(-1))}`,
    );
  };

  const startedAt = Date.now();
  let interaction = 0;
  const interactionLatenciesMs: number[] = [];
  let nextSampleAt = startedAt;
  await collect(0);
  while (Date.now() - startedAt < durationMs) {
    interaction += 1;
    const value = interaction % 2 === 1 ? "28" : "36";
    const interactionStartedAt = performance.now();
    await slider.fill(value);
    await expect(controller.locator("small")).toContainText("正在", {
      timeout: 2_000,
    });
    await slider.focus();
    await slider.press("Tab");
    await expect(controller).toContainText("已保存", { timeout: 10_000 });
    interactionLatenciesMs.push(performance.now() - interactionStartedAt);
    await page.waitForTimeout(
      Math.min(15_000, Math.max(0, durationMs - (Date.now() - startedAt))),
    );
    if (Date.now() >= nextSampleAt + 60_000) {
      nextSampleAt += 60_000;
      await collect(Date.now() - startedAt);
    }
  }
  if ((samples.at(-1)?.elapsedMs ?? 0) < durationMs - 30_000) {
    await collect(Date.now() - startedAt);
  }

  const browserState = await page.evaluate(() => {
    const state = window as SoakWindow;
    return {
      longTasks: state.__soakLongTasks ?? [],
      rafIntervals: state.__soakRafIntervals ?? [],
      rafMinuteBuckets: state.__soakRafMinuteBuckets ?? [],
      microphoneCalls: state.__soakMicrophoneCalls ?? 0,
    };
  });
  const beforeReload = Date.now();
  await page.reload();
  await expect(page.locator(".canvas-metrics")).toContainText("50个内容", {
    timeout: 20_000,
  });
  await expect(page.locator('[data-runtime-status="ready"]')).toHaveCount(22, {
    timeout: 30_000,
  });
  const reloadRecoveryMs = Date.now() - beforeReload;
  const microphoneCallsAfterReload = await page.evaluate(() => {
    const state = window as SoakWindow;
    return state.__soakMicrophoneCalls ?? 0;
  });
  await cdp.detach();

  const growthWindowSize = Math.min(
    5,
    Math.max(1, Math.floor(samples.length / 2)),
  );
  const first = samples.slice(0, growthWindowSize);
  const last = samples.slice(-growthWindowSize);
  const heapGrowthBytes =
    median(last.map((sample) => sample.heapBytes)) -
    median(first.map((sample) => sample.heapBytes));
  const nodeGrowth =
    median(last.map((sample) => sample.nodes)) -
    median(first.map((sample) => sample.nodes));
  const listenerGrowth =
    median(last.map((sample) => sample.listeners)) -
    median(first.map((sample) => sample.listeners));
  const budgets = {
    durationMs: 1_800_000,
    heapBytes: 300 * 1024 * 1024,
    heapGrowthBytes: 48 * 1024 * 1024,
    nodeGrowth: 500,
    listenerGrowth: 200,
    interactionP95Ms: 3_000,
    interactionMaxMs: 10_000,
    rafP95Ms: 50,
    rafMaxMs: 250,
    longestTaskMs: 750,
    storageBytes: 10 * 1024 * 1024,
    reloadRecoveryMs: 20_000,
    minimumPerformanceSamples: 31,
  };
  const actual = {
    durationMs: Date.now() - startedAt,
    performanceSampleCount: samples.length,
    maxHeapBytes: Math.max(...samples.map((sample) => sample.heapBytes)),
    heapGrowthBytes,
    nodeGrowth,
    listenerGrowth,
    rafP95Ms: nearestRank(browserState.rafIntervals, 0.95),
    rafMaxMs: maximum(browserState.rafIntervals),
    rafSampleCount: browserState.rafIntervals.length,
    rafMinuteBuckets: browserState.rafMinuteBuckets,
    longestTaskMs: maximum(browserState.longTasks),
    longTaskCount: browserState.longTasks.length,
    maxStorageBytes: Math.max(...samples.map((sample) => sample.storageBytes)),
    reloadRecoveryMs,
    microphoneCalls:
      browserState.microphoneCalls + microphoneCallsAfterReload,
    pageErrors,
    consoleErrors,
    localRequestFailures,
    localHttpErrors,
    interactionLatencyMs: {
      count: interactionLatenciesMs.length,
      p50: nearestRank(interactionLatenciesMs, 0.5),
      p95: nearestRank(interactionLatenciesMs, 0.95),
      max: maximum(interactionLatenciesMs),
    },
    unhealthySamples: samples.filter((sample) => sample.health !== "ok"),
  };
  const browserVersion = browser.version();
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const violations = [
    actual.maxHeapBytes > budgets.heapBytes
      ? `maxHeapBytes ${actual.maxHeapBytes} > ${budgets.heapBytes}`
      : null,
    actual.rafP95Ms > budgets.rafP95Ms
      ? `rafP95Ms ${actual.rafP95Ms} > ${budgets.rafP95Ms}`
      : null,
    actual.rafMaxMs > budgets.rafMaxMs
      ? `rafMaxMs ${actual.rafMaxMs} > ${budgets.rafMaxMs}`
      : null,
    actual.longestTaskMs > budgets.longestTaskMs
      ? `longestTaskMs ${actual.longestTaskMs} > ${budgets.longestTaskMs}`
      : null,
    actual.maxStorageBytes > budgets.storageBytes
      ? `maxStorageBytes ${actual.maxStorageBytes} > ${budgets.storageBytes}`
      : null,
    actual.reloadRecoveryMs > budgets.reloadRecoveryMs
      ? `reloadRecoveryMs ${actual.reloadRecoveryMs} > ${budgets.reloadRecoveryMs}`
      : null,
    actual.microphoneCalls !== 0
      ? `microphoneCalls ${actual.microphoneCalls} != 0`
      : null,
    ...actual.pageErrors.map((error) => `pageError: ${error}`),
    ...actual.consoleErrors.map((error) => `consoleError: ${error}`),
    ...actual.localRequestFailures.map((error) => `requestFailure: ${error}`),
    ...actual.localHttpErrors.map((error) => `httpError: ${error}`),
    actual.interactionLatencyMs.p95 > budgets.interactionP95Ms
      ? `interaction p95 ${actual.interactionLatencyMs.p95} > ${budgets.interactionP95Ms}`
      : null,
    actual.interactionLatencyMs.max > budgets.interactionMaxMs
      ? `interaction max ${actual.interactionLatencyMs.max} > ${budgets.interactionMaxMs}`
      : null,
    ...actual.unhealthySamples.map(
      (sample) => `unhealthySample at ${sample.elapsedMs}ms`,
    ),
    !userAgent.includes(`Chrome/${browserVersion.split(".")[0]}.`)
      ? `browser identity mismatch: ${browserVersion} / ${userAgent}`
      : null,
    qualification && actual.durationMs < budgets.durationMs
      ? `durationMs ${actual.durationMs} < ${budgets.durationMs}`
      : null,
    qualification &&
    actual.performanceSampleCount < budgets.minimumPerformanceSamples
      ? `performanceSampleCount ${actual.performanceSampleCount} < ${budgets.minimumPerformanceSamples}`
      : null,
    qualification && actual.heapGrowthBytes > budgets.heapGrowthBytes
      ? `heapGrowthBytes ${actual.heapGrowthBytes} > ${budgets.heapGrowthBytes}`
      : null,
    qualification && actual.nodeGrowth > budgets.nodeGrowth
      ? `nodeGrowth ${actual.nodeGrowth} > ${budgets.nodeGrowth}`
      : null,
    qualification && actual.listenerGrowth > budgets.listenerGrowth
      ? `listenerGrowth ${actual.listenerGrowth} > ${budgets.listenerGrowth}`
      : null,
  ].filter((violation): violation is string => violation !== null);
  const evidence = {
    runId,
    qualification,
    passed: violations.length === 0,
    violations,
    releaseManifest: {
      path: process.env.AI_TUTOR_RELEASE_MANIFEST_PATH ?? null,
      sha256: process.env.AI_TUTOR_RELEASE_MANIFEST_SHA256 ?? null,
    },
    generatedAt: new Date().toISOString(),
    browser: {
      version: browserVersion,
      userAgent,
      viewport: page.viewportSize(),
    },
    scenario: { runtimes: 20, teachingBlocks: 50, interactionCount: interaction },
    budgets,
    actual,
    samples,
  };
  const evidencePath = resolve(
    process.cwd(),
    "evidence",
    `P8_SOAK_BROWSER_${qualification ? runId : `DEBUG_${runId}`}.json`,
  );
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach("p8-soak-browser-evidence", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  console.log(`P8_SOAK_EVIDENCE=${evidencePath}`);

  expect(violations, "soak budget violations").toEqual([]);
});
