import {
  MINIMAL_LEARNER_MODEL_VERSION,
  minimalLearnerModelSchema,
  type LearnerMisconceptionEvidence,
  type LearningEvidenceAnalysis,
  type LearningLessonKind,
  type MinimalLearnerModel,
} from "@ai-tutor/contracts";

const LESSON_ORDER: readonly LearningLessonKind[] = [
  "box-model-v1",
  "flex-v1",
  "positioning-v1",
];

export function buildMinimalLearnerModel(
  analyses: readonly LearningEvidenceAnalysis[],
  misconceptionEvidence: readonly LearnerMisconceptionEvidence[] = [],
): MinimalLearnerModel {
  const latestByLesson = new Map<LearningLessonKind, LearningEvidenceAnalysis>();
  for (const analysis of [...analyses].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )) {
    if (!latestByLesson.has(analysis.result.lessonKind)) {
      latestByLesson.set(analysis.result.lessonKind, analysis);
    }
  }

  return minimalLearnerModelSchema.parse({
    modelVersion: MINIMAL_LEARNER_MODEL_VERSION,
    scope: "learning-evidence-only",
    concepts: LESSON_ORDER.flatMap((lessonKind) => {
      const analysis = latestByLesson.get(lessonKind);
      if (!analysis) return [];
      const byMilestone = new Map(
        analysis.result.milestones.map((milestone) => [
          milestone.milestoneId,
          milestone,
        ]),
      );
      const explanation = byMilestone.get("explanation");
      const observation = byMilestone.get("observation");
      const transfer = byMilestone.get("transfer");
      if (!explanation || !observation || !transfer) return [];
      return [
        {
          lessonKind,
          sourceSessionId: analysis.sessionId,
          sourceAnalysisId: analysis.analysisId,
          sourceThroughSequence: analysis.sourceThroughSequence,
          analyzedAt: analysis.createdAt,
          conceptState: analysis.result.milestones.map((milestone) => ({
            milestoneId: milestone.milestoneId,
            status: milestone.status,
            learnerState: milestone.learnerState,
            sourceEventIds: milestone.sourceEventIds,
          })),
          hintDependency: analysis.result.independentCreditEligible
            ? "no-support-recorded"
            : "support-recorded",
          explanationResult: explanation.status,
          practiceResult: {
            guidedObservation: observation.status,
            independentTransfer: transfer.status,
          },
          misconceptions: misconceptionEvidence.filter(
            (item) =>
              item.lessonKind === lessonKind &&
              item.sourceSessionId === analysis.sessionId,
          ),
        },
      ];
    }),
    deletion: {
      strategy: "derived-from-owner-bound-session-analyses",
      endpointTemplate: "/api/learning/sessions/{sessionId}",
      effect:
        "删除课程记录时会级联删除该课程的事件、快照和分析；模型会在下次读取时重新生成。",
    },
    claimBoundary:
      "这里只汇总可观察的课内学习证据，不推断人格，也不自动代表长期掌握。",
  });
}
