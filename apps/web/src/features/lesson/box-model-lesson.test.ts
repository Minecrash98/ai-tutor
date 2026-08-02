import { describe, expect, it } from "vitest";

import {
  INITIAL_BOX_MODEL_LESSON,
  boxModelWidthBreakdown,
  evaluateTransferDeclaration,
  isCorrectTransferDeclaration,
  lessonElapsedSeconds,
  reduceBoxModelLesson,
  replayBoxModelLessonEvents,
} from "./box-model-lesson";

describe("box model lesson state machine", () => {
  it("calculates the live content-box width from the actual lesson dimensions", () => {
    expect(boxModelWidthBreakdown(16)).toEqual({
      contentPx: 280,
      horizontalPaddingPx: 32,
      borderPx: 8,
      totalPx: 320,
    });
    expect(boxModelWidthBreakdown(32)).toEqual({
      contentPx: 280,
      horizontalPaddingPx: 64,
      borderPx: 8,
      totalPx: 352,
    });
  });

  it("requires prediction, the target observation, explanation, and transfer", () => {
    const sessionId = "20000000-0000-4000-8000-000000000001";
    const events = [
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000001",
        sessionId,
        actorType: "system" as const,
        type: "start" as const,
        blockId: "demo-1",
        at: "2026-08-01T00:00:00.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000002",
        sessionId,
        actorType: "user" as const,
        type: "predict" as const,
        answer: "same" as const,
        at: "2026-08-01T00:00:05.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000003",
        sessionId,
        actorType: "user" as const,
        type: "experiment-saved" as const,
        blockId: "demo-1",
        revisionId: "revision-28",
        property: "padding",
        value: "28px",
        at: "2026-08-01T00:00:10.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000004",
        sessionId,
        actorType: "user" as const,
        type: "experiment-saved" as const,
        blockId: "demo-1",
        revisionId: "revision-32",
        property: "padding",
        value: "32px",
        at: "2026-08-01T00:00:15.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000005",
        sessionId,
        actorType: "user" as const,
        type: "explain" as const,
        answer: "margin-pushes" as const,
        at: "2026-08-01T00:00:20.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000006",
        sessionId,
        actorType: "user" as const,
        type: "explain" as const,
        answer: "content-plus-padding" as const,
        at: "2026-08-01T00:00:25.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000007",
        sessionId,
        actorType: "system" as const,
        type: "attach-transfer" as const,
        blockId: "transfer-1",
        at: "2026-08-01T00:00:26.000Z",
      },
      {
        eventVersion: 1 as const,
        eventId: "10000000-0000-4000-8000-000000000008",
        sessionId,
        actorType: "user" as const,
        type: "transfer-submit" as const,
        code: "padding: 20px;",
        at: "2026-08-01T00:00:35.000Z",
      },
    ];
    let state = reduceBoxModelLesson(INITIAL_BOX_MODEL_LESSON, events[0]!);
    expect(state.phase).toBe("predict");

    state = reduceBoxModelLesson(state, events[1]!);
    expect(state).toMatchObject({ phase: "observe", predictionCorrect: false });

    state = reduceBoxModelLesson(state, events[2]!);
    expect(state.phase).toBe("observe");

    state = reduceBoxModelLesson(state, events[3]!);
    expect(state.phase).toBe("explain");

    state = reduceBoxModelLesson(state, events[4]!);
    expect(state).toMatchObject({ phase: "explain", explanationAttempts: 1 });

    state = reduceBoxModelLesson(state, events[5]!);
    state = reduceBoxModelLesson(state, events[6]!);
    state = reduceBoxModelLesson(state, events[7]!);

    expect(state.phase).toBe("complete");
    expect(state.evidence.map((item) => item.kind)).toEqual([
      "prediction",
      "observation",
      "explanation",
      "explanation",
      "transfer",
    ]);
    expect(lessonElapsedSeconds(state)).toBe(35);
    expect(replayBoxModelLessonEvents(events)).toEqual(state);
    expect(replayBoxModelLessonEvents(events)).toEqual(
      replayBoxModelLessonEvents(events),
    );
    expect(state.evidence[0]?.id).toBe(
      "10000000-0000-4000-8000-000000000002:prediction",
    );
  });

  it("ignores events from a different session", () => {
    const started = reduceBoxModelLesson(INITIAL_BOX_MODEL_LESSON, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000011",
      sessionId: "20000000-0000-4000-8000-000000000011",
      actorType: "system",
      type: "start",
      blockId: "demo-1",
      at: "2026-08-01T00:00:00.000Z",
    });
    const unchanged = reduceBoxModelLesson(started, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000012",
      sessionId: "20000000-0000-4000-8000-000000000012",
      actorType: "user",
      type: "predict",
      answer: "grows",
      at: "2026-08-01T00:00:05.000Z",
    });
    expect(unchanged).toBe(started);
  });

  it("records progressive help and never counts answer-revealing support as independent", () => {
    const sessionId = "20000000-0000-4000-8000-000000000021";
    let state = reduceBoxModelLesson(INITIAL_BOX_MODEL_LESSON, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000021",
      sessionId,
      actorType: "system",
      type: "start",
      blockId: "demo-support",
      at: "2026-08-01T01:00:00.000Z",
    });
    state = reduceBoxModelLesson(state, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000022",
      sessionId,
      actorType: "user",
      type: "support",
      phase: "predict",
      action: "hint",
      hintLevel: 1,
      at: "2026-08-01T01:00:05.000Z",
    });
    const invalidJump = reduceBoxModelLesson(state, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000023",
      sessionId,
      actorType: "user",
      type: "support",
      phase: "predict",
      action: "hint",
      hintLevel: 3,
      at: "2026-08-01T01:00:06.000Z",
    });
    expect(invalidJump).toBe(state);
    state = reduceBoxModelLesson(state, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000024",
      sessionId,
      actorType: "user",
      type: "support",
      phase: "predict",
      action: "hint",
      hintLevel: 2,
      at: "2026-08-01T01:00:07.000Z",
    });
    state = reduceBoxModelLesson(state, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000025",
      sessionId,
      actorType: "user",
      type: "support",
      phase: "predict",
      action: "hint",
      hintLevel: 3,
      at: "2026-08-01T01:00:08.000Z",
    });
    state = reduceBoxModelLesson(state, {
      eventVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000026",
      sessionId,
      actorType: "system",
      type: "support",
      phase: "predict",
      action: "timeout",
      hintLevel: null,
      at: "2026-08-01T01:02:08.000Z",
    });
    expect(state).toMatchObject({
      phase: "predict",
      independentCreditEligible: false,
    });
    expect(state.supportHistory.map((item) => item.action)).toEqual([
      "hint",
      "hint",
      "hint",
      "timeout",
    ]);
    expect(state.evidence.filter((item) => item.kind === "support")).toHaveLength(4);
  });

  it("caps explanation attempts and completes a skipped route only as guided", () => {
    const sessionId = "20000000-0000-4000-8000-000000000031";
    const base = {
      eventVersion: 1 as const,
      sessionId,
      actorType: "user" as const,
    };
    let state = reduceBoxModelLesson(INITIAL_BOX_MODEL_LESSON, {
      ...base,
      actorType: "system",
      eventId: "10000000-0000-4000-8000-000000000031",
      type: "start",
      blockId: "demo-guided",
      at: "2026-08-01T02:00:00.000Z",
    });
    state = reduceBoxModelLesson(state, {
      ...base,
      eventId: "10000000-0000-4000-8000-000000000032",
      type: "support",
      phase: "predict",
      action: "skip",
      hintLevel: null,
      at: "2026-08-01T02:00:01.000Z",
    });
    state = reduceBoxModelLesson(state, {
      ...base,
      eventId: "10000000-0000-4000-8000-000000000033",
      type: "support",
      phase: "observe",
      action: "skip",
      hintLevel: null,
      at: "2026-08-01T02:00:02.000Z",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = reduceBoxModelLesson(state, {
        ...base,
        eventId: `10000000-0000-4000-8000-00000000003${attempt + 4}`,
        type: "explain",
        answer: "margin-pushes",
        at: `2026-08-01T02:00:0${attempt + 3}.000Z`,
      });
    }
    const afterLimit = reduceBoxModelLesson(state, {
      ...base,
      eventId: "10000000-0000-4000-8000-000000000037",
      type: "explain",
      answer: "content-plus-padding",
      at: "2026-08-01T02:00:07.000Z",
    });
    expect(afterLimit).toBe(state);
    state = reduceBoxModelLesson(state, {
      ...base,
      eventId: "10000000-0000-4000-8000-000000000038",
      type: "support",
      phase: "explain",
      action: "demonstration",
      hintLevel: null,
      at: "2026-08-01T02:00:08.000Z",
    });
    state = reduceBoxModelLesson(state, {
      ...base,
      actorType: "system",
      eventId: "10000000-0000-4000-8000-000000000039",
      type: "attach-transfer",
      blockId: "guided-transfer",
      at: "2026-08-01T02:00:09.000Z",
    });
    state = reduceBoxModelLesson(state, {
      ...base,
      eventId: "10000000-0000-4000-8000-000000000040",
      type: "transfer-submit",
      code: "padding: 20px",
      at: "2026-08-01T02:00:10.000Z",
    });
    expect(state).toMatchObject({
      phase: "complete",
      explanationAttempts: 3,
      explanationCorrect: false,
      independentCreditEligible: false,
      transferPassed: true,
    });
    expect(state.evidence.at(-1)?.detail).toContain("有支架完成");
  });

  it("accepts only the constrained semantic CSS answer", () => {
    expect(isCorrectTransferDeclaration(" padding : 20px ; ")).toBe(true);
    expect(isCorrectTransferDeclaration("/* own work */ padding:20px")).toBe(true);
    expect(isCorrectTransferDeclaration("PADDING: 20.0px 20px")).toBe(true);
    expect(isCorrectTransferDeclaration("padding: 20px 20px 20px 20px;")).toBe(
      true,
    );
    expect(isCorrectTransferDeclaration("padding: 19px;")).toBe(false);
    expect(isCorrectTransferDeclaration("padding: 20px 19px;")).toBe(false);
    expect(isCorrectTransferDeclaration("margin: 20px;")).toBe(false);
    expect(isCorrectTransferDeclaration("padding: 20px; color: red;")).toBe(false);
    expect(isCorrectTransferDeclaration(".notice { padding: 20px; }")).toBe(false);
    expect(isCorrectTransferDeclaration("width: 240px;")).toBe(false);
    expect(evaluateTransferDeclaration("margin: 20px").message).toContain(
      "padding",
    );
    expect(
      evaluateTransferDeclaration("padding: 20px; width: 240px").message,
    ).toContain("多条");
  });
});
