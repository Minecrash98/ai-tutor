import type {
  LearningLessonRecordedEvent,
  LearningReplayBundle,
} from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveLearnerMisconceptionEvidence,
  deriveReplayMisconceptionEvidence,
  strongestMisconceptionState,
} from "./learning-misconception-evidence";

const SESSION_ID = "00000000-0000-4000-8000-000000000101";
const eventId = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const at = "2026-08-02T00:00:00.000Z";

function derive(
  lessonKind: "box-model-v1" | "flex-v1" | "positioning-v1",
  events: LearningLessonRecordedEvent[],
) {
  return deriveLearnerMisconceptionEvidence({
    lessonKind,
    sessionId: SESSION_ID,
    events,
  });
}

describe("learning misconception evidence", () => {
  it("keeps a single box-model error uncertain", () => {
    const result = derive("box-model-v1", [
      {
        eventVersion: 1,
        eventId: eventId("1"),
        sessionId: SESSION_ID,
        actorType: "user",
        type: "predict",
        answer: "same",
        at,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        misconceptionId: "box.width-includes-padding",
        state: "uncertain",
        sourceEventIds: [eventId("1")],
      }),
    ]);
    expect(strongestMisconceptionState(result)).toBe("uncertain");
  });

  it("requires independent prediction and explanation events for a repeated box pattern", () => {
    const result = derive("box-model-v1", [
      {
        eventVersion: 1,
        eventId: eventId("1"),
        sessionId: SESSION_ID,
        actorType: "user",
        type: "predict",
        answer: "same",
        at,
      },
      {
        eventVersion: 1,
        eventId: eventId("2"),
        sessionId: SESSION_ID,
        actorType: "user",
        type: "explain",
        answer: "margin-pushes",
        at,
      },
    ]);
    expect(result).toContainEqual(
      expect.objectContaining({
        misconceptionId: "box.width-includes-padding",
        state: "repeated-pattern",
        sourceEventIds: [eventId("1"), eventId("2")],
      }),
    );
    expect(strongestMisconceptionState(result)).toBe("supported");
  });

  it("maps the real Flex and positioning answers into cross-stage patterns", () => {
    expect(
      derive("flex-v1", [
        {
          eventVersion: 2,
          eventId: eventId("3"),
          sessionId: SESSION_ID,
          actorType: "user",
          type: "scenario-predict",
          answer: "gap-resizes-items",
          at,
        },
        {
          eventVersion: 2,
          eventId: eventId("4"),
          sessionId: SESSION_ID,
          actorType: "user",
          type: "scenario-explain",
          answer: "gap-changes-item-size",
          at,
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        misconceptionId: "flex.gap-resizes-items",
        state: "repeated-pattern",
      }),
    );
    expect(
      derive("positioning-v1", [
        {
          eventVersion: 2,
          eventId: eventId("5"),
          sessionId: SESSION_ID,
          actorType: "user",
          type: "scenario-predict",
          answer: "relative-leaves-flow",
          at,
        },
        {
          eventVersion: 2,
          eventId: eventId("6"),
          sessionId: SESSION_ID,
          actorType: "user",
          type: "scenario-explain",
          answer: "relative-leaves-flow",
          at,
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        misconceptionId: "position.relative-leaves-flow",
        state: "repeated-pattern",
      }),
    );
  });

  it("does not let later events contaminate a frozen analysis", () => {
    const prediction: LearningLessonRecordedEvent = {
      eventVersion: 1,
      eventId: eventId("7"),
      sessionId: SESSION_ID,
      actorType: "user",
      type: "predict",
      answer: "same",
      at,
    };
    const explanation: LearningLessonRecordedEvent = {
      eventVersion: 1,
      eventId: eventId("8"),
      sessionId: SESSION_ID,
      actorType: "user",
      type: "explain",
      answer: "margin-pushes",
      at,
    };
    const replay: LearningReplayBundle = {
      schemaVersion: 1,
      session: {
        schemaVersion: 1,
        sessionId: SESSION_ID,
        canvasId: "00000000-0000-4000-8000-000000000102",
        lessonKind: "box-model-v1",
        status: "active",
        latestSequence: 2,
        startedAt: at,
        endedAt: null,
      },
      events: [
        { sequence: 1, event: prediction },
        { sequence: 2, event: explanation },
      ],
      latestSnapshot: null,
    };
    const result = deriveReplayMisconceptionEvidence(replay, 1);
    expect(result).toEqual([
      expect.objectContaining({ state: "uncertain" }),
    ]);
  });
});
