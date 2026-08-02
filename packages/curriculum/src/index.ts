export * from "./schema";
export * from "./transfer-bank";
export * from "./adaptation";
export * from "./misconception-benchmark";
export * from "./diagnostic";
export { BOX_MODEL_COURSE } from "./courses/box-model-v1";
export { FLEX_COURSE } from "./courses/flex-v1";
export { POSITIONING_COURSE } from "./courses/positioning-v1";

import { BOX_MODEL_COURSE } from "./courses/box-model-v1";
import { FLEX_COURSE } from "./courses/flex-v1";
import { POSITIONING_COURSE } from "./courses/positioning-v1";

export const CURRICULUM_COURSES = Object.freeze([
  BOX_MODEL_COURSE,
  FLEX_COURSE,
  POSITIONING_COURSE,
]);

export const COURSE_BY_ID = Object.freeze({
  "box-model-v1": BOX_MODEL_COURSE,
  "flex-v1": FLEX_COURSE,
  "positioning-v1": POSITIONING_COURSE,
});
