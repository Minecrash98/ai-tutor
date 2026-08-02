import {
  diagnoseMisconception,
  type DiagnosticObservation,
  type DiagnosticObservationStage,
} from "./diagnostic";
import type { CurriculumCourseId } from "./schema";

export interface HeldOutStudentAction {
  readonly actionId: string;
  readonly stage: DiagnosticObservationStage;
  readonly responseCode: string;
}

export interface HeldOutDiagnosticSample {
  readonly sampleId: string;
  readonly split: "held-out";
  readonly courseId: CurriculumCourseId;
  readonly misconceptionId: string;
  readonly actions: readonly HeldOutStudentAction[];
  readonly expectedSupported: boolean;
}

const action = (
  actionId: string,
  stage: DiagnosticObservationStage,
  responseCode: string,
): HeldOutStudentAction => ({ actionId, stage, responseCode });

export const HELD_OUT_DIAGNOSTIC_SAMPLES: readonly HeldOutDiagnosticSample[] =
  Object.freeze([
    { sampleId: "flex-axis-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.axes-swapped", actions: [action("axis-op", "operation", "justify-for-cross-axis"), action("axis-explain", "explanation", "axes-coupled")], expectedSupported: true },
    { sampleId: "flex-axis-one-error", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.axes-swapped", actions: [action("axis-op-only", "operation", "justify-for-cross-axis"), action("axis-unrelated", "explanation", "gap-is-padding")], expectedSupported: false },
    { sampleId: "flex-gap-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.gap-resizes-items", actions: [action("gap-predict", "prediction", "gap-resizes"), action("gap-explain", "explanation", "gap-is-padding")], expectedSupported: true },
    { sampleId: "flex-gap-unrelated", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.gap-resizes-items", actions: [action("gap-op-unrelated", "operation", "flex-on-item"), action("gap-predict-unrelated", "prediction", "default-wrap")], expectedSupported: false },
    { sampleId: "flex-container-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.item-owns-container-rules", actions: [action("container-op", "operation", "flex-on-item"), action("container-transfer", "transfer", "container-rule-on-child")], expectedSupported: true },
    { sampleId: "flex-container-one-error", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.item-owns-container-rules", actions: [action("container-op-only", "operation", "flex-on-item")], expectedSupported: false },
    { sampleId: "flex-margin-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.margin-equals-gap", actions: [action("margin-op", "operation", "item-margin-for-gap"), action("margin-explain", "explanation", "gap-equals-outer-margin")], expectedSupported: true },
    { sampleId: "flex-margin-unrelated", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.margin-equals-gap", actions: [action("margin-predict-unrelated", "prediction", "gap-resizes"), action("margin-explain-unrelated", "explanation", "gap-is-padding")], expectedSupported: false },
    { sampleId: "flex-wrap-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.wrap-assumed", actions: [action("wrap-predict", "prediction", "default-wrap"), action("wrap-explain", "explanation", "wrap-without-rule")], expectedSupported: true },
    { sampleId: "flex-wrap-one-error", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.wrap-assumed", actions: [action("wrap-predict-only", "prediction", "default-wrap")], expectedSupported: false },
    { sampleId: "flex-direction-positive", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.direction-keeps-axis", actions: [action("direction-op", "operation", "column-justify-horizontal"), action("direction-explain", "explanation", "axis-ignores-direction")], expectedSupported: true },
    { sampleId: "flex-direction-unrelated", split: "held-out", courseId: "flex-v1", misconceptionId: "flex.direction-keeps-axis", actions: [action("direction-op-unrelated", "operation", "item-margin-for-gap"), action("direction-explain-unrelated", "explanation", "gap-equals-outer-margin")], expectedSupported: false },
  ]);

export function extractDiagnosticObservations(
  actions: readonly HeldOutStudentAction[],
): readonly DiagnosticObservation[] {
  return Object.freeze(
    actions.map((studentAction) => ({
      observationId: studentAction.actionId,
      stage: studentAction.stage,
      signalId: `${studentAction.stage}.${studentAction.responseCode}`,
    })),
  );
}

export interface DiagnosticBenchmarkResult {
  readonly total: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
}

export function evaluateDiagnosticBenchmark(
  samples: readonly HeldOutDiagnosticSample[],
): DiagnosticBenchmarkResult {
  let negatives = 0;
  let positives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const sample of samples) {
    const actual =
      diagnoseMisconception(
        sample.courseId,
        sample.misconceptionId,
        extractDiagnosticObservations(sample.actions),
      ).state === "supported";
    if (sample.expectedSupported) {
      positives += 1;
      if (!actual) falseNegatives += 1;
    } else {
      negatives += 1;
      if (actual) falsePositives += 1;
    }
  }
  return Object.freeze({
    total: samples.length,
    falsePositives,
    falseNegatives,
    falsePositiveRate: negatives === 0 ? 0 : falsePositives / negatives,
    falseNegativeRate: positives === 0 ? 0 : falseNegatives / positives,
  });
}
