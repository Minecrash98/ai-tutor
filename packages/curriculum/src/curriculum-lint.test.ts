import { describe, expect, it } from "vitest";

import {
  COURSE_BY_ID,
  CURRICULUM_COURSES,
  HIDDEN_TRANSFER_MANIFEST,
  diagnoseMisconception,
  diagnoseCourseMisconceptions,
  chooseHint,
  buildEntryDiagnostic,
  chooseNextTask,
  evaluateDiagnosticBenchmark,
  HELD_OUT_DIAGNOSTIC_SAMPLES,
  lintCurriculumCourse,
  scheduleDelayedTransfer,
} from "./index";

describe("curriculum authoring contract", () => {
  it("keeps three unique, complete courses lint-clean", () => {
    expect(CURRICULUM_COURSES).toHaveLength(3);
    expect(new Set(CURRICULUM_COURSES.map((course) => course.id)).size).toBe(3);
    expect(
      new Set(CURRICULUM_COURSES.map((course) => course.conceptId)).size,
    ).toBe(3);
    expect(CURRICULUM_COURSES.flatMap(lintCurriculumCourse)).toEqual([]);
  });

  it("requires repeated evidence before naming a misconception", () => {
    for (const course of CURRICULUM_COURSES) {
      for (const misconception of course.misconceptions) {
        expect(misconception.singleErrorState).toBe("uncertain");
        expect(misconception.minimumOccurrences).toBeGreaterThanOrEqual(2);
        expect(misconception.evidenceSignals.length).toBeGreaterThanOrEqual(2);
        expect(misconception.elicitationPrompt).not.toBe("");
        expect(misconception.supportHint).not.toBe("");
        expect(misconception.correctionQuestion).not.toBe("");
      }
    }
  });

  it("covers the required box, Flex, and positioning misconception concepts", () => {
    const tags = (courseId: keyof typeof COURSE_BY_ID) =>
      COURSE_BY_ID[courseId].misconceptions.flatMap((item) => item.conceptTags);
    expect(tags("box-model-v1")).toEqual(expect.arrayContaining(["margin-vs-padding", "content-box", "border-box", "total-size"]));
    expect(tags("flex-v1")).toEqual(expect.arrayContaining(["main-vs-cross-axis", "container-vs-item", "gap-vs-margin", "justify-vs-align", "wrap", "direction"]));
    expect(tags("positioning-v1")).toEqual(expect.arrayContaining(["containing-block", "document-flow", "relative-vs-absolute", "offset-reference", "offset-conflict", "static"]));
  });

  it("keeps the held-out Flex detector below the frozen false-positive and false-negative limits", () => {
    const result = evaluateDiagnosticBenchmark(HELD_OUT_DIAGNOSTIC_SAMPLES);
    expect(result.total).toBe(12);
    expect(result.falsePositiveRate).toBeLessThanOrEqual(0.05);
    expect(result.falseNegativeRate).toBeLessThanOrEqual(0.05);
  });

  it("requires the measurements needed by the expanded misconception boundaries", () => {
    const fields = (courseId: keyof typeof COURSE_BY_ID, factId: string) =>
      COURSE_BY_ID[courseId].factSources.find((fact) => fact.id === factId)?.requiredFields ?? [];
    expect(fields("box-model-v1", "box.fact.computed")).toEqual(
      expect.arrayContaining(["borderLeftWidth", "marginLeft", "boxSizing"]),
    );
    expect(fields("flex-v1", "flex.fact.computed")).toEqual(
      expect.arrayContaining(["flexDirection", "flexWrap"]),
    );
    expect(fields("flex-v1", "flex.fact.rects")).toContain("itemMargins");
    expect(fields("positioning-v1", "position.fact.computed")).toEqual(
      expect.arrayContaining(["left", "right", "width", "direction"]),
    );
  });

  it("marks the first prediction provisional and recalibrates it with hidden transfer", () => {
    expect(buildEntryDiagnostic({ courseId: "box-model-v1", prediction: "incorrect" })).toMatchObject({
      confidence: 0.55,
      provisional: true,
      scaffold: "fact-check",
      skipAllowed: true,
      blocksFirstInteraction: false,
      calibratedBy: "entry-prediction",
    });
    expect(buildEntryDiagnostic({ courseId: "box-model-v1", prediction: "incorrect", hiddenTransferOutcome: "passed" })).toMatchObject({
      confidence: 0.9,
      provisional: false,
      scaffold: "none",
      calibratedBy: "hidden-transfer",
    });
  });

  it("selects the next task with traceable rules instead of a personality label", () => {
    expect(chooseNextTask({ courseId: "flex-v1", latestOutcome: "failed", misconceptionState: "uncertain", hintLevel: 1, hiddenTransferDue: false })).toMatchObject({
      ruleId: "flex-v1:next-task-v1",
      taskVariantId: "flex-v1:guided-fact-check",
      difficulty: "guided",
      scaffold: "fact-check",
      independentCreditEligible: true,
    });
    expect(chooseNextTask({ courseId: "flex-v1", latestOutcome: "passed", misconceptionState: "none", hintLevel: 0, hiddenTransferDue: true })).toMatchObject({ difficulty: "hidden-transfer", scaffold: "none" });
  });

  it("binds two hidden hashes to every course without exposing answers", () => {
    expect(HIDDEN_TRANSFER_MANIFEST).toHaveLength(6);
    for (const entry of HIDDEN_TRANSFER_MANIFEST) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.visibility).toBe("server-hidden");
      expect(COURSE_BY_ID[entry.courseId].transfer.hiddenItemIds).toContain(
        entry.itemId,
      );
      expect(entry).not.toHaveProperty("answer");
      expect(entry).not.toHaveProperty("prompt");
    }
  });

  it("schedules retention checks only inside the frozen 24–72 hour window", () => {
    expect(scheduleDelayedTransfer("2026-08-02T00:00:00.000Z", 24)).toBe(
      "2026-08-03T00:00:00.000Z",
    );
    expect(scheduleDelayedTransfer("2026-08-02T00:00:00.000Z", 72)).toBe(
      "2026-08-05T00:00:00.000Z",
    );
    expect(() =>
      scheduleDelayedTransfer("2026-08-02T00:00:00.000Z", 23),
    ).toThrow();
    expect(() =>
      scheduleDelayedTransfer("2026-08-02T00:00:00.000Z", 73),
    ).toThrow();
  });

  it("keeps one error uncertain and requires repeated, distinct signals", () => {
    const oneError = diagnoseMisconception(
      "box-model-v1",
      "box.width-includes-padding",
      ["prediction.same"],
    );
    expect(oneError.state).toBe("uncertain");
    expect(oneError.matchedSignals).toEqual(["prediction.same"]);
    const repeatedSameSignal = diagnoseMisconception(
      "box-model-v1",
      "box.width-includes-padding",
      ["prediction.same", "prediction.same"],
    );
    expect(repeatedSameSignal.state).toBe("uncertain");
    const supported = diagnoseMisconception(
      "box-model-v1",
      "box.width-includes-padding",
      ["prediction.same", "explanation.margin-pushes"],
    );
    expect(supported.state).toBe("supported");
    expect(supported.ruleId).toBe(
      "box-model-rules-v1:box.width-includes-padding",
    );
    const sameStage = diagnoseMisconception(
      "box-model-v1",
      "box.width-includes-padding",
      [
        { observationId: "prediction-1", stage: "prediction", signalId: "prediction.same" },
        { observationId: "prediction-2", stage: "prediction", signalId: "explanation.margin-pushes" },
      ],
    );
    expect(sameStage.state).toBe("uncertain");
    expect(
      diagnoseCourseMisconceptions("box-model-v1", [
        { observationId: "prediction-1", stage: "prediction", signalId: "prediction.same" },
        { observationId: "explanation-1", stage: "explanation", signalId: "explanation.margin-pushes" },
      ]).find((item) => item.misconceptionId === "box.width-includes-padding"),
    ).toMatchObject({ state: "supported", matchedStages: ["prediction", "explanation"] });
  });

  it("removes independent credit only after the explicit demonstration", () => {
    const course = COURSE_BY_ID["flex-v1"];
    expect(chooseHint(course, 1).independentCreditEligible).toBe(true);
    expect(chooseHint(course, 2).independentCreditEligible).toBe(true);
    expect(chooseHint(course, 3)).toMatchObject({
      independentCreditEligible: false,
      reason: "学生明确请求示范；本轮不计独立达成",
    });
  });
});
