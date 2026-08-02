import { expect, test } from "@playwright/test";

test.skip(
  process.env.AI_TUTOR_P7_DATABASE !== "1",
  "requires the Compose PostgreSQL learning-evidence service",
);

test("reveals a frozen unfamiliar task, preserves a wrong attempt, and keeps delayed content locked", async ({
  page,
}) => {
  let transferUrl: string | null = null;
  const transferGetStatuses: number[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      /\/api\/learning\/sessions\/[a-f0-9-]+\/transfers$/.test(
        new URL(response.url()).pathname,
      )
    ) {
      transferUrl = response.url();
      transferGetStatuses.push(response.status());
    }
  });
  await page.goto("/");

  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await lesson.getByRole("button", { name: "会变大" }).click();
  await expect(lesson.locator(".entry-diagnostic")).toHaveAttribute(
    "data-diagnostic-calibrated-by",
    "entry-prediction",
  );
  const controller = page
    .locator(".teaching-block--css-controller")
    .filter({ hasText: "让里面更宽松" });
  const slider = controller.getByRole("slider", {
    name: "padding 控制器",
  });
  await slider.fill("32");
  await slider.focus();
  await page.keyboard.press("Tab");
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "explain",
    { timeout: 10_000 },
  );
  await lesson
    .getByRole("button", {
      name: "width 只算内容区，左右 padding 另外加上",
    })
    .click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "transfer",
    { timeout: 10_000 },
  );
  await lesson.getByLabel("补写 CSS 声明").fill("padding: 20px;");
  await lesson.getByRole("button", { name: "运行我的 CSS" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "complete",
    { timeout: 10_000 },
  );

  const learningEvidence = page.getByRole("region", {
    name: "可追溯学习证据",
  });
  await expect(learningEvidence).toBeVisible({ timeout: 15_000 });
  await expect(
    learningEvidence.locator('li[data-evidence-status="met"]'),
  ).toHaveCount(4);
  await expect(learningEvidence).toContainText("本次独立完成");
  const predictionEvidence = learningEvidence
    .locator('li[data-evidence-status="met"]')
    .first();
  await predictionEvidence
    .getByText("查看 1 条原始步骤", { exact: true })
    .click();
  await expect(predictionEvidence).toContainText("完成条件");
  await expect(predictionEvidence).toContainText("提交预测：会变大");
  await expect(
    predictionEvidence.locator("[data-learning-event-id] code"),
  ).toHaveText(/[a-f0-9-]{36}/);
  await learningEvidence.getByText("查看判定依据与版本").click();
  await expect(learningEvidence).toContainText("AI 评分");
  await expect(learningEvidence).toContainText("未使用；结果来自固定规则");
  await expect(learningEvidence).toContainText("本次课程记录");
  await expect(learningEvidence).toContainText("步骤格式版本");
  await expect(learningEvidence).toContainText("结果校验码");
  const historyCount = learningEvidence
    .locator("dl > div")
    .filter({ hasText: "保留的历史快照" })
    .locator("dd");
  const beforeReanalysis = Number.parseInt(
    (await historyCount.textContent()) ?? "0",
    10,
  );
  await learningEvidence
    .getByRole("button", { name: "按同一规则重新检查（保留旧结果）" })
    .click();
  await expect
    .poll(async () => Number.parseInt((await historyCount.textContent()) ?? "0", 10))
    .toBe(beforeReanalysis + 1);
  const auditHref = await learningEvidence
    .getByRole("link", { name: "导出完整学习证据包" })
    .getAttribute("href");
  expect(auditHref).toBeTruthy();
  const auditResponse = await page.context().request.get(
    new URL(auditHref!, page.url()).toString(),
  );
  expect(auditResponse.ok()).toBe(true);
  expect(auditResponse.headers()["content-disposition"]).toContain(
    "learning-proof-audit-",
  );
  const audit = (await auditResponse.json()) as {
    formatVersion: number;
    contentHash: string;
    replay: {
      session: { sessionId: string };
      events: Array<{ sequence: number; event: { eventId: string } }>;
    };
    analyses: Array<{
      analysisId: string;
      resultHash: string;
      sourceThroughSequence: number;
      result: {
        scoringModel: null;
        rubric: { id: string; version: number };
        evaluator: { id: string; version: number };
        milestones: Array<{
          status: "missing" | "not-met" | "met";
          sourceEventIds: string[];
        }>;
      };
    }>;
  };
  expect(audit.formatVersion).toBe(1);
  expect(audit.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(audit.replay.events.length).toBeGreaterThanOrEqual(5);
  expect(audit.analyses).toHaveLength(beforeReanalysis + 1);
  expect(
    audit.analyses.every(
      (item) =>
        item.result.scoringModel === null &&
        /^[a-f0-9]{64}$/.test(item.resultHash),
    ),
  ).toBe(true);
  expect(
    audit.analyses[0]?.result.milestones.every((milestone) =>
      milestone.sourceEventIds.every((eventId) =>
        audit.replay.events.some(
          (record) =>
            record.event.eventId === eventId &&
            record.sequence <= audit.analyses[0]!.sourceThroughSequence,
        ),
      ),
    ),
  ).toBe(true);

  const assessment = page.getByRole("region", {
    name: "陌生迁移与延迟保持挑战",
  });
  await expect(assessment).toBeVisible();
  const immediate = assessment.locator(
    'li[data-transfer-kind="immediate-hidden"]',
  );
  await expect(immediate).toContainText("这是一本相册", { timeout: 15_000 });
  await expect(immediate).toContainText("请独立完成");
  const immediateFrame = immediate.locator("iframe").contentFrame();
  await expect(immediateFrame.locator(".caption")).toHaveCSS(
    "padding-top",
    "4px",
  );

  const answer = immediate.getByLabel("只补一条 CSS 声明");
  await expect(answer).toHaveAttribute("placeholder", "属性: 值;");
  await expect(immediate.locator("iframe")).toHaveAttribute(
    "srcdoc",
    /Content-Security-Policy.*default-src 'none'/,
  );
  await answer.fill("margin: 24px;");
  await expect(immediateFrame.locator(".caption")).toHaveCSS(
    "padding-top",
    "4px",
  );
  await immediate.getByRole("button", { name: "运行并提交" }).click();
  await expect(immediate.getByRole("status")).toContainText("改了别的属性");
  await expect(immediate).toContainText("尝试 1 次");
  await expect(lesson.locator(".entry-diagnostic")).toHaveAttribute(
    "data-diagnostic-calibrated-by",
    "hidden-transfer",
  );
  await expect(lesson.locator(".entry-diagnostic")).toContainText(
    "先核对一个页面事实会更稳",
  );

  await answer.fill("padding: 24px;");
  await expect(immediateFrame.locator(".caption")).toHaveCSS(
    "padding-top",
    "4px",
  );
  await immediate.getByRole("button", { name: "运行并提交" }).click();
  await expect(immediate).toContainText("已经通过");
  await expect(immediate).toContainText("尝试 2 次");
  await expect(immediateFrame.locator(".caption")).toHaveCSS(
    "padding-top",
    "24px",
  );
  await expect(lesson.locator(".entry-diagnostic")).toContainText(
    "可以直接继续操作",
  );

  const delayed = assessment.locator(
    'li[data-transfer-kind="delayed-retention"]',
  );
  await expect(delayed).toContainText("后再来");
  await expect(delayed).toContainText("题目内容暂不显示");
  await expect(delayed.locator("iframe")).toHaveCount(0);
  await expect(assessment).toContainText("才可讨论长期掌握");

  await expect.poll(() => transferUrl).not.toBeNull();
  const response = await page.context().request.get(transferUrl!);
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    items: Array<Record<string, unknown>>;
  };
  const delayedPayload = payload.items.find(
    (item) => item.kind === "delayed-retention",
  );
  expect(delayedPayload).toMatchObject({ status: "locked" });
  expect(delayedPayload).not.toHaveProperty("prompt");
  expect(delayedPayload).not.toHaveProperty("html");
  expect(delayedPayload).not.toHaveProperty("baseCss");
  expect(payload.items.every((item) => !("itemHash" in item))).toBe(true);
  expect(transferGetStatuses.length).toBeGreaterThanOrEqual(3);
  expect(transferGetStatuses.every((status) => status === 200)).toBe(true);
  await expect(assessment).not.toContainText("冻结题目标记");
});
