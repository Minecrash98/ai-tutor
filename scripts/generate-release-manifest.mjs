import { spawnSync } from "node:child_process";
import { createReleaseManifest } from "./release-manifest.mjs";

const root = process.cwd();

function docker(args) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      "docker " + args.join(" ") + " failed: " +
        (result.stderr || result.stdout),
    );
  }
  return result.stdout.trim();
}

function resolveComposeContainer(service) {
  const ids = docker(["compose", "ps", "-q", service])
    .split(/\r?\n/)
    .filter(Boolean);
  if (ids.length !== 1) {
    throw new Error(
      `expected exactly one running Compose ${service} container; found ${ids.length}`,
    );
  }
  const id = ids[0];
  const name = docker(["inspect", "--format", "{{.Name}}", id]).replace(
    /^\//,
    "",
  );
  if (!name) {
    throw new Error(`could not resolve the Compose ${service} container name`);
  }
  return { service, id, name };
}

const runId =
  process.env.AI_TUTOR_RELEASE_RUN_ID ??
  new Date().toISOString().replace(/[:.]/g, "-");
const expectedContainers = {
  web: resolveComposeContainer("web"),
  database: resolveComposeContainer("db"),
};
const result = createReleaseManifest({ runId, expectedContainers });

process.stdout.write(
  JSON.stringify({
    runId,
    path: result.relativePath,
    sha256: result.sha256,
    sourceSha256: result.manifest.source.sha256,
    sourceFileCount: result.manifest.source.fileCount,
    git: result.manifest.source.git,
    images: Object.fromEntries(
      Object.entries(result.manifest.images).map(([service, image]) => [
        service,
        image.id,
      ]),
    ),
    scope:
      "Release fingerprint only. This command does not run or imply a soak test.",
  }) + "\n",
);
