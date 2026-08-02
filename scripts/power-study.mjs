import { requiredPerGroupForTwoProportions } from "./research-analysis-lib.mjs";

const control = Number(process.argv[2]);
const treatment = Number(process.argv[3]);
if (!Number.isFinite(control) || !Number.isFinite(treatment)) {
  throw new Error("usage: node scripts/power-study.mjs <control-rate> <treatment-rate>");
}
const perGroup = requiredPerGroupForTwoProportions(control, treatment);
process.stdout.write(
  JSON.stringify({
    status: "PLANNING_ONLY_NOT_PREREGISTERED",
    assumedControlRate: control,
    assumedTreatmentRate: treatment,
    alphaTwoSided: 0.05,
    targetPower: 0.8,
    requiredPerGroupApproximation: perGroup,
    attritionNotIncluded: true
  }) + "\n",
);
