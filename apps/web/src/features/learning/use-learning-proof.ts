"use client";

import {
  LEARNING_PROOF_SCHEMA_VERSION,
  SCENARIO_LEARNING_PROOF_SCHEMA_VERSION,
  appendLearningEventsResponseSchema,
  learningAuditRecordedEventSchema,
  learningReplayBundleSchema,
  learningSessionSnapshotSchema,
  type BoxModelExplanation,
  type BoxModelLessonRecordedEvent,
  type BoxModelLessonState,
  type BoxModelPrediction,
  type LearningLessonRecordedEvent,
  type LearningLessonState,
  type LearningAuditEventInput,
  type LearningAuditRecordedEvent,
  type PersonalizedLessonOrigin,
  type LearningSupportAction,
  type LearningCanvasSnapshot,
  type LearningSemanticSnapshot,
  type ScenarioExplanation,
  type ScenarioLessonBlock,
  type ScenarioLessonKind,
  type ScenarioLessonRecordedEvent,
  type ScenarioLessonState,
  type ScenarioPrediction,
} from "@ai-tutor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  INITIAL_BOX_MODEL_LESSON,
  replayBoxModelLessonEvents,
} from "@/features/lesson/box-model-lesson";
import {
  INITIAL_SCENARIO_LESSON,
  replayScenarioLessonEvents,
} from "@/features/lesson/scenario-lesson";
import {
  LearningProofLocalSaveError,
  acknowledgeLearningProofLocalEvents,
  acknowledgeLearningProofLocalSnapshot,
  activateLearningProofLocalSession,
  appendLearningProofLocalEvent,
  claimLearningProofLocalState,
  createLearningProofLocalState,
  listLearningProofLocalSessions,
  mergeLearningProofReplay,
  pendingLearningProofEvents,
  removeLearningProofLocalSession,
  restoreLearningProofLocalState,
  saveLearningProofLocalState,
  type LearningProofLocalState,
  type LearningProofLocalSessionReference,
} from "./learning-proof-local";

export type LearningProofSyncStatus =
  | "idle"
  | "local"
  | "syncing"
  | "synced"
  | "recovering"
  | "corrupted";

export interface LearningProofSnapshotInput {
  readonly canvasSnapshot: LearningCanvasSnapshot;
  readonly semanticSnapshot: LearningSemanticSnapshot;
}

export interface LearningProofAuthoritativeSnapshot {
  readonly throughSequence: number;
  readonly lessonState: LearningLessonState;
}

interface UseLearningProofOptions {
  readonly captureSnapshot: () => LearningProofSnapshotInput | null;
  readonly onNotice: (message: string) => void;
}

class LearningProofHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Learning proof request failed with status ${status}`);
    this.name = "LearningProofHttpError";
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LearningProofHttpError(response.status, body);
  return body;
}

function boxModelEventMetadata<const TActor extends "user" | "system">(
  sessionId: string,
  actorType: TActor,
  at: string,
) {
  return {
    eventVersion: LEARNING_PROOF_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    sessionId,
    actorType,
    at,
  };
}

function scenarioEventMetadata<const TActor extends "user" | "system">(
  sessionId: string,
  actorType: TActor,
  at: string,
  eventVersion:
    | typeof LEARNING_PROOF_SCHEMA_VERSION
    | typeof SCENARIO_LEARNING_PROOF_SCHEMA_VERSION =
    SCENARIO_LEARNING_PROOF_SCHEMA_VERSION,
) {
  return {
    eventVersion,
    eventId: crypto.randomUUID(),
    sessionId,
    actorType,
    at,
  };
}

function proofSchemaVersion(state: LearningProofLocalState) {
  return (
    state.events[0]?.eventVersion ??
    (state.lessonKind === "box-model-v1"
      ? LEARNING_PROOF_SCHEMA_VERSION
      : SCENARIO_LEARNING_PROOF_SCHEMA_VERSION)
  );
}

function isScenarioEvent(
  event: LearningLessonRecordedEvent,
): event is ScenarioLessonRecordedEvent {
  return event.type.startsWith("scenario-");
}

function isAuditEvent(
  event: LearningLessonRecordedEvent,
): event is LearningAuditRecordedEvent {
  return event.type.startsWith("audit-");
}

function isBoxModelEvent(
  event: LearningLessonRecordedEvent,
): event is BoxModelLessonRecordedEvent {
  return !isScenarioEvent(event) && !isAuditEvent(event);
}

function replayActiveLesson(
  events: readonly LearningLessonRecordedEvent[],
): LearningLessonState {
  const scenarioEvents = events.filter(isScenarioEvent);
  return scenarioEvents.length > 0
    ? replayScenarioLessonEvents(scenarioEvents)
    : replayBoxModelLessonEvents(events.filter(isBoxModelEvent));
}

export function useLearningProof({
  captureSnapshot,
  onNotice,
}: UseLearningProofOptions) {
  const [lessonState, setLessonState] = useState<BoxModelLessonState>(
    INITIAL_BOX_MODEL_LESSON,
  );
  const [scenarioLessonState, setScenarioLessonState] =
    useState<ScenarioLessonState>(INITIAL_SCENARIO_LESSON);
  const [allEvents, setAllEvents] = useState<
    readonly LearningLessonRecordedEvent[]
  >([]);
  const [syncStatus, setSyncStatus] =
    useState<LearningProofSyncStatus>("idle");
  const [sessionHistory, setSessionHistory] = useState<
    readonly LearningProofLocalSessionReference[]
  >([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [authoritativeSnapshot, setAuthoritativeSnapshot] =
    useState<LearningProofAuthoritativeSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const localStateRef = useRef<LearningProofLocalState | null>(null);
  const lessonStateRef = useRef<BoxModelLessonState>(INITIAL_BOX_MODEL_LESSON);
  const scenarioLessonStateRef = useRef<ScenarioLessonState>(
    INITIAL_SCENARIO_LESSON,
  );
  const captureSnapshotRef = useRef(captureSnapshot);
  const onNoticeRef = useRef(onNotice);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const lastNoticeRef = useRef<string | null>(null);
  const writerIdRef = useRef(crypto.randomUUID());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1_000);

  useEffect(() => {
    captureSnapshotRef.current = captureSnapshot;
  }, [captureSnapshot]);
  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  const notice = useCallback((message: string) => {
    if (lastNoticeRef.current === message) return;
    lastNoticeRef.current = message;
    onNoticeRef.current(message);
  }, []);

  const refreshSessionHistory = useCallback(() => {
    setSessionHistory(listLearningProofLocalSessions(window.localStorage));
  }, []);

  const applyLocalState = useCallback(
    (state: LearningProofLocalState, persist = true) => {
      localStateRef.current = state;
      setActiveSessionId(state.sessionId);
      const lesson = replayBoxModelLessonEvents(
        state.events.filter(isBoxModelEvent),
      );
      const scenarioLesson = replayScenarioLessonEvents(
        state.events.filter(isScenarioEvent),
      );
      lessonStateRef.current = lesson;
      scenarioLessonStateRef.current = scenarioLesson;
      setLessonState(lesson);
      setScenarioLessonState(scenarioLesson);
      setAllEvents(state.events);
      if (!persist) return;
      try {
        saveLearningProofLocalState(window.localStorage, state);
        refreshSessionHistory();
      } catch (error) {
        setSyncStatus("local");
        notice(
          error instanceof LearningProofLocalSaveError &&
            error.reason === "quota"
            ? "这台设备的保存空间已满；当前操作仍在页面中，请先导出学习记录。"
            : error instanceof LearningProofLocalSaveError &&
                error.reason === "conflict"
              ? "另一个标签页刚保存了更新；当前标签不会覆盖它，请先刷新合并记录。"
            : "当前学习记录无法写入设备存储，请先导出后再刷新页面。",
        );
      }
    },
    [notice, refreshSessionHistory],
  );

  const recoverFromServer = useCallback(
    async (
      sessionId: string,
      local: LearningProofLocalState | null,
    ): Promise<LearningProofLocalState> => {
      const replay = learningReplayBundleSchema.parse(
        await responseJson(
          await fetch(`/api/learning/sessions/${sessionId}`, {
            cache: "no-store",
          }),
        ),
      );
      const merged = claimLearningProofLocalState(
        mergeLearningProofReplay(local, replay),
        writerIdRef.current,
      );
      setAuthoritativeSnapshot(
        replay.latestSnapshot
          ? {
              throughSequence: replay.latestSnapshot.throughSequence,
              lessonState: replay.latestSnapshot.lessonState,
            }
          : null,
      );
      applyLocalState(merged);
      return merged;
    },
    [applyLocalState],
  );

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryDelayRef.current = 1_000;
  }, []);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, 30_000);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void flushRef.current();
    }, delay);
  }, []);

  useEffect(() => clearRetry, [clearRetry]);

  const flushNow = useCallback(async () => {
    const initial = localStateRef.current;
    if (!initial) return;
    setSyncStatus("syncing");
    try {
      await responseJson(
        await fetch("/api/learning/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: proofSchemaVersion(initial),
            sessionId: initial.sessionId,
            canvasId: initial.canvasId,
            lessonKind: initial.lessonKind,
            startedAt: initial.startedAt,
          }),
        }),
      );

      while (true) {
        const current = localStateRef.current;
        if (!current || current.sessionId !== initial.sessionId) return;
        const pending = pendingLearningProofEvents(current).slice(0, 64);
        if (pending.length === 0) break;
        const response = appendLearningEventsResponseSchema.parse(
          await responseJson(
            await fetch(
              `/api/learning/sessions/${current.sessionId}/events`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  schemaVersion: proofSchemaVersion(current),
                  expectedSequence: current.acknowledgedSequence,
                  events: pending,
                }),
              },
            ),
          ),
        );
        if (
          response.acknowledgedSequence <= current.acknowledgedSequence ||
          response.acknowledgedSequence >
            current.acknowledgedSequence + pending.length
        ) {
          throw new LearningProofLocalSaveError("invalid");
        }
        const latest = localStateRef.current;
        if (!latest || latest.sessionId !== current.sessionId) return;
        applyLocalState(
          acknowledgeLearningProofLocalEvents(
            latest,
            response.acknowledgedSequence,
          ),
        );
      }

      const current = localStateRef.current;
      if (
        current &&
        current.acknowledgedSequence > current.snapshotThroughSequence
      ) {
        const snapshot = captureSnapshotRef.current();
        if (!snapshot) {
          setSyncStatus("local");
          scheduleRetry();
          return;
        }
        const throughSequence = current.acknowledgedSequence;
        const saved = learningSessionSnapshotSchema.parse(
          await responseJson(
            await fetch(
              `/api/learning/sessions/${current.sessionId}/snapshot`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  schemaVersion: proofSchemaVersion(current),
                  throughSequence,
                  ...snapshot,
                  lessonState: replayActiveLesson(current.events),
                }),
              },
            ),
          ),
        );
        if (saved.throughSequence !== throughSequence) {
          throw new LearningProofLocalSaveError("invalid");
        }
        setAuthoritativeSnapshot({
          throughSequence: saved.throughSequence,
          lessonState: saved.lessonState,
        });
        const latest = localStateRef.current;
        if (latest && latest.sessionId === current.sessionId) {
          applyLocalState(
            acknowledgeLearningProofLocalSnapshot(
              latest,
              saved.throughSequence,
            ),
          );
        }
      }
      const final = localStateRef.current;
      if (
        !final ||
        pendingLearningProofEvents(final).length > 0 ||
        final.snapshotThroughSequence < final.acknowledgedSequence
      ) {
        setSyncStatus("local");
        scheduleRetry();
        return;
      }
      clearRetry();
      setSyncStatus("synced");
      lastNoticeRef.current = null;
    } catch (error) {
      if (error instanceof LearningProofHttpError && error.status === 409) {
        try {
          const current = localStateRef.current;
          if (current) {
            const merged = await recoverFromServer(current.sessionId, current);
            setSyncStatus("local");
            if (
              pendingLearningProofEvents(merged).length > 0 ||
              merged.snapshotThroughSequence < merged.acknowledgedSequence
            ) {
              queueMicrotask(() => flushRef.current());
            }
            return;
          }
        } catch {
          // Fall through to the device-local recovery message.
        }
      }
      setSyncStatus("local");
      notice("在线学习记录暂时未连接；这节课仍保存在这台设备。");
      scheduleRetry();
    }
  }, [
    applyLocalState,
    clearRetry,
    notice,
    recoverFromServer,
    scheduleRetry,
  ]);

  useEffect(() => {
    flushRef.current = flushNow;
  }, [flushNow]);

  const scheduleSync = useCallback(() => {
    clearRetry();
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(() => flushRef.current());
  }, [clearRetry]);

  useEffect(() => {
    let cancelled = false;
    const restored = restoreLearningProofLocalState(window.localStorage);
    const restoredState = restored.state
      ? claimLearningProofLocalState(restored.state, writerIdRef.current)
      : null;

    const finish = async () => {
      try {
        if (restored.pointer) {
          const merged = await recoverFromServer(
            restored.pointer.sessionId,
            restoredState,
          );
          if (cancelled) return;
          setSyncStatus("synced");
          if (
            pendingLearningProofEvents(merged).length > 0 ||
            merged.snapshotThroughSequence < merged.acknowledgedSequence
          ) {
            scheduleSync();
          }
        } else if (restoredState) {
          scheduleSync();
        }
      } catch {
        if (cancelled) return;
        if (restoredState) {
          setSyncStatus("local");
          scheduleSync();
        } else if (restored.status === "corrupted") {
          setSyncStatus("corrupted");
          notice("设备上的学习记录受损，在线副本也暂时无法恢复；请开始一节新课。");
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    queueMicrotask(() => {
      if (cancelled) return;
      refreshSessionHistory();
      if (restoredState) {
        applyLocalState(restoredState, restored.status === "migrated");
        setSyncStatus(restored.status === "migrated" ? "local" : "recovering");
      } else if (restored.status === "corrupted") {
        setSyncStatus("recovering");
      }
      if (!restored.pointer && !restored.state) setReady(true);
      else void finish();
    });
    return () => {
      cancelled = true;
    };
  }, [
    applyLocalState,
    notice,
    recoverFromServer,
    refreshSessionHistory,
    scheduleSync,
  ]);

  const recordEvent = useCallback(
    (event: LearningLessonRecordedEvent): LearningLessonState => {
      const current = localStateRef.current;
      if (!current || current.sessionId !== event.sessionId) {
        return current?.lessonKind === "box-model-v1"
          ? lessonStateRef.current
          : scenarioLessonStateRef.current;
      }
      const next = appendLearningProofLocalEvent(current, event, event.at);
      applyLocalState(next);
      setSyncStatus("local");
      queueMicrotask(scheduleSync);
      return replayActiveLesson(next.events);
    },
    [applyLocalState, scheduleSync],
  );

  const start = useCallback(
    (
      blockId: string,
      personalizedOrigin?: PersonalizedLessonOrigin,
      at = new Date().toISOString(),
    ) => {
      const sessionId = crypto.randomUUID();
      const canvasId = crypto.randomUUID();
      setAuthoritativeSnapshot(null);
      const event: BoxModelLessonRecordedEvent = {
        ...boxModelEventMetadata(sessionId, "system", at),
        type: "start",
        blockId,
        ...(personalizedOrigin ? { personalizedOrigin } : {}),
      };
      const initial = appendLearningProofLocalEvent(
        createLearningProofLocalState(
          sessionId,
          canvasId,
          at,
          "box-model-v1",
          writerIdRef.current,
        ),
        event,
        at,
      );
      applyLocalState(initial);
      setSyncStatus("local");
      queueMicrotask(scheduleSync);
      return lessonStateRef.current;
    },
    [applyLocalState, scheduleSync],
  );

  const predict = useCallback(
    (answer: BoxModelPrediction, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (!current || lessonStateRef.current.phase !== "predict") {
        return lessonStateRef.current;
      }
      recordEvent({
        ...boxModelEventMetadata(current.sessionId, "user", at),
        type: "predict",
        answer,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const experimentSaved = useCallback(
    (
      blockId: string,
      revisionId: string,
      property: string,
      value: string,
      at = new Date().toISOString(),
      context?: {
        readonly target?: string;
        readonly beforeValue?: string | null;
      },
    ) => {
      const current = localStateRef.current;
      const lesson = lessonStateRef.current;
      if (
        !current ||
        lesson.phase !== "observe" ||
        lesson.lessonBlockId !== blockId ||
        property !== "padding"
      ) {
        return lesson;
      }
      recordEvent({
        ...boxModelEventMetadata(current.sessionId, "user", at),
        type: "experiment-saved",
        blockId,
        revisionId,
        property,
        value,
        ...(context?.target ? { target: context.target } : {}),
        ...(context && "beforeValue" in context
          ? { beforeValue: context.beforeValue ?? null }
          : {}),
        transient: false,
        saved: true,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const explain = useCallback(
    (answer: BoxModelExplanation, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (!current || lessonStateRef.current.phase !== "explain") {
        return lessonStateRef.current;
      }
      recordEvent({
        ...boxModelEventMetadata(current.sessionId, "user", at),
        type: "explain",
        answer,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const support = useCallback(
    (
      action: LearningSupportAction,
      hintLevel: 1 | 2 | 3 | null = null,
      at = new Date().toISOString(),
    ) => {
      const current = localStateRef.current;
      const lesson = lessonStateRef.current;
      if (
        !current ||
        lesson.phase === "idle" ||
        lesson.phase === "complete"
      ) {
        return lesson;
      }
      recordEvent({
        ...boxModelEventMetadata(
          current.sessionId,
          action === "timeout" ? "system" : "user",
          at,
        ),
        type: "support",
        phase: lesson.phase,
        action,
        hintLevel,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const attachTransfer = useCallback(
    (blockId: string, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (!current || lessonStateRef.current.phase !== "transfer") {
        return lessonStateRef.current;
      }
      recordEvent({
        ...boxModelEventMetadata(current.sessionId, "system", at),
        type: "attach-transfer",
        blockId,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const submitTransfer = useCallback(
    (code: string, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (!current || lessonStateRef.current.phase !== "transfer") {
        return lessonStateRef.current;
      }
      recordEvent({
        ...boxModelEventMetadata(current.sessionId, "user", at),
        type: "transfer-submit",
        code,
      });
      return lessonStateRef.current;
    },
    [recordEvent],
  );

  const startScenario = useCallback(
    (
      lessonKind: ScenarioLessonKind,
      blocks: readonly ScenarioLessonBlock[],
      personalizedOrigin?: PersonalizedLessonOrigin,
      at = new Date().toISOString(),
    ) => {
      const sessionId = crypto.randomUUID();
      const canvasId = crypto.randomUUID();
      setAuthoritativeSnapshot(null);
      const event: ScenarioLessonRecordedEvent = {
        ...scenarioEventMetadata(sessionId, "system", at),
        type: "scenario-start",
        lessonKind,
        blocks: [...blocks],
        ...(personalizedOrigin ? { personalizedOrigin } : {}),
      };
      const initial = appendLearningProofLocalEvent(
        createLearningProofLocalState(
          sessionId,
          canvasId,
          at,
          lessonKind,
          writerIdRef.current,
        ),
        event,
        at,
      );
      applyLocalState(initial);
      setSyncStatus("local");
      queueMicrotask(scheduleSync);
      return scenarioLessonStateRef.current;
    },
    [applyLocalState, scheduleSync],
  );

  const predictScenario = useCallback(
    (answer: ScenarioPrediction, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        scenarioLessonStateRef.current.phase !== "predict"
      ) {
        return scenarioLessonStateRef.current;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          "user",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-predict",
        answer,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const scenarioExperimentSaved = useCallback(
    (
      blockId: string,
      revisionId: string,
      property: string,
      value: string,
      at = new Date().toISOString(),
      context?: {
        readonly target?: string;
        readonly beforeValue?: string | null;
      },
    ) => {
      const current = localStateRef.current;
      const scenario = scenarioLessonStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        scenario.phase !== "observe" ||
        !scenario.blocks.some((block) => block.blockId === blockId)
      ) {
        return scenario;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          "user",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-experiment-saved",
        blockId,
        revisionId,
        property,
        value,
        ...(context?.target ? { target: context.target } : {}),
        ...(context && "beforeValue" in context
          ? { beforeValue: context.beforeValue ?? null }
          : {}),
        transient: false,
        saved: true,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const explainScenario = useCallback(
    (answer: ScenarioExplanation, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        scenarioLessonStateRef.current.phase !== "explain"
      ) {
        return scenarioLessonStateRef.current;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          "user",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-explain",
        answer,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const supportScenario = useCallback(
    (
      action: LearningSupportAction,
      hintLevel: 1 | 2 | 3 | null = null,
      at = new Date().toISOString(),
    ) => {
      const current = localStateRef.current;
      const lesson = scenarioLessonStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        lesson.phase === "idle" ||
        lesson.phase === "complete"
      ) {
        return lesson;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          action === "timeout" ? "system" : "user",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-support",
        phase: lesson.phase,
        action,
        hintLevel,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const attachScenarioTransfer = useCallback(
    (blockId: string, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        scenarioLessonStateRef.current.phase !== "transfer"
      ) {
        return scenarioLessonStateRef.current;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          "system",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-attach-transfer",
        blockId,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const submitScenarioTransfer = useCallback(
    (code: string, at = new Date().toISOString()) => {
      const current = localStateRef.current;
      if (
        !current ||
        current.lessonKind === "box-model-v1" ||
        scenarioLessonStateRef.current.phase !== "transfer"
      ) {
        return scenarioLessonStateRef.current;
      }
      recordEvent({
        ...scenarioEventMetadata(
          current.sessionId,
          "user",
          at,
          proofSchemaVersion(current),
        ),
        type: "scenario-transfer-submit",
        code,
      });
      return scenarioLessonStateRef.current;
    },
    [recordEvent],
  );

  const recordAuditEvent = useCallback(
    (input: LearningAuditEventInput, expectedSessionId?: string): boolean => {
      const current = localStateRef.current;
      if (
        !current ||
        (expectedSessionId !== undefined && current.sessionId !== expectedSessionId)
      ) {
        return false;
      }
      const activeState =
        current.lessonKind === "box-model-v1"
          ? lessonStateRef.current
          : scenarioLessonStateRef.current;
      if (activeState.phase === "idle" || activeState.phase === "complete") {
        return false;
      }
      const event = learningAuditRecordedEventSchema.parse({
        ...input,
        eventVersion: proofSchemaVersion(current),
        eventId: crypto.randomUUID(),
        sessionId: current.sessionId,
      });
      recordEvent(event);
      return true;
    },
    [recordEvent],
  );

  const openLocalSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (sessionId === localStateRef.current?.sessionId) return true;
      clearRetry();
      let stored: LearningProofLocalState | null;
      try {
        stored = activateLearningProofLocalSession(
          window.localStorage,
          sessionId,
        );
      } catch {
        notice("这份设备记录暂时无法打开；其他学习记录没有被改动。");
        return false;
      }
      if (!stored) {
        notice("这份设备记录不完整，无法安全打开；可以继续使用其他记录。");
        refreshSessionHistory();
        return false;
      }
      const claimed = claimLearningProofLocalState(
        stored,
        writerIdRef.current,
      );
      setAuthoritativeSnapshot(null);
      applyLocalState(claimed, false);
      refreshSessionHistory();
      setSyncStatus("recovering");
      try {
        const merged = await recoverFromServer(sessionId, claimed);
        setSyncStatus("synced");
        if (
          pendingLearningProofEvents(merged).length > 0 ||
          merged.snapshotThroughSequence < merged.acknowledgedSequence
        ) {
          scheduleSync();
        }
      } catch {
        setSyncStatus("local");
        notice("已打开这台设备上的记录；在线副本恢复后会继续同步。");
        scheduleSync();
      }
      return true;
    },
    [
      applyLocalState,
      clearRetry,
      notice,
      recoverFromServer,
      refreshSessionHistory,
      scheduleSync,
    ],
  );

  const downloadLocal = useCallback(() => {
    const current = localStateRef.current;
    if (!current) return;
    const payload = JSON.stringify(
      {
        schemaVersion: proofSchemaVersion(current),
        exportedAt: new Date().toISOString(),
        sessionId: current.sessionId,
        lessonKind: current.lessonKind,
        acknowledgedSequence: current.acknowledgedSequence,
        snapshotThroughSequence: current.snapshotThroughSequence,
        events: current.events,
        lessonState: replayActiveLesson(current.events),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `learning-proof-${current.sessionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const deleteLocalSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (localStateRef.current?.sessionId === sessionId) {
        notice("正在查看的记录不能直接删除；请先打开另一节课。");
        return false;
      }
      try {
        const response = await fetch(`/api/learning/sessions/${sessionId}`, {
          method: "DELETE",
        });
        await responseJson(response);
        removeLearningProofLocalSession(window.localStorage, sessionId);
        refreshSessionHistory();
        notice("这份学习记录已从当前设备和在线副本中删除。");
        return true;
      } catch {
        notice("这份记录暂时没有删除；设备和在线副本都保持原样。");
        return false;
      }
    },
    [notice, refreshSessionHistory],
  );

  const boxEvents = useMemo(
    () => allEvents.filter(isBoxModelEvent),
    [allEvents],
  );
  const scenarioEvents = useMemo(
    () => allEvents.filter(isScenarioEvent),
    [allEvents],
  );
  const auditEvents = useMemo(
    () => allEvents.filter(isAuditEvent),
    [allEvents],
  );

  return {
    lessonState,
    lessonStateRef,
    events: boxEvents,
    scenarioLessonState,
    scenarioLessonStateRef,
    scenarioEvents,
    timelineEvents: allEvents,
    auditEvents,
    syncStatus,
    sessionHistory,
    activeSessionId,
    authoritativeSnapshot,
    ready,
    start,
    predict,
    experimentSaved,
    explain,
    support,
    attachTransfer,
    submitTransfer,
    startScenario,
    predictScenario,
    scenarioExperimentSaved,
    explainScenario,
    supportScenario,
    attachScenarioTransfer,
    submitScenarioTransfer,
    recordAuditEvent,
    retrySync: scheduleSync,
    openLocalSession,
    deleteLocalSession,
    downloadLocal,
  } as const;
}
