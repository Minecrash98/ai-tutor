import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const outputs = {
  web: "evidence/P8_CONTAINER_SBOM_2026-08-02.cdx.json",
  migrate: "evidence/P8_MIGRATION_CONTAINER_SBOM_2026-08-02.cdx.json",
  database: "evidence/P8_DATABASE_CONTAINER_SBOM_2026-08-02.cdx.json",
};

function run(command, args, timeout = 180_000) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      command + " " + args.join(" ") + " failed: " +
        (result.stderr || result.stdout),
    );
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function serviceForImage(row) {
  if (row.ContainerName.includes("-web-")) return "web";
  if (row.ContainerName.includes("-migrate-")) return "migrate";
  if (row.ContainerName.includes("-db-")) return "database";
  return null;
}

const scoutVersionOutput = run("docker", ["scout", "version"]).stdout;
const scoutVersion =
  scoutVersionOutput.match(/version:\s+v?([^\s]+)/i)?.[1] ?? null;
if (scoutVersion !== "1.21.0") {
  throw new Error(
    "Docker Scout 1.21.0 is required for canonical image SBOMs; found " +
      scoutVersion,
  );
}

const rows = JSON.parse(
  run("docker", ["compose", "images", "--format", "json"]).stdout,
);
const scanned = {};
for (const row of rows) {
  const service = serviceForImage(row);
  if (!service) continue;
  const outputPath = resolve(root, outputs[service]);
  run(
    "docker",
    [
      "scout",
      "sbom",
      "--format",
      "cyclonedx",
      "--output",
      outputPath,
      "local://" + row.ID,
    ],
    300_000,
  );
  const content = readFileSync(outputPath);
  const document = JSON.parse(content.toString("utf8"));
  const sbomDigest =
    document.metadata?.component?.purl?.match(
      /@sha256:([a-f0-9]{64})/,
    )?.[1] ?? null;
  const imageDigest = row.ID.replace(/^sha256:/, "");
  if (sbomDigest !== imageDigest) {
    throw new Error(
      service +
        " SBOM digest mismatch: sbom=" +
        sbomDigest +
        " image=" +
        imageDigest,
    );
  }
  scanned[service] = {
    image: {
      id: row.ID,
      repository: row.Repository,
      tag: row.Tag || null,
      platform: row.Platform,
      sizeBytes: row.Size,
      created: row.Created,
    },
    sbom: {
      path: outputs[service],
      sha256: sha256(content),
      componentCount: Array.isArray(document.components)
        ? document.components.length
        : null,
    },
  };
}
for (const service of Object.keys(outputs)) {
  if (!scanned[service]) throw new Error("missing Compose image " + service);
}

const inventoryPath = resolve(
  root,
  "evidence",
  "P8_LICENSE_INVENTORY_2026-08-02.json",
);
const inventoryContent = readFileSync(inventoryPath);
const inventory = JSON.parse(inventoryContent.toString("utf8"));
const bundledClientLibraries = inventory.components
  .filter(
    (component) =>
      component.name === "tldraw" ||
      component.name.startsWith("@tldraw/"),
  )
  .map((component) => ({
    name: component.name,
    version: component.version,
    license: component.license,
    evidence:
      "frozen workspace inventory plus direct/client bundle dependency; package manifests are not preserved in optimized static chunks",
  }));
const licenseContent = readFileSync(
  resolve(root, "licenses", "tldraw-v3.15.5-LICENSE.md"),
);
const distribution = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scanner: {
    name: "docker-scout",
    version: scoutVersion,
    command: "docker scout sbom --format cyclonedx local://<image-digest>",
  },
  images: scanned,
  bundledClientLibraries,
  sourceInventory: {
    path: "evidence/P8_LICENSE_INVENTORY_2026-08-02.json",
    sha256: sha256(inventoryContent),
    lockfileSha256: inventory.lockfile.sha256,
  },
  tldrawLicenseCopy: {
    path: "licenses/tldraw-v3.15.5-LICENSE.md",
    sha256: sha256(licenseContent),
  },
  scope:
    "The three image SBOMs cover packages and OS files discoverable in the optimized images. The source inventory complements them for browser libraries compiled into static chunks, whose package manifests are absent. Neither source alone is complete; this manifest binds both without claiming legal review.",
};
const distributionPath = resolve(
  root,
  "evidence",
  "P8_DISTRIBUTION_MANIFEST_2026-08-02.json",
);
writeFileSync(
  distributionPath,
  JSON.stringify(distribution, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    generatedAt: distribution.generatedAt,
    scannerVersion: scoutVersion,
    images: Object.fromEntries(
      Object.entries(scanned).map(([service, value]) => [
        service,
        {
          id: value.image.id,
          sizeBytes: value.image.sizeBytes,
          componentCount: value.sbom.componentCount,
        },
      ]),
    ),
    bundledClientLibraryCount: bundledClientLibraries.length,
    distributionManifest: "evidence/P8_DISTRIBUTION_MANIFEST_2026-08-02.json",
  }) + "\n",
);
