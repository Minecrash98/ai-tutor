import type { LearningEvidenceAnalysis } from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import { buildMinimalLearnerModel } from "./minimal-learner-model";

function analysis(input: {
  readonly lessonKind: LearningEvidenceAnalysis["result"]["lessonKind"];
  readonly analysisId: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly independent?: boolean;
}): LearningEvidenceAnalysis {
  const eventIds = [
    "bb213c7b-449b-414a-8e3c-983e12ce0d81",
    "ca2b965b-d6a6-42b8-a6ec-c99f0d1e59d1",
    "9abf600b-15fe-41b6-bf8d-47103106d981",
    "73933800-c453-40d8-bc90-52cb2e2f55ef",
  ];
  return {
    analysisId: input.analysisId,
    sessionId: input.sessionId,
    sourceThroughSequence: 8,
    resultHash: "a".repeat(64),
    createdAt: input.createdAt,
    result: {
      analysisVersion: 1,
      lessonKind: input.lessonKind,
      sourceEventSchemaVersion: 2,
      sourceThroughSequence: 8,
      rubric: { id: "css-learning-proof-rubric", version: 1 },
      evaluator: { id: "deterministic-event-replay", version: 1 },
      scoringModel: null,
      independentCreditEligible: input.independent ?? true,
      milestones: (["prediction", "observation", "explanation", "transfer"] as const).map(
        (milestoneId, index) => ({
          milestoneId,
          status: "met" as const,
          learnerState: (input.independent ?? true)
            ? ("independent-demonstration" as const)
            : ("supported-demonstration" as const),
          criterion: `criterion-${milestoneId}`,
          observed: `observed-${milestoneId}`,
          sourceEventIds: [eventIds[index]!],
        }),
      ),
      claimBoundary:
        "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。",
    },
  };
}

describe("minimal learner model", () => {
  it("uses only the latest analysis per concept and keeps traceable outcomes", () => {
    const oldBox = analysis({
      lessonKind: "box-model-v1",
      analysisId: "edbb7ab8-9363-4f6d-b234-545d08b683ea",
      sessionId: "c53cab29-cae8-49e6-8088-49bb1abdd5c4",
      createdAt: "2026-08-02T01:00:00.000Z",
    });
    const latestBox = analysis({
      lessonKind: "box-model-v1",
      analysisId: "257f45e7-dcbe-40c3-89cb-1a8ef940ec7a",
      sessionId: "fdb7e493-cefe-43fa-8549-507a58dbbd85",
      createdAt: "2026-08-02T02:00:00.000Z",
      independent: false,
    });
    const flex = analysis({
      lessonKind: "flex-v1",
      analysisId: "86c3c710-5200-4c5c-a2ee-47e19bfe6a7e",
      sessionId: "2e209023-031e-450a-9840-9a0dab54dd3e",
      createdAt: "2026-08-02T03:00:00.000Z",
    });
    const model = buildMinimalLearnerModel([oldBox, flex, latestBox]);
    expect(model.concepts).toHaveLength(2);
    expect(model.concepts[0]).toMatchObject({
      lessonKind: "box-model-v1",
      sourceAnalysisId: latestBox.analysisId,
      hintDependency: "support-recorded",
      explanationResult: "met",
      practiceResult: {
        guidedObservation: "met",
        independentTransfer: "met",
      },
    });
    expect(model.concepts[1]?.lessonKind).toBe("flex-v1");
    expect(JSON.stringify(model)).not.toMatch(/personality|demographic|mastery/i);
  });
});
