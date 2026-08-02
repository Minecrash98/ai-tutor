import {
  LEARNING_ANALYSIS_VERSION,
  LEARNING_EVALUATOR_ID,
  LEARNING_EVALUATOR_VERSION,
  LEARNING_RUBRIC_ID,
  LEARNING_RUBRIC_VERSION,
  learningEvidenceAnalysisResultSchema,
  type LearnerEvidenceState,
  type LearningEvidenceAnalysisResult,
  type LearningEvidenceStatus,
  type LearningLessonState,
  type LearningMilestoneAnalysis,
  type LearningReplayBundle,
} from "@ai-tutor/contracts";

const CLAIM_BOUNDARY =
  "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。" as const;

function sourceIds(
  replay: LearningReplayBundle,
  eventTypes: readonly string[],
): readonly string[] {
  const accepted = new Set(eventTypes);
  return replay.events
    .filter((record) => accepted.has(record.event.type))
    .map((record) => record.event.eventId);
}

function statusAndState(
  present: boolean,
  met: boolean,
  independent: boolean,
): {
  readonly status: LearningEvidenceStatus;
  readonly learnerState: LearnerEvidenceState;
} {
  if (!present) return { status: "missing", learnerState: "no-evidence" };
  if (!met) return { status: "not-met", learnerState: "attempted" };
  return {
    status: "met",
    learnerState: independent
      ? "independent-demonstration"
      : "supported-demonstration",
  };
}

function milestone(input: {
  readonly milestoneId: LearningMilestoneAnalysis["milestoneId"];
  readonly criterion: string;
  readonly observed: string;
  readonly sourceEventIds: readonly string[];
  readonly met: boolean;
  readonly independent: boolean;
}): LearningMilestoneAnalysis {
  return {
    milestoneId: input.milestoneId,
    ...statusAndState(
      input.sourceEventIds.length > 0,
      input.met,
      input.independent,
    ),
    criterion: input.criterion,
    observed:
      input.sourceEventIds.length === 0
        ? "没有对应的学生操作记录。"
        : input.observed,
    sourceEventIds: input.sourceEventIds,
  };
}

export function buildLearningEvidenceAnalysis(
  replay: LearningReplayBundle,
  state: LearningLessonState,
): LearningEvidenceAnalysisResult {
  const scenario = "lessonKind" in state;
  const independent = state.independentCreditEligible;
  const predictionIds = sourceIds(
    replay,
    scenario ? ["scenario-predict"] : ["predict"],
  );
  const observationIds = sourceIds(
    replay,
    scenario ? ["scenario-experiment-saved"] : ["experiment-saved"],
  );
  const explanationIds = sourceIds(
    replay,
    scenario ? ["scenario-explain"] : ["explain"],
  );
  const transferIds = sourceIds(
    replay,
    scenario ? ["scenario-transfer-submit"] : ["transfer-submit"],
  );
  const passedObservations = scenario
    ? new Set(
        state.observations
          .filter((observation) => observation.passed)
          .map((observation) => observation.revisionId),
      ).size
    : state.observedPaddingPx === 32
      ? 1
      : 0;
  const requiredObservations = scenario ? 3 : 1;

  return learningEvidenceAnalysisResultSchema.parse({
    analysisVersion: LEARNING_ANALYSIS_VERSION,
    lessonKind: replay.session.lessonKind,
    sourceEventSchemaVersion: replay.schemaVersion,
    sourceThroughSequence: replay.events.length,
    rubric: {
      id: LEARNING_RUBRIC_ID,
      version: LEARNING_RUBRIC_VERSION,
    },
    evaluator: {
      id: LEARNING_EVALUATOR_ID,
      version: LEARNING_EVALUATOR_VERSION,
    },
    scoringModel: null,
    independentCreditEligible: independent,
    milestones: [
      milestone({
        milestoneId: "prediction",
        criterion: "学生在查看结果前提交自己的判断。",
        observed: scenario
          ? `已记录预测：${state.prediction ?? "未填写"}。`
          : `已记录预测：${state.prediction ?? "未填写"}。`,
        sourceEventIds: predictionIds,
        met: state.prediction !== null,
        independent,
      }),
      milestone({
        milestoneId: "observation",
        criterion: scenario
          ? "学生亲手保存三个满足课程目标的不同变化。"
          : "学生亲手把内侧空隙调整并保存为 32px。",
        observed: `满足目标的保存记录：${passedObservations}/${requiredObservations}。`,
        sourceEventIds: observationIds,
        met: passedObservations >= requiredObservations,
        independent,
      }),
      milestone({
        milestoneId: "explanation",
        criterion: "学生提交的原因解释与页面中的真实变化一致。",
        observed:
          state.explanationCorrect === true
            ? "最后一次解释与页面事实一致。"
            : "已有解释记录，但尚未与页面事实一致。",
        sourceEventIds: explanationIds,
        met: state.explanationCorrect === true,
        independent,
      }),
      milestone({
        milestoneId: "transfer",
        criterion: "学生在新页面独立写出并运行正确的 CSS。",
        observed:
          state.transferPassed === true
            ? "新页面挑战已运行通过。"
            : "已有提交记录，但新页面挑战尚未通过。",
        sourceEventIds: transferIds,
        met: state.transferPassed === true,
        independent,
      }),
    ],
    claimBoundary: CLAIM_BOUNDARY,
  });
}
