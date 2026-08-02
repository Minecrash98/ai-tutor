import {
  LEARNING_PROOF_SCHEMA_VERSION,
  SCENARIO_LEARNING_PROOF_SCHEMA_VERSION,
  learningEvidenceAnalysisResultSchema,
  learningEvidenceAnalysisSchema,
  learningProofAuditBundleSchema,
  learningLessonKindSchema,
  learningLessonRecordedEventSchema,
  learningLessonStateSchema,
  learningCanvasSnapshotSchema,
  learningSemanticSnapshotSchema,
  type AppendLearningEventsRequest,
  type CreateLearningSessionRequest,
  type LearningReplayBundle,
  type LearningLessonKind,
  type LearningLessonRecordedEvent,
  type LearningLessonState,
  type LearningEvidenceAnalysis,
  type LearningEvidenceAnalysisListResponse,
  type MinimalLearnerModel,
  type LearningProofAuditBundle,
  type LearningSessionSnapshot,
  type LearningSessionSummary,
  type SaveLearningSnapshotRequest,
  type StoredLearningEvent,
} from "@ai-tutor/contracts";
import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { createDatabase, type Database } from "@/db";
import {
  canvases,
  learningEvidenceAnalyses,
  sessionEvents,
  sessionSnapshots,
  teachingSessions,
} from "@/db/schema";
import { replayBoxModelLessonEvents } from "@/features/lesson/box-model-lesson";
import { replayScenarioLessonEvents } from "@/features/lesson/scenario-lesson";
import { buildLearningEvidenceAnalysis } from "./learning-evidence-analysis";
import { buildMinimalLearnerModel } from "../minimal-learner-model";
import { deriveReplayMisconceptionEvidence } from "../learning-misconception-evidence";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function hashLearningPayload(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export class LearningProofStoreError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LearningProofStoreError";
  }
}

function fail(code: string, status: number, message: string): never {
  throw new LearningProofStoreError(code, status, message);
}

function isScenarioEvent(
  event: LearningLessonRecordedEvent,
): event is Extract<LearningLessonRecordedEvent, { type: `scenario-${string}` }> {
  return event.type.startsWith("scenario-");
}

function isAuditEvent(
  event: LearningLessonRecordedEvent,
): event is Extract<LearningLessonRecordedEvent, { type: `audit-${string}` }> {
  return event.type.startsWith("audit-");
}

function eventMatchesLesson(
  lessonKind: LearningLessonKind,
  event: LearningLessonRecordedEvent,
): boolean {
  if (isAuditEvent(event)) return true;
  if (lessonKind === "box-model-v1") return !isScenarioEvent(event);
  if (!isScenarioEvent(event)) return false;
  if (event.type === "scenario-start") return event.lessonKind === lessonKind;
  if (event.type === "scenario-predict") {
    return lessonKind === "flex-v1"
      ? ["gap-separates-items", "gap-resizes-items", "unsure"].includes(event.answer)
      : ["absolute-leaves-flow", "relative-leaves-flow", "unsure"].includes(event.answer);
  }
  if (event.type === "scenario-explain") {
    return lessonKind === "flex-v1"
      ? [
          "axes-are-independent",
          "gap-changes-item-size",
          "justify-is-cross-axis",
        ].includes(event.answer)
      : [
          "nearest-positioned-ancestor",
          "viewport-always",
          "relative-leaves-flow",
        ].includes(event.answer);
  }
  return true;
}

function currentSchemaVersion(lessonKind: LearningLessonKind) {
  return lessonKind === "box-model-v1"
    ? LEARNING_PROOF_SCHEMA_VERSION
    : SCENARIO_LEARNING_PROOF_SCHEMA_VERSION;
}

function isSupportedStoredSchema(
  lessonKind: LearningLessonKind,
  schemaVersion: number,
): schemaVersion is
  | typeof LEARNING_PROOF_SCHEMA_VERSION
  | typeof SCENARIO_LEARNING_PROOF_SCHEMA_VERSION {
  return lessonKind === "box-model-v1"
    ? schemaVersion === LEARNING_PROOF_SCHEMA_VERSION
    : schemaVersion === LEARNING_PROOF_SCHEMA_VERSION ||
        schemaVersion === SCENARIO_LEARNING_PROOF_SCHEMA_VERSION;
}

function replayLessonEvents(
  lessonKind: LearningLessonKind,
  events: readonly LearningLessonRecordedEvent[],
): LearningLessonState {
  if (lessonKind === "box-model-v1") {
    return replayBoxModelLessonEvents(
      events.filter(
        (event): event is Extract<
          LearningLessonRecordedEvent,
          { type: "start" | "predict" | "experiment-saved" | "explain" | "support" | "attach-transfer" | "transfer-submit" }
        > => !isScenarioEvent(event) && !isAuditEvent(event),
      ),
    );
  }
  return replayScenarioLessonEvents(events.filter(isScenarioEvent));
}

function sessionSummary(row: {
  readonly id: string;
  readonly canvasId: string;
  readonly status: "active" | "completed" | "interrupted";
  readonly schemaVersion: number;
  readonly lessonKind: string;
  readonly latestSequence: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}): LearningSessionSummary {
  const lessonKind = learningLessonKindSchema.safeParse(row.lessonKind);
  if (
    !lessonKind.success ||
    !isSupportedStoredSchema(lessonKind.data, row.schemaVersion)
  ) {
    fail(
      "LEARNING_SESSION_VERSION_UNSUPPORTED",
      409,
      "这份学习记录来自不兼容的版本，请先导出后再开始新课。",
    );
  }
  return {
    schemaVersion: row.schemaVersion,
    sessionId: row.id,
    canvasId: row.canvasId,
    lessonKind: lessonKind.data,
    status: row.status,
    latestSequence: row.latestSequence,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

function evidenceAnalysisRecord(row: {
  readonly id: string;
  readonly sessionId: string;
  readonly sourceThroughSequence: number;
  readonly analysisVersion: number;
  readonly rubricId: string;
  readonly rubricVersion: number;
  readonly evaluatorId: string;
  readonly evaluatorVersion: number;
  readonly scoringModel: string | null;
  readonly result: unknown;
  readonly resultHash: string;
  readonly createdAt: Date;
}): LearningEvidenceAnalysis {
  const result = learningEvidenceAnalysisResultSchema.parse(row.result);
  if (
    row.sourceThroughSequence !== result.sourceThroughSequence ||
    row.analysisVersion !== result.analysisVersion ||
    row.rubricId !== result.rubric.id ||
    row.rubricVersion !== result.rubric.version ||
    row.evaluatorId !== result.evaluator.id ||
    row.evaluatorVersion !== result.evaluator.version ||
    row.scoringModel !== null ||
    result.scoringModel !== null ||
    hashLearningPayload(result) !== row.resultHash
  ) {
    fail(
      "LEARNING_ANALYSIS_CORRUPTED",
      500,
      "学习证据快照未通过版本或完整性检查，已停止展示。",
    );
  }
  return learningEvidenceAnalysisSchema.parse({
    analysisId: row.id,
    sessionId: row.sessionId,
    sourceThroughSequence: row.sourceThroughSequence,
    result,
    resultHash: row.resultHash,
    createdAt: row.createdAt.toISOString(),
  });
}

function storedEvent(row: {
  readonly sequence: number;
  readonly clientEventId: string;
  readonly eventVersion: number;
  readonly eventType: string;
  readonly actorType: "user" | "ai" | "system";
  readonly payload: unknown;
  readonly payloadHash: string;
}): StoredLearningEvent {
  const parsed = learningLessonRecordedEventSchema.safeParse(row.payload);
  if (
    !parsed.success ||
    parsed.data.eventId !== row.clientEventId ||
    parsed.data.eventVersion !== row.eventVersion ||
    parsed.data.type !== row.eventType ||
    parsed.data.actorType !== row.actorType ||
    hashLearningPayload(parsed.data) !== row.payloadHash
  ) {
    fail(
      "LEARNING_EVENT_CORRUPTED",
      500,
      "一条学习记录未通过完整性检查，已停止回放以免显示错误结果。",
    );
  }
  return { sequence: row.sequence, event: parsed.data };
}

export interface AppendLearningEventsResult {
  readonly acknowledgedSequence: number;
  readonly latestSequence: number;
  readonly events: readonly StoredLearningEvent[];
}

export class LearningProofStore {
  constructor(private readonly database: Database) {}

  async findLatestActiveSessionId(ownerId: string): Promise<string | null> {
    const rows = await this.database
      .select({ id: teachingSessions.id })
      .from(teachingSessions)
      .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
      .where(
        and(
          eq(canvases.anonymousOwnerTokenHash, ownerId),
          eq(teachingSessions.status, "active"),
        ),
      )
      .orderBy(desc(teachingSessions.startedAt), desc(teachingSessions.id))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async deleteSession(
    ownerId: string,
    sessionId: string,
  ): Promise<{ readonly deleted: boolean }> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: teachingSessions.id,
          ownerId: canvases.anonymousOwnerTokenHash,
        })
        .from(teachingSessions)
        .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
        .where(eq(teachingSessions.id, sessionId))
        .for("update");
      const session = rows[0];
      if (!session) return { deleted: false };
      if (session.ownerId !== ownerId) {
        fail(
          "LEARNING_SESSION_FORBIDDEN",
          403,
          "这份学习记录不属于当前设备。",
        );
      }
      await transaction
        .delete(teachingSessions)
        .where(eq(teachingSessions.id, sessionId));
      return { deleted: true };
    });
  }

  async createSession(
    ownerId: string,
    input: CreateLearningSessionRequest,
  ): Promise<LearningSessionSummary> {
    return this.database.transaction(async (transaction) => {
      const existingSession = await transaction
        .select({
          id: teachingSessions.id,
          canvasId: teachingSessions.canvasId,
          status: teachingSessions.status,
          schemaVersion: teachingSessions.schemaVersion,
          lessonKind: teachingSessions.lessonKind,
          latestSequence: teachingSessions.latestSequence,
          startedAt: teachingSessions.startedAt,
          endedAt: teachingSessions.endedAt,
          ownerId: canvases.anonymousOwnerTokenHash,
        })
        .from(teachingSessions)
        .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
        .where(eq(teachingSessions.id, input.sessionId))
        .for("update");
      const existing = existingSession[0];
      if (existing) {
        if (existing.ownerId !== ownerId || existing.canvasId !== input.canvasId) {
          fail(
            "LEARNING_SESSION_FORBIDDEN",
            403,
            "这份学习记录不属于当前设备。",
          );
        }
        if (
          existing.lessonKind !== input.lessonKind ||
          existing.schemaVersion !== input.schemaVersion ||
          existing.startedAt.getTime() !== new Date(input.startedAt).getTime()
        ) {
          fail(
            "LEARNING_SESSION_ID_CONFLICT",
            409,
            "同一个学习记录编号已经用于另一节课，请恢复原记录或开始新课。",
          );
        }
        return sessionSummary(existing);
      }

      if (input.schemaVersion !== currentSchemaVersion(input.lessonKind)) {
        fail(
          "LEARNING_SESSION_VERSION_UNSUPPORTED",
          409,
          "新课程需要使用当前版本；旧记录仍可恢复和导出。",
        );
      }

      const existingCanvas = await transaction
        .select({ ownerId: canvases.anonymousOwnerTokenHash })
        .from(canvases)
        .where(eq(canvases.id, input.canvasId))
        .for("update");
      if (existingCanvas[0] && existingCanvas[0].ownerId !== ownerId) {
        fail("LEARNING_CANVAS_FORBIDDEN", 403, "这个画布不属于当前设备。");
      }
      if (!existingCanvas[0]) {
        await transaction
          .insert(canvases)
          .values({
            id: input.canvasId,
            anonymousOwnerTokenHash: ownerId,
            title:
              input.lessonKind === "box-model-v1"
                ? "盒模型一分钟课"
                : input.lessonKind === "flex-v1"
                  ? "Flex 轴与间距课"
                  : "定位与文档流课",
            currentDocumentSnapshot: { version: 1, shapes: [] },
          })
          .onConflictDoNothing({ target: canvases.id });
      }
      const confirmedCanvas = await transaction
        .select({ ownerId: canvases.anonymousOwnerTokenHash })
        .from(canvases)
        .where(eq(canvases.id, input.canvasId))
        .for("update");
      if (!confirmedCanvas[0] || confirmedCanvas[0].ownerId !== ownerId) {
        fail("LEARNING_CANVAS_FORBIDDEN", 403, "这个画布不属于当前设备。");
      }
      await transaction
        .insert(teachingSessions)
        .values({
          id: input.sessionId,
          canvasId: input.canvasId,
          status: "active",
          schemaVersion: input.schemaVersion,
          lessonKind: input.lessonKind,
          startedAt: new Date(input.startedAt),
          latestSequence: 0,
        })
        .onConflictDoNothing({ target: teachingSessions.id });
      const created = await transaction
        .select({
          id: teachingSessions.id,
          canvasId: teachingSessions.canvasId,
          status: teachingSessions.status,
          schemaVersion: teachingSessions.schemaVersion,
          lessonKind: teachingSessions.lessonKind,
          latestSequence: teachingSessions.latestSequence,
          startedAt: teachingSessions.startedAt,
          endedAt: teachingSessions.endedAt,
          ownerId: canvases.anonymousOwnerTokenHash,
        })
        .from(teachingSessions)
        .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
        .where(eq(teachingSessions.id, input.sessionId));
      if (
        !created[0] ||
        created[0].ownerId !== ownerId ||
        created[0].canvasId !== input.canvasId
      ) {
        fail("LEARNING_SESSION_CREATE_FAILED", 500, "暂时无法建立学习记录。");
      }
      return sessionSummary(created[0]);
    });
  }

  async appendEvents(
    ownerId: string,
    sessionId: string,
    input: AppendLearningEventsRequest,
  ): Promise<AppendLearningEventsResult> {
    if (input.events.some((event) => event.sessionId !== sessionId)) {
      fail("LEARNING_EVENT_SESSION_MISMATCH", 400, "学习步骤与当前课程不匹配。");
    }
    return this.database.transaction(async (transaction) => {
      const sessions = await transaction
        .select({
          id: teachingSessions.id,
          latestSequence: teachingSessions.latestSequence,
          schemaVersion: teachingSessions.schemaVersion,
          lessonKind: teachingSessions.lessonKind,
          status: teachingSessions.status,
          ownerId: canvases.anonymousOwnerTokenHash,
        })
        .from(teachingSessions)
        .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
        .where(eq(teachingSessions.id, sessionId))
        .for("update");
      const session = sessions[0];
      if (!session) {
        fail("LEARNING_SESSION_NOT_FOUND", 404, "没有找到这节课的学习记录。");
      }
      if (session.ownerId !== ownerId) {
        fail("LEARNING_SESSION_FORBIDDEN", 403, "这份学习记录不属于当前设备。");
      }
      const lessonKind = learningLessonKindSchema.safeParse(session.lessonKind);
      if (
        !lessonKind.success ||
        !isSupportedStoredSchema(lessonKind.data, session.schemaVersion) ||
        input.schemaVersion !== session.schemaVersion ||
        input.events.some(
          (event) => event.eventVersion !== session.schemaVersion,
        ) ||
        input.events.some((event) => !eventMatchesLesson(lessonKind.data, event))
      ) {
        fail(
          "LEARNING_EVENT_LESSON_MISMATCH",
          400,
          "这个学习步骤不属于当前课程。",
        );
      }
      if (input.expectedSequence > session.latestSequence) {
        fail(
          "LEARNING_SEQUENCE_AHEAD",
          409,
          "学习步骤序号超前，请先恢复最新记录。",
        );
      }

      const existingRows = await transaction
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence));
      if (
        existingRows.length !== session.latestSequence ||
        existingRows.some((row, index) => row.sequence !== index + 1)
      ) {
        fail(
          "LEARNING_EVENT_STREAM_CORRUPTED",
          500,
          "学习步骤序列不完整，已停止写入以免覆盖正确记录。",
        );
      }
      const existingById = new Map(
        existingRows.map((row) => [row.clientEventId, row]),
      );
      const replayedEvents = existingRows.map(storedEvent).map(
        (record) => record.event,
      );
      if (
        replayedEvents.some(
          (event) => !eventMatchesLesson(lessonKind.data, event),
        )
      ) {
        fail(
          "LEARNING_EVENT_STREAM_CORRUPTED",
          500,
          "学习步骤与课程类型不一致，已停止写入。",
        );
      }
      const accepted: StoredLearningEvent[] = [];
      let acknowledgedSequence = input.expectedSequence;
      let databaseLatest = session.latestSequence;

      for (const event of input.events) {
        const payloadHash = hashLearningPayload(event);
        const existing = existingById.get(event.eventId);
        if (existing) {
          if (
            existing.payloadHash !== payloadHash ||
            existing.sequence !== acknowledgedSequence + 1
          ) {
            fail(
              "LEARNING_EVENT_ID_CONFLICT",
              409,
              "学习步骤与已保存记录冲突，请先恢复最新记录。",
            );
          }
          accepted.push(storedEvent(existing));
          acknowledgedSequence = existing.sequence;
          continue;
        }
        if (acknowledgedSequence !== databaseLatest) {
          fail(
            "LEARNING_SEQUENCE_CONFLICT",
            409,
            "另一份更新已经先保存，请先恢复最新记录。",
          );
        }
        const startEvent =
          event.type === "start" || event.type === "scenario-start";
        if ((databaseLatest === 0) !== startEvent) {
          fail(
            "LEARNING_EVENT_TRANSITION_INVALID",
            409,
            databaseLatest === 0
              ? "第一条学习步骤必须先建立课程。"
              : "课程已经开始，不能用新的开始步骤覆盖原记录。",
          );
        }
        const currentState = replayLessonEvents(
          lessonKind.data,
          replayedEvents,
        );
        if (session.status === "completed" || currentState.phase === "complete") {
          fail(
            "LEARNING_SESSION_ALREADY_COMPLETED",
            409,
            "这节课已经完成；原学习记录不会被重新打开。",
          );
        }
        const lastEvent = replayedEvents.at(-1);
        if (
          lastEvent &&
          new Date(event.at).getTime() < new Date(lastEvent.at).getTime()
        ) {
          fail(
            "LEARNING_EVENT_TIME_REVERSED",
            409,
            "学习步骤时间早于上一条记录，请先恢复当前会话。",
          );
        }
        if (
          (event.type === "experiment-saved" ||
            event.type === "scenario-experiment-saved") &&
          replayedEvents.some(
            (candidate) =>
              (candidate.type === "experiment-saved" ||
                candidate.type === "scenario-experiment-saved") &&
              candidate.revisionId === event.revisionId,
          )
        ) {
          fail(
            "LEARNING_REVISION_ALREADY_OBSERVED",
            409,
            "每次观察必须来自一个新的不可变版本。",
          );
        }
        if (
          (event.type === "attach-transfer" ||
            event.type === "scenario-attach-transfer") &&
          replayedEvents.some(
            (candidate) =>
              (candidate.type === "start" &&
                candidate.blockId === event.blockId) ||
              (candidate.type === "scenario-start" &&
                candidate.blocks.some(
                  (block) => block.blockId === event.blockId,
                )),
          )
        ) {
          fail(
            "LEARNING_TRANSFER_BLOCK_REUSED",
            409,
            "迁移题必须使用结构不同的新页面。",
          );
        }
        const nextState = replayLessonEvents(lessonKind.data, [
          ...replayedEvents,
          event,
        ]);
        if (
          !isAuditEvent(event) &&
          canonicalJson(nextState) === canonicalJson(currentState)
        ) {
          fail(
            "LEARNING_EVENT_TRANSITION_INVALID",
            409,
            "这个学习步骤不符合当前阶段，记录没有写入。",
          );
        }
        const sequence = databaseLatest + 1;
        const inserted = await transaction
          .insert(sessionEvents)
          .values({
            sessionId,
            sequence,
            clientEventId: event.eventId,
            eventVersion: event.eventVersion,
            eventType: event.type,
            actorType: event.actorType,
            payload: event,
            payloadHash,
            occurredAt: new Date(event.at),
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          fail("LEARNING_EVENT_SAVE_FAILED", 500, "暂时无法保存这个学习步骤。");
        }
        accepted.push(storedEvent(row));
        replayedEvents.push(event);
        databaseLatest = sequence;
        acknowledgedSequence = sequence;
      }

      if (databaseLatest !== session.latestSequence) {
        await transaction
          .update(teachingSessions)
          .set({ latestSequence: databaseLatest, updatedAt: new Date() })
          .where(eq(teachingSessions.id, sessionId));
      }
      return {
        acknowledgedSequence,
        latestSequence: databaseLatest,
        events: accepted,
      };
    });
  }

  async saveSnapshot(
    ownerId: string,
    sessionId: string,
    input: SaveLearningSnapshotRequest,
  ): Promise<LearningSessionSnapshot> {
    return this.database.transaction(async (transaction) => {
      const sessions = await transaction
        .select({
          latestSequence: teachingSessions.latestSequence,
          canvasId: teachingSessions.canvasId,
          schemaVersion: teachingSessions.schemaVersion,
          lessonKind: teachingSessions.lessonKind,
          ownerId: canvases.anonymousOwnerTokenHash,
        })
        .from(teachingSessions)
        .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
        .where(eq(teachingSessions.id, sessionId))
        .for("update");
      const session = sessions[0];
      if (!session) {
        fail("LEARNING_SESSION_NOT_FOUND", 404, "没有找到这节课的学习记录。");
      }
      if (session.ownerId !== ownerId) {
        fail("LEARNING_SESSION_FORBIDDEN", 403, "这份学习记录不属于当前设备。");
      }
      if (input.throughSequence !== session.latestSequence) {
        fail(
          "LEARNING_SNAPSHOT_SEQUENCE_CONFLICT",
          409,
          "学习记录还在同步，请稍后再保存回放快照。",
        );
      }
      const eventRows = await transaction
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence));
      const events = eventRows.map(storedEvent);
      const lessonKind = learningLessonKindSchema.safeParse(session.lessonKind);
      if (
        !lessonKind.success ||
        !isSupportedStoredSchema(lessonKind.data, session.schemaVersion) ||
        input.schemaVersion !== session.schemaVersion ||
        events.some(
          ({ event }) => event.eventVersion !== session.schemaVersion,
        )
      ) {
        fail(
          "LEARNING_SESSION_VERSION_UNSUPPORTED",
          409,
          "这份学习记录来自不兼容的版本，请先导出后再开始新课。",
        );
      }
      const replayed = replayLessonEvents(
        lessonKind.data,
        events.map((record) => record.event),
      );
      if (
        replayed.sessionId !== sessionId ||
        canonicalJson(replayed) !== canonicalJson(input.lessonState)
      ) {
        fail(
          "LEARNING_SNAPSHOT_REPLAY_MISMATCH",
          409,
          "当前结果与学习步骤不一致，已停止保存以免覆盖正确记录。",
        );
      }
      const snapshotHash = hashLearningPayload({
        throughSequence: input.throughSequence,
        canvasSnapshot: input.canvasSnapshot,
        semanticSnapshot: input.semanticSnapshot,
        lessonState: input.lessonState,
      });
      const existing = await transaction
        .select()
        .from(sessionSnapshots)
        .where(
          and(
            eq(sessionSnapshots.sessionId, sessionId),
            eq(sessionSnapshots.throughSequence, input.throughSequence),
          ),
        );
      if (existing[0]) {
        if (existing[0].snapshotHash !== snapshotHash) {
          fail(
            "LEARNING_SNAPSHOT_CONFLICT",
            409,
            "同一步骤已有不同快照，请先恢复最新记录。",
          );
        }
        return {
          throughSequence: existing[0].throughSequence,
          canvasSnapshot: learningCanvasSnapshotSchema.parse(
            existing[0].canvasSnapshot,
          ),
          semanticSnapshot: learningSemanticSnapshotSchema.parse(
            existing[0].semanticSnapshot,
          ),
          lessonState: learningLessonStateSchema.parse(existing[0].lessonState),
          snapshotHash: existing[0].snapshotHash,
          createdAt: existing[0].createdAt.toISOString(),
        };
      }
      const inserted = await transaction
        .insert(sessionSnapshots)
        .values({
          sessionId,
          throughSequence: input.throughSequence,
          canvasSnapshot: input.canvasSnapshot,
          semanticSnapshot: input.semanticSnapshot,
          lessonState: input.lessonState,
          snapshotHash,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        fail("LEARNING_SNAPSHOT_SAVE_FAILED", 500, "暂时无法保存回放快照。");
      }
      const complete = input.lessonState.phase === "complete";
      await transaction
        .update(canvases)
        .set({
          currentDocumentSnapshot: input.canvasSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(canvases.id, session.canvasId));
      await transaction
        .update(teachingSessions)
        .set({
          status: complete ? "completed" : "active",
          endedAt: complete ? new Date(input.lessonState.completedAt!) : null,
          updatedAt: new Date(),
        })
        .where(eq(teachingSessions.id, sessionId));
      return {
        throughSequence: created.throughSequence,
        canvasSnapshot: input.canvasSnapshot,
        semanticSnapshot: input.semanticSnapshot,
        lessonState: input.lessonState,
        snapshotHash,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }

  async getReplay(ownerId: string, sessionId: string): Promise<LearningReplayBundle> {
    const sessions = await this.database
      .select({
        id: teachingSessions.id,
        canvasId: teachingSessions.canvasId,
        status: teachingSessions.status,
        schemaVersion: teachingSessions.schemaVersion,
        lessonKind: teachingSessions.lessonKind,
        latestSequence: teachingSessions.latestSequence,
        startedAt: teachingSessions.startedAt,
        endedAt: teachingSessions.endedAt,
        ownerId: canvases.anonymousOwnerTokenHash,
      })
      .from(teachingSessions)
      .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
      .where(eq(teachingSessions.id, sessionId));
    const session = sessions[0];
    if (!session) {
      fail("LEARNING_SESSION_NOT_FOUND", 404, "没有找到这节课的学习记录。");
    }
    if (session.ownerId !== ownerId) {
      fail("LEARNING_SESSION_FORBIDDEN", 403, "这份学习记录不属于当前设备。");
    }
    const [eventRows, snapshotRows] = await Promise.all([
      this.database
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence)),
      this.database
        .select()
        .from(sessionSnapshots)
        .where(eq(sessionSnapshots.sessionId, sessionId))
        .orderBy(desc(sessionSnapshots.throughSequence))
        .limit(1),
    ]);
    const lessonKind = learningLessonKindSchema.safeParse(session.lessonKind);
    const schemaVersion = session.schemaVersion;
    if (
      !lessonKind.success ||
      !isSupportedStoredSchema(lessonKind.data, schemaVersion)
    ) {
      fail(
        "LEARNING_SESSION_VERSION_UNSUPPORTED",
        409,
        "这份学习记录来自不兼容的版本，请先导出后再开始新课。",
      );
    }
    const events = eventRows.map(storedEvent);
    if (
      events.length !== session.latestSequence ||
      events.some(
        (record, index) =>
          record.sequence !== index + 1 ||
          record.event.sessionId !== sessionId ||
          record.event.eventVersion !== schemaVersion ||
          !eventMatchesLesson(lessonKind.data, record.event),
      )
    ) {
      fail(
        "LEARNING_EVENT_STREAM_CORRUPTED",
        500,
        "学习步骤未通过顺序或课程完整性检查，已停止回放。",
      );
    }
    const snapshot = snapshotRows[0];
    let latestSnapshot: LearningSessionSnapshot | null = null;
    if (snapshot) {
      const parsedSnapshot = {
        throughSequence: snapshot.throughSequence,
        canvasSnapshot: learningCanvasSnapshotSchema.parse(
          snapshot.canvasSnapshot,
        ),
        semanticSnapshot: learningSemanticSnapshotSchema.parse(
          snapshot.semanticSnapshot,
        ),
        lessonState: learningLessonStateSchema.parse(snapshot.lessonState),
        snapshotHash: snapshot.snapshotHash,
        createdAt: snapshot.createdAt.toISOString(),
      };
      const expectedHash = hashLearningPayload({
        throughSequence: parsedSnapshot.throughSequence,
        canvasSnapshot: parsedSnapshot.canvasSnapshot,
        semanticSnapshot: parsedSnapshot.semanticSnapshot,
        lessonState: parsedSnapshot.lessonState,
      });
      const replayed = replayLessonEvents(
        lessonKind.data,
        events
          .slice(0, parsedSnapshot.throughSequence)
          .map((record) => record.event),
      );
      if (
        parsedSnapshot.throughSequence < 1 ||
        parsedSnapshot.throughSequence > events.length ||
        expectedHash !== parsedSnapshot.snapshotHash ||
        canonicalJson(replayed) !== canonicalJson(parsedSnapshot.lessonState)
      ) {
        fail(
          "LEARNING_SNAPSHOT_CORRUPTED",
          500,
          "学习快照未通过哈希或确定性重放检查，已停止回放。",
        );
      }
      latestSnapshot = parsedSnapshot;
    }
    if (
      session.status === "completed" &&
      (!latestSnapshot ||
        latestSnapshot.throughSequence !== session.latestSequence ||
        latestSnapshot.lessonState.phase !== "complete")
    ) {
      fail(
        "LEARNING_COMPLETION_SNAPSHOT_MISSING",
        500,
        "完成状态缺少对应的最终快照，已停止回放。",
      );
    }
    return {
      schemaVersion,
      session: sessionSummary(session),
      events,
      latestSnapshot,
    };
  }

  async getCurrentLessonState(
    ownerId: string,
    sessionId: string,
  ): Promise<LearningLessonState> {
    const replay = await this.getReplay(ownerId, sessionId);
    return replayLessonEvents(
      replay.session.lessonKind,
      replay.events.map((record) => record.event),
    );
  }

  async listEvidenceAnalyses(
    ownerId: string,
    sessionId: string,
  ): Promise<LearningEvidenceAnalysisListResponse> {
    const replay = await this.getReplay(ownerId, sessionId);
    const rows = await this.database
      .select()
      .from(learningEvidenceAnalyses)
      .where(eq(learningEvidenceAnalyses.sessionId, sessionId))
      .orderBy(desc(learningEvidenceAnalyses.createdAt))
      .limit(100);
    return {
      sessionId,
      currentThroughSequence: replay.events.length,
      analyses: rows.map(evidenceAnalysisRecord),
    };
  }

  async getAuditBundle(
    ownerId: string,
    sessionId: string,
  ): Promise<LearningProofAuditBundle> {
    const replay = await this.getReplay(ownerId, sessionId);
    const rows = await this.database
      .select()
      .from(learningEvidenceAnalyses)
      .where(eq(learningEvidenceAnalyses.sessionId, sessionId))
      .orderBy(desc(learningEvidenceAnalyses.createdAt))
      .limit(100);
    const core = {
      formatVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      replay,
      analyses: rows.map(evidenceAnalysisRecord),
    };
    return learningProofAuditBundleSchema.parse({
      ...core,
      contentHash: hashLearningPayload(core),
    });
  }

  async createEvidenceAnalysis(
    ownerId: string,
    sessionId: string,
    mode: "current" | "reanalysis",
  ): Promise<{ readonly created: boolean; readonly analysis: LearningEvidenceAnalysis }> {
    const replay = await this.getReplay(ownerId, sessionId);
    const state = replayLessonEvents(
      replay.session.lessonKind,
      replay.events.map((record) => record.event),
    );
    const result = buildLearningEvidenceAnalysis(replay, state);
    if (mode === "current") {
      const existingRows = await this.database
        .select()
        .from(learningEvidenceAnalyses)
        .where(
          and(
            eq(learningEvidenceAnalyses.sessionId, sessionId),
            eq(
              learningEvidenceAnalyses.sourceThroughSequence,
              result.sourceThroughSequence,
            ),
          ),
        )
        .orderBy(desc(learningEvidenceAnalyses.createdAt));
      const matching = existingRows.find(
        (row) =>
          row.analysisVersion === result.analysisVersion &&
          row.rubricId === result.rubric.id &&
          row.rubricVersion === result.rubric.version &&
          row.evaluatorId === result.evaluator.id &&
          row.evaluatorVersion === result.evaluator.version &&
          row.scoringModel === null,
      );
      if (matching) {
        return { created: false, analysis: evidenceAnalysisRecord(matching) };
      }
    }

    const resultHash = hashLearningPayload(result);
    const createdRows = await this.database
      .insert(learningEvidenceAnalyses)
      .values({
        sessionId,
        sourceThroughSequence: result.sourceThroughSequence,
        analysisVersion: result.analysisVersion,
        rubricId: result.rubric.id,
        rubricVersion: result.rubric.version,
        evaluatorId: result.evaluator.id,
        evaluatorVersion: result.evaluator.version,
        scoringModel: null,
        result,
        resultHash,
      })
      .returning();
    const created = createdRows[0];
    if (!created) {
      fail(
        "LEARNING_ANALYSIS_CREATE_FAILED",
        500,
        "学习证据快照没有保存，请稍后重试。",
      );
    }
    return { created: true, analysis: evidenceAnalysisRecord(created) };
  }

  async getMinimalLearnerModel(ownerId: string): Promise<MinimalLearnerModel> {
    const rows = await this.database
      .select({
        id: learningEvidenceAnalyses.id,
        sessionId: learningEvidenceAnalyses.sessionId,
        sourceThroughSequence: learningEvidenceAnalyses.sourceThroughSequence,
        analysisVersion: learningEvidenceAnalyses.analysisVersion,
        rubricId: learningEvidenceAnalyses.rubricId,
        rubricVersion: learningEvidenceAnalyses.rubricVersion,
        evaluatorId: learningEvidenceAnalyses.evaluatorId,
        evaluatorVersion: learningEvidenceAnalyses.evaluatorVersion,
        scoringModel: learningEvidenceAnalyses.scoringModel,
        result: learningEvidenceAnalyses.result,
        resultHash: learningEvidenceAnalyses.resultHash,
        createdAt: learningEvidenceAnalyses.createdAt,
      })
      .from(learningEvidenceAnalyses)
      .innerJoin(
        teachingSessions,
        eq(learningEvidenceAnalyses.sessionId, teachingSessions.id),
      )
      .innerJoin(canvases, eq(teachingSessions.canvasId, canvases.id))
      .where(eq(canvases.anonymousOwnerTokenHash, ownerId))
      .orderBy(desc(learningEvidenceAnalyses.createdAt))
      .limit(500);
    const analyses = rows.map(evidenceAnalysisRecord);
    const baseModel = buildMinimalLearnerModel(analyses);
    const misconceptionEvidence = (
      await Promise.all(
        baseModel.concepts.map(async (concept) =>
          deriveReplayMisconceptionEvidence(
            await this.getReplay(ownerId, concept.sourceSessionId),
            concept.sourceThroughSequence,
          ),
        ),
      )
    ).flat();
    return buildMinimalLearnerModel(analyses, misconceptionEvidence);
  }

}

const storeGlobal = globalThis as typeof globalThis & {
  __aiTutorLearningProofStore?: LearningProofStore;
  __aiTutorLearningProofDatabaseUrl?: string;
};

export function getLearningProofStore(): LearningProofStore {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail(
      "LEARNING_DATABASE_UNAVAILABLE",
      503,
      "在线学习记录暂时不可用；当前操作仍保存在这台设备，连接恢复后会继续同步。",
    );
  }
  if (
    !storeGlobal.__aiTutorLearningProofStore ||
    storeGlobal.__aiTutorLearningProofDatabaseUrl !== databaseUrl
  ) {
    storeGlobal.__aiTutorLearningProofStore = new LearningProofStore(
      createDatabase(databaseUrl).db,
    );
    storeGlobal.__aiTutorLearningProofDatabaseUrl = databaseUrl;
  }
  return storeGlobal.__aiTutorLearningProofStore;
}

export function resetLearningProofStoreForTests(): void {
  delete storeGlobal.__aiTutorLearningProofStore;
  delete storeGlobal.__aiTutorLearningProofDatabaseUrl;
}
