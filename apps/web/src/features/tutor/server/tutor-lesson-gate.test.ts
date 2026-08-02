import type { LearningLessonState } from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import { INITIAL_BOX_MODEL_LESSON } from "@/features/lesson/box-model-lesson";

import { evaluateTutorToolLessonGate } from "./tutor-lesson-gate";

function activeState(
  phase: Extract<LearningLessonState["phase"], "predict" | "observe" | "explain" | "transfer">,
  overrides: Partial<LearningLessonState> = {},
): LearningLessonState {
  return {
    ...INITIAL_BOX_MODEL_LESSON,
    sessionId: "d3ca6ac4-7954-4bb7-94c8-d6fa648b53f8",
    startedAt: "2026-08-02T08:00:00.000Z",
    phase,
    ...overrides,
  } as LearningLessonState;
}

describe("authoritative tutor lesson gate", () => {
  it.each(["predict", "observe", "explain", "transfer"] as const)(
    "blocks answer-changing tools during independent %s work",
    (phase) => {
      const decision = evaluateTutorToolLessonGate(
        "apply_css_change",
        activeState(phase),
      );
      expect(decision).toMatchObject({
        allowed: false,
        code: "WAIT_FOR_STUDENT",
      });
    },
  );

  it("allows canvas reading and camera focus without doing the answer", () => {
    const lesson = activeState("transfer");
    for (const tool of [
      "read_canvas_state",
      "inspect_selected_element",
      "read_relevant_source",
      "read_last_student_action",
      "read_teaching_assertion_evidence",
    ] as const) {
      expect(evaluateTutorToolLessonGate(tool, lesson)).toMatchObject({
        allowed: true,
        code: "READ_ONLY",
      });
    }
    expect(evaluateTutorToolLessonGate("focus_block", lesson).allowed).toBe(
      true,
    );
  });

  it("allows guided mutation only after explicit demonstration or takeover", () => {
    const base = activeState("observe", {
      independentCreditEligible: false,
    });
    expect(evaluateTutorToolLessonGate("create_demo_block", base).allowed).toBe(
      false,
    );
    const guided = {
      ...base,
      supportHistory: [
        {
          action: "demonstration" as const,
          phase: "observe" as const,
          hintLevel: null,
          eventId: "b5f3ea20-a274-4a4f-a898-7dbb11fb0c6d",
          at: "2026-08-02T08:01:00.000Z",
        },
      ],
    } as LearningLessonState;
    expect(
      evaluateTutorToolLessonGate("create_demo_block", guided),
    ).toMatchObject({ allowed: true, code: "GUIDED_TAKEOVER" });
  });

  it("does not block free-canvas or completed-lesson work", () => {
    expect(
      evaluateTutorToolLessonGate("apply_css_change", null).allowed,
    ).toBe(true);
    expect(
      evaluateTutorToolLessonGate("apply_css_change", {
        ...INITIAL_BOX_MODEL_LESSON,
        phase: "complete",
      } as LearningLessonState).allowed,
    ).toBe(true);
  });
});
