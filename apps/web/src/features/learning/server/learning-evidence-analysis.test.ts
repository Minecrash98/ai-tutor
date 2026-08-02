import type {
  LearningReplayBundle,
  StoredLearningEvent,
} from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import {
  INITIAL_BOX_MODEL_LESSON,
  replayBoxModelLessonEvents,
} from "@/features/lesson/box-model-lesson";
import { buildLearningEvidenceAnalysis } from "./learning-evidence-analysis";

function replay(
  events: StoredLearningEvent[],
): LearningReplayBundle {
  return {
    schemaVersion: 1,
    session: {
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      canvasId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "active",
      schemaVersion: 1,
      lessonKind: "box-model-v1",
      latestSequence: events.length,
      startedAt: "2026-08-02T00:00:00.000Z",
      endedAt: null,
    },
    events,
    latestSnapshot: null,
  };
}

describe("learning evidence analysis", () => {
  it("keeps all four milestones explicitly missing for an empty stream", () => {
    const result = buildLearningEvidenceAnalysis(
      replay([]),
      INITIAL_BOX_MODEL_LESSON,
    );
    expect(result.milestones.map((item) => item.status)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
    expect(result.scoringModel).toBeNull();
  });

  it("links attempts to immutable source event ids", () => {
    const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const event = {
      eventVersion: 1 as const,
      eventId: "11111111-1111-4111-8111-111111111111",
      sessionId,
      at: "2026-08-02T00:00:01.000Z",
      type: "start" as const,
      actorType: "system" as const,
      blockId: "lesson",
    };
    const prediction = {
      eventVersion: 1 as const,
      eventId: "22222222-2222-4222-8222-222222222222",
      sessionId,
      at: "2026-08-02T00:00:02.000Z",
      type: "predict" as const,
      actorType: "user" as const,
      answer: "same" as const,
    };
    const stored = [event, prediction].map((item, index) => ({
      sequence: index + 1,
      event: item,
      payloadHash: "0".repeat(64),
      recordedAt: item.at,
    })) as StoredLearningEvent[];
    const bundle = replay(stored);
    const state = replayBoxModelLessonEvents([event, prediction]);
    const result = buildLearningEvidenceAnalysis(bundle, state);
    expect(result.milestones[0]).toMatchObject({
      status: "met",
      sourceEventIds: [prediction.eventId],
    });
    expect(result.milestones.slice(1).every((item) => item.status === "missing"))
      .toBe(true);
  });
});
