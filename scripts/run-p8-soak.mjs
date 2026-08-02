import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createReleaseManifest } from "./release-manifest.mjs";

const durationMs = Number(
  process.env.AI_TUTOR_SOAK_DURATION_MS ?? 1_800_000,
);
const qualification = durationMs >= 1_800_000;
const runId =
  process.env.AI_TUTOR_SOAK_RUN_ID ??
  new Date().toISOString().replace(/[:.]/g, "-");
const evidenceLabel = qualification ? runId : `DEBUG_${runId}`;
const samples = [];

function docker(args, timeout = 20_000) {
  return spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
}

function resolveComposeContainer(service) {
  const idResult = docker(["compose", "ps", "-q", service]);
  const ids = idResult.stdout.split(/\r?\n/).filter(Boolean);
  if (idResult.status !== 0 || ids.length !== 1) {
    throw new Error(
      `expected exactly one running Compose ${service} container: ${idResult.stderr || ids.join(", ") || "none"}`,
    );
  }
  const id = ids[0];
  const nameResult = docker(["inspect", "--format", "{{.Name}}", id]);
  const name = nameResult.stdout.trim().replace(/^\//, "");
  if (nameResult.status !== 0 || !name) {
    throw new Error(
      `could not inspect Compose ${service} container ${id}: ${nameResult.stderr}`,
    );
  }
  return { service, id, name };
}

const expectedContainers = {
  web: resolveComposeContainer("web"),
  database: resolveComposeContainer("db"),
};
const expectedRows = Object.values(expectedContainers);
const releaseManifest = createReleaseManifest({ runId, expectedContainers });
process.stdout.write(
  `P8_SOAK_RELEASE_MANIFEST=${releaseManifest.path}\n`,
);

function memoryBytes(value) {
  const match = value.match(/([\d.]+)(KiB|MiB|GiB)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "gib" ? 1024 ** 3 : unit === "mib" ? 1024 ** 2 : 1024;
  return Math.round(amount * multiplier);
}

function sampleContainers() {
  const result = docker([
    "stats",
    "--no-stream",
    "--format",
    "{{json .}}",
    ...expectedRows.map((container) => container.id),
  ]);
  let containers = [];
  let error = null;
  try {
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `docker stats exit ${result.status}`);
    }
    containers = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((row) => {
        const expected = expectedRows.find(
          (container) => container.name === row.Name,
        );
        if (!expected) throw new Error(`unexpected container ${row.Name}`);
        const bytes = memoryBytes(row.MemUsage);
        const cpuPercent = Number(String(row.CPUPerc).replace("%", ""));
        const pids = Number(row.PIDs);
        if (bytes === null || !Number.isFinite(cpuPercent) || !Number.isFinite(pids)) {
          throw new Error(`invalid docker stats row for ${row.Name}`);
        }
        return {
          service: expected.service,
          containerId: expected.id,
          name: row.Name,
          memoryBytes: bytes,
          cpuPercent,
          pids,
        };
      });
    const missing = expectedRows.filter(
      (expected) =>
        !containers.some((container) => container.name === expected.name),
    );
    if (missing.length > 0) {
      throw new Error(
        `missing docker stats for ${missing.map((row) => row.service).join(", ")}`,
      );
    }
  } catch (sampleError) {
    error = sampleError instanceof Error ? sampleError.message : String(sampleError);
  }
  const sample = {
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
    containers,
    error,
  };
  samples.push(sample);
  process.stdout.write(`P8_SOAK_CONTAINER_PROGRESS=${JSON.stringify(sample)}\n`);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

const startedAt = Date.now();
sampleContainers();
const timer = setInterval(sampleContainers, 60_000);
const command =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : "pnpm";
const commandArgs =
  process.platform === "win32"
    ? [
        "/d",
        "/s",
        "/c",
        "pnpm exec playwright test --config=playwright.soak.config.ts",
      ]
    : [
        "exec",
        "playwright",
        "test",
        "--config=playwright.soak.config.ts",
      ];
const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    AI_TUTOR_RUN_SOAK: "1",
    AI_TUTOR_SOAK_DURATION_MS: String(durationMs),
    AI_TUTOR_SOAK_RUN_ID: runId,
    AI_TUTOR_RELEASE_MANIFEST_PATH: releaseManifest.relativePath,
    AI_TUTOR_RELEASE_MANIFEST_SHA256: releaseManifest.sha256,
  },
});

const exitCode = await new Promise((resolveExit) => {
  child.once("error", () => resolveExit(1));
  child.once("exit", (code) => resolveExit(code ?? 1));
});
clearInterval(timer);
sampleContainers();

const byService = (service) =>
  samples
    .flatMap((sample) => sample.containers)
    .filter((container) => container.service === service);
const budgets = {
  durationMs: 1_800_000,
  minimumSamples: qualification ? 31 : 2,
  webMaxBytes: 512 * 1024 * 1024,
  databaseMaxBytes: 256 * 1024 * 1024,
  growthBytes: 64 * 1024 * 1024,
};
const actual = {};
let containerBudgetPassed = true;
for (const [key, service, budget] of [
  ["web", "web", budgets.webMaxBytes],
  ["database", "db", budgets.databaseMaxBytes],
]) {
  const rows = byService(service);
  const values = rows.map((row) => row.memoryBytes);
  const windowSize = Math.min(
    5,
    Math.max(1, Math.floor(values.length / 2)),
  );
  const growthBytes =
    median(values.slice(-windowSize)) - median(values.slice(0, windowSize));
  actual[key] = {
    samples: rows.length,
    maxBytes: Math.max(0, ...values),
    growthBytes,
  };
  if (
    rows.length < budgets.minimumSamples ||
    actual[key].maxBytes > budget ||
    (qualification && growthBytes > budgets.growthBytes)
  ) {
    containerBudgetPassed = false;
  }
}

const elapsedMs = Date.now() - startedAt;
const samplingErrors = samples.filter((sample) => sample.error !== null);
const durationPassed = !qualification || elapsedMs >= budgets.durationMs;
const passed =
  exitCode === 0 &&
  samplingErrors.length === 0 &&
  durationPassed &&
  containerBudgetPassed;
const evidence = {
  runId,
  qualification,
  passed,
  generatedAt: new Date().toISOString(),
  durationMs: elapsedMs,
  browserExitCode: exitCode,
  expectedContainers,
  releaseManifest: {
    path: releaseManifest.relativePath,
    sha256: releaseManifest.sha256,
  },
  budgets,
  actual,
  samplingErrorCount: samplingErrors.length,
  samples,
};
const evidencePath = resolve(
  process.cwd(),
  "evidence",
  `P8_SOAK_CONTAINERS_${evidenceLabel}.json`,
);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`P8_SOAK_CONTAINER_EVIDENCE=${evidencePath}\n`);
if (!passed) process.exitCode = 1;
