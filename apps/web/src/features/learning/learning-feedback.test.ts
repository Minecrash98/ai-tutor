import type {
  BoxModelLessonEvidence,
  BoxModelLessonRecordedEvent,
} from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import { buildLearningFeedbackTimeline } from "./learning-feedback";

const sessionId = "d3ca6ac4-7954-4bb7-94c8-d6fa648b53f8";
const at = "2026-08-02T08:00:00.000Z";

function event(
  eventId: string,
  value:
    | { type: "explain"; answer: "margin-pushes" | "content-plus-padding" }
    | { type: "transfer-submit"; code: string },
): BoxModelLessonRecordedEvent {
  return { eventVersion: 1, eventId, sessionId, actorType: "user", at, ...value };
}

function evidence(
  eventId: string,
  kind: "explanation" | "transfer",
  passed: boolean,
  detail: string,
): BoxModelLessonEvidence {
  return {
    schemaVersion: 1,
    id: `evidence-${eventId}`,
    eventId,
    at,
    kind,
    skillId: "css.box-model.padding",
    evaluatorId: "box-model-rules-v1",
    passed,
    criterion: "确定性课程规则",
    observed: "学生原始操作",
    detail,
  };
}

describe("learning feedback timeline", () => {
  it("keeps a failed explanation and marks the later self-correction", () => {
    const failedId = "11111111-1111-4111-8111-111111111111";
    const passedId = "22222222-2222-4222-8222-222222222222";
    const timeline = buildLearningFeedbackTimeline(
      [
        event(failedId, { type: "explain", answer: "margin-pushes" }),
        event(passedId, { type: "explain", answer: "content-plus-padding" }),
      ],
      [
        evidence(failedId, "explanation", false, "外边距在边框外，不能解释卡片自身总宽"),
        evidence(passedId, "explanation", true, "内容宽、左右内边距和边框相加与浏览器测量一致"),
      ],
    );
    expect(timeline.map((item) => item.feedback.status)).toEqual(["not-met", "met"]);
    expect(timeline[1]?.feedback.correctsEventId).toBe(failedId);
    expect(timeline[0]?.feedback.nextSmallestAction).toContain("只改一处");
  });

  it("retains submitted CSS and refuses to invent a result without evidence", () => {
    const eventId = "33333333-3333-4333-8333-333333333333";
    const timeline = buildLearningFeedbackTimeline(
      [event(eventId, { type: "transfer-submit", code: "padding: 20px;" })],
      [],
    );
    expect(timeline[0]).toMatchObject({
      code: "padding: 20px;",
      feedback: { feedbackVersion: 1, status: "blocked", correctsEventId: null },
    });
    expect(timeline[0]?.feedback.causalEvidence).toContain("不能自动算作通过");
  });
});
