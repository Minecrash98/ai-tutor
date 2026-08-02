import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { relative, resolve } from "node:path";

const ROOT = process.cwd();
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".ai-tutor",
  ".playwright-cli",
  "node_modules",
  "evidence",
  "output",
  "playwright-report",
  "playwright-report-compose",
  "test-results",
  "coverage",
  "docs",
]);
const IGNORED_GOVERNANCE_FILES = new Set([
  "COMPETITION_FIRST_PLACE_GOALS.md",
  "COMPETITION_FIRST_PLACE_REVIEW.md",
  "HANDOFF.md",
  "IMPLEMENTATION_PLAN.md",
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      command + " " + args.join(" ") + " failed: " +
        (result.stderr || result.stdout),
    );
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceFiles(directory = ROOT) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (
      (directory === ROOT && IGNORED_GOVERNANCE_FILES.has(entry.name)) ||
      entry.name === ".env" ||
      (entry.name.startsWith(".env.") && entry.name !== ".env.example") ||
      entry.name.endsWith(".dump") ||
      entry.name.endsWith(".backup")
    ) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...workspaceFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function workspaceFingerprint() {
  const files = workspaceFiles().sort((left, right) =>
    relative(ROOT, left).localeCompare(relative(ROOT, right)),
  );
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), fileCount: files.length };
}

function gitState() {
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status !== 0) {
    return {
      available: false,
      commit: null,
      clean: null,
      detail: "workspace has no Git provenance",
    };
  }
  const commit = run("git", ["rev-parse", "HEAD"]);
  const status = run("git", ["status", "--porcelain=v1"]);
  return {
    available: true,
    commit,
    clean: status.length === 0,
    changedEntryCount: status ? status.split(/\r?\n/).length : 0,
  };
}

function composeHashes() {
  const output = run("docker", ["compose", "config", "--hash", "*"]);
  return Object.fromEntries(
    output.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(" ");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

const SBOM_BY_SERVICE = {
  web: "evidence/P8_CONTAINER_SBOM_2026-08-02.cdx.json",
  migrate: "evidence/P8_MIGRATION_CONTAINER_SBOM_2026-08-02.cdx.json",
  database: "evidence/P8_DATABASE_CONTAINER_SBOM_2026-08-02.cdx.json",
};

function serviceForImage(row) {
  if (row.ContainerName.includes("-web-")) return "web";
  if (row.ContainerName.includes("-migrate-")) return "migrate";
  if (row.ContainerName.includes("-db-")) return "database";
  return null;
}

function sbomRecord(service, imageId) {
  const relativePath = SBOM_BY_SERVICE[service];
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) {
    throw new Error("missing image SBOM for " + service + ": " + relativePath);
  }
  const content = readFileSync(path);
  const document = JSON.parse(content.toString("utf8"));
  const purl = document.metadata?.component?.purl ?? "";
  const digest = purl.match(/@sha256:([a-f0-9]{64})/)?.[1] ?? null;
  const expected = imageId.replace(/^sha256:/, "");
  if (digest !== expected) {
    throw new Error(
      service + " SBOM digest mismatch: sbom=" + digest + " image=" + expected,
    );
  }
  return {
    path: relativePath,
    sha256: sha256(content),
    imageDigest: "sha256:" + digest,
    componentCount: Array.isArray(document.components)
      ? document.components.length
      : null,
    generator: document.metadata?.tools ?? null,
  };
}

export function createReleaseManifest({ runId, expectedContainers }) {
  const images = JSON.parse(
    run("docker", ["compose", "images", "--format", "json"]),
  );
  const imageRecords = {};
  for (const row of images) {
    const service = serviceForImage(row);
    if (!service) continue;
    imageRecords[service] = {
      id: row.ID,
      repository: row.Repository,
      tag: row.Tag || null,
      platform: row.Platform,
      sizeBytes: row.Size,
      created: row.Created,
      sbom: sbomRecord(service, row.ID),
    };
  }
  for (const service of ["web", "migrate", "database"]) {
    if (!imageRecords[service]) {
      throw new Error("Compose image metadata missing for " + service);
    }
  }

  const source = workspaceFingerprint();
  const lockfile = readFileSync(resolve(ROOT, "pnpm-lock.yaml"));
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, "package.json"), "utf8"),
  );
  const playwright = JSON.parse(
    readFileSync(
      resolve(ROOT, "node_modules", "@playwright", "test", "package.json"),
      "utf8",
    ),
  );
  const manifest = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    source: {
      ...source,
      scope:
        "Release inputs only. Generated evidence, reports, planning/status ledgers, and operator documentation are excluded so evidence updates cannot change the runtime fingerprint.",
      git: gitState(),
      lockfileSha256: sha256(lockfile),
    },
    toolchain: {
      node: process.version,
      packageManager: packageJson.packageManager,
      playwright: playwright.version,
      dockerScout:
        run("docker", ["scout", "version"]).match(/version:\s+v?([^\s]+)/i)?.[1] ??
        null,
    },
    host: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      headlessBrowserEvidence: true,
    },
    composeServiceHashes: composeHashes(),
    expectedContainers,
    images: imageRecords,
    scope:
      "This fingerprint binds one local release candidate on this host to the release-input snapshot, lockfile, Compose service hashes, and three image SBOMs. A soak is separate evidence and is not implied by this manifest. Generated evidence and governance documentation are excluded; representative competition hardware and human-visible GPU performance remain unverified.",
  };
  const path = resolve(
    ROOT,
    "evidence",
    "P8_RELEASE_MANIFEST_" + runId + ".json",
  );
  const body = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(path, body);
  return {
    path,
    relativePath: relative(ROOT, path).replaceAll("\\", "/"),
    sha256: sha256(body),
    manifest,
  };
}
