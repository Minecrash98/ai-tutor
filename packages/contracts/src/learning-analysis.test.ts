import { describe, expect, it } from "vitest";

import {
  learningEvidenceAnalysisResultSchema,
  learningProofAuditBundleSchema,
  learningMilestoneAnalysisSchema,
  learnerMisconceptionEvidenceSchema,
  minimalLearnerModelSchema,
} from "./learning-analysis";

describe("learning evidence analysis contract", () => {
  it("represents missing evidence explicitly", () => {
    const parsed = learningMilestoneAnalysisSchema.parse({
      milestoneId: "explanation",
      status: "missing",
      learnerState: "no-evidence",
      criterion: "学生提交一个解释。",
      observed: "没有对应的学生操作记录。",
      sourceEventIds: [],
    });
    expect(parsed.status).toBe("missing");
    expect(parsed.sourceEventIds).toEqual([]);
  });

  it("requires traceable deterministic versions and no scoring model", () => {
    const milestone = {
      status: "missing" as const,
      learnerState: "no-evidence" as const,
      criterion: "有学生操作记录。",
      observed: "没有对应的学生操作记录。",
      sourceEventIds: [],
    };
    const parsed = learningEvidenceAnalysisResultSchema.parse({
      analysisVersion: 1,
      lessonKind: "box-model-v1",
      sourceEventSchemaVersion: 1,
      sourceThroughSequence: 0,
      rubric: { id: "css-learning-proof-rubric", version: 1 },
      evaluator: { id: "deterministic-event-replay", version: 1 },
      scoringModel: null,
      independentCreditEligible: true,
      milestones: [
        { ...milestone, milestoneId: "prediction" },
        { ...milestone, milestoneId: "observation" },
        { ...milestone, milestoneId: "explanation" },
        { ...milestone, milestoneId: "transfer" },
      ],
      claimBoundary:
        "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。",
    });
    expect(parsed.rubric.version).toBe(1);
    expect(parsed.evaluator.version).toBe(1);
    expect(parsed.scoringModel).toBeNull();
  });

  it("keeps the learner model learning-only, versioned, and deletable", () => {
    const parsed = minimalLearnerModelSchema.parse({
      modelVersion: 1,
      scope: "learning-evidence-only",
      concepts: [],
      deletion: {
        strategy: "derived-from-owner-bound-session-analyses",
        endpointTemplate: "/api/learning/sessions/{sessionId}",
        effect:
          "删除课程记录时会级联删除该课程的事件、快照和分析；模型会在下次读取时重新生成。",
      },
      claimBoundary:
        "这里只汇总可观察的课内学习证据，不推断人格，也不自动代表长期掌握。",
    });
    expect(parsed.concepts).toEqual([]);
    expect(() =>
      minimalLearnerModelSchema.parse({ ...parsed, personality: "认真" }),
    ).toThrow();
  });

  it("does not label one event as a repeated misconception", () => {
    expect(() =>
      learnerMisconceptionEvidenceSchema.parse({
        lessonKind: "box-model-v1",
        sourceSessionId: "ca6f1e4a-fba1-4b7f-b551-3862c212aba5",
        misconceptionId: "padding-is-margin",
        state: "repeated-pattern",
        sourceEventIds: ["7f3fb422-d4bc-4301-bab1-686135261b94"],
      }),
    ).toThrow(/至少两条/);
  });

  it("keeps replay, frozen analysis sources, and versions in one audit bundle", () => {
    const sessionId = "ca6f1e4a-fba1-4b7f-b551-3862c212aba5";
    const eventId = "7f3fb422-d4bc-4301-bab1-686135261b94";
    const milestone = {
      status: "missing" as const,
      learnerState: "no-evidence" as const,
      criterion: "有学生操作记录。",
      observed: "没有对应的学生操作记录。",
      sourceEventIds: [] as string[],
    };
    const result = {
      analysisVersion: 1 as const,
      lessonKind: "box-model-v1" as const,
      sourceEventSchemaVersion: 1,
      sourceThroughSequence: 1,
      rubric: { id: "css-learning-proof-rubric" as const, version: 1 as const },
      evaluator: {
        id: "deterministic-event-replay" as const,
        version: 1 as const,
      },
      scoringModel: null,
      independentCreditEligible: true,
      milestones: [
        {
          ...milestone,
          milestoneId: "prediction" as const,
          status: "met" as const,
          learnerState: "independent-demonstration" as const,
          sourceEventIds: [eventId],
        },
        { ...milestone, milestoneId: "observation" as const },
        { ...milestone, milestoneId: "explanation" as const },
        { ...milestone, milestoneId: "transfer" as const },
      ],
      claimBoundary:
        "这份记录只说明本次课程中的可观察表现，不自动代表长期掌握。" as const,
    };
    const bundle = {
      formatVersion: 1 as const,
      exportedAt: "2026-08-02T00:10:00.000Z",
      replay: {
        schemaVersion: 1 as const,
        session: {
          schemaVersion: 1 as const,
          sessionId,
          canvasId: "00000000-0000-4000-8000-000000000001",
          lessonKind: "box-model-v1" as const,
          status: "active" as const,
          latestSequence: 1,
          startedAt: "2026-08-02T00:00:00.000Z",
          endedAt: null,
        },
        events: [
          {
            sequence: 1,
            event: {
              eventVersion: 1 as const,
              eventId,
              sessionId,
              actorType: "user" as const,
              type: "predict" as const,
              answer: "grows" as const,
              at: "2026-08-02T00:00:10.000Z",
            },
          },
        ],
        latestSnapshot: null,
      },
      analyses: [
        {
          analysisId: "00000000-0000-4000-8000-000000000002",
          sessionId,
          sourceThroughSequence: 1,
          result,
          resultHash: "a".repeat(64),
          createdAt: "2026-08-02T00:05:00.000Z",
        },
      ],
      contentHash: "b".repeat(64),
    };
    expect(learningProofAuditBundleSchema.parse(bundle).analyses).toHaveLength(
      1,
    );
    expect(() =>
      learningProofAuditBundleSchema.parse({
        ...bundle,
        analyses: [
          {
            ...bundle.analyses[0],
            sourceThroughSequence: 0,
            result: { ...result, sourceThroughSequence: 0 },
          },
        ],
      }),
    ).toThrow(/冻结边界/);
  });
});
