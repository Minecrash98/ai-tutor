import { BOX_MODEL_COURSE } from "./courses/box-model-v1";
import { FLEX_COURSE } from "./courses/flex-v1";
import { POSITIONING_COURSE } from "./courses/positioning-v1";
import type {
  CurriculumCourse,
  CurriculumCourseId,
  HintDefinition,
} from "./schema";

export interface MisconceptionDiagnosis {
  readonly ruleId: string;
  readonly misconceptionId: string;
  readonly state: "none" | "uncertain" | "supported";
  readonly matchedSignals: readonly string[];
  readonly matchedObservationIds: readonly string[];
  readonly matchedStages: readonly DiagnosticObservationStage[];
  readonly minimumOccurrences: number;
  readonly correctionQuestion: string;
}

export type DiagnosticObservationStage =
  | "prediction"
  | "operation"
  | "explanation"
  | "transfer";

export interface DiagnosticObservation {
  readonly observationId: string;
  readonly stage: DiagnosticObservationStage;
  readonly signalId: string;
}

const DIAGNOSTIC_COURSE_BY_ID = {
  "box-model-v1": BOX_MODEL_COURSE,
  "flex-v1": FLEX_COURSE,
  "positioning-v1": POSITIONING_COURSE,
} as const;

export function diagnoseMisconception(
  courseId: CurriculumCourseId,
  misconceptionId: string,
  observed: readonly (string | DiagnosticObservation)[],
): MisconceptionDiagnosis {
  const course = DIAGNOSTIC_COURSE_BY_ID[courseId];
  const misconception = course.misconceptions.find(
    (candidate) => candidate.id === misconceptionId,
  );
  if (!misconception) {
    throw new Error(
      "unknown misconception " + misconceptionId + " for " + courseId,
    );
  }
  const observations = observed.map((item, index): DiagnosticObservation => {
    if (typeof item !== "string") return item;
    const prefix = item.split(".", 1)[0];
    const stage: DiagnosticObservationStage =
      prefix === "prediction" ||
      prefix === "operation" ||
      prefix === "explanation" ||
      prefix === "transfer"
        ? prefix
        : "operation";
    return {
      observationId: `legacy-${index + 1}`,
      stage,
      signalId: item,
    };
  });
  const matches = observations.filter((observation) =>
    misconception.evidenceSignals.includes(observation.signalId),
  );
  const distinctSignals = [...new Set(matches.map((item) => item.signalId))];
  const distinctObservationIds = [
    ...new Set(matches.map((item) => item.observationId)),
  ];
  const distinctStages = [...new Set(matches.map((item) => item.stage))];
  const enoughIndependentEvidence =
    distinctSignals.length >= misconception.minimumOccurrences &&
    distinctObservationIds.length >= misconception.minimumOccurrences &&
    distinctStages.length >= 2;
  return Object.freeze({
    ruleId: course.evaluatorId + ":" + misconception.id,
    misconceptionId: misconception.id,
    state:
      distinctSignals.length === 0
        ? "none"
        : enoughIndependentEvidence
          ? "supported"
          : "uncertain",
    matchedSignals: Object.freeze(distinctSignals),
    matchedObservationIds: Object.freeze(distinctObservationIds),
    matchedStages: Object.freeze(distinctStages),
    minimumOccurrences: misconception.minimumOccurrences,
    correctionQuestion: misconception.correctionQuestion,
  });
}

export function diagnoseCourseMisconceptions(
  courseId: CurriculumCourseId,
  observations: readonly DiagnosticObservation[],
): readonly MisconceptionDiagnosis[] {
  return Object.freeze(
    DIAGNOSTIC_COURSE_BY_ID[courseId].misconceptions.map((misconception) =>
      diagnoseMisconception(courseId, misconception.id, observations),
    ),
  );
}

export interface HintDecision {
  readonly ruleId: string;
  readonly hint: HintDefinition;
  readonly independentCreditEligible: boolean;
  readonly reason: string;
}

export function chooseHint(
  course: CurriculumCourse,
  requestedLevel: 1 | 2 | 3,
): HintDecision {
  const hint = course.hints[requestedLevel - 1];
  if (!hint || hint.level !== requestedLevel) {
    throw new Error("course " + course.id + " is missing hint level " + requestedLevel);
  }
  return Object.freeze({
    ruleId: course.evaluatorId + ":hint-v1",
    hint,
    independentCreditEligible: hint.creditEligibleAfterUse,
    reason:
      requestedLevel === 1
        ? "先给不含答案的方向线索"
        : requestedLevel === 2
          ? "在一次未解决后给可核对的事实"
          : "学生明确请求示范；本轮不计独立达成",
  });
}
