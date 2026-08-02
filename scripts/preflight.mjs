import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const checks = [];
const failures = [];
const warnings = [];

function record(name, passed, detail) {
  checks.push({ name, passed, required: true, detail });
  if (!passed) failures.push(`${name}: ${detail}`);
}

function advisory(name, passed, detail, fallback) {
  checks.push({ name, passed, required: false, detail, fallback });
  if (!passed) warnings.push(`${name}: ${detail}`);
}

function accessible(path, mode) {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function canBindLocalPort(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolvePort(true));
    });
  });
}

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node
  .split(".")
  .map(Number);
record(
  "node",
  (nodeMajor === 24 && nodeMinor >= 18) || nodeMajor === 25,
  `found ${process.versions.node}; supported for local checks >=24.18.0 <26`,
);

const nodeVersionFile = readFileSync(resolve(root, ".node-version"), "utf8").trim();
const nvmVersionFile = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();
record(
  "release-node-version",
  nodeVersionFile === "24.18.0" && nvmVersionFile === nodeVersionFile,
  `.node-version=${nodeVersionFile}; .nvmrc=${nvmVersionFile}; release and CI require 24.18.0`,
);

const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
record(
  "package-manager",
  packageJson.packageManager === "pnpm@10.12.3",
  `found ${packageJson.packageManager ?? "missing"}`,
);
record(
  "lockfile",
  existsSync(resolve(root, "pnpm-lock.yaml")),
  "pnpm-lock.yaml must be present",
);

const tldrawPackage = JSON.parse(
  readFileSync(
    resolve(root, "apps", "web", "node_modules", "tldraw", "package.json"),
    "utf8",
  ),
);
record(
  "tldraw-version",
  tldrawPackage.version === "3.15.5",
  `found ${tldrawPackage.version}; required 3.15.5 with visible watermark`,
);

const licensePath = resolve(
  root,
  "licenses",
  "tldraw-v3.15.5-LICENSE.md",
);
const licenseHash = existsSync(licensePath)
  ? createHash("sha256")
      .update(readFileSync(licensePath))
      .digest("hex")
      .toUpperCase()
  : "MISSING";
record(
  "tldraw-license-copy",
  licenseHash ===
    "A051565874FD424CC9C19049D425EAD719B9B7CF214546F31A368B4A3822755D",
  `SHA-256 ${licenseHash}`,
);

const requiredAssets = [
  "apps/web/src/app/icon.svg",
  "apps/web/public/audio/realtime-ack.wav",
  "packages/curriculum/src/courses/box-model-v1.ts",
  "docs/PRIVACY_AND_DATA_DISCLOSURE.md",
];
const unreadableAssets = requiredAssets.filter(
  (path) => !accessible(resolve(root, path), fsConstants.R_OK),
);
record(
  "required-assets",
  unreadableAssets.length === 0,
  unreadableAssets.length === 0
    ? `${requiredAssets.length} required UI, audio, curriculum, and disclosure assets are readable`
    : `missing or unreadable: ${unreadableAssets.join(", ")}`,
);

const writablePaths = ["evidence", "output"].map((path) => resolve(root, path));
for (const path of writablePaths) {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // The required check below reports a missing or unwritable directory.
  }
}
const unwritablePaths = writablePaths.filter(
  (path) =>
    !existsSync(path) ||
    !accessible(path, fsConstants.R_OK | fsConstants.W_OK),
);
record(
  "workspace-permissions",
  unwritablePaths.length === 0,
  unwritablePaths.length === 0
    ? "evidence and output directories are readable and writable"
    : `missing or not writable: ${unwritablePaths.join(", ")}`,
);

const codexShim =
  process.platform === "win32"
    ? (
        spawnSync("where.exe", ["codex"], {
          encoding: "utf8",
          timeout: 2_000,
          windowsHide: true,
        }).stdout ?? ""
      )
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.toLowerCase().endsWith(".cmd")) ?? "codex.cmd"
    : "codex";
function runCodex(args, timeout) {
  return process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/c", "call", codexShim, ...args],
        { encoding: "utf8", timeout, windowsHide: true },
      )
    : spawnSync(codexShim, args, {
        encoding: "utf8",
        timeout,
        windowsHide: true,
      });
}

const expectedCodexVersion = "0.144.1";
const codexVersionResult = runCodex(["--version"], 3_000);
const codexVersion = `${codexVersionResult.stdout ?? ""} ${codexVersionResult.stderr ?? ""}`
  .match(/codex-cli\s+([0-9]+[.][0-9]+[.][0-9]+)/i)?.[1] ?? null;
advisory(
  "codex-version",
  codexVersionResult.status === 0 && codexVersion === expectedCodexVersion,
  codexVersion
    ? `found codex-cli ${codexVersion}; validated compatibility target ${expectedCodexVersion}`
    : "Codex CLI version could not be determined",
  "The deterministic course remains available; do not use the Live Tutor until the recorded Codex compatibility target is restored and preflight passes.",
);

const codexStatus = runCodex(["login", "status"], 5_000);
const codexAuthenticated =
  codexStatus.status === 0 &&
  /logged in|authenticated/i.test(
    `${codexStatus.stdout ?? ""}\n${codexStatus.stderr ?? ""}`,
  );
advisory(
  "codex-login",
  codexAuthenticated,
  codexAuthenticated
    ? "authenticated without exposing account details"
    : "Codex authentication was not available to the preflight",
  "The deterministic CSS course and saved local work remain available; Realtime Tutor stays disabled.",
);

let runningApplication = false;
try {
  const response = await fetch("http://127.0.0.1:3000/api/health", {
    signal: AbortSignal.timeout(2_500),
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  runningApplication =
    response.ok &&
    payload?.release === "0.1.0" &&
    payload?.deterministicDemo === true &&
    payload?.status === "ok";
  record(
    "application-port",
    runningApplication,
    runningApplication
      ? `AI Tutor is already healthy on 127.0.0.1:3000; database ready=${payload?.database?.ready === true}`
      : `port 3000 answered but did not identify a healthy AI Tutor release (HTTP ${response.status})`,
  );
} catch {
  const portAvailable = await canBindLocalPort(3000);
  record(
    "application-port",
    portAvailable,
    portAvailable
      ? "127.0.0.1:3000 is available for the one-command local release"
      : "127.0.0.1:3000 is occupied by an unidentified or unresponsive process",
  );
}

if (runningApplication) {
  try {
    const response = await fetch(
      "http://127.0.0.1:3000/api/realtime/capabilities",
      {
        signal: AbortSignal.timeout(8_000),
        headers: {
          accept: "application/json",
          origin: "http://127.0.0.1:3000",
        },
      },
    );
    const payload = await response.json().catch(() => null);
    advisory(
      "realtime-capability",
      response.ok &&
        payload?.ready === true &&
        payload?.textAvailable === true &&
        payload?.voiceAvailable === true,
      response.ok
        ? "text and voice capability endpoint returned ready"
        : `capability endpoint returned HTTP ${response.status}`,
      "The deterministic course, source editor, comparisons, and learning proof remain usable without Realtime.",
    );
  } catch (error) {
    advisory(
      "realtime-capability",
      false,
      error instanceof Error ? error.message : "capability check failed",
      "The deterministic course, source editor, comparisons, and learning proof remain usable without Realtime.",
    );
  }
} else {
  advisory(
    "realtime-capability",
    false,
    "application is not running, so the server capability endpoint was not queried",
    "Start the release, then rerun preflight; deterministic lessons do not require Realtime.",
  );
}

if (process.argv.includes("--database")) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  record(
    "database-url",
    Boolean(databaseUrl),
    databaseUrl
      ? "configured"
      : "DATABASE_URL is required for authoritative persistence",
  );
  if (databaseUrl) {
    let client;
    try {
      const requireFromWeb = createRequire(
        resolve(root, "apps", "web", "package.json"),
      );
      const postgresModule = requireFromWeb("postgres");
      const postgres = postgresModule.default ?? postgresModule;
      client = postgres(databaseUrl, {
        prepare: false,
        connect_timeout: 3,
        max: 1,
      });
      const result = await client`select 1 as ready`;
      record(
        "database-query",
        result[0]?.ready === 1,
        "connected and completed SELECT 1",
      );
    } catch (error) {
      record(
        "database-query",
        false,
        error instanceof Error ? error.message : "database query failed",
      );
    } finally {
      await client?.end({ timeout: 1 }).catch(() => undefined);
    }
  }
}

if (process.argv.includes("--live-voice")) {
  const capture = process.env.AI_TUTOR_FAKE_AUDIO_CAPTURE?.trim();
  record(
    "fake-audio-capture",
    Boolean(capture && existsSync(resolve(capture))),
    capture
      ? "configured path was checked without opening the physical microphone"
      : "AI_TUTOR_FAKE_AUDIO_CAPTURE is required; physical microphone is forbidden",
  );
  record(
    "muted-live-mode",
    process.env.AI_TUTOR_LIVE_REALTIME === "1",
    "AI_TUTOR_LIVE_REALTIME=1 is required; Playwright adds --mute-audio",
  );
}

console.log(
  JSON.stringify(
    {
      status:
        failures.length > 0
          ? "BLOCKED"
          : warnings.length > 0
            ? "READY_WITH_FALLBACK"
            : "READY",
      checks,
      warnings,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  process.exitCode = 1;
}
