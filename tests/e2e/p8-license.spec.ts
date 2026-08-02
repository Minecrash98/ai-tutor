import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const TLDRAW_VERSION = "3.15.5";
const TLDRAW_LICENSE_SHA256 =
  "A051565874FD424CC9C19049D425EAD719B9B7CF214546F31A368B4A3822755D";

test("pins the production-with-watermark tldraw release and its tagged license", async () => {
  const packageJson = JSON.parse(
    readFileSync(
      join(process.cwd(), "apps", "web", "node_modules", "tldraw", "package.json"),
      "utf8",
    ),
  ) as { version?: string };
  expect(packageJson.version).toBe(TLDRAW_VERSION);

  const license = readFileSync(
    join(
      process.cwd(),
      "licenses",
      `tldraw-v${TLDRAW_VERSION}-LICENSE.md`,
    ),
  );
  expect(createHash("sha256").update(license).digest("hex").toUpperCase()).toBe(
    TLDRAW_LICENSE_SHA256,
  );
});

test("keeps the required made-with-tldraw watermark visible and interactive", async ({
  page,
}) => {
  await page.goto("/");
  const watermark = page.locator(".tl-watermark_SEE-LICENSE");
  const attribution = page.getByRole("button", { name: "made with tldraw" });
  await expect(watermark).toBeVisible();
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveAttribute("title", "made with tldraw");

  const presentation = await watermark.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      display: style.display,
      opacity: Number(style.opacity),
      pointerEvents: style.pointerEvents,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(presentation.display).not.toBe("none");
  expect(presentation.opacity).toBe(1);
  expect(presentation.pointerEvents).toBe("all");
  expect(presentation.width).toBeGreaterThanOrEqual(96);
  expect(presentation.height).toBeGreaterThanOrEqual(32);
});
