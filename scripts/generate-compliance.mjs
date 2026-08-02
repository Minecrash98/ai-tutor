import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const portableCheckOnly = process.argv.includes("--check");
const exactCheckOnly = process.argv.includes("--check-exact");
const inventoryPath = resolve(
  root,
  "evidence",
  "P8_LICENSE_INVENTORY_2026-08-02.json",
);
const sbomPath = resolve(root, "evidence", "P8_SBOM_2026-08-02.cdx.json");
const noticesPath = resolve(root, "THIRD_PARTY_NOTICES.md");
const tldrawLicensePath = resolve(
  root,
  "licenses",
  "tldraw-v3.15.5-LICENSE.md",
);
const lockfilePath = resolve(root, "pnpm-lock.yaml");

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
const lockfileSha256 = sha256(readFileSync(lockfilePath));
const tldrawLicenseSha256 = sha256(readFileSync(tldrawLicensePath));
const componentKey = (component) => `${component.name}@${component.version}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateStoredArtifacts() {
  for (const path of [inventoryPath, sbomPath, noticesPath, tldrawLicensePath]) {
    assert(existsSync(path), `compliance artifact is missing: ${path}`);
  }

  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  const notices = readFileSync(noticesPath, "utf8");
  assert(inventory.schemaVersion === 2, "inventory schemaVersion must be 2");
  assert(
    typeof inventory.generatedAt === "string" &&
      Number.isFinite(Date.parse(inventory.generatedAt)),
    "inventory generatedAt is invalid",
  );
  assert(
    inventory.lockfile?.sha256 === lockfileSha256,
    "inventory lockfile hash does not match pnpm-lock.yaml",
  );
  assert(
    inventory.unresolvedLicenseCount === 0,
    "inventory contains unresolved licenses",
  );
  assert(Array.isArray(inventory.components), "inventory components are missing");
  assert(
    inventory.reportedComponentCount === inventory.components.length,
    "inventory component count is inconsistent",
  );
  const inventoryKeys = new Set();
  for (const component of inventory.components) {
    assert(
      typeof component.name === "string" &&
        typeof component.version === "string" &&
        typeof component.license === "string" &&
        component.license !== "Unknown",
      "inventory contains an invalid or unknown component",
    );
    const key = componentKey(component);
    assert(!inventoryKeys.has(key), `inventory component is duplicated: ${key}`);
    inventoryKeys.add(key);
  }
  const tldrawMapping = inventory.customLicenseMappings?.find(
    (mapping) => mapping.license === "LicenseRef-tldraw-v3",
  );
  assert(tldrawMapping, "tldraw custom license mapping is missing");
  assert(
    tldrawMapping.verbatimCopy === "licenses/tldraw-v3.15.5-LICENSE.md" &&
      tldrawMapping.verbatimSha256 === tldrawLicenseSha256,
    "tldraw verbatim license copy hash does not match the inventory",
  );

  assert(
    sbom.bomFormat === "CycloneDX" && sbom.specVersion === "1.6",
    "source SBOM is not CycloneDX 1.6",
  );
  assert(Array.isArray(sbom.components), "source SBOM components are missing");
  const sbomKeys = new Set(sbom.components.map(componentKey));
  assert(
    sbomKeys.size === inventoryKeys.size &&
      [...inventoryKeys].every((key) => sbomKeys.has(key)),
    "source SBOM and license inventory component sets differ",
  );
  const lockProperty = sbom.metadata?.component?.properties?.find(
    (property) => property.name === "ai-tutor:pnpm-lock-sha256",
  );
  assert(
    lockProperty?.value === lockfileSha256,
    "source SBOM lockfile property does not match pnpm-lock.yaml",
  );
  assert(
    notices.includes(lockfileSha256) &&
      notices.includes("licenses/tldraw-v3.15.5-LICENSE.md") &&
      notices.includes(tldrawLicenseSha256),
    "third-party notice is not bound to the current lockfile and tldraw license",
  );
  return {
    generatedAt: inventory.generatedAt,
    reportedComponentCount: inventory.reportedComponentCount,
  };
}

if (portableCheckOnly) {
  const result = validateStoredArtifacts();
  process.stdout.write(
    `${JSON.stringify({
      mode: "check-portable",
      ...result,
      lockfileSha256,
      tldrawLicenseSha256,
      unresolvedLicenseCount: 0,
    })}\n`,
  );
  process.exit(0);
}

let generatedAt = new Date().toISOString();
if (exactCheckOnly) {
  const result = validateStoredArtifacts();
  generatedAt = result.generatedAt;
}

const command =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : "pnpm";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm licenses list --prod --json"]
    : ["licenses", "list", "--prod", "--json"];
const commandResult = spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
});
if (commandResult.status !== 0) {
  throw new Error(
    `pnpm license inventory failed: ${commandResult.stderr || commandResult.stdout}`,
  );
}

const rawInventory = JSON.parse(commandResult.stdout);
const tldrawLicensePackages = new Set([
  "@tldraw/editor@3.15.5",
  "tldraw@3.15.5",
]);
const componentsByKey = new Map();
const unresolved = [];
for (const [declaredLicense, entries] of Object.entries(rawInventory)) {
  for (const entry of entries) {
    for (const version of entry.versions) {
      const key = `${entry.name}@${version}`;
      const isPinnedTldrawLicense =
        declaredLicense === "Unknown" && tldrawLicensePackages.has(key);
      const resolvedLicense = isPinnedTldrawLicense
        ? "LicenseRef-tldraw-v3"
        : declaredLicense;
      if (resolvedLicense === "Unknown") unresolved.push(key);
      componentsByKey.set(key, {
        name: entry.name,
        version,
        license: resolvedLicense,
        author: entry.author ?? null,
        homepage: entry.homepage ?? null,
        description: entry.description ?? null,
      });
    }
  }
}
if (unresolved.length > 0) {
  throw new Error(
    `unresolved reported licenses: ${unresolved.sort().join(", ")}`,
  );
}

const components = [...componentsByKey.values()].sort((left, right) =>
  componentKey(left).localeCompare(componentKey(right)),
);
const packagePurl = (name, version) => {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.slice(1).split("/");
    return `pkg:npm/%40${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
};
const byLicense = Object.groupBy(components, (component) => component.license);
const inventory = {
  schemaVersion: 2,
  artifactKind: "workspace-license-report",
  generatedAt,
  generatedOn: { platform: process.platform, architecture: process.arch },
  sourceCommand: "pnpm licenses list --prod --json",
  sourceScope:
    "frozen workspace installation report; complementary image SBOMs cover discoverable standalone and OS files",
  limitations: [
    "pnpm may report workspace tooling and platform-specific optional packages that are not copied into the standalone runtime image",
    "optimized browser chunks do not preserve every package manifest, so image scanners can miss bundled client libraries",
    "this engineering inventory is not an external legal opinion",
  ],
  runtimeDistributionEvidence:
    "evidence/P8_DISTRIBUTION_MANIFEST_2026-08-02.json",
  packageManager: "pnpm@10.12.3",
  lockfile: { path: "pnpm-lock.yaml", sha256: lockfileSha256 },
  reportedComponentCount: components.length,
  unresolvedLicenseCount: unresolved.length,
  licenseCounts: Object.fromEntries(
    Object.entries(byLicense)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([license, rows]) => [license, rows.length]),
  ),
  customLicenseMappings: [
    {
      packages: [...tldrawLicensePackages].sort(),
      license: "LicenseRef-tldraw-v3",
      verbatimCopy: "licenses/tldraw-v3.15.5-LICENSE.md",
      verbatimSha256: tldrawLicenseSha256,
      watermarkRequired: true,
    },
  ],
  components,
};
const sbom = {
  $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    timestamp: generatedAt,
    tools: {
      components: [
        { type: "application", name: "pnpm", version: "10.12.3" },
        {
          type: "application",
          name: "ai-tutor-compliance-generator",
          version: "2",
        },
      ],
    },
    component: {
      type: "application",
      name: "ai-tutor-workspace-report",
      version: "0.1.0",
      "bom-ref": "pkg:npm/ai-tutor@0.1.0",
      purl: "pkg:npm/ai-tutor@0.1.0",
      properties: [
        { name: "ai-tutor:pnpm-lock-sha256", value: lockfileSha256 },
        {
          name: "ai-tutor:scope",
          value: "workspace-report-not-runtime-image",
        },
      ],
    },
  },
  components: components.map((component) => ({
    type: "library",
    name: component.name,
    version: component.version,
    "bom-ref": packagePurl(component.name, component.version),
    purl: packagePurl(component.name, component.version),
    licenses:
      component.license === "LicenseRef-tldraw-v3"
        ? [{ license: { name: "tldraw license (watermark required)" } }]
        : [{ expression: component.license }],
    ...(component.homepage
      ? { externalReferences: [{ type: "website", url: component.homepage }] }
      : {}),
  })),
};

const noticeLines = [
  "# Third-party notices",
  "",
  `Generated: ${generatedAt}`,
  "",
  "This is the frozen workspace dependency report produced by pnpm. It can include workspace tooling and platform-specific optional packages that are not copied into the standalone runtime. Separate image SBOMs cover packages and OS files discoverable in the optimized web, migration, and database images; optimized browser chunks can omit package manifests, so the image and workspace records are complementary. These are reproducible engineering records, not an external legal opinion.",
  "",
  `Lockfile SHA-256: \`${lockfileSha256}\``,
  `tldraw license-copy SHA-256: \`${tldrawLicenseSha256}\``,
  "",
  "## tldraw 3.15.5",
  "",
  "The application uses the fixed free-license path for `tldraw` and `@tldraw/editor` 3.15.5. The visible `made with tldraw` watermark is retained. A verbatim license copy is included at `licenses/tldraw-v3.15.5-LICENSE.md`; the application does not require a paid tldraw license while that watermark path is used.",
  "",
  "On a public, non-localhost HTTPS origin, the pinned unlicensed SDK may request its watermark tracking SVG from tldraw's default CDN. Local HTTP/localhost validation does not make that request. This behavior must remain disclosed and be included in any public deployment privacy/CSP review.",
  "",
  "## Reported licenses",
  "",
];
for (const [license, rows] of Object.entries(byLicense).sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  noticeLines.push(`### ${license}`, "");
  for (const component of rows) {
    noticeLines.push(
      `- \`${component.name}@${component.version}\`${component.homepage ? ` — ${component.homepage}` : ""}`,
    );
  }
  noticeLines.push("");
}

const outputs = [
  [inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`],
  [sbomPath, `${JSON.stringify(sbom, null, 2)}\n`],
  [noticesPath, `${noticeLines.join("\n")}\n`],
];
if (exactCheckOnly) {
  const drifted = outputs
    .filter(
      ([path, expected]) =>
        !existsSync(path) || readFileSync(path, "utf8") !== expected,
    )
    .map(([path]) => path.slice(root.length + 1));
  if (drifted.length > 0) {
    throw new Error(
      `compliance artifacts are stale for ${process.platform}/${process.arch}: ${drifted.join(", ")}; run pnpm compliance:generate on the canonical platform`,
    );
  }
} else {
  mkdirSync(resolve(root, "evidence"), { recursive: true });
  for (const [path, content] of outputs) writeFileSync(path, content);
}
process.stdout.write(
  `${JSON.stringify({
    mode: exactCheckOnly ? "check-exact" : "generate",
    generatedAt,
    generatedOn: inventory.generatedOn,
    lockfileSha256,
    tldrawLicenseSha256,
    reportedComponentCount: components.length,
    unresolvedLicenseCount: unresolved.length,
  })}\n`,
);
