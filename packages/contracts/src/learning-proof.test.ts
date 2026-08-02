import { describe, expect, it } from "vitest";

import {
  appendLearningEventsRequestSchema,
  boxModelLessonEvidenceSchema,
  boxModelLessonRecordedEventSchema,
  boxModelLessonStateSchema,
  createLearningSessionRequestSchema,
  learningReplayBundleSchema,
  learningFeedbackReceiptSchema,
  learningAuditRecordedEventSchema,
  saveLearningSnapshotRequestSchema,
  scenarioLessonRecordedEventSchema,
  scenarioLessonStateSchema,
} from "./learning-proof";

const startEvent = {
  eventVersion: 1 as const,
  eventId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  at: "2026-08-02T01:02:03.000Z",
  type: "start" as const,
  actorType: "system" as const,
  blockId: "lesson-block-1",
};

const personalizedOrigin = {
  version: 1 as const,
  planId: "personal-course:block-1:revision-1:box-model:#card",
  courseId: "box-model-v1" as const,
  sourceBlockId: "source-block-1",
  baseRevisionId: "revision-1",
  baseContentHash: "source-content-hash",
  verifiedRevisionId: "revision-2",
  analyzerVersion: "personalized-course-rules-v1" as const,
  domPath: "main#card",
  source: {
    filePath: "styles.css",
    line: 2,
    column: 1,
    selector: "#card",
    declarations: { width: "280px", padding: "20px" },
  },
  experiment: {
    property: "padding" as const,
    beforeValue: "20px",
    trialValue: "36px",
    verifiedValue: "36px",
    verifiedAt: "2026-08-02T01:03:03.000Z",
    beforeRect: { width: 328, height: 160, x: 20, y: 30 },
    afterRect: { width: 360, height: 192, x: 20, y: 30 },
  },
  formativeAnswers: {
    prediction: "outer-grows",
    explanation: "content-box-adds-padding",
    explanationAttempts: 1,
  },
  hiddenTransfer: {
    itemId: "box-transfer-b-1",
    sha256: "7ef009aaf125fa750b25910b9d57fa1f6977e3d39bef68226ba57f9e97b23bef",
  },
};

describe("learning proof contracts", () => {
  it("accepts a versioned box-model event and rejects invalid payloads", () => {
    expect(boxModelLessonRecordedEventSchema.parse(startEvent)).toEqual(startEvent);
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...startEvent,
        eventVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...startEvent,
        type: "predict",
        actorType: "user",
        answer: "already-know-it",
      }).success,
    ).toBe(false);
  });

  it("round-trips a personalized source receipt while old events stay valid", () => {
    const personalizedStart = { ...startEvent, personalizedOrigin };
    expect(boxModelLessonRecordedEventSchema.parse(personalizedStart)).toEqual(
      personalizedStart,
    );
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...personalizedStart,
        personalizedOrigin: {
          ...personalizedOrigin,
          courseId: "flex-v1",
        },
      }).success,
    ).toBe(false);
    expect(boxModelLessonRecordedEventSchema.parse(startEvent)).toEqual(startEvent);
  });

  it("requires one session and unique ids per append batch", () => {
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 1,
        expectedSequence: 0,
        events: [startEvent],
      }).success,
    ).toBe(true);
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 1,
        expectedSequence: 0,
        events: [startEvent, startEvent],
      }).success,
    ).toBe(false);
  });

  it("accepts neutral Tutor timeline events without weakening privacy or lesson families", () => {
    const messageEvent = {
      eventVersion: 1 as const,
      eventId: "10000000-0000-4000-8000-000000000031",
      sessionId: startEvent.sessionId,
      at: "2026-08-02T01:02:04.000Z",
      type: "audit-tutor-message" as const,
      actorType: "user" as const,
      mode: "text" as const,
      realtimeSessionId: "40000000-0000-4000-8000-000000000001",
      role: "user" as const,
      contentStored: false,
      text: null,
      characterCount: 8,
    };
    expect(learningAuditRecordedEventSchema.parse(messageEvent)).toEqual(
      messageEvent,
    );
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 1,
        expectedSequence: 0,
        events: [startEvent, messageEvent],
      }).success,
    ).toBe(true);
    expect(
      learningAuditRecordedEventSchema.safeParse({
        ...messageEvent,
        contentStored: false,
        text: "不应保存的正文",
      }).success,
    ).toBe(false);
    expect(
      learningAuditRecordedEventSchema.safeParse({
        ...messageEvent,
        actorType: "ai",
      }).success,
    ).toBe(false);
    expect(
      learningAuditRecordedEventSchema.safeParse({
        ...messageEvent,
        eventVersion: 2,
      }).success,
    ).toBe(true);
  });

  it("records support explicitly and keeps old box snapshots readable", () => {
    const supportEvent = {
      eventVersion: 1 as const,
      eventId: "10000000-0000-4000-8000-000000000021",
      sessionId: startEvent.sessionId,
      at: startEvent.at,
      type: "support" as const,
      actorType: "user" as const,
      phase: "predict" as const,
      action: "hint" as const,
      hintLevel: 1 as const,
    };
    expect(boxModelLessonRecordedEventSchema.parse(supportEvent)).toEqual(
      supportEvent,
    );
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...supportEvent,
        hintLevel: null,
      }).success,
    ).toBe(false);
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...supportEvent,
        action: "timeout",
        actorType: "system",
        hintLevel: 1,
      }).success,
    ).toBe(false);

    const oldSnapshot = boxModelLessonStateSchema.parse({
      version: 2,
      sessionId: startEvent.sessionId,
      phase: "predict",
      lessonBlockId: startEvent.blockId,
      transferBlockId: null,
      prediction: null,
      predictionCorrect: null,
      observedPaddingPx: null,
      explanationCorrect: null,
      explanationAttempts: 0,
      transferCode: null,
      transferPassed: null,
      startedAt: startEvent.at,
      completedAt: null,
      evidence: [],
    });
    expect(oldSnapshot.supportHistory).toEqual([]);
    expect(oldSnapshot.personalizedOrigin).toBeNull();
    expect(oldSnapshot.independentCreditEligible).toBe(true);
  });

  it("keeps evaluator, criterion, and observation in each evidence record", () => {
    const parsed = boxModelLessonEvidenceSchema.parse({
      schemaVersion: 1,
      id: `${startEvent.eventId}:prediction`,
      eventId: startEvent.eventId,
      at: startEvent.at,
      kind: "prediction",
      skillId: "css.box-model.padding",
      evaluatorId: "box-model-rules-v1",
      passed: true,
      criterion: "预测左右 padding 增加会让 content-box 总宽变大",
      observed: "会变大",
      detail: "学生先做了可判定预测",
    });
    expect(parsed.evaluatorId).toBe("box-model-rules-v1");
  });

  it("bounds replay snapshots and requires a positive event sequence", () => {
    expect(
      saveLearningSnapshotRequestSchema.safeParse({
        schemaVersion: 1,
        throughSequence: 0,
        canvasSnapshot: { version: 1, shapes: [] },
        semanticSnapshot: { version: 1, serializedState: "{}" },
        lessonState: {},
      }).success,
    ).toBe(false);
  });

  it("accepts versioned Flex and positioning events without widening box answers", () => {
    const scenarioStart = {
      eventVersion: 2 as const,
      eventId: "10000000-0000-4000-8000-000000000010",
      sessionId: startEvent.sessionId,
      at: startEvent.at,
      type: "scenario-start" as const,
      actorType: "system" as const,
      lessonKind: "flex-v1" as const,
      blocks: [
        { role: "source" as const, blockId: "normal" },
        { role: "experiment" as const, blockId: "flex" },
      ],
    };
    expect(scenarioLessonRecordedEventSchema.parse(scenarioStart)).toEqual(
      scenarioStart,
    );
    expect(
      scenarioLessonRecordedEventSchema.safeParse({
        ...scenarioStart,
        blocks: [
          { role: "source", blockId: "same" },
          { role: "source", blockId: "same" },
        ],
      }).success,
    ).toBe(false);
    expect(
      scenarioLessonRecordedEventSchema.safeParse({
        ...scenarioStart,
        lessonKind: "positioning-v1",
      }).success,
    ).toBe(false);
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 2,
        expectedSequence: 0,
        events: [scenarioStart],
      }).success,
    ).toBe(true);
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 1,
        expectedSequence: 0,
        events: [scenarioStart],
      }).success,
    ).toBe(false);
    expect(
      appendLearningEventsRequestSchema.safeParse({
        schemaVersion: 1,
        expectedSequence: 0,
        events: [{ ...scenarioStart, eventVersion: 1 }],
      }).success,
    ).toBe(true);
    expect(
      createLearningSessionRequestSchema.safeParse({
        schemaVersion: 2,
        sessionId: scenarioStart.sessionId,
        canvasId: "30000000-0000-4000-8000-000000000001",
        lessonKind: "flex-v1",
        startedAt: scenarioStart.at,
      }).success,
    ).toBe(true);
    expect(
      boxModelLessonRecordedEventSchema.safeParse({
        ...startEvent,
        type: "predict",
        actorType: "user",
        answer: "gap-separates-items",
      }).success,
    ).toBe(false);
  });

  it("requires replay envelope, session, and event protocol versions to agree", () => {
    const scenarioStart = {
      eventVersion: 2 as const,
      eventId: "10000000-0000-4000-8000-000000000011",
      sessionId: startEvent.sessionId,
      at: startEvent.at,
      type: "scenario-start" as const,
      actorType: "system" as const,
      lessonKind: "flex-v1" as const,
      blocks: [
        { role: "source" as const, blockId: "normal" },
        { role: "experiment" as const, blockId: "flex" },
      ],
    };
    const replay = {
      schemaVersion: 2 as const,
      session: {
        schemaVersion: 2 as const,
        sessionId: scenarioStart.sessionId,
        canvasId: "30000000-0000-4000-8000-000000000001",
        lessonKind: "flex-v1" as const,
        status: "active" as const,
        latestSequence: 1,
        startedAt: scenarioStart.at,
        endedAt: null,
      },
      events: [{ sequence: 1, event: scenarioStart }],
      latestSnapshot: null,
    };
    expect(learningReplayBundleSchema.safeParse(replay).success).toBe(true);
    expect(
      learningReplayBundleSchema.safeParse({
        ...replay,
        session: { ...replay.session, schemaVersion: 1 },
      }).success,
    ).toBe(false);
  });

  it("requires active and completed scenario states to carry replay invariants", () => {
    expect(
      scenarioLessonStateSchema.safeParse({
        version: 1,
        lessonKind: "flex-v1",
        sessionId: null,
        phase: "predict",
        blocks: [],
        transferBlockId: null,
        prediction: null,
        predictionCorrect: null,
        observations: [],
        explanation: null,
        explanationCorrect: null,
        explanationAttempts: 0,
        transferCode: null,
        transferPassed: null,
        startedAt: null,
        completedAt: null,
        evidence: [],
      }).success,
    ).toBe(false);
    expect(
      scenarioLessonStateSchema.safeParse({
        version: 1,
        lessonKind: "flex-v1",
        sessionId: startEvent.sessionId,
        phase: "complete",
        blocks: [
          { role: "source", blockId: "normal" },
          { role: "experiment", blockId: "flex" },
        ],
        transferBlockId: "transfer",
        prediction: "gap-separates-items",
        predictionCorrect: true,
        observations: [],
        explanation: "axes-are-independent",
        explanationCorrect: true,
        explanationAttempts: 1,
        transferCode: "display:flex",
        transferPassed: true,
        startedAt: startEvent.at,
        completedAt: "2026-08-02T01:03:03.000Z",
        evidence: [],
      }).success,
    ).toBe(false);
  });

  it("accepts only version-one structured learning feedback and bounded hint/status values", () => {
    const feedback = {
      feedbackVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000009",
      goal: "亲手保存一个指定变化",
      observedBehavior: "保存了 padding: 32px",
      causalEvidence: "浏览器测得左右内边距均为 32px",
      nextSmallestAction: "继续解释总宽为什么变化",
      hintLevel: 1,
      status: "met",
      correctsEventId: null,
    };
    expect(learningFeedbackReceiptSchema.safeParse(feedback).success).toBe(true);
    expect(learningFeedbackReceiptSchema.safeParse({ ...feedback, feedbackVersion: 2 }).success).toBe(false);
    expect(learningFeedbackReceiptSchema.safeParse({ ...feedback, hintLevel: 4 }).success).toBe(false);
    expect(learningFeedbackReceiptSchema.safeParse({ ...feedback, status: "celebration" }).success).toBe(false);
  });
});
