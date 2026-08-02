import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const prereg = JSON.parse(
  readFileSync(resolve(root, "research", "preregistration.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(
    resolve(root, "research", "instruments", "frozen-item-manifest.json"),
    "utf8",
  ),
);
const productionManifestSource = readFileSync(
  resolve(root, "packages", "curriculum", "src", "transfer-bank.ts"),
  "utf8",
);
const productionItems = [...productionManifestSource.matchAll(
  /\{\s*itemId:\s*"([^"]+)",\s*courseId:\s*"([^"]+)",\s*sha256:\s*"([a-f0-9]{64})",\s*visibility:\s*"server-hidden",\s*kind:\s*"(immediate-hidden|delayed-retention)"/g,
)].map((match) => ({
  itemId: match[1],
  courseId: match[2],
  sha256: match[3],
  window: match[4] === "immediate-hidden" ? "immediate-hidden" : "24-72-hours",
}));
const issues = [];
if (prereg.status !== "DRAFT_NOT_EXTERNALLY_REGISTERED") {
  issues.push("machine validation must not declare external registration");
}
if (prereg.externalRegistrationId !== null || prereg.frozenAt !== null) {
  issues.push("external ID and freeze time must remain null until real registration");
}
if (prereg.outcomes.length < 5) issues.push("five disaggregated outcomes are required");
if (!prereg.analysis.missingPrimaryRule || !prereg.analysis.exclusions.length) {
  issues.push("missing-data and exclusion rules are required");
}
if (manifest.answersIncluded !== false || manifest.items.length !== 6) {
  issues.push("six answer-free hidden item hashes are required");
}
if (productionItems.length !== 6) {
  issues.push("production hidden-item manifest must contain exactly six parseable entries");
}
const researchById = new Map(manifest.items.map((item) => [item.itemId, item]));
for (const productionItem of productionItems) {
  const researchItem = researchById.get(productionItem.itemId);
  if (
    !researchItem ||
    researchItem.courseId !== productionItem.courseId ||
    researchItem.sha256 !== productionItem.sha256 ||
    researchItem.window !== productionItem.window
  ) {
    issues.push("research/production hidden-item drift: " + productionItem.itemId);
  }
}
if (new Set(manifest.items.map((item) => item.itemId)).size !== manifest.items.length) {
  issues.push("research hidden-item IDs must be unique");
}
for (const item of manifest.items) {
  if (!/^[a-f0-9]{64}$/.test(item.sha256)) {
    issues.push("invalid item hash: " + item.itemId);
  }
}
if (JSON.stringify(prereg).match(/"results?"\s*:/i)) {
  issues.push("preregistration must not contain result fields");
}
if (issues.length) {
  for (const issue of issues) process.stderr.write("[prereg] " + issue + "\n");
  process.exit(1);
}
process.stdout.write(
  JSON.stringify({
    status: prereg.status,
    outcomes: prereg.outcomes.length,
    hiddenItems: manifest.items.length,
    realParticipants: 0,
    externalRegistration: false
  }) + "\n",
);
