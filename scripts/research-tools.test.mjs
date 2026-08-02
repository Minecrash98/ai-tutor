import assert from "node:assert/strict";
import test from "node:test";
import {
  requiredPerGroupForTwoProportions,
  summarizeBinary,
  summarizeDelayed,
  wilsonInterval,
} from "./research-analysis-lib.mjs";

test("Wilson interval keeps honest uncertainty for a 12-person pilot", () => {
  const interval = wilsonInterval(8, 12);
  assert.ok(interval.lower < 8 / 12);
  assert.ok(interval.upper > 8 / 12);
  assert.ok(interval.upper - interval.lower > 0.3);
});

test("primary binary analysis keeps missing starts in the denominator", () => {
  assert.deepEqual(summarizeBinary([true, false, null]), {
    successes: 1,
    total: 3,
    missing: 1,
    rate: 1 / 3,
    wilson95: wilsonInterval(1, 3),
  });
});

test("delayed missingness is reported as observed and best/worst sensitivity", () => {
  const summary = summarizeDelayed([true, false, null, null]);
  assert.equal(summary.observed.total, 2);
  assert.equal(summary.missing, 2);
  assert.equal(summary.worstCase.successes, 1);
  assert.equal(summary.bestCase.successes, 3);
});

test("power planning is deterministic and rejects post-hoc no-effect input", () => {
  assert.equal(requiredPerGroupForTwoProportions(0.5, 0.7), 93);
  assert.throws(() => requiredPerGroupForTwoProportions(0.5, 0.5));
});
