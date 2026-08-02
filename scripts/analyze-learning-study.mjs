import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summarizeBinary,
  summarizeDelayed,
} from "./research-analysis-lib.mjs";

const inputFlag = process.argv.indexOf("--input");
if (inputFlag < 0 || !process.argv[inputFlag + 1]) {
  throw new Error("--input <de-identified-json> is required; no result is generated without data");
}
const input = JSON.parse(
  readFileSync(resolve(process.argv[inputFlag + 1]), "utf8"),
);
if (!Array.isArray(input.rows)) throw new Error("input.rows must be an array");
const rows = input.rows.filter((row) => row.withdrawnBeforeStart !== true);
const result = {
  schemaVersion: 1,
  sourceKind: input.synthetic === true ? "SYNTHETIC_TEST_ONLY" : "REAL_DEIDENTIFIED_DATA",
  enrolled: rows.length,
  firstDragWithin45Seconds: summarizeBinary(
    rows.map((row) =>
      typeof row.firstDragMs === "number" ? row.firstDragMs <= 45_000 : null,
    ),
  ),
  independentCompletion: summarizeBinary(
    rows.map((row) =>
      row.completedWithinSevenMinutes === true && row.highestHintLevel < 3
        ? true
        : row.completedWithinSevenMinutes === null
          ? null
          : false,
    ),
  ),
  immediateTransfer: summarizeBinary(
    rows.map((row) => row.immediateTransferPassed ?? null),
  ),
  delayedRetention: summarizeDelayed(
    rows.map((row) => row.delayedTransferPassed ?? null),
  ),
  claimBoundary:
    input.synthetic === true
      ? "Synthetic output validates analysis code only and is not user research evidence."
      : "Pilot output is directional unless a preregistered comparison study is supplied.",
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
