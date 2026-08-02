import { z } from "zod";

import {
  learningLessonKindSchema,
  learningReplayBundleSchema,
} from "./learning-proof";

export const LEARNING_ANALYSIS_VERSION = 1 as const;
export const LEARNING_RUBRIC_ID = "css-learning-proof-rubric" as const;
export const LEARNING_RUBRIC_VERSION = 1 as const;
export const LEARNING_EVALUATOR_ID = "deterministic-event-replay" as const;
export const LEARNING_EVALUATOR_VERSION = 1 as const;
export const MINIMAL_LEARNER_MODEL_VERSION = 1 as const;

export const learningMilestoneIdSchema = z.enum([
  "prediction",
  "observation",
  "explanation",
  "transfer",
]);

export const learningEvidenceStatusSchema = z.enum([
  "missing",
  "not-met",
  "met",
]);

export const learnerEvidenceStateSchema = z.enum([
  "no-evidence",
  "attempted",
  "supported-demonstration",
  "independent-demonstration",
]);

export const learningMilestoneAnalysisSchema = z.object({
  milestoneId: learningMilestoneIdSchema,
  status: learningEvidenceStatusSchema,
  learnerState: learnerEvidenceStateSchema,
  criterion: z.string().trim().min(1).max(500),
  observed: z.string().trim().min(1).max(2_000),
  sourceEventIds: z.array(z.string().uuid()).max(500).readonly(),
});

export const learningEvidenceAnalysisResultSchema = z.object({
  analysisVersion: z.literal(LEARNING_ANALYSIS_VERSION),
  lessonKind: learningLessonKindSchema,
  sourceEventSchemaVersion: z.number().int().positive(),
  sourceThroughSequence: z.number().int().nonnegative(),
  rubric: z.object({
    id: z.literal(LEARNING_RUBRIC_ID),
    version: z.literal(LEARNING_RUBRIC_VERSION),
  }),
  evaluator: z.object({
    id: z.literal(LEARNING_EVALUATOR_ID),
    version: z.literal(LEARNING_EVALUATOR_VERSION),
  }),
  scoringModel: z.null(),
  independentCreditEligible: z.boolean(),
  milestones: z.array(learningMilestoneAnalysisSchema).length(4).readonly(),
  claimBoundary: z.literal(
    "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。",
  ),
});

export const learningEvidenceAnalysisSchema = z.object({
  analysisId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceThroughSequence: z.number().int().nonnegative(),
  result: learningEvidenceAnalysisResultSchema,
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
});

export const learningEvidenceAnalysisListResponseSchema = z.object({
  sessionId: z.string().uuid(),
  currentThroughSequence: z.number().int().nonnegative(),
  analyses: z.array(learningEvidenceAnalysisSchema).max(100).readonly(),
});

export const createLearningEvidenceAnalysisRequestSchema = z
  .object({
    mode: z.enum(["current", "reanalysis"]).default("current"),
  })
  .strict();

export const createLearningEvidenceAnalysisResponseSchema = z.object({
  created: z.boolean(),
  analysis: learningEvidenceAnalysisSchema,
});

export const learningProofAuditBundleSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: z.string().datetime({ offset: true }),
    replay: learningReplayBundleSchema,
    analyses: z.array(learningEvidenceAnalysisSchema).max(100).readonly(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((bundle, context) => {
    const eventSequenceById = new Map(
      bundle.replay.events.map((record) => [
        record.event.eventId,
        {
          sequence: record.sequence,
          sessionId: record.event.sessionId,
        },
      ]),
    );
    for (const [analysisIndex, analysis] of bundle.analyses.entries()) {
      const path: PropertyKey[] = ["analyses", analysisIndex];
      if (
        analysis.sessionId !== bundle.replay.session.sessionId ||
        analysis.result.lessonKind !== bundle.replay.session.lessonKind
      ) {
        context.addIssue({
          code: "custom",
          path,
          message: "分析结果必须属于证据包中的同一次课程。",
        });
      }
      if (
        analysis.sourceThroughSequence !==
          analysis.result.sourceThroughSequence ||
        analysis.sourceThroughSequence >
          bundle.replay.session.latestSequence
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, "sourceThroughSequence"],
          message: "分析结果引用了无效的课程步骤边界。",
        });
      }
      if (
        analysis.result.sourceEventSchemaVersion !==
        bundle.replay.schemaVersion
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, "result", "sourceEventSchemaVersion"],
          message: "分析结果与原始步骤格式版本不一致。",
        });
      }
      for (const milestone of analysis.result.milestones) {
        for (const sourceEventId of milestone.sourceEventIds) {
          const source = eventSequenceById.get(sourceEventId);
          if (
            !source ||
            source.sessionId !== analysis.sessionId ||
            source.sequence > analysis.sourceThroughSequence
          ) {
            context.addIssue({
              code: "custom",
              path: [...path, "result", "milestones"],
              message: "分析结果引用了缺失、跨课程或晚于冻结边界的步骤。",
            });
          }
        }
      }
    }
  });

export const learnerMisconceptionEvidenceSchema = z
  .object({
    lessonKind: learningLessonKindSchema,
    sourceSessionId: z.string().uuid(),
    misconceptionId: z.string().trim().min(1).max(120),
    state: z.enum(["uncertain", "repeated-pattern"]),
    sourceEventIds: z.array(z.string().uuid()).min(1).max(100).readonly(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.state === "repeated-pattern" &&
      new Set(value.sourceEventIds).size < 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceEventIds"],
        message: "重复误区模式必须来自至少两条不同的学生事件。",
      });
    }
  });

export const minimalLearnerConceptSchema = z
  .object({
    lessonKind: learningLessonKindSchema,
    sourceSessionId: z.string().uuid(),
    sourceAnalysisId: z.string().uuid(),
    sourceThroughSequence: z.number().int().nonnegative(),
    analyzedAt: z.string().datetime({ offset: true }),
    conceptState: z
      .array(
        learningMilestoneAnalysisSchema.pick({
          milestoneId: true,
          status: true,
          learnerState: true,
          sourceEventIds: true,
        }),
      )
      .length(4)
      .readonly(),
    hintDependency: z.enum(["no-support-recorded", "support-recorded"]),
    explanationResult: learningEvidenceStatusSchema,
    practiceResult: z
      .object({
        guidedObservation: learningEvidenceStatusSchema,
        independentTransfer: learningEvidenceStatusSchema,
      })
      .strict(),
    misconceptions: z.array(learnerMisconceptionEvidenceSchema).max(100).readonly(),
  })
  .strict();

export const minimalLearnerModelSchema = z
  .object({
    modelVersion: z.literal(MINIMAL_LEARNER_MODEL_VERSION),
    scope: z.literal("learning-evidence-only"),
    concepts: z.array(minimalLearnerConceptSchema).max(3).readonly(),
    deletion: z
      .object({
        strategy: z.literal("derived-from-owner-bound-session-analyses"),
        endpointTemplate: z.literal("/api/learning/sessions/{sessionId}"),
        effect: z.literal(
          "删除课程记录时会级联删除该课程的事件、快照和分析；模型会在下次读取时重新生成。",
        ),
      })
      .strict(),
    claimBoundary: z.literal(
      "这里只汇总可观察的课内学习证据，不推断人格，也不自动代表长期掌握。",
    ),
  })
  .strict();

export type LearningMilestoneId = z.infer<typeof learningMilestoneIdSchema>;
export type LearningEvidenceStatus = z.infer<
  typeof learningEvidenceStatusSchema
>;
export type LearnerEvidenceState = z.infer<typeof learnerEvidenceStateSchema>;
export type LearningMilestoneAnalysis = z.infer<
  typeof learningMilestoneAnalysisSchema
>;
export type LearningEvidenceAnalysisResult = z.infer<
  typeof learningEvidenceAnalysisResultSchema
>;
export type LearningEvidenceAnalysis = z.infer<
  typeof learningEvidenceAnalysisSchema
>;
export type LearningEvidenceAnalysisListResponse = z.infer<
  typeof learningEvidenceAnalysisListResponseSchema
>;
export type CreateLearningEvidenceAnalysisRequest = z.infer<
  typeof createLearningEvidenceAnalysisRequestSchema
>;
export type LearningProofAuditBundle = z.infer<
  typeof learningProofAuditBundleSchema
>;
export type LearnerMisconceptionEvidence = z.infer<
  typeof learnerMisconceptionEvidenceSchema
>;
export type MinimalLearnerConcept = z.infer<
  typeof minimalLearnerConceptSchema
>;
export type MinimalLearnerModel = z.infer<typeof minimalLearnerModelSchema>;
