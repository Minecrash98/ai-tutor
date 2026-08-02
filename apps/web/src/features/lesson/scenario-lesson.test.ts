import type { ScenarioLessonRecordedEvent } from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import {
  INITIAL_SCENARIO_LESSON,
  isCorrectScenarioTransfer,
  reduceScenarioLesson,
  replayScenarioLessonEvents,
  scenarioTransferChanges,
  scenarioObservationProgress,
} from "./scenario-lesson";

const sessionId = "20000000-0000-4000-8000-000000000001";
let eventIndex = 0;
function event<T extends Omit<ScenarioLessonRecordedEvent, "eventVersion" | "eventId" | "sessionId" | "at">>(
  value: T,
): ScenarioLessonRecordedEvent {
  eventIndex += 1;
  return {
    eventVersion: 1,
    eventId: `10000000-0000-4000-8000-${String(eventIndex).padStart(12, "0")}`,
    sessionId,
    at: `2026-08-02T01:02:${String(eventIndex).padStart(2, "0")}.000Z`,
    ...value,
  } as unknown as ScenarioLessonRecordedEvent;
}

describe("scenario lesson reducer", () => {
  it("requires real Flex saves before explanation and records failed attempts", () => {
    const events: ScenarioLessonRecordedEvent[] = [
      event({
        type: "scenario-start",
        actorType: "system",
        lessonKind: "flex-v1",
        blocks: [
          { role: "source", blockId: "normal" },
          { role: "experiment", blockId: "flex" },
        ],
      }),
      event({
        type: "scenario-predict",
        actorType: "user",
        answer: "gap-resizes-items",
      }),
      event({
        type: "scenario-experiment-saved",
        actorType: "user",
        blockId: "flex",
        revisionId: "rev-wrong",
        property: "gap",
        value: "20px",
      }),
      event({
        type: "scenario-experiment-saved",
        actorType: "user",
        blockId: "flex",
        revisionId: "rev-gap",
        property: "gap",
        value: "32px",
      }),
      event({
        type: "scenario-experiment-saved",
        actorType: "user",
        blockId: "flex",
        revisionId: "rev-main",
        property: "justify-content",
        value: "center",
      }),
      event({
        type: "scenario-experiment-saved",
        actorType: "user",
        blockId: "flex",
        revisionId: "rev-cross",
        property: "align-items",
        value: "flex-end",
      }),
    ];
    const state = replayScenarioLessonEvents(events);
    expect(state.phase).toBe("explain");
    expect(state.predictionCorrect).toBe(false);
    expect(scenarioObservationProgress(state)).toEqual({ completed: 3, total: 3 });
    expect(state.observations.map((item) => item.passed)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it("completes positioning only after a correct explanation and transfer", () => {
    const start = event({
      type: "scenario-start",
      actorType: "system",
      lessonKind: "positioning-v1",
      blocks: [
        { role: "static", blockId: "static" },
        { role: "relative", blockId: "relative" },
        { role: "absolute", blockId: "absolute" },
      ],
    });
    let state = reduceScenarioLesson(INITIAL_SCENARIO_LESSON, start);
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-predict",
        actorType: "user",
        answer: "absolute-leaves-flow",
      }),
    );
    for (const [blockId, value] of [
      ["static", "40px"],
      ["relative", "40px"],
      ["absolute", "48px"],
    ] as const) {
      state = reduceScenarioLesson(
        state,
        event({
          type: "scenario-experiment-saved",
          actorType: "user",
          blockId,
          revisionId: `rev-${blockId}`,
          property: "top",
          value,
        }),
      );
    }
    expect(state.phase).toBe("explain");
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-explain",
        actorType: "user",
        answer: "nearest-positioned-ancestor",
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-attach-transfer",
        actorType: "system",
        blockId: "transfer",
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-transfer-submit",
        actorType: "user",
        code: "position: absolute; top: 16px; right: 16px;",
      }),
    );
    expect(state.phase).toBe("complete");
    expect(state.evidence.at(-1)?.passed).toBe(true);
  });

  it.each([
    {
      lessonKind: "flex-v1" as const,
      blocks: [
        { role: "source" as const, blockId: "guided-normal" },
        { role: "experiment" as const, blockId: "guided-flex" },
      ],
      wrongExplanation: "gap-changes-item-size" as const,
      code: "display:flex; gap:24px; justify-content:space-between; align-items:center;",
    },
    {
      lessonKind: "positioning-v1" as const,
      blocks: [
        { role: "static" as const, blockId: "guided-static" },
        { role: "relative" as const, blockId: "guided-relative" },
        { role: "absolute" as const, blockId: "guided-absolute" },
      ],
      wrongExplanation: "viewport-always" as const,
      code: "position:absolute; top:16px; right:16px;",
    },
  ])("keeps $lessonKind support explicit and caps explanation attempts", ({
    lessonKind,
    blocks,
    wrongExplanation,
    code,
  }) => {
    let state = reduceScenarioLesson(
      INITIAL_SCENARIO_LESSON,
      event({
        type: "scenario-start",
        actorType: "system",
        lessonKind,
        blocks,
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-support",
        actorType: "user",
        phase: "predict",
        action: "hint",
        hintLevel: 1,
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-support",
        actorType: "user",
        phase: "predict",
        action: "skip",
        hintLevel: null,
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-support",
        actorType: "user",
        phase: "observe",
        action: "demonstration",
        hintLevel: null,
      }),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = reduceScenarioLesson(
        state,
        event({
          type: "scenario-explain",
          actorType: "user",
          answer: wrongExplanation,
        }),
      );
    }
    const atLimit = reduceScenarioLesson(
      state,
      event({
        type: "scenario-explain",
        actorType: "user",
        answer:
          lessonKind === "flex-v1"
            ? "axes-are-independent"
            : "nearest-positioned-ancestor",
      }),
    );
    expect(atLimit).toBe(state);
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-support",
        actorType: "user",
        phase: "explain",
        action: "demonstration",
        hintLevel: null,
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-attach-transfer",
        actorType: "system",
        blockId: `guided-${lessonKind}-transfer`,
      }),
    );
    state = reduceScenarioLesson(
      state,
      event({
        type: "scenario-transfer-submit",
        actorType: "user",
        code,
      }),
    );
    expect(state).toMatchObject({
      phase: "complete",
      explanationAttempts: 3,
      explanationCorrect: false,
      independentCreditEligible: false,
      transferPassed: true,
    });
    expect(state.evidence.at(-1)?.detail).toContain("有支架完成");
  });

  it("rejects partial and extra transfer declarations", () => {
    expect(
      isCorrectScenarioTransfer(
        "flex-v1",
        "display:flex; gap:24px; justify-content:space-between; align-items:center;",
      ),
    ).toBe(true);
    expect(
      isCorrectScenarioTransfer(
        "positioning-v1",
        "position:absolute; top:16px; right:16px; z-index:4;",
      ),
    ).toBe(false);
    for (const invalid of [
      "body { display:flex; gap:24px; justify-content:space-between; align-items:center; }",
      "nonsense; display:flex; gap:24px; justify-content:space-between; align-items:center;",
      "display:flex; display:flex; gap:24px; justify-content:space-between; align-items:center;",
      "@media all { display:flex; gap:24px; justify-content:space-between; align-items:center; }",
    ]) {
      expect(isCorrectScenarioTransfer("flex-v1", invalid)).toBe(false);
      expect(scenarioTransferChanges("flex-v1", invalid)).toBeNull();
    }
    expect(
      scenarioTransferChanges(
        "flex-v1",
        "/* my answer */ align-items: center; display: FLEX; justify-content: space-between; gap: 24px;",
      ),
    ).toEqual([
      { property: "align-items", value: "center" },
      { property: "display", value: "flex" },
      { property: "justify-content", value: "space-between" },
      { property: "gap", value: "24px" },
    ]);
  });
});
