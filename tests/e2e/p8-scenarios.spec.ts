import { expect, test, type Page } from "@playwright/test";

interface DemoExpectation {
  readonly option: "box-model" | "flex" | "positioning";
  readonly label: string;
  readonly title: string;
  readonly property: string;
  readonly value: string;
  readonly explanation: string;
}

const scenarios: readonly DemoExpectation[] = [
  {
    option: "box-model",
    label: "内容周围的空隙",
    title: "演示模式 · 卡片里的空间",
    property: "padding-top",
    value: "36px",
    explanation: "里面留白会加到总尺寸",
  },
  {
    option: "flex",
    label: "横向排列与间距",
    title: "演示模式 · 三个方块怎么排",
    property: "column-gap",
    value: "32px",
    explanation: "gap 只改变项目之间的距离",
  },
  {
    option: "positioning",
    label: "把元素放到指定位置",
    title: "演示模式 · 标签放在哪里",
    property: "top",
    value: "56px",
    explanation: "相对定位保留原来的位置",
  },
];

async function startDemo(page: Page, scenario: DemoExpectation) {
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await tutor.getByLabel("教学主题").selectOption(scenario.option);
  await tutor
    .getByRole("button", { name: `打开${scenario.label}演示` })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  return tutor;
}

for (const scenario of scenarios) {
  test(`completes the ${scenario.option} scenario without AI or microphone`, async ({
    page,
  }) => {
    const realtimeRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/realtime/")) {
        realtimeRequests.push(request.url());
      }
    });
    await page.goto("/");
    await startDemo(page, scenario);

    const source = page
      .locator(".teaching-block--runnable")
      .filter({ hasText: scenario.title });
    await expect(source).toBeVisible();
    const frame = source.locator(".static-html-runtime-frame").contentFrame();
    await expect(frame.locator("#demo")).toHaveCSS(
      scenario.property,
      scenario.value,
    );
    await expect(page.locator(".teaching-block--css-controller")).toHaveCount(1);
    await expect(page.locator(".comparison-runtime")).toHaveCount(1);
    await expect(
      page.locator(".teaching-block--explanation").filter({
        hasText: scenario.explanation,
      }),
    ).toBeVisible();
    expect(realtimeRequests).toEqual([]);

    await page.reload();
    await expect(page.locator(".comparison-runtime")).toHaveCount(1);
    await expect(
      page.locator(".teaching-block--runnable").filter({
        hasText: scenario.title,
      }),
    ).toBeVisible();
  });
}

test("continues in clearly labelled demo mode when voice service is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          (window as typeof window & { __microphoneCalls?: number })
            .__microphoneCalls =
            ((window as typeof window & { __microphoneCalls?: number })
              .__microphoneCalls ?? 0) + 1;
          return Promise.reject(new Error("physical microphone must not run"));
        },
      },
    });
  });
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
  await expect(tutor.getByRole("alert")).toContainText("没有改动你的内容");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls ?? 0,
    ),
  ).toBe(0);

  await tutor.getByLabel("教学主题").selectOption("flex");
  await tutor
    .getByRole("button", { name: "打开横向排列与间距演示" })
    .click();
  await expect(tutor.locator("[data-demo-mode]")).toHaveAttribute(
    "data-demo-mode",
    "ready",
    { timeout: 15_000 },
  );
  await expect(page.locator(".comparison-runtime")).toHaveCount(1);
});
