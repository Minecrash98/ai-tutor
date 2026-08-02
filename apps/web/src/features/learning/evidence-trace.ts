import type {
  LearningEvidenceAnalysis,
  LearningReplayBundle,
} from "@ai-tutor/contracts";

export interface LearningEvidenceTrace {
  readonly analysis: LearningEvidenceAnalysis;
  readonly replay: LearningReplayBundle;
  readonly eventById: ReadonlyMap<
    string,
    LearningReplayBundle["events"][number]
  >;
}

function traceFailure(message: string): never {
  throw new Error(`学习证据来源无法核对：${message}`);
}

export function buildLearningEvidenceTrace(
  analysis: LearningEvidenceAnalysis,
  replay: LearningReplayBundle,
): LearningEvidenceTrace {
  if (analysis.sessionId !== replay.session.sessionId) {
    traceFailure("判定结果与课程记录不属于同一次学习。");
  }
  if (analysis.result.lessonKind !== replay.session.lessonKind) {
    traceFailure("判定结果与课程主题不一致。");
  }
  if (analysis.result.sourceEventSchemaVersion !== replay.schemaVersion) {
    traceFailure("判定结果与原始步骤的格式版本不一致。");
  }
  if (analysis.sourceThroughSequence !== analysis.result.sourceThroughSequence) {
    traceFailure("判定结果的步骤边界不一致。");
  }
  if (analysis.sourceThroughSequence > replay.session.latestSequence) {
    traceFailure("课程记录还没有包含判定所引用的最后一步。");
  }

  const eligibleEvents = replay.events.filter(
    (record) => record.sequence <= analysis.sourceThroughSequence,
  );
  const eventById = new Map(
    eligibleEvents.map((record) => [record.event.eventId, record] as const),
  );
  for (const milestone of analysis.result.milestones) {
    if (new Set(milestone.sourceEventIds).size !== milestone.sourceEventIds.length) {
      traceFailure("同一判定重复引用了同一条学生步骤。");
    }
    for (const eventId of milestone.sourceEventIds) {
      const record = eventById.get(eventId);
      if (!record) {
        traceFailure("判定引用的学生步骤不存在或晚于冻结边界。");
      }
      if (record.event.sessionId !== analysis.sessionId) {
        traceFailure("判定引用了其他课程的学生步骤。");
      }
    }
  }

  return { analysis, replay, eventById };
}
