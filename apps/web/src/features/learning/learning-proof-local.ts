import {
  learningLessonKindSchema,
  learningLessonRecordedEventSchema,
  type LearningLessonKind,
  type LearningLessonRecordedEvent,
  type LearningReplayBundle,
} from "@ai-tutor/contracts";
import { z } from "zod";

// Read-only compatibility keys for records created before the per-session v2 store.
export const LEARNING_PROOF_LOCAL_KEY = "ai-tutor-p7-learning-proof-v1";
export const LEARNING_PROOF_POINTER_KEY =
  "ai-tutor-p7-learning-proof-pointer-v1";
export const LEARNING_PROOF_INDEX_KEY = "ai-tutor-learning-proof-index-v2";
const LEARNING_PROOF_SESSION_PREFIX = "ai-tutor-learning-proof-session-v2:";
const MAX_LOCAL_EVENTS = 1_000;
const MAX_LOCAL_BYTES = 5 * 1_024 * 1_024;
const MAX_LOCAL_SESSIONS = 100;

export function learningProofSessionStorageKey(sessionId: string): string {
  return `${LEARNING_PROOF_SESSION_PREFIX}${sessionId}`;
}

export interface LearningProofLocalState {
  readonly version: 2;
  readonly lessonKind: LearningLessonKind;
  readonly sessionId: string;
  readonly canvasId: string;
  readonly startedAt: string;
  readonly acknowledgedSequence: number;
  readonly snapshotThroughSequence: number;
  readonly events: readonly LearningLessonRecordedEvent[];
  readonly writerId: string;
  readonly storageRevision: number;
  readonly savedAt: string;
}

export interface LearningProofLocalSessionReference {
  readonly sessionId: string;
  readonly canvasId: string;
  readonly lessonKind: LearningLessonKind;
  readonly startedAt: string;
  readonly savedAt: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function eventMatchesLesson(
  lessonKind: LearningLessonKind,
  event: LearningLessonRecordedEvent,
): boolean {
  if (event.type.startsWith("audit-")) return true;
  const scenario = event.type.startsWith("scenario-");
  if (lessonKind === "box-model-v1") return !scenario;
  if (!scenario) return false;
  return event.type !== "scenario-start" || event.lessonKind === lessonKind;
}

const localStateSchema = z
  .object({
    version: z.literal(2),
    lessonKind: learningLessonKindSchema,
    sessionId: z.string().uuid(),
    canvasId: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    acknowledgedSequence: z.number().int().nonnegative(),
    snapshotThroughSequence: z.number().int().nonnegative(),
    events: z.array(learningLessonRecordedEventSchema).max(MAX_LOCAL_EVENTS),
    writerId: z.string().trim().min(1).max(200),
    storageRevision: z.number().int().nonnegative(),
    savedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (value.acknowledgedSequence > value.events.length) {
      context.addIssue({
        code: "custom",
        message: "Acknowledged sequence is outside the local event stream.",
        path: ["acknowledgedSequence"],
      });
    }
    if (value.snapshotThroughSequence > value.acknowledgedSequence) {
      context.addIssue({
        code: "custom",
        message: "Snapshot sequence cannot exceed acknowledged events.",
        path: ["snapshotThroughSequence"],
      });
    }
    if (
      value.events.some(
        (event) =>
          event.sessionId !== value.sessionId ||
          !eventMatchesLesson(value.lessonKind, event),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Local events must belong to the saved session and lesson.",
        path: ["events"],
      });
    }
  });

const localEnvelopeSchema = z.object({
  version: z.literal(2),
  checksum: z.string().regex(/^[0-9a-f]{8}$/),
  payload: localStateSchema,
});

const sessionReferenceSchema = z.object({
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid(),
  lessonKind: learningLessonKindSchema,
  startedAt: z.string().datetime({ offset: true }),
  savedAt: z.string().datetime({ offset: true }),
});

const localIndexSchema = z
  .object({
    version: z.literal(2),
    activeSessionId: z.string().uuid(),
    sessions: z.array(sessionReferenceSchema).max(MAX_LOCAL_SESSIONS),
  })
  .superRefine((value, context) => {
    const ids = value.sessions.map((session) => session.sessionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Local learning session index contains duplicate ids.",
        path: ["sessions"],
      });
    }
    if (!ids.includes(value.activeSessionId)) {
      context.addIssue({
        code: "custom",
        message: "Active learning session is missing from the index.",
        path: ["activeSessionId"],
      });
    }
  });

const legacyV1StateSchema = z
  .object({
    version: z.literal(1),
    lessonKind: learningLessonKindSchema.optional(),
    sessionId: z.string().uuid(),
    canvasId: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    acknowledgedSequence: z.number().int().nonnegative(),
    events: z.array(learningLessonRecordedEventSchema).max(MAX_LOCAL_EVENTS),
    savedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (value.acknowledgedSequence > value.events.length) {
      context.addIssue({
        code: "custom",
        message: "Legacy acknowledgement is outside the event stream.",
        path: ["acknowledgedSequence"],
      });
    }
  });

const legacyV1EnvelopeSchema = z.object({
  version: z.literal(1),
  checksum: z.string().regex(/^[0-9a-f]{8}$/),
  payload: legacyV1StateSchema,
});

const legacyPointerSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid(),
});

const legacyV0StateSchema = z.object({
  version: z.literal(0),
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid().optional(),
  startedAt: z.string().datetime({ offset: true }),
  acknowledgedSequence: z.number().int().nonnegative().default(0),
  events: z.array(learningLessonRecordedEventSchema).max(MAX_LOCAL_EVENTS),
});

function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function decodeV2Envelope(raw: string): LearningProofLocalState | null {
  try {
    const envelope = localEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!envelope.success) return null;
    const payloadJson = JSON.stringify(envelope.data.payload);
    return checksum(payloadJson) === envelope.data.checksum
      ? envelope.data.payload
      : null;
  } catch {
    return null;
  }
}

function legacyPointer(storage: StorageLike) {
  try {
    const raw = storage.getItem(LEARNING_PROOF_POINTER_KEY);
    if (!raw) return null;
    const parsed = legacyPointerSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { sessionId: parsed.data.sessionId, canvasId: parsed.data.canvasId }
      : null;
  } catch {
    return null;
  }
}

function migrateLegacyState(
  value: unknown,
  now: string,
): LearningProofLocalState | null {
  const rawV1 = legacyV1StateSchema.safeParse(value);
  if (rawV1.success) {
    return {
      version: 2,
      lessonKind: rawV1.data.lessonKind ?? "box-model-v1",
      sessionId: rawV1.data.sessionId,
      canvasId: rawV1.data.canvasId,
      startedAt: rawV1.data.startedAt,
      acknowledgedSequence: rawV1.data.acknowledgedSequence,
      snapshotThroughSequence: 0,
      events: rawV1.data.events,
      writerId: "legacy-migration",
      storageRevision: 0,
      savedAt: now,
    };
  }
  const rawV0 = legacyV0StateSchema.safeParse(value);
  if (!rawV0.success) return null;
  return {
    version: 2,
    lessonKind: "box-model-v1",
    sessionId: rawV0.data.sessionId,
    canvasId: rawV0.data.canvasId ?? rawV0.data.sessionId,
    startedAt: rawV0.data.startedAt,
    acknowledgedSequence: rawV0.data.acknowledgedSequence,
    snapshotThroughSequence: 0,
    events: rawV0.data.events,
    writerId: "legacy-migration",
    storageRevision: 0,
    savedAt: now,
  };
}

function restoreLegacy(
  storage: StorageLike,
  now: string,
): LearningProofRestoreResult {
  const pointer = legacyPointer(storage);
  const raw = storage.getItem(LEARNING_PROOF_LOCAL_KEY);
  if (!raw) {
    return pointer
      ? { status: "corrupted", state: null, pointer }
      : { status: "empty", state: null, pointer: null };
  }
  try {
    const unknownValue = JSON.parse(raw) as unknown;
    const envelope = legacyV1EnvelopeSchema.safeParse(unknownValue);
    if (envelope.success) {
      const payloadJson = JSON.stringify(envelope.data.payload);
      if (checksum(payloadJson) !== envelope.data.checksum) {
        return { status: "corrupted", state: null, pointer };
      }
      const state = migrateLegacyState(envelope.data.payload, now);
      return state
        ? {
            status: "migrated",
            state,
            pointer: { sessionId: state.sessionId, canvasId: state.canvasId },
          }
        : { status: "corrupted", state: null, pointer };
    }
    const migrated = migrateLegacyState(unknownValue, now);
    return migrated
      ? {
          status: "migrated",
          state: migrated,
          pointer: {
            sessionId: migrated.sessionId,
            canvasId: migrated.canvasId,
          },
        }
      : { status: "corrupted", state: null, pointer };
  } catch {
    return { status: "corrupted", state: null, pointer };
  }
}

export type LearningProofRestoreResult =
  | { readonly status: "empty"; readonly state: null; readonly pointer: null }
  | {
      readonly status: "ok" | "migrated";
      readonly state: LearningProofLocalState;
      readonly pointer: { readonly sessionId: string; readonly canvasId: string };
    }
  | {
      readonly status: "corrupted";
      readonly state: null;
      readonly pointer: {
        readonly sessionId: string;
        readonly canvasId: string;
      } | null;
    };

export function restoreLearningProofLocalState(
  storage: StorageLike,
  now = new Date().toISOString(),
): LearningProofRestoreResult {
  const indexRaw = storage.getItem(LEARNING_PROOF_INDEX_KEY);
  if (indexRaw) {
    try {
      const index = localIndexSchema.safeParse(JSON.parse(indexRaw));
      if (!index.success) {
        return { status: "corrupted", state: null, pointer: null };
      }
      const reference = index.data.sessions.find(
        (session) => session.sessionId === index.data.activeSessionId,
      )!;
      const stateRaw = storage.getItem(
        learningProofSessionStorageKey(reference.sessionId),
      );
      const state = stateRaw ? decodeV2Envelope(stateRaw) : null;
      if (!state || state.canvasId !== reference.canvasId) {
        return {
          status: "corrupted",
          state: null,
          pointer: {
            sessionId: reference.sessionId,
            canvasId: reference.canvasId,
          },
        };
      }
      return {
        status: "ok",
        state,
        pointer: { sessionId: state.sessionId, canvasId: state.canvasId },
      };
    } catch {
      return { status: "corrupted", state: null, pointer: null };
    }
  }
  return restoreLegacy(storage, now);
}

export function listLearningProofLocalSessions(
  storage: StorageLike,
): readonly LearningProofLocalSessionReference[] {
  try {
    const raw = storage.getItem(LEARNING_PROOF_INDEX_KEY);
    if (!raw) return [];
    const parsed = localIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sessions : [];
  } catch {
    return [];
  }
}

export class LearningProofLocalSaveError extends Error {
  constructor(readonly reason: "quota" | "invalid" | "conflict") {
    super(
      reason === "quota"
        ? "The local learning record is too large or storage is full."
        : reason === "conflict"
          ? "Another browser tab saved a newer learning record."
          : "The local learning record is invalid.",
    );
    this.name = "LearningProofLocalSaveError";
  }
}

export function activateLearningProofLocalSession(
  storage: StorageLike,
  sessionId: string,
): LearningProofLocalState | null {
  try {
    const indexRaw = storage.getItem(LEARNING_PROOF_INDEX_KEY);
    if (!indexRaw) return null;
    const parsedIndex = localIndexSchema.safeParse(JSON.parse(indexRaw));
    if (!parsedIndex.success) return null;
    const reference = parsedIndex.data.sessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (!reference) return null;
    const stateRaw = storage.getItem(learningProofSessionStorageKey(sessionId));
    const state = stateRaw ? decodeV2Envelope(stateRaw) : null;
    if (
      !state ||
      state.canvasId !== reference.canvasId ||
      state.lessonKind !== reference.lessonKind
    ) {
      return null;
    }
    storage.setItem(
      LEARNING_PROOF_INDEX_KEY,
      JSON.stringify({ ...parsedIndex.data, activeSessionId: sessionId }),
    );
    return state;
  } catch {
    throw new LearningProofLocalSaveError("quota");
  }
}

export function saveLearningProofLocalState(
  storage: StorageLike,
  state: LearningProofLocalState,
): void {
  const parsed = localStateSchema.safeParse(state);
  if (!parsed.success) throw new LearningProofLocalSaveError("invalid");
  const payloadJson = JSON.stringify(parsed.data);
  const envelope = JSON.stringify({
    version: 2,
    checksum: checksum(payloadJson),
    payload: parsed.data,
  });
  if (envelope.length > MAX_LOCAL_BYTES) {
    throw new LearningProofLocalSaveError("quota");
  }

  const sessionKey = learningProofSessionStorageKey(state.sessionId);
  const existingRaw = storage.getItem(sessionKey);
  if (existingRaw) {
    const existing = decodeV2Envelope(existingRaw);
    if (!existing) throw new LearningProofLocalSaveError("invalid");
    if (existing.storageRevision === state.storageRevision) {
      if (canonicalJson(existing) === canonicalJson(parsed.data)) return;
      throw new LearningProofLocalSaveError("conflict");
    }
    if (existing.storageRevision !== state.storageRevision - 1) {
      throw new LearningProofLocalSaveError("conflict");
    }
  } else if (state.storageRevision > 1) {
    throw new LearningProofLocalSaveError("conflict");
  }

  let currentIndex: z.infer<typeof localIndexSchema> | null = null;
  const indexRaw = storage.getItem(LEARNING_PROOF_INDEX_KEY);
  if (indexRaw) {
    const parsedIndex = localIndexSchema.safeParse(JSON.parse(indexRaw));
    if (!parsedIndex.success) throw new LearningProofLocalSaveError("invalid");
    currentIndex = parsedIndex.data;
  }
  const reference: LearningProofLocalSessionReference = {
    sessionId: state.sessionId,
    canvasId: state.canvasId,
    lessonKind: state.lessonKind,
    startedAt: state.startedAt,
    savedAt: state.savedAt,
  };
  const sessions = [
    ...(currentIndex?.sessions.filter(
      (session) => session.sessionId !== state.sessionId,
    ) ?? []),
    reference,
  ].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  if (sessions.length > MAX_LOCAL_SESSIONS) {
    throw new LearningProofLocalSaveError("quota");
  }

  try {
    // Commit the session envelope first. A pointer/index can never reference a
    // session payload that was not durably written.
    storage.setItem(sessionKey, envelope);
    storage.setItem(
      LEARNING_PROOF_INDEX_KEY,
      JSON.stringify({
        version: 2,
        activeSessionId: state.sessionId,
        sessions,
      }),
    );
  } catch {
    throw new LearningProofLocalSaveError("quota");
  }
}

export function clearLearningProofLocalState(storage: StorageLike): void {
  for (const session of listLearningProofLocalSessions(storage)) {
    storage.removeItem(learningProofSessionStorageKey(session.sessionId));
  }
  storage.removeItem(LEARNING_PROOF_INDEX_KEY);
  storage.removeItem(LEARNING_PROOF_LOCAL_KEY);
  storage.removeItem(LEARNING_PROOF_POINTER_KEY);
}

export function removeLearningProofLocalSession(
  storage: StorageLike,
  sessionId: string,
): boolean {
  try {
    const raw = storage.getItem(LEARNING_PROOF_INDEX_KEY);
    if (!raw) return false;
    const parsed = localIndexSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new LearningProofLocalSaveError("invalid");
    const sessions = parsed.data.sessions.filter(
      (session) => session.sessionId !== sessionId,
    );
    if (sessions.length === parsed.data.sessions.length) return false;
    storage.removeItem(learningProofSessionStorageKey(sessionId));
    if (sessions.length === 0) {
      storage.removeItem(LEARNING_PROOF_INDEX_KEY);
    } else {
      storage.setItem(
        LEARNING_PROOF_INDEX_KEY,
        JSON.stringify({
          ...parsed.data,
          activeSessionId:
            parsed.data.activeSessionId === sessionId
              ? sessions.at(-1)?.sessionId ?? null
              : parsed.data.activeSessionId,
          sessions,
        }),
      );
    }
    return true;
  } catch (error) {
    if (error instanceof LearningProofLocalSaveError) throw error;
    throw new LearningProofLocalSaveError("quota");
  }
}

export function createLearningProofLocalState(
  sessionId: string,
  canvasId: string,
  startedAt: string,
  lessonKind: LearningLessonKind = "box-model-v1",
  writerId = "single-writer",
): LearningProofLocalState {
  return {
    version: 2,
    lessonKind,
    sessionId,
    canvasId,
    startedAt,
    acknowledgedSequence: 0,
    snapshotThroughSequence: 0,
    events: [],
    writerId,
    storageRevision: 0,
    savedAt: startedAt,
  };
}

export function claimLearningProofLocalState(
  state: LearningProofLocalState,
  writerId: string,
): LearningProofLocalState {
  return { ...state, writerId };
}

export function appendLearningProofLocalEvent(
  state: LearningProofLocalState,
  event: LearningLessonRecordedEvent,
  savedAt = new Date().toISOString(),
): LearningProofLocalState {
  if (
    event.sessionId !== state.sessionId ||
    !eventMatchesLesson(state.lessonKind, event)
  ) {
    throw new LearningProofLocalSaveError("invalid");
  }
  if (state.events.some((candidate) => candidate.eventId === event.eventId)) {
    return state;
  }
  if (state.events.length >= MAX_LOCAL_EVENTS) {
    throw new LearningProofLocalSaveError("quota");
  }
  return {
    ...state,
    events: [...state.events, event],
    storageRevision: state.storageRevision + 1,
    savedAt,
  };
}

export function acknowledgeLearningProofLocalEvents(
  state: LearningProofLocalState,
  throughSequence: number,
  savedAt = new Date().toISOString(),
): LearningProofLocalState {
  if (
    !Number.isInteger(throughSequence) ||
    throughSequence < state.acknowledgedSequence ||
    throughSequence > state.events.length
  ) {
    throw new LearningProofLocalSaveError("invalid");
  }
  if (throughSequence === state.acknowledgedSequence) return state;
  return {
    ...state,
    acknowledgedSequence: throughSequence,
    storageRevision: state.storageRevision + 1,
    savedAt,
  };
}

export function acknowledgeLearningProofLocalSnapshot(
  state: LearningProofLocalState,
  throughSequence: number,
  savedAt = new Date().toISOString(),
): LearningProofLocalState {
  if (
    !Number.isInteger(throughSequence) ||
    throughSequence < state.snapshotThroughSequence ||
    throughSequence > state.acknowledgedSequence
  ) {
    throw new LearningProofLocalSaveError("invalid");
  }
  if (throughSequence === state.snapshotThroughSequence) return state;
  return {
    ...state,
    snapshotThroughSequence: throughSequence,
    storageRevision: state.storageRevision + 1,
    savedAt,
  };
}

export function pendingLearningProofEvents(
  state: LearningProofLocalState,
): readonly LearningLessonRecordedEvent[] {
  return state.events.slice(state.acknowledgedSequence);
}

export function mergeLearningProofReplay(
  local: LearningProofLocalState | null,
  replay: LearningReplayBundle,
  savedAt = new Date().toISOString(),
): LearningProofLocalState {
  const authoritative = replay.events.map((record, index) => {
    if (record.sequence !== index + 1) {
      throw new LearningProofLocalSaveError("invalid");
    }
    return record.event;
  });
  const localEvents =
    local?.sessionId === replay.session.sessionId ? local.events : [];
  for (const event of authoritative) {
    const localMatch = localEvents.find(
      (candidate) => candidate.eventId === event.eventId,
    );
    if (localMatch && canonicalJson(localMatch) !== canonicalJson(event)) {
      throw new LearningProofLocalSaveError("invalid");
    }
  }
  const authoritativeIds = new Set(authoritative.map((event) => event.eventId));
  const pending = localEvents.filter(
    (event) => !authoritativeIds.has(event.eventId),
  );
  return {
    version: 2,
    lessonKind: replay.session.lessonKind,
    sessionId: replay.session.sessionId,
    canvasId: replay.session.canvasId,
    startedAt: replay.session.startedAt,
    acknowledgedSequence: authoritative.length,
    snapshotThroughSequence: replay.latestSnapshot?.throughSequence ?? 0,
    events: [...authoritative, ...pending],
    writerId: local?.writerId ?? "server-recovery",
    storageRevision: (local?.storageRevision ?? -1) + 1,
    savedAt,
  };
}
