import { z } from "zod";

export const LEARNING_PROOF_SCHEMA_VERSION = 1 as const;
export const SCENARIO_LEARNING_PROOF_SCHEMA_VERSION = 2 as const;
export const BOX_MODEL_LESSON_STATE_VERSION = 2 as const;
export const SCENARIO_LESSON_STATE_VERSION = 1 as const;

export const learningLessonKindSchema = z.enum([
  "box-model-v1",
  "flex-v1",
  "positioning-v1",
]);
export const scenarioLessonKindSchema = z.enum(["flex-v1", "positioning-v1"]);
export type LearningLessonKind = z.infer<typeof learningLessonKindSchema>;
export type ScenarioLessonKind = z.infer<typeof scenarioLessonKindSchema>;

export const boxModelPredictionSchema = z.enum(["grows", "same", "unsure"]);
export const boxModelExplanationSchema = z.enum([
  "content-plus-padding",
  "margin-pushes",
  "font-grows",
]);
export const activeLessonPhaseSchema = z.enum([
  "predict",
  "observe",
  "explain",
  "transfer",
]);
export const learningSupportActionSchema = z.enum([
  "hint",
  "skip",
  "demonstration",
  "timeout",
  "teacher-takeover",
]);
export const learningSupportRecordSchema = z.object({
  eventId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
  phase: activeLessonPhaseSchema,
  action: learningSupportActionSchema,
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
});

export const personalizedLessonOriginSchema = z.object({
  version: z.literal(1),
  planId: z.string().trim().min(1).max(2_000),
  courseId: learningLessonKindSchema,
  sourceBlockId: z.string().trim().min(1).max(200),
  baseRevisionId: z.string().trim().min(1).max(200),
  baseContentHash: z.string().trim().min(1).max(200),
  verifiedRevisionId: z.string().trim().min(1).max(200),
  analyzerVersion: z.literal("personalized-course-rules-v1"),
  domPath: z.string().trim().min(1).max(2_048),
  source: z.object({
    filePath: z.string().trim().min(1).max(1_024),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    selector: z.string().trim().min(1).max(2_048),
    declarations: z.record(z.string(), z.string()).refine(
      (declarations) => Object.keys(declarations).length <= 12,
      "A personalized source receipt can contain at most 12 declarations.",
    ),
  }),
  experiment: z.object({
    property: z.enum(["padding", "gap", "top", "right", "bottom", "left"]),
    beforeValue: z.string().trim().min(1).max(200),
    trialValue: z.string().trim().min(1).max(200),
    verifiedValue: z.string().trim().min(1).max(200),
    verifiedAt: z.string().datetime({ offset: true }),
    beforeRect: z.object({
      width: z.number().finite(),
      height: z.number().finite(),
      x: z.number().finite(),
      y: z.number().finite(),
    }),
    afterRect: z.object({
      width: z.number().finite(),
      height: z.number().finite(),
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  }),
  formativeAnswers: z.object({
    prediction: z.string().trim().min(1).max(120),
    explanation: z.string().trim().min(1).max(120),
    explanationAttempts: z.number().int().positive().max(100),
  }),
  hiddenTransfer: z.object({
    itemId: z.string().trim().min(1).max(200),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});

export type PersonalizedLessonOrigin = z.infer<
  typeof personalizedLessonOriginSchema
>;

const eventIdentityMetadata = {
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
};
const boxModelEventMetadata = {
  ...eventIdentityMetadata,
  eventVersion: z.literal(LEARNING_PROOF_SCHEMA_VERSION),
};
const scenarioEventMetadata = {
  ...eventIdentityMetadata,
  eventVersion: z.union([
    z.literal(LEARNING_PROOF_SCHEMA_VERSION),
    z.literal(SCENARIO_LEARNING_PROOF_SCHEMA_VERSION),
  ]),
};
const supportedLearningProofSchemaVersionSchema = z.union([
  z.literal(LEARNING_PROOF_SCHEMA_VERSION),
  z.literal(SCENARIO_LEARNING_PROOF_SCHEMA_VERSION),
]);

export const boxModelLessonRecordedEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("start"),
    actorType: z.literal("system"),
    blockId: z.string().trim().min(1).max(200),
    personalizedOrigin: personalizedLessonOriginSchema.optional(),
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("predict"),
    actorType: z.literal("user"),
    answer: boxModelPredictionSchema,
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("experiment-saved"),
    actorType: z.literal("user"),
    blockId: z.string().trim().min(1).max(200),
    revisionId: z.string().trim().min(1).max(200),
    property: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(200),
    target: z.string().trim().min(1).max(2_048).optional(),
    beforeValue: z.string().trim().min(1).max(200).nullable().optional(),
    transient: z.literal(false).optional(),
    saved: z.literal(true).optional(),
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("explain"),
    actorType: z.literal("user"),
    answer: boxModelExplanationSchema,
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("support"),
    actorType: z.enum(["user", "system"]),
    phase: activeLessonPhaseSchema,
    action: learningSupportActionSchema,
    hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("attach-transfer"),
    actorType: z.literal("system"),
    blockId: z.string().trim().min(1).max(200),
  }),
  z.object({
    ...boxModelEventMetadata,
    type: z.literal("transfer-submit"),
    actorType: z.literal("user"),
    code: z.string().max(2_000),
  }),
]).superRefine((event, context) => {
  if (event.type === "start") {
    if (
      event.personalizedOrigin &&
      event.personalizedOrigin.courseId !== "box-model-v1"
    ) {
      context.addIssue({
        code: "custom",
        message: "A personalized origin must match the box-model lesson kind.",
        path: ["personalizedOrigin", "courseId"],
      });
    }
    return;
  }
  if (event.type !== "support") return;
  if (event.action === "hint" && event.hintLevel === null) {
    context.addIssue({
      code: "custom",
      message: "A hint support event requires its visible hint level.",
      path: ["hintLevel"],
    });
  }
  if (event.action !== "hint" && event.hintLevel !== null) {
    context.addIssue({
      code: "custom",
      message: "Only a hint support event may carry a hint level.",
      path: ["hintLevel"],
    });
  }
});

export type BoxModelPrediction = z.infer<typeof boxModelPredictionSchema>;
export type BoxModelExplanation = z.infer<typeof boxModelExplanationSchema>;
export type ActiveLessonPhase = z.infer<typeof activeLessonPhaseSchema>;
export type LearningSupportAction = z.infer<
  typeof learningSupportActionSchema
>;
export type LearningSupportRecord = z.infer<typeof learningSupportRecordSchema>;
export type BoxModelLessonRecordedEvent = z.infer<
  typeof boxModelLessonRecordedEventSchema
>;

export const boxModelLessonEvidenceSchema = z.object({
  schemaVersion: z.literal(LEARNING_PROOF_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(240),
  eventId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
  kind: z.enum([
    "prediction",
    "observation",
    "explanation",
    "transfer",
    "support",
  ]),
  skillId: z.literal("css.box-model.padding"),
  evaluatorId: z.literal("box-model-rules-v1"),
  passed: z.boolean(),
  criterion: z.string().trim().min(1).max(500),
  observed: z.string().trim().min(1).max(2_000),
  detail: z.string().trim().min(1).max(2_000),
});

export type BoxModelLessonEvidence = z.infer<
  typeof boxModelLessonEvidenceSchema
>;

export const boxModelLessonStateSchema = z.object({
  version: z.literal(BOX_MODEL_LESSON_STATE_VERSION),
  sessionId: z.string().uuid().nullable(),
  phase: z.enum(["idle", "predict", "observe", "explain", "transfer", "complete"]),
  lessonBlockId: z.string().nullable(),
  transferBlockId: z.string().nullable(),
  prediction: boxModelPredictionSchema.nullable(),
  predictionCorrect: z.boolean().nullable(),
  observedPaddingPx: z.number().finite().nullable(),
  explanationCorrect: z.boolean().nullable(),
  explanationAttempts: z.number().int().nonnegative(),
  supportHistory: z.array(learningSupportRecordSchema).readonly().default([]),
  personalizedOrigin: personalizedLessonOriginSchema.nullable().default(null),
  independentCreditEligible: z.boolean().default(true),
  transferCode: z.string().nullable(),
  transferPassed: z.boolean().nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  evidence: z.array(boxModelLessonEvidenceSchema).readonly(),
}).superRefine((value, context) => {
  if (value.phase !== "idle" && (!value.sessionId || !value.startedAt)) {
    context.addIssue({
      code: "custom",
      message: "An active lesson requires a session and start time.",
      path: ["sessionId"],
    });
  }
  if (
    value.phase === "complete" &&
    (!value.completedAt ||
      value.transferPassed !== true ||
      !value.transferBlockId ||
      value.transferBlockId === value.lessonBlockId ||
      (value.independentCreditEligible &&
        (!value.prediction ||
          value.observedPaddingPx !== 32 ||
          value.explanationCorrect !== true)))
  ) {
    context.addIssue({
      code: "custom",
      message: "A completed lesson requires every deterministic milestone and a distinct transfer block.",
      path: ["completedAt"],
    });
  }
});

export type BoxModelLessonState = z.infer<typeof boxModelLessonStateSchema>;

export const scenarioPredictionSchema = z.enum([
  "gap-separates-items",
  "gap-resizes-items",
  "absolute-leaves-flow",
  "relative-leaves-flow",
  "unsure",
]);
export const scenarioExplanationSchema = z.enum([
  "axes-are-independent",
  "gap-changes-item-size",
  "justify-is-cross-axis",
  "nearest-positioned-ancestor",
  "viewport-always",
  "relative-leaves-flow",
]);
export const scenarioBlockRoleSchema = z.enum([
  "source",
  "experiment",
  "static",
  "relative",
  "absolute",
]);
export const scenarioLessonBlockSchema = z.object({
  role: scenarioBlockRoleSchema,
  blockId: z.string().trim().min(1).max(200),
});

export const scenarioLessonRecordedEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-start"),
    actorType: z.literal("system"),
    lessonKind: scenarioLessonKindSchema,
    blocks: z.array(scenarioLessonBlockSchema).min(2).max(5),
    personalizedOrigin: personalizedLessonOriginSchema.optional(),
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-predict"),
    actorType: z.literal("user"),
    answer: scenarioPredictionSchema,
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-experiment-saved"),
    actorType: z.literal("user"),
    blockId: z.string().trim().min(1).max(200),
    revisionId: z.string().trim().min(1).max(200),
    property: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(200),
    target: z.string().trim().min(1).max(2_048).optional(),
    beforeValue: z.string().trim().min(1).max(200).nullable().optional(),
    transient: z.literal(false).optional(),
    saved: z.literal(true).optional(),
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-explain"),
    actorType: z.literal("user"),
    answer: scenarioExplanationSchema,
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-support"),
    actorType: z.enum(["user", "system"]),
    phase: activeLessonPhaseSchema,
    action: learningSupportActionSchema,
    hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-attach-transfer"),
    actorType: z.literal("system"),
    blockId: z.string().trim().min(1).max(200),
  }),
  z.object({
    ...scenarioEventMetadata,
    type: z.literal("scenario-transfer-submit"),
    actorType: z.literal("user"),
    code: z.string().max(2_000),
  }),
]).superRefine((event, context) => {
  if (event.type === "scenario-support") {
    if (event.action === "hint" && event.hintLevel === null) {
      context.addIssue({
        code: "custom",
        message: "A hint support event requires its visible hint level.",
        path: ["hintLevel"],
      });
    }
    if (event.action !== "hint" && event.hintLevel !== null) {
      context.addIssue({
        code: "custom",
        message: "Only a hint support event may carry a hint level.",
        path: ["hintLevel"],
      });
    }
    return;
  }
  if (event.type !== "scenario-start") return;
  if (
    event.personalizedOrigin &&
    event.personalizedOrigin.courseId !== event.lessonKind
  ) {
    context.addIssue({
      code: "custom",
      message: "A personalized origin must match the scenario lesson kind.",
      path: ["personalizedOrigin", "courseId"],
    });
  }
  const roles = event.blocks.map((block) => block.role);
  const blockIds = event.blocks.map((block) => block.blockId);
  const expectedRoles =
    event.lessonKind === "flex-v1"
      ? ["source", "experiment"]
      : ["static", "relative", "absolute"];
  if (
    roles.length !== expectedRoles.length ||
    new Set(roles).size !== roles.length ||
    new Set(blockIds).size !== blockIds.length ||
    expectedRoles.some((role) => !roles.includes(role as typeof roles[number]))
  ) {
    context.addIssue({
      code: "custom",
      message: "Scenario start blocks must contain each required role and unique block exactly once.",
      path: ["blocks"],
    });
  }
});

export type ScenarioPrediction = z.infer<typeof scenarioPredictionSchema>;
export type ScenarioExplanation = z.infer<typeof scenarioExplanationSchema>;
export type ScenarioLessonBlock = z.infer<typeof scenarioLessonBlockSchema>;
export type ScenarioLessonRecordedEvent = z.infer<
  typeof scenarioLessonRecordedEventSchema
>;

const learningAuditEventMetadata = {
  ...eventIdentityMetadata,
  eventVersion: supportedLearningProofSchemaVersionSchema,
};
const auditTextSchema = z.string().max(2_000).nullable();
const auditDetailSchema = z.string().trim().min(1).max(500).nullable();
const auditReferenceSchema = z.string().trim().min(1).max(2_048).nullable();
const tutorModeSchema = z.enum(["text", "voice"]);

export const learningAuditRecordedEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      ...learningAuditEventMetadata,
      type: z.literal("audit-tutor-session"),
      actorType: z.literal("system"),
      mode: tutorModeSchema,
      realtimeSessionId: z.string().uuid(),
      status: z.enum([
        "checking",
        "requesting-microphone",
        "connecting",
        "connected",
        "listening",
        "thinking",
        "doing",
        "speaking",
        "reconnecting",
        "stopped",
        "error",
      ]),
      detail: auditDetailSchema,
    }),
    z.object({
      ...learningAuditEventMetadata,
      type: z.literal("audit-tutor-message"),
      actorType: z.enum(["user", "ai", "system"]),
      mode: tutorModeSchema,
      realtimeSessionId: z.string().uuid(),
      role: z.enum(["user", "assistant", "system"]),
      contentStored: z.boolean(),
      text: auditTextSchema,
      characterCount: z.number().int().positive().max(20_000),
    }),
    z.object({
      ...learningAuditEventMetadata,
      type: z.literal("audit-tutor-tool"),
      actorType: z.literal("ai"),
      mode: tutorModeSchema,
      realtimeSessionId: z.string().uuid(),
      requestId: z.string().trim().min(1).max(200),
      tool: z.string().trim().min(1).max(120),
      success: z.boolean(),
      mutatesCanvas: z.boolean(),
    }),
    z.object({
      ...learningAuditEventMetadata,
      type: z.literal("audit-fact-receipt"),
      actorType: z.literal("system"),
      mode: tutorModeSchema,
      realtimeSessionId: z.string().uuid(),
      requestId: z.string().trim().min(1).max(200),
      allowed: z.boolean(),
      target: auditReferenceSchema,
      property: auditReferenceSchema,
      beforeValue: auditReferenceSchema,
      afterValue: auditReferenceSchema,
      selector: auditReferenceSchema,
      source: auditReferenceSchema,
      ruleValue: auditReferenceSchema,
      uncertainty: auditDetailSchema,
    }),
    z.object({
      ...learningAuditEventMetadata,
      type: z.literal("audit-canvas-action"),
      actorType: z.enum(["user", "ai", "system"]),
      source: z.enum(["student", "tutor", "system"]),
      action: z.string().trim().min(1).max(120),
      blockId: z.string().trim().min(1).max(200).nullable(),
      revisionId: z.string().trim().min(1).max(200).nullable(),
      detail: auditDetailSchema,
    }),
  ])
  .superRefine((event, context) => {
    if (event.type !== "audit-tutor-message") return;
    const expectedActor =
      event.role === "user" ? "user" : event.role === "assistant" ? "ai" : "system";
    if (event.actorType !== expectedActor) {
      context.addIssue({
        code: "custom",
        message: "Tutor message role and actor must match.",
        path: ["actorType"],
      });
    }
    if (event.contentStored !== (event.text !== null)) {
      context.addIssue({
        code: "custom",
        message: "Tutor message content must follow the learner's save choice.",
        path: ["text"],
      });
    }
  });

export type LearningAuditRecordedEvent = z.infer<
  typeof learningAuditRecordedEventSchema
>;
export type LearningAuditEventInput = LearningAuditRecordedEvent extends infer TEvent
  ? TEvent extends LearningAuditRecordedEvent
    ? Omit<TEvent, "eventVersion" | "eventId" | "sessionId">
    : never
  : never;

export const scenarioLessonEvidenceSchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  id: z.string().trim().min(1).max(240),
  eventId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
  kind: z.enum([
    "prediction",
    "observation",
    "explanation",
    "transfer",
    "support",
  ]),
  skillId: z.enum(["css.flex.axes", "css.positioning.flow"]),
  evaluatorId: z.enum(["flex-rules-v1", "positioning-rules-v1"]),
  passed: z.boolean(),
  criterion: z.string().trim().min(1).max(500),
  observed: z.string().trim().min(1).max(2_000),
  detail: z.string().trim().min(1).max(2_000),
});

export const scenarioLessonObservationSchema = z.object({
  eventId: z.string().uuid(),
  blockId: z.string().trim().min(1).max(200),
  revisionId: z.string().trim().min(1).max(200),
  property: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(200),
  passed: z.boolean(),
});

export const scenarioLessonStateSchema = z.object({
  version: z.literal(SCENARIO_LESSON_STATE_VERSION),
  lessonKind: scenarioLessonKindSchema.nullable(),
  sessionId: z.string().uuid().nullable(),
  phase: z.enum(["idle", "predict", "observe", "explain", "transfer", "complete"]),
  blocks: z.array(scenarioLessonBlockSchema).readonly(),
  transferBlockId: z.string().nullable(),
  prediction: scenarioPredictionSchema.nullable(),
  predictionCorrect: z.boolean().nullable(),
  observations: z.array(scenarioLessonObservationSchema).readonly(),
  explanation: scenarioExplanationSchema.nullable(),
  explanationCorrect: z.boolean().nullable(),
  explanationAttempts: z.number().int().nonnegative(),
  supportHistory: z.array(learningSupportRecordSchema).readonly().default([]),
  personalizedOrigin: personalizedLessonOriginSchema.nullable().default(null),
  independentCreditEligible: z.boolean().default(true),
  transferCode: z.string().nullable(),
  transferPassed: z.boolean().nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  evidence: z.array(scenarioLessonEvidenceSchema).readonly(),
}).superRefine((value, context) => {
  if (
    value.phase !== "idle" &&
    (!value.lessonKind || !value.sessionId || !value.startedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "An active scenario lesson requires a kind, session, and start time.",
      path: ["sessionId"],
    });
  }
  if (
    value.phase === "complete" &&
    (!value.completedAt ||
      value.transferPassed !== true ||
      !value.transferBlockId ||
      value.blocks.some((block) => block.blockId === value.transferBlockId) ||
      (value.independentCreditEligible &&
        (!value.prediction ||
          value.explanationCorrect !== true ||
          new Set(
            value.observations
              .filter((observation) => observation.passed)
              .map((observation) => observation.revisionId),
          ).size < 3)))
  ) {
    context.addIssue({
      code: "custom",
      message: "A completed scenario lesson requires every milestone, three distinct revisions, and a distinct transfer block.",
      path: ["completedAt"],
    });
  }
});

export type ScenarioLessonEvidence = z.infer<typeof scenarioLessonEvidenceSchema>;
export type LearningLessonEvidence =
  | BoxModelLessonEvidence
  | ScenarioLessonEvidence;
export type ScenarioLessonObservation = z.infer<
  typeof scenarioLessonObservationSchema
>;
export type ScenarioLessonState = z.infer<typeof scenarioLessonStateSchema>;

export const learningLessonRecordedEventSchema = z.union([
  boxModelLessonRecordedEventSchema,
  scenarioLessonRecordedEventSchema,
  learningAuditRecordedEventSchema,
]);
export const learningLessonStateSchema = z.union([
  boxModelLessonStateSchema,
  scenarioLessonStateSchema,
]);
export type LearningLessonRecordedEvent = z.infer<
  typeof learningLessonRecordedEventSchema
>;
export type LearningLessonState = z.infer<typeof learningLessonStateSchema>;

export const learningFeedbackReceiptSchema = z.object({
  feedbackVersion: z.literal(1),
  eventId: z.string().uuid(),
  goal: z.string().trim().min(1).max(300),
  observedBehavior: z.string().trim().min(1).max(2_000),
  causalEvidence: z.string().trim().min(1).max(2_000),
  nextSmallestAction: z.string().trim().min(1).max(500),
  hintLevel: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  status: z.enum(["met", "not-met", "supported", "blocked"]),
  correctsEventId: z.string().uuid().nullable(),
});

export type LearningFeedbackReceipt = z.infer<
  typeof learningFeedbackReceiptSchema
>;

export const createLearningSessionRequestSchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid(),
  lessonKind: learningLessonKindSchema,
  startedAt: z.string().datetime({ offset: true }),
});

export const appendLearningEventsRequestSchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  expectedSequence: z.number().int().nonnegative(),
  events: z.array(learningLessonRecordedEventSchema).min(1).max(64),
}).superRefine((value, context) => {
  const sessionIds = new Set(value.events.map((event) => event.sessionId));
  if (sessionIds.size > 1) {
    context.addIssue({
      code: "custom",
      message: "A learning event batch must belong to one session.",
      path: ["events"],
    });
  }
  const eventIds = value.events.map((event) => event.eventId);
  if (new Set(eventIds).size !== eventIds.length) {
    context.addIssue({
      code: "custom",
      message: "A learning event batch cannot repeat an event id.",
      path: ["events"],
    });
  }
  if (value.events.some((event) => event.eventVersion !== value.schemaVersion)) {
    context.addIssue({
      code: "custom",
      message: "Every learning event must use the request schema version.",
      path: ["events"],
    });
  }
  const containsScenario = value.events.some((event) =>
    event.type.startsWith("scenario-"),
  );
  const containsBoxModel = value.events.some(
    (event) =>
      !event.type.startsWith("scenario-") && !event.type.startsWith("audit-"),
  );
  if (containsScenario && containsBoxModel) {
    context.addIssue({
      code: "custom",
      message: "A learning event batch cannot mix lesson families.",
      path: ["events"],
    });
  }
  if (
    value.schemaVersion === SCENARIO_LEARNING_PROOF_SCHEMA_VERSION &&
    containsBoxModel
  ) {
    context.addIssue({
      code: "custom",
      message: "Schema version 2 is reserved for scenario lessons.",
      path: ["schemaVersion"],
    });
  }
});

export type CreateLearningSessionRequest = z.infer<
  typeof createLearningSessionRequestSchema
>;
export type AppendLearningEventsRequest = z.infer<
  typeof appendLearningEventsRequestSchema
>;

export const learningCanvasSnapshotSchema = z.object({
  version: z.literal(1),
  shapes: z.array(z.record(z.string(), z.unknown())).max(1_000),
});

export const learningSemanticSnapshotSchema = z.object({
  version: z.literal(1),
  serializedState: z.string().max(5 * 1_024 * 1_024),
});

export const saveLearningSnapshotRequestSchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  throughSequence: z.number().int().positive(),
  canvasSnapshot: learningCanvasSnapshotSchema,
  semanticSnapshot: learningSemanticSnapshotSchema,
  lessonState: learningLessonStateSchema,
}).superRefine((value, context) => {
  const scenarioState = "lessonKind" in value.lessonState;
  if (
    value.schemaVersion === SCENARIO_LEARNING_PROOF_SCHEMA_VERSION &&
    !scenarioState
  ) {
    context.addIssue({
      code: "custom",
      message: "Schema version 2 is reserved for scenario snapshots.",
      path: ["schemaVersion"],
    });
  }
});

export type LearningCanvasSnapshot = z.infer<
  typeof learningCanvasSnapshotSchema
>;
export type LearningSemanticSnapshot = z.infer<
  typeof learningSemanticSnapshotSchema
>;
export type SaveLearningSnapshotRequest = z.infer<
  typeof saveLearningSnapshotRequestSchema
>;

export const storedLearningEventSchema = z.object({
  sequence: z.number().int().positive(),
  event: learningLessonRecordedEventSchema,
});

export const learningSessionSummarySchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid(),
  lessonKind: learningLessonKindSchema,
  status: z.enum(["active", "completed", "interrupted"]),
  latestSequence: z.number().int().nonnegative(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
}).superRefine((value, context) => {
  if (
    value.schemaVersion === SCENARIO_LEARNING_PROOF_SCHEMA_VERSION &&
    value.lessonKind === "box-model-v1"
  ) {
    context.addIssue({
      code: "custom",
      message: "Schema version 2 is reserved for scenario lessons.",
      path: ["schemaVersion"],
    });
  }
});

export const learningSessionSnapshotSchema = z.object({
  throughSequence: z.number().int().positive(),
  canvasSnapshot: learningCanvasSnapshotSchema,
  semanticSnapshot: learningSemanticSnapshotSchema,
  lessonState: learningLessonStateSchema,
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
});

export const learningReplayBundleSchema = z.object({
  schemaVersion: supportedLearningProofSchemaVersionSchema,
  session: learningSessionSummarySchema,
  events: z.array(storedLearningEventSchema),
  latestSnapshot: learningSessionSnapshotSchema.nullable(),
}).superRefine((value, context) => {
  if (value.schemaVersion !== value.session.schemaVersion) {
    context.addIssue({
      code: "custom",
      message: "The replay and session schema versions must match.",
      path: ["schemaVersion"],
    });
  }
  if (
    value.events.some(
      ({ event }) => event.eventVersion !== value.session.schemaVersion,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Replay events must match the stored session schema version.",
      path: ["events"],
    });
  }
});

export const appendLearningEventsResponseSchema = z.object({
  acknowledgedSequence: z.number().int().nonnegative(),
  latestSequence: z.number().int().nonnegative(),
  events: z.array(storedLearningEventSchema),
});

export type StoredLearningEvent = z.infer<typeof storedLearningEventSchema>;
export type LearningSessionSummary = z.infer<
  typeof learningSessionSummarySchema
>;
export type LearningSessionSnapshot = z.infer<
  typeof learningSessionSnapshotSchema
>;
export type LearningReplayBundle = z.infer<typeof learningReplayBundleSchema>;
export type AppendLearningEventsResponse = z.infer<
  typeof appendLearningEventsResponseSchema
>;
