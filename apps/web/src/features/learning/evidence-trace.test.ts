import {
  LEARNING_ANALYSIS_VERSION,
  LEARNING_EVALUATOR_ID,
  LEARNING_EVALUATOR_VERSION,
  LEARNING_RUBRIC_ID,
  LEARNING_RUBRIC_VERSION,
  type LearningEvidenceAnalysis,
  type LearningReplayBundle,
} from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import { buildLearningEvidenceTrace } from "./evidence-trace";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-000000000002";
const PREDICTION_ID = "00000000-0000-4000-8000-000000000011";
const EXPLANATION_ID = "00000000-0000-4000-8000-000000000012";

function replay(): LearningReplayBundle {
  return {
    schemaVersion: 1,
    session: {
      schemaVersion: 1,
      sessionId: SESSION_ID,
      canvasId: "00000000-0000-4000-8000-000000000003",
      lessonKind: "box-model-v1",
      status: "completed",
      latestSequence: 2,
      startedAt: "2026-08-02T00:00:00.000Z",
      endedAt: "2026-08-02T00:05:00.000Z",
    },
    events: [
      {
        sequence: 1,
        event: {
          eventId: PREDICTION_ID,
          sessionId: SESSION_ID,
          eventVersion: 1,
          type: "predict",
          actorType: "user",
          answer: "grows",
          at: "2026-08-02T00:00:10.000Z",
        },
      },
      {
        sequence: 2,
        event: {
          eventId: EXPLANATION_ID,
          sessionId: SESSION_ID,
          eventVersion: 1,
          type: "explain",
          actorType: "user",
          answer: "content-plus-padding",
          at: "2026-08-02T00:01:00.000Z",
        },
      },
    ],
    latestSnapshot: null,
  };
}

function analysis(
  sourceEventId = PREDICTION_ID,
  sourceThroughSequence = 1,
): LearningEvidenceAnalysis {
  return {
    analysisId: "00000000-0000-4000-8000-000000000004",
    sessionId: SESSION_ID,
    sourceThroughSequence,
    resultHash: "a".repeat(64),
    createdAt: "2026-08-02T00:05:01.000Z",
    result: {
      analysisVersion: LEARNING_ANALYSIS_VERSION,
      lessonKind: "box-model-v1",
      sourceEventSchemaVersion: 1,
      sourceThroughSequence,
      rubric: {
        id: LEARNING_RUBRIC_ID,
        version: LEARNING_RUBRIC_VERSION,
      },
      evaluator: {
        id: LEARNING_EVALUATOR_ID,
        version: LEARNING_EVALUATOR_VERSION,
      },
      scoringModel: null,
      independentCreditEligible: true,
      milestones: [
        {
          milestoneId: "prediction",
          status: "met",
          learnerState: "independent-demonstration",
          criterion: "先做预测。",
          observed: "已经预测。",
          sourceEventIds: [sourceEventId],
        },
        {
          milestoneId: "observation",
          status: "missing",
          learnerState: "no-evidence",
          criterion: "亲手观察。",
          observed: "没有记录。",
          sourceEventIds: [],
        },
        {
          milestoneId: "explanation",
          status: "missing",
          learnerState: "no-evidence",
          criterion: "说清原因。",
          observed: "没有记录。",
          sourceEventIds: [],
        },
        {
          milestoneId: "transfer",
          status: "missing",
          learnerState: "no-evidence",
          criterion: "独立挑战。",
          observed: "没有记录。",
          sourceEventIds: [],
        },
      ],
      claimBoundary:
        "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。",
    },
  };
}

describe("buildLearningEvidenceTrace", () => {
  it("maps a frozen analysis source to its exact stored event", () => {
    const trace = buildLearningEvidenceTrace(analysis(), replay());
    expect(trace.eventById.get(PREDICTION_ID)).toMatchObject({
      sequence: 1,
      event: { eventId: PREDICTION_ID, sessionId: SESSION_ID },
    });
    expect(trace.eventById.has(EXPLANATION_ID)).toBe(false);
  });

  it("rejects an event that was recorded after the analysis boundary", () => {
    expect(() =>
      buildLearningEvidenceTrace(analysis(EXPLANATION_ID, 1), replay()),
    ).toThrow("不存在或晚于冻结边界");
  });

  it("rejects a missing source event", () => {
    expect(() =>
      buildLearningEvidenceTrace(
        analysis("00000000-0000-4000-8000-000000000099"),
        replay(),
      ),
    ).toThrow("不存在或晚于冻结边界");
  });

  it("rejects a replay from another learning session", () => {
    const other = replay();
    expect(() =>
      buildLearningEvidenceTrace(analysis(), {
        ...other,
        session: { ...other.session, sessionId: OTHER_SESSION_ID },
      }),
    ).toThrow("不属于同一次学习");
  });
});
