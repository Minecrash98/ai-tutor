import { expect, test } from "@playwright/test";

test("keeps authored stylesheet order and rejects oversized files before reading them", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function trackedArrayBuffer() {
      const state = window as typeof window & { __uploadedFileReads?: number };
      state.__uploadedFileReads = (state.__uploadedFileReads ?? 0) + 1;
      return original.call(this);
    };
  });
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles([
    {
      name: "cascade.html",
      mimeType: "text/html",
      buffer: Buffer.from(`<!doctype html><html><head>
        <style>#card{color:rgb(180, 0, 0)}</style>
        <link rel="stylesheet" href="./middle.css" media="screen">
        <style>#card{color:rgb(0, 0, 220)}</style>
      </head><body><main id="card">cascade</main></body></html>`),
    },
    {
      name: "middle.css",
      mimeType: "text/css",
      buffer: Buffer.from("#card{color:rgb(0, 140, 0)}"),
    },
  ]);

  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "cascade.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  const frame = runtime.locator(".static-html-runtime-frame").contentFrame();
  await expect(frame.locator("#card")).toHaveCSS("color", "rgb(0, 0, 220)");
  await expect(frame.locator('style[data-ai-tutor-source="middle.css"]')).toHaveAttribute(
    "media",
    "screen",
  );

  await page.evaluate(() => {
    (window as typeof window & { __uploadedFileReads?: number }).__uploadedFileReads = 0;
  });
  await upload.setInputFiles({
    name: "too-large.html",
    mimeType: "text/html",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 65),
  });
  await expect(page.locator(".canvas-status")).toContainText("超过 2 MB");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __uploadedFileReads?: number })
          .__uploadedFileReads ?? 0,
    ),
  ).toBe(0);
  await expect(page.locator(".teaching-block--runnable")).toHaveCount(1);
});

test("sanitizes hostile HTML, CSS, URLs, and reserved source metadata", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (/evil\.invalid|example\.invalid/.test(request.url())) {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles([
    {
      name: "hostile.html",
      mimeType: "text/html",
      buffer: Buffer.from(`<!doctype html>
        <html>
          <head>
            <base href="https://evil.invalid/">
            <meta http-equiv="refresh" content="0;url=https://evil.invalid/refresh">
            <link rel="stylesheet" href="https://evil.invalid/leak.css">
            <script>window.__uploadedScriptRan = true</script>
          </head>
          <body onload="window.__uploadedScriptRan = true">
            <iframe src="https://evil.invalid/frame"></iframe>
            <object data="https://evil.invalid/object"></object>
            <a id="bad-link" href="javascript:alert(1)" ping="https://evil.invalid/ping">bad</a>
            <form id="bad-form" action="https://evil.invalid/form">
              <button formaction="https://evil.invalid/button">send</button>
            </form>
            <img id="bad-image"
              src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+"
              srcset="https://evil.invalid/a.png 1x"
              onerror="window.__uploadedScriptRan = true">
            <main id="spoof"
              data-ai-tutor-source="forged.css"
              data-ai-tutor-base-line="999"
              style="background-image:url(javascript:alert(1))">safe text</main>
          </body>
        </html>`),
    },
    {
      name: "hostile.css",
      mimeType: "text/css",
      buffer: Buffer.from(
        '@import "https://example.invalid/leak.css"; #spoof{background:url("https://evil.invalid/pixel.png")}',
      ),
    },
  ]);

  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "hostile.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  const frameElement = runtime.locator(".static-html-runtime-frame");
  const frame = frameElement.contentFrame();

  await expect(frame.locator("script,iframe,object,base,link")).toHaveCount(1);
  await expect(frame.locator("script")).toHaveCount(1);
  await expect(frame.locator("iframe,object,base,link")).toHaveCount(0);
  await expect(frame.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
  await expect(
    frame.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveCount(1);
  await expect(frame.locator("body")).not.toHaveAttribute("onload");
  await expect(frame.locator("#bad-link")).toHaveAttribute("href", "#");
  await expect(frame.locator("#bad-link")).not.toHaveAttribute("ping");
  await expect(frame.locator("#bad-form")).toHaveAttribute("action", "");
  await expect(frame.locator("#bad-image")).toHaveAttribute("src", "");
  await expect(frame.locator("#bad-image")).not.toHaveAttribute("srcset");
  await expect(frame.locator("#bad-image")).not.toHaveAttribute("onerror");
  await expect(frame.locator("#spoof")).not.toHaveAttribute(
    "data-ai-tutor-source",
  );
  await expect(frame.locator("#spoof")).not.toHaveAttribute(
    "data-ai-tutor-base-line",
  );
  await expect(frame.locator("#spoof")).not.toHaveAttribute(
    "style",
    /javascript|evil\.invalid/i,
  );
  expect(externalRequests).toEqual([]);

  const uploadedScriptRan = await frame.locator("html").evaluate(
    () =>
      (window as typeof window & { __uploadedScriptRan?: boolean })
        .__uploadedScriptRan ?? false,
  );
  expect(uploadedScriptRan).toBe(false);
});

test("ignores a protocol-correct runtime message sent by the wrong window", async ({
  page,
}) => {
  await page.goto("/");
  const upload = page.locator('input[type="file"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: "source-check.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!doctype html><html><body><main id="card">source check</main></body></html>',
    ),
  });
  const runtime = page
    .locator(".teaching-block__runtime--live")
    .filter({ hasText: "source-check.html" });
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready", {
    timeout: 10_000,
  });
  const frameElement = runtime.locator(".static-html-runtime-frame");
  const runtimeInstanceId = await frameElement.evaluate((element) => {
    const source = (element as HTMLIFrameElement).srcdoc;
    const match = source.match(/const runtimeInstanceId = ("[^"]+");/);
    if (!match?.[1]) throw new Error("runtime instance id not found");
    return JSON.parse(match[1]) as string;
  });

  await page.evaluate((runtimeId) => {
    window.postMessage(
      {
        protocolVersion: 1,
        runtimeInstanceId: runtimeId,
        messageId: "spoofed-parent-message",
        type: "runtime.inspection_error",
        payload: { code: "SPOOFED", message: "wrong window accepted" },
      },
      "*",
    );
  }, runtimeInstanceId);
  await page.waitForTimeout(100);

  await expect(page.getByText("wrong window accepted")).toHaveCount(0);
  await expect(runtime).toHaveAttribute("data-runtime-status", "ready");
});
