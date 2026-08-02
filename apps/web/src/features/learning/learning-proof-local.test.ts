import { describe, expect, it } from "vitest";

import {
  LEARNING_PROOF_LOCAL_KEY,
  LEARNING_PROOF_INDEX_KEY,
  LEARNING_PROOF_POINTER_KEY,
  LearningProofLocalSaveError,
  acknowledgeLearningProofLocalEvents,
  acknowledgeLearningProofLocalSnapshot,
  activateLearningProofLocalSession,
  appendLearningProofLocalEvent,
  claimLearningProofLocalState,
  createLearningProofLocalState,
  learningProofSessionStorageKey,
  listLearningProofLocalSessions,
  mergeLearningProofReplay,
  pendingLearningProofEvents,
  removeLearningProofLocalSession,
  restoreLearningProofLocalState,
  saveLearningProofLocalState,
} from "./learning-proof-local";

const sessionId = "20000000-0000-4000-8000-000000000001";
const canvasId = "30000000-0000-4000-8000-000000000001";
const startedAt = "2026-08-02T00:00:00.000Z";
const startEvent = {
  eventVersion: 1 as const,
  eventId: "10000000-0000-4000-8000-000000000001",
  sessionId,
  at: startedAt,
  type: "start" as const,
  actorType: "system" as const,
  blockId: "lesson-1",
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("local learning proof recovery", () => {
  it("round-trips a checksummed outbox and tracks acknowledgements", () => {
    const storage = new MemoryStorage();
    const state = appendLearningProofLocalEvent(
      createLearningProofLocalState(sessionId, canvasId, startedAt),
      startEvent,
    );
    saveLearningProofLocalState(storage, state);
    const restored = restoreLearningProofLocalState(storage);
    expect(restored.status).toBe("ok");
    if (!restored.state) throw new Error("state was not restored");
    expect(pendingLearningProofEvents(restored.state)).toEqual([startEvent]);
    expect(
      pendingLearningProofEvents(
        acknowledgeLearningProofLocalEvents(restored.state, 1),
      ),
    ).toEqual([]);
    const snapshotted = acknowledgeLearningProofLocalSnapshot(
      acknowledgeLearningProofLocalEvents(restored.state, 1),
      1,
    );
    expect(snapshotted.snapshotThroughSequence).toBe(1);
  });

  it("keeps a separate pointer when the main record is corrupted", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEARNING_PROOF_POINTER_KEY,
      JSON.stringify({ version: 1, sessionId, canvasId }),
    );
    storage.setItem(LEARNING_PROOF_LOCAL_KEY, "{broken");
    expect(restoreLearningProofLocalState(storage)).toEqual({
      status: "corrupted",
      state: null,
      pointer: { sessionId, canvasId },
    });
  });

  it("migrates the pre-envelope version without losing pending events", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEARNING_PROOF_LOCAL_KEY,
      JSON.stringify({
        version: 0,
        sessionId,
        canvasId,
        startedAt,
        acknowledgedSequence: 0,
        events: [startEvent],
      }),
    );
    const restored = restoreLearningProofLocalState(
      storage,
      "2026-08-02T00:00:01.000Z",
    );
    expect(restored.status).toBe("migrated");
    expect(restored.state?.events).toEqual([startEvent]);
    expect(restored.state?.lessonKind).toBe("box-model-v1");
  });

  it("round-trips a scenario kind and its distinct event family", () => {
    const storage = new MemoryStorage();
    const scenarioSession = "20000000-0000-4000-8000-000000000002";
    const scenarioStart = {
      eventVersion: 1 as const,
      eventId: "10000000-0000-4000-8000-000000000010",
      sessionId: scenarioSession,
      at: startedAt,
      type: "scenario-start" as const,
      actorType: "system" as const,
      lessonKind: "flex-v1" as const,
      blocks: [
        { role: "source" as const, blockId: "normal" },
        { role: "experiment" as const, blockId: "flex" },
      ],
    };
    const state = appendLearningProofLocalEvent(
      createLearningProofLocalState(
        scenarioSession,
        canvasId,
        startedAt,
        "flex-v1",
      ),
      scenarioStart,
    );
    saveLearningProofLocalState(storage, state);
    const restored = restoreLearningProofLocalState(storage);
    expect(restored.state?.lessonKind).toBe("flex-v1");
    expect(restored.state?.events).toEqual([scenarioStart]);
  });

  it("merges authoritative events with unsent local events", () => {
    const pending = {
      ...startEvent,
      eventId: "10000000-0000-4000-8000-000000000002",
      type: "attach-transfer" as const,
      blockId: "transfer-1",
      at: "2026-08-02T00:00:01.000Z",
    };
    const local = appendLearningProofLocalEvent(
      appendLearningProofLocalEvent(
        createLearningProofLocalState(sessionId, canvasId, startedAt),
        startEvent,
      ),
      pending,
    );
    const merged = mergeLearningProofReplay(local, {
      schemaVersion: 1,
      session: {
        schemaVersion: 1,
        sessionId,
        canvasId,
        lessonKind: "box-model-v1",
        status: "active",
        latestSequence: 1,
        startedAt,
        endedAt: null,
      },
      events: [{ sequence: 1, event: startEvent }],
      latestSnapshot: null,
    });
    expect(merged.acknowledgedSequence).toBe(1);
    expect(pendingLearningProofEvents(merged)).toEqual([pending]);
  });

  it("reports storage quota failures without mutating the in-memory state", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    const state = createLearningProofLocalState(sessionId, canvasId, startedAt);
    expect(() => saveLearningProofLocalState(storage, state)).toThrow(
      LearningProofLocalSaveError,
    );
    expect(state.events).toEqual([]);
  });

  it("preserves each course in a separate envelope when a new course starts", () => {
    const storage = new MemoryStorage();
    const first = appendLearningProofLocalEvent(
      createLearningProofLocalState(sessionId, canvasId, startedAt),
      startEvent,
    );
    saveLearningProofLocalState(storage, first);

    const scenarioSession = "20000000-0000-4000-8000-000000000099";
    const scenarioCanvas = "30000000-0000-4000-8000-000000000099";
    const scenario = appendLearningProofLocalEvent(
      createLearningProofLocalState(
        scenarioSession,
        scenarioCanvas,
        startedAt,
        "flex-v1",
      ),
      {
        eventVersion: 1,
        eventId: "10000000-0000-4000-8000-000000000099",
        sessionId: scenarioSession,
        at: startedAt,
        type: "scenario-start",
        actorType: "system",
        lessonKind: "flex-v1",
        blocks: [
          { role: "source", blockId: "source" },
          { role: "experiment", blockId: "experiment" },
        ],
      },
    );
    saveLearningProofLocalState(storage, scenario);

    expect(storage.getItem(learningProofSessionStorageKey(sessionId))).not.toBeNull();
    expect(
      storage.getItem(learningProofSessionStorageKey(scenarioSession)),
    ).not.toBeNull();
    expect(listLearningProofLocalSessions(storage)).toHaveLength(2);
    expect(restoreLearningProofLocalState(storage).state?.sessionId).toBe(
      scenarioSession,
    );
  });

  it("removes exactly one historical envelope and repairs the active pointer", () => {
    const storage = new MemoryStorage();
    const first = appendLearningProofLocalEvent(
      createLearningProofLocalState(sessionId, canvasId, startedAt),
      startEvent,
    );
    saveLearningProofLocalState(storage, first);
    const secondSession = "20000000-0000-4000-8000-000000000099";
    saveLearningProofLocalState(
      storage,
      createLearningProofLocalState(
        secondSession,
        "30000000-0000-4000-8000-000000000099",
        "2026-08-02T00:01:00.000Z",
        "flex-v1",
      ),
    );
    expect(removeLearningProofLocalSession(storage, secondSession)).toBe(true);
    expect(storage.getItem(learningProofSessionStorageKey(secondSession))).toBeNull();
    expect(storage.getItem(learningProofSessionStorageKey(sessionId))).not.toBeNull();
    expect(listLearningProofLocalSessions(storage).map((item) => item.sessionId)).toEqual([sessionId]);
    expect(restoreLearningProofLocalState(storage).state?.sessionId).toBe(sessionId);
    expect(removeLearningProofLocalSession(storage, secondSession)).toBe(false);
  });

  it("reopens an indexed historical course without rewriting its envelope", () => {
    const storage = new MemoryStorage();
    const first = appendLearningProofLocalEvent(
      createLearningProofLocalState(
        startEvent.sessionId,
        "30000000-0000-4000-8000-000000000001",
        startEvent.at,
        "box-model-v1",
        "writer-a",
      ),
      startEvent,
      startEvent.at,
    );
    saveLearningProofLocalState(storage, first);
    const firstRaw = storage.getItem(
      learningProofSessionStorageKey(first.sessionId),
    );
    const secondStart = {
      eventVersion: 2 as const,
      eventId: "10000000-0000-4000-8000-000000000091",
      sessionId: "20000000-0000-4000-8000-000000000091",
      actorType: "system" as const,
      type: "scenario-start" as const,
      lessonKind: "flex-v1" as const,
      blocks: [
        { role: "source" as const, blockId: "source" },
        { role: "experiment" as const, blockId: "experiment" },
      ],
      at: "2026-08-02T06:00:00.000Z",
    };
    saveLearningProofLocalState(
      storage,
      appendLearningProofLocalEvent(
        createLearningProofLocalState(
          secondStart.sessionId,
          "30000000-0000-4000-8000-000000000091",
          secondStart.at,
          "flex-v1",
          "writer-a",
        ),
        secondStart,
        secondStart.at,
      ),
    );

    expect(activateLearningProofLocalSession(storage, first.sessionId)).toEqual(
      first,
    );
    expect(
      JSON.parse(storage.getItem(LEARNING_PROOF_INDEX_KEY)!).activeSessionId,
    ).toBe(first.sessionId);
    expect(storage.getItem(learningProofSessionStorageKey(first.sessionId))).toBe(
      firstRaw,
    );
  });

  it("rejects a stale writer instead of overwriting another tab", () => {
    const storage = new MemoryStorage();
    const initial = appendLearningProofLocalEvent(
      createLearningProofLocalState(
        sessionId,
        canvasId,
        startedAt,
        "box-model-v1",
        "tab-a",
      ),
      startEvent,
    );
    saveLearningProofLocalState(storage, initial);
    const tabA = appendLearningProofLocalEvent(
      claimLearningProofLocalState(initial, "tab-a"),
      {
        eventVersion: 1,
        eventId: "10000000-0000-4000-8000-000000000021",
        sessionId,
        at: "2026-08-02T00:00:01.000Z",
        type: "predict",
        actorType: "user",
        answer: "grows",
      },
    );
    const tabB = appendLearningProofLocalEvent(
      claimLearningProofLocalState(initial, "tab-b"),
      {
        eventVersion: 1,
        eventId: "10000000-0000-4000-8000-000000000022",
        sessionId,
        at: "2026-08-02T00:00:01.000Z",
        type: "predict",
        actorType: "user",
        answer: "same",
      },
    );
    saveLearningProofLocalState(storage, tabA);
    expect(() => saveLearningProofLocalState(storage, tabB)).toThrowError(
      expect.objectContaining({ reason: "conflict" }),
    );
    expect(restoreLearningProofLocalState(storage).state?.events.at(-1)).toMatchObject({
      eventId: "10000000-0000-4000-8000-000000000021",
    });
  });

  it("writes the session envelope before publishing the active index", () => {
    const storage = new MemoryStorage();
    const state = appendLearningProofLocalEvent(
      createLearningProofLocalState(sessionId, canvasId, startedAt),
      startEvent,
    );
    storage.setItem = (key, value) => {
      if (key === learningProofSessionStorageKey(sessionId)) {
        throw new Error("simulated envelope failure");
      }
      storage.values.set(key, value);
    };
    expect(() => saveLearningProofLocalState(storage, state)).toThrow(
      LearningProofLocalSaveError,
    );
    expect(storage.getItem(LEARNING_PROOF_INDEX_KEY)).toBeNull();
  });

  it("keeps privacy-safe Tutor timeline entries in either lesson family", () => {
    const auditEvent = {
      eventVersion: 1 as const,
      eventId: "10000000-0000-4000-8000-000000000041",
      sessionId,
      at: "2026-08-02T00:00:01.000Z",
      type: "audit-tutor-message" as const,
      actorType: "user" as const,
      mode: "voice" as const,
      realtimeSessionId: "40000000-0000-4000-8000-000000000001",
      role: "user" as const,
      contentStored: false,
      text: null,
      characterCount: 12,
    };
    const boxState = appendLearningProofLocalEvent(
      appendLearningProofLocalEvent(
        createLearningProofLocalState(sessionId, canvasId, startedAt),
        startEvent,
      ),
      auditEvent,
    );
    expect(boxState.events.at(-1)).toEqual(auditEvent);

    const scenarioSession = "20000000-0000-4000-8000-000000000042";
    const scenarioState = appendLearningProofLocalEvent(
      appendLearningProofLocalEvent(
        createLearningProofLocalState(
          scenarioSession,
          canvasId,
          startedAt,
          "flex-v1",
        ),
        {
          eventVersion: 2,
          eventId: "10000000-0000-4000-8000-000000000043",
          sessionId: scenarioSession,
          at: startedAt,
          type: "scenario-start",
          actorType: "system",
          lessonKind: "flex-v1",
          blocks: [
            { role: "source", blockId: "source" },
            { role: "experiment", blockId: "experiment" },
          ],
        },
      ),
      {
        ...auditEvent,
        eventVersion: 2,
        eventId: "10000000-0000-4000-8000-000000000042",
        sessionId: scenarioSession,
      },
    );
    expect(scenarioState.events).toHaveLength(2);
  });

  it("rejects events from another lesson family before persistence", () => {
    const state = createLearningProofLocalState(
      sessionId,
      canvasId,
      startedAt,
      "flex-v1",
    );
    expect(() => appendLearningProofLocalEvent(state, startEvent)).toThrowError(
      expect.objectContaining({ reason: "invalid" }),
    );
  });
});
