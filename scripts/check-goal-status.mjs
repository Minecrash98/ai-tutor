import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const goalsPath = resolve(root, "COMPETITION_FIRST_PLACE_GOALS.md");
const goals = readFileSync(goalsPath, "utf8");
const ledgerMarker = "## 100 项执行状态账本";
const ledgerIndex = goals.indexOf(ledgerMarker);
const issues = [];
if (ledgerIndex < 0) issues.push("goal ledger marker is missing");
const ledger = ledgerIndex >= 0 ? goals.slice(ledgerIndex) : "";
const statuses = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "VERIFIED"];
const entries = [
  ...ledger.matchAll(
    /^\|\s*(\d{3})\s*\|\s*(NOT_STARTED|IN_PROGRESS|BLOCKED|VERIFIED)\s*\|\s*(.*?)\s*\|$/gm,
  ),
].map((match) => ({
  id: match[1],
  status: match[2],
  evidence: match[3],
}));
const priorityById = Object.fromEntries(
  [
    ...goals
      .slice(0, Math.max(0, ledgerIndex))
      .matchAll(/^\|\s*(\d{3})\s*\|\s*(S[0-2])\s*\|/gm),
  ].map((match) => [match[1], match[2]]),
);

if (entries.length !== 100) {
  issues.push("goal ledger must contain exactly 100 entries; found " + entries.length);
}
const ids = new Set(entries.map((entry) => entry.id));
for (let id = 1; id <= 100; id += 1) {
  const formatted = String(id).padStart(3, "0");
  if (!ids.has(formatted)) issues.push("goal " + formatted + " is missing");
}
if (ids.size !== entries.length) issues.push("goal ledger contains duplicate IDs");

const counts = Object.fromEntries(
  statuses.map((status) => [
    status,
    entries.filter((entry) => entry.status === status).length,
  ]),
);
const summary = goals.match(
  /汇总：.*?VERIFIED\s+(\d+).*?IN_PROGRESS\s+(\d+).*?BLOCKED\s+(\d+).*?NOT_STARTED\s+(\d+)/s,
);
if (!summary) {
  issues.push("goal summary counts are missing");
} else {
  const declared = {
    VERIFIED: Number(summary[1]),
    IN_PROGRESS: Number(summary[2]),
    BLOCKED: Number(summary[3]),
    NOT_STARTED: Number(summary[4]),
  };
  for (const status of statuses) {
    if (declared[status] !== counts[status]) {
      issues.push(
        "goal summary " +
          status +
          "=" +
          declared[status] +
          " but ledger=" +
          counts[status],
      );
    }
  }
}

const governanceFiles = [
  "AGENTS.md",
  "README.md",
  "HANDOFF.md",
  "IMPLEMENTATION_PLAN.md",
  "COMPETITION_FIRST_PLACE_GOALS.md",
];
const governanceText = Object.fromEntries(
  governanceFiles.map((path) => [
    path,
    readFileSync(resolve(root, path), "utf8"),
  ]),
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const expectedNodeRange = ">=24.18.0 <26";
if (packageJson.engines?.node !== expectedNodeRange) {
  issues.push(
    "package.json Node range drift: expected " +
      expectedNodeRange +
      " found " +
      String(packageJson.engines?.node ?? "missing"),
  );
}
if (!governanceText["README.md"].includes(`Node.js \`${expectedNodeRange}\``)) {
  issues.push("README Node range does not match package.json release policy");
}
if (packageJson.packageManager !== "pnpm@10.12.3") {
  issues.push("package manager drift: expected pnpm@10.12.3");
}
for (const [path, content] of Object.entries(governanceText)) {
  if (!content.includes("P8")) issues.push(path + " does not name P8");
  if (
    !/购买.{0,20}(排除|禁止)|Purchases are explicitly\s+excluded/s.test(
      content,
    )
  ) {
    issues.push(path + " does not preserve the purchase exclusion");
  }
}
for (const forbidden of [
  "P8、部署、真实用户研究或新增产品范围仍须单独批准",
  "12 人 pilot 和确认性研究均未授权",
  "当前门禁：\u0060P7_MINIMUM_SCOPE_IN_PROGRESS",
]) {
  if (goals.includes(forbidden)) {
    issues.push("stale authorization text remains: " + forbidden);
  }
}
if (
  /80\/80/.test(governanceText["HANDOFF.md"]) ||
  /80\/80/.test(governanceText["IMPLEMENTATION_PLAN.md"])
) {
  issues.push("hard-coded historical 80/80 test count remains in current governance");
}

const providerSource = readFileSync(
  resolve(
    root,
    "apps",
    "web",
    "src",
    "features",
    "tutor",
    "server",
    "codex-realtime-provider.ts",
  ),
  "utf8",
);
const providerVersion = Number(
  providerSource.match(/REALTIME_PROVIDER_INSTANCE_VERSION\s*=\s*(\d+)/)?.[1],
);
const handoffProviderVersion = Number(
  governanceText["HANDOFF.md"].match(
    /provider[^\n]*版本[^\d]*(\d+)/i,
  )?.[1],
);
if (
  !Number.isFinite(providerVersion) ||
  providerVersion !== handoffProviderVersion
) {
  issues.push(
    "provider version drift: code=" +
      providerVersion +
      " handoff=" +
      handoffProviderVersion,
  );
}

const soakGoal = entries.find((entry) => entry.id === "083");
if (soakGoal?.status === "VERIFIED") {
  const evidenceDirectory = resolve(root, "evidence");
  const files = readdirSync(evidenceDirectory);
  const qualifiedBrowser = files
    .filter((name) => /^P8_SOAK_BROWSER_(?!DEBUG_).+\.json$/.test(name))
    .map((name) =>
      JSON.parse(readFileSync(resolve(evidenceDirectory, name), "utf8")),
    )
    .find(
      (item) =>
        item.qualification === true &&
        item.passed === true &&
        item.actual?.durationMs >= 1_800_000,
    );
  const qualifiedContainers = files
    .filter((name) => /^P8_SOAK_CONTAINERS_(?!DEBUG_).+\.json$/.test(name))
    .map((name) =>
      JSON.parse(readFileSync(resolve(evidenceDirectory, name), "utf8")),
    )
    .find(
      (item) =>
        item.qualification === true &&
        item.passed === true &&
        item.durationMs >= 1_800_000 &&
        item.runId === qualifiedBrowser?.runId,
    );
  if (!qualifiedBrowser || !qualifiedContainers) {
    issues.push(
      "goal 083 is VERIFIED without matching qualified 30-minute browser and container evidence",
    );
  }
}

if (issues.length > 0) {
  for (const issue of issues) process.stderr.write("[status] " + issue + "\n");
  process.exit(1);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  overall: "NO_GO",
  counts,
  entries: entries.map((entry) => ({
    ...entry,
    priority: priorityById[entry.id] ?? null,
    owner:
      entry.status === "BLOCKED"
        ? "项目负责人 / 外部参与者"
        : "本地实现与机器验证",
    deadline:
      entry.status === "VERIFIED"
        ? "已验证"
        : entry.status === "BLOCKED"
          ? "外部输入到位后"
          : "最终候选冻结前",
  })),
};

if (process.argv.includes("--write")) {
  const manifestPath = resolve(
    root,
    "evidence",
    "COMPETITION_GOAL_STATUS_2026-08-02.json",
  );
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const rows = manifest.entries
    .map(
      (entry) =>
        "| " +
        entry.id +
        " | " +
        (entry.priority ?? "-") +
        " | " +
        entry.status +
        " | " +
        entry.owner +
        " | " +
        entry.deadline +
        " | " +
        entry.evidence.replaceAll("|", "\\|") +
        " |",
    )
    .join("\n");
  const dashboard = [
    "# 第一名准备度看板",
    "",
    "生成时间：" + manifest.generatedAt,
    "",
    "当前结论：NO_GO。该结论由 100 项状态与硬门禁决定，不使用伪精确 AI 分数。",
    "",
    "## 汇总",
    "",
    "| VERIFIED | IN_PROGRESS | BLOCKED | NOT_STARTED |",
    "|---:|---:|---:|---:|",
    "| " +
      counts.VERIFIED +
      " | " +
      counts.IN_PROGRESS +
      " | " +
      counts.BLOCKED +
      " | " +
      counts.NOT_STARTED +
      " |",
    "",
    "## 逐项目状态",
    "",
    "| ID | 优先级 | 状态 | 负责人 | 截止口径 | 证据或阻塞 |",
    "|---:|:---:|:---:|---|---|---|",
    rows,
    "",
    "机器验证、真人批准、专家/法务与官方比赛材料保持分列；BLOCKED 不会被自动测试改写为 VERIFIED。",
    "",
  ].join("\n");
  writeFileSync(
    resolve(root, "docs", "COMPETITION_READINESS_DASHBOARD.md"),
    dashboard,
  );
}

process.stdout.write(
  JSON.stringify({
    mode: process.argv.includes("--write") ? "write" : "check",
    overall: manifest.overall,
    counts,
    entries: entries.length,
    providerVersion,
  }) + "\n",
);
