import {
  type BoxModelLessonRecordedEvent,
  type CreateLearningSessionRequest,
  type LearningLessonRecordedEvent,
  type PersonalizedLessonOrigin,
  type ScenarioLessonRecordedEvent,
} from "@ai-tutor/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "@/db";
import { replayBoxModelLessonEvents } from "@/features/lesson/box-model-lesson";
import { replayScenarioLessonEvents } from "@/features/lesson/scenario-lesson";
import {
  LearningProofStore,
  LearningProofStoreError,
} from "./learning-proof-store";

const databaseUrl = process.env.AI_TUTOR_TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;
type ScenarioEventInput =
  ScenarioLessonRecordedEvent extends infer TEvent
    ? TEvent extends ScenarioLessonRecordedEvent
      ? Omit<TEvent, "eventVersion" | "eventId" | "sessionId" | "at">
      : never
    : never;

function personalizedOrigin(): PersonalizedLessonOrigin {
  return {
    version: 1,
    planId: "personal-course:source-block:revision-1:box-model:#card",
    courseId: "box-model-v1",
    sourceBlockId: "source-block",
    baseRevisionId: "revision-1",
    baseContentHash: "immutable-source-hash",
    verifiedRevisionId: "revision-2",
    analyzerVersion: "personalized-course-rules-v1",
    domPath: "main#card",
    source: {
      filePath: "styles.css",
      line: 2,
      column: 1,
      selector: "#card",
      declarations: { width: "280px", padding: "20px" },
    },
    experiment: {
      property: "padding",
      beforeValue: "20px",
      trialValue: "36px",
      verifiedValue: "36px",
      verifiedAt: "2026-08-02T01:59:59.000Z",
      beforeRect: { width: 328, height: 160, x: 20, y: 30 },
      afterRect: { width: 360, height: 192, x: 20, y: 30 },
    },
    formativeAnswers: {
      prediction: "outer-grows",
      explanation: "content-box-adds-padding",
      explanationAttempts: 1,
    },
    hiddenTransfer: {
      itemId: "box-transfer-b-1",
      sha256: "7ef009aaf125fa750b25910b9d57fa1f6977e3d39bef68226ba57f9e97b23bef",
    },
  };
}

describeDatabase("PostgreSQL learning proof store", () => {
  let connection: ReturnType<typeof createDatabase>;
  let store: LearningProofStore;

  beforeAll(() => {
    connection = createDatabase(databaseUrl!);
    store = new LearningProofStore(connection.db);
  });

  afterAll(async () => {
    await connection.client.end({ timeout: 1 });
  });

  it("appends strictly ordered events, retries idempotently, and rejects conflicts", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    const startedAt = "2026-08-02T02:00:00.000Z";
    const request: CreateLearningSessionRequest = {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt,
    };
    await store.createSession(ownerId, request);
    expect(await store.createSession(ownerId, request)).toMatchObject({
      sessionId,
      latestSequence: 0,
    });
    expect(
      await store.createSession(ownerId, {
        ...request,
        startedAt: "2026-08-02T02:00:00+00:00",
      }),
    ).toMatchObject({ sessionId, latestSequence: 0 });

    const start: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "system",
      type: "start",
      blockId: "lesson-block",
      personalizedOrigin: personalizedOrigin(),
      at: startedAt,
    };
    const predict: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "user",
      type: "predict",
      answer: "grows",
      at: "2026-08-02T02:00:01.000Z",
    };
    const first = await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [start, predict],
    });
    expect(first).toMatchObject({
      acknowledgedSequence: 2,
      latestSequence: 2,
    });

    const retry = await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [start, predict],
    });
    expect(retry.events.map((record) => record.sequence)).toEqual([1, 2]);
    const replay = await store.getReplay(ownerId, sessionId);
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0]?.event).toMatchObject({
      type: "start",
      personalizedOrigin: {
        baseContentHash: "immutable-source-hash",
        verifiedRevisionId: "revision-2",
        hiddenTransfer: { itemId: "box-transfer-b-1" },
      },
    });

    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 1,
        expectedSequence: 0,
        events: [{ ...start, blockId: "changed-block" }],
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_EVENT_ID_CONFLICT",
      status: 409,
    });
    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 1,
        expectedSequence: 0,
        events: [{ ...predict, eventId: randomUUID() }],
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_SEQUENCE_CONFLICT",
      status: 409,
    });
    await expect(store.getReplay("different-owner", sessionId)).rejects.toBeInstanceOf(
      LearningProofStoreError,
    );
  });

  it("persists neutral Tutor events in order while deterministic lesson replay ignores them", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    const startedAt = "2026-08-02T02:10:00.000Z";
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt,
    });
    const start: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "system",
      type: "start",
      blockId: "lesson-block",
      at: startedAt,
    };
    const audit: LearningLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "user",
      type: "audit-tutor-message",
      mode: "voice",
      realtimeSessionId: randomUUID(),
      role: "user",
      contentStored: false,
      text: null,
      characterCount: 12,
      at: "2026-08-02T02:10:01.000Z",
    };
    const predict: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "user",
      type: "predict",
      answer: "grows",
      at: "2026-08-02T02:10:02.000Z",
    };
    const events: LearningLessonRecordedEvent[] = [start, audit, predict];
    const appended = await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events,
    });
    expect(appended.latestSequence).toBe(3);
    expect(appended.events.map((record) => record.event.type)).toEqual([
      "start",
      "audit-tutor-message",
      "predict",
    ]);

    const lessonState = replayBoxModelLessonEvents([start, predict]);
    const snapshot = await store.saveSnapshot(ownerId, sessionId, {
      schemaVersion: 1,
      throughSequence: 3,
      canvasSnapshot: { version: 1, shapes: [] },
      semanticSnapshot: { version: 1, serializedState: "{}" },
      lessonState,
    });
    expect(snapshot.lessonState).toEqual(lessonState);
    const replay = await store.getReplay(ownerId, sessionId);
    expect(replay.events[1]?.event).toEqual(audit);
    expect(replay.latestSnapshot?.throughSequence).toBe(3);

    const analysis = await store.createEvidenceAnalysis(
      ownerId,
      sessionId,
      "current",
    );
    expect(analysis.analysis.sourceThroughSequence).toBe(3);
    expect(
      analysis.analysis.result.milestones
        .flatMap((milestone) => milestone.sourceEventIds)
        .includes(audit.eventId),
    ).toBe(false);
  });

  it("rolls back an inserted event when PostgreSQL raises 53100 before sequence update", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    const startedAt = "2026-08-02T02:15:00.000Z";
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt,
    });
    const event: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "system",
      type: "start",
      blockId: "disk-full-lesson",
      at: startedAt,
    };
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `test_disk_full_${suffix}`;
    const triggerName = `test_disk_full_trigger_${suffix}`;
    try {
      await connection.client.unsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = '${sessionId}'::uuid THEN
            RAISE EXCEPTION 'injected disk full' USING ERRCODE = '53100';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await connection.client.unsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE UPDATE OF latest_sequence ON teaching_session
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);
      await expect(
        store.appendEvents(ownerId, sessionId, {
          schemaVersion: 1,
          expectedSequence: 0,
          events: [event],
        }),
      ).rejects.toMatchObject({ cause: { code: "53100" } });
      const eventCount = await connection.client.unsafe<
        { event_count: number }[]
      >(
        "SELECT COUNT(*)::int AS event_count FROM session_event WHERE session_id = $1",
        [sessionId],
      );
      const sequence = await connection.client.unsafe<
        { latest_sequence: string | number }[]
      >(
        "SELECT latest_sequence FROM teaching_session WHERE id = $1",
        [sessionId],
      );
      expect(eventCount[0]?.event_count).toBe(0);
      expect(Number(sequence[0]?.latest_sequence)).toBe(0);
      expect((await store.getReplay(ownerId, sessionId)).events).toHaveLength(0);
    } finally {
      await connection.client.unsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON teaching_session`,
      );
      await connection.client.unsafe(
        `DROP FUNCTION IF EXISTS "${functionName}"()`,
      );
    }

    const recovered = await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [event],
    });
    expect(recovered.latestSequence).toBe(1);
    const retry = await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [event],
    });
    expect(retry.events.map((item) => item.sequence)).toEqual([1]);
    expect((await store.getReplay(ownerId, sessionId)).events).toHaveLength(1);
  });

  it("appends versioned analyses without rewriting an earlier result", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    const startedAt = "2026-08-02T02:30:00.000Z";
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt,
    });
    const start: BoxModelLessonRecordedEvent = {
      eventVersion: 1,
      eventId: randomUUID(),
      sessionId,
      actorType: "system",
      type: "start",
      blockId: "lesson-block",
      at: startedAt,
    };
    await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [start],
    });

    const first = await store.createEvidenceAnalysis(
      ownerId,
      sessionId,
      "current",
    );
    expect(first.created).toBe(true);
    expect(first.analysis.result.milestones.map((item) => item.status)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
    const retry = await store.createEvidenceAnalysis(
      ownerId,
      sessionId,
      "current",
    );
    expect(retry).toMatchObject({
      created: false,
      analysis: { analysisId: first.analysis.analysisId },
    });

    const reanalysis = await store.createEvidenceAnalysis(
      ownerId,
      sessionId,
      "reanalysis",
    );
    expect(reanalysis.created).toBe(true);
    expect(reanalysis.analysis.analysisId).not.toBe(first.analysis.analysisId);
    expect(reanalysis.analysis.resultHash).toBe(first.analysis.resultHash);
    const listed = await store.listEvidenceAnalyses(ownerId, sessionId);
    expect(listed.analyses).toHaveLength(2);
    expect(listed.analyses.map((item) => item.analysisId)).toEqual(
      expect.arrayContaining([
        first.analysis.analysisId,
        reanalysis.analysis.analysisId,
      ]),
    );
    const audit = await store.getAuditBundle(ownerId, sessionId);
    expect(audit).toMatchObject({
      formatVersion: 1,
      replay: {
        session: { sessionId },
        events: [{ sequence: 1, event: { eventId: start.eventId } }],
      },
      analyses: [
        { analysisId: reanalysis.analysis.analysisId },
        { analysisId: first.analysis.analysisId },
      ],
    });
    expect(audit.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.analyses.every((item) => item.result.scoringModel === null)).toBe(
      true,
    );
    await expect(
      store.listEvidenceAnalyses("different-owner", sessionId),
    ).rejects.toMatchObject({ code: "LEARNING_SESSION_FORBIDDEN" });
    await expect(
      store.getAuditBundle("different-owner", sessionId),
    ).rejects.toMatchObject({ code: "LEARNING_SESSION_FORBIDDEN" });
  });

  it("stores only a snapshot that exactly matches deterministic replay", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    const startedAt = "2026-08-02T03:00:00.000Z";
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt,
    });
    const events: BoxModelLessonRecordedEvent[] = [
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "system",
        type: "start",
        blockId: "lesson-block",
        at: startedAt,
      },
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "predict",
        answer: "same",
        at: "2026-08-02T03:00:01.000Z",
      },
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "experiment-saved",
        blockId: "lesson-block",
        revisionId: "revision-32",
        property: "padding",
        value: "32px",
        at: "2026-08-02T03:00:02.000Z",
      },
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "explain",
        answer: "content-plus-padding",
        at: "2026-08-02T03:00:03.000Z",
      },
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "system",
        type: "attach-transfer",
        blockId: "transfer-block",
        at: "2026-08-02T03:00:04.000Z",
      },
      {
        eventVersion: 1,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "transfer-submit",
        code: "padding: 20px;",
        at: "2026-08-02T03:00:05.000Z",
      },
    ];
    await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events,
    });
    const lessonState = replayBoxModelLessonEvents(events);
    const snapshotInput = {
      schemaVersion: 1 as const,
      throughSequence: events.length,
      canvasSnapshot: { version: 1 as const, shapes: [{ id: "shape-1" }] },
      semanticSnapshot: { version: 1 as const, serializedState: "{}" },
      lessonState,
    };
    const snapshot = await store.saveSnapshot(ownerId, sessionId, snapshotInput);
    expect(snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.lessonState.phase).toBe("complete");
    expect(
      await store.saveSnapshot(ownerId, sessionId, snapshotInput),
    ).toEqual(snapshot);

    const replay = await store.getReplay(ownerId, sessionId);
    expect(replay.session.status).toBe("completed");
    expect(replay.latestSnapshot?.lessonState).toEqual(
      replayBoxModelLessonEvents(
        replay.events
          .map((record) => record.event)
          .filter(
            (event): event is BoxModelLessonRecordedEvent =>
              !event.type.startsWith("scenario-"),
          ),
      ),
    );
    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 1,
        expectedSequence: events.length,
        events: [
          {
            ...events[0]!,
            eventId: randomUUID(),
            at: "2026-08-02T03:00:06.000Z",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_EVENT_TRANSITION_INVALID",
      status: 409,
    });
    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 1,
        expectedSequence: events.length,
        events: [
          {
            eventVersion: 1,
            eventId: randomUUID(),
            sessionId,
            actorType: "user",
            type: "predict",
            answer: "grows",
            at: "2026-08-02T03:00:06.000Z",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_SESSION_ALREADY_COMPLETED",
      status: 409,
    });
    await expect(
      store.saveSnapshot(ownerId, sessionId, {
        ...snapshotInput,
        lessonState: { ...lessonState, evidence: [] },
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_SNAPSHOT_REPLAY_MISMATCH",
      status: 409,
    });
  });

  for (const lessonKind of ["flex-v1", "positioning-v1"] as const) {
    it(`persists, validates, and deterministically replays ${lessonKind}`, async () => {
      const sessionId = randomUUID();
      const canvasId = randomUUID();
      const ownerId = `owner-${randomUUID()}`;
      const startedAt = "2026-08-02T04:00:00.000Z";
      const blocks =
        lessonKind === "flex-v1"
          ? [
              { role: "source" as const, blockId: "normal" },
              { role: "experiment" as const, blockId: "flex" },
            ]
          : [
              { role: "static" as const, blockId: "static" },
              { role: "relative" as const, blockId: "relative" },
              { role: "absolute" as const, blockId: "absolute" },
            ];
      await expect(
        store.createSession(ownerId, {
          schemaVersion: 1,
          sessionId,
          canvasId,
          lessonKind,
          startedAt,
        }),
      ).rejects.toMatchObject({
        code: "LEARNING_SESSION_VERSION_UNSUPPORTED",
        status: 409,
      });
      await store.createSession(ownerId, {
        schemaVersion: 2,
        sessionId,
        canvasId,
        lessonKind,
        startedAt,
      });
      await expect(
        store.createSession(ownerId, {
          schemaVersion: 2,
          sessionId,
          canvasId,
          lessonKind:
            lessonKind === "flex-v1" ? "positioning-v1" : "flex-v1",
          startedAt,
        }),
      ).rejects.toMatchObject({
        code: "LEARNING_SESSION_ID_CONFLICT",
        status: 409,
      });

      let eventIndex = 0;
      const make = (
        value: ScenarioEventInput,
      ): ScenarioLessonRecordedEvent => {
        eventIndex += 1;
        return {
          eventVersion: 2,
          eventId: randomUUID(),
          sessionId,
          at: `2026-08-02T04:00:${String(eventIndex).padStart(2, "0")}.000Z`,
          ...value,
        } as unknown as ScenarioLessonRecordedEvent;
      };
      const observations =
        lessonKind === "flex-v1"
          ? [
              { blockId: "flex", property: "gap", value: "32px" },
              {
                blockId: "flex",
                property: "justify-content",
                value: "center",
              },
              {
                blockId: "flex",
                property: "align-items",
                value: "flex-end",
              },
            ]
          : [
              { blockId: "static", property: "top", value: "40px" },
              { blockId: "relative", property: "top", value: "40px" },
              { blockId: "absolute", property: "top", value: "48px" },
            ];
      const events: ScenarioLessonRecordedEvent[] = [
        make({
          type: "scenario-start",
          actorType: "system",
          lessonKind,
          blocks,
        }),
        make({
          type: "scenario-predict",
          actorType: "user",
          answer:
            lessonKind === "flex-v1"
              ? "gap-separates-items"
              : "absolute-leaves-flow",
        }),
        ...observations.map((observation, index) =>
          make({
            type: "scenario-experiment-saved",
            actorType: "user",
            revisionId: `revision-${index + 1}`,
            ...observation,
          }),
        ),
        make({
          type: "scenario-explain",
          actorType: "user",
          answer:
            lessonKind === "flex-v1"
              ? "axes-are-independent"
              : "nearest-positioned-ancestor",
        }),
        make({
          type: "scenario-attach-transfer",
          actorType: "system",
          blockId: "transfer",
        }),
        make({
          type: "scenario-transfer-submit",
          actorType: "user",
          code:
            lessonKind === "flex-v1"
              ? "display:flex; gap:24px; justify-content:space-between; align-items:center;"
              : "position:absolute; top:16px; right:16px;",
        }),
      ];
      await store.appendEvents(ownerId, sessionId, {
        schemaVersion: 2,
        expectedSequence: 0,
        events,
      });
      const lessonState = replayScenarioLessonEvents(events);
      expect(lessonState.phase).toBe("complete");
      const snapshot = await store.saveSnapshot(ownerId, sessionId, {
        schemaVersion: 2,
        throughSequence: events.length,
        canvasSnapshot: { version: 1, shapes: [{ id: `shape-${lessonKind}` }] },
        semanticSnapshot: { version: 1, serializedState: "{}" },
        lessonState,
      });
      expect(snapshot.lessonState).toEqual(lessonState);
      const replay = await store.getReplay(ownerId, sessionId);
      expect(replay.session).toMatchObject({
        lessonKind,
        status: "completed",
        latestSequence: events.length,
      });
      expect(replay.latestSnapshot?.lessonState).toEqual(
        replayScenarioLessonEvents(
          replay.events
            .map((record) => record.event)
            .filter(
              (event): event is ScenarioLessonRecordedEvent =>
                event.type.startsWith("scenario-"),
            ),
        ),
      );

      await expect(
        store.appendEvents(ownerId, sessionId, {
          schemaVersion: 2,
          expectedSequence: events.length,
          events: [
            make({
              type: "scenario-predict",
              actorType: "user",
              answer:
                lessonKind === "flex-v1"
                  ? "absolute-leaves-flow"
                  : "gap-separates-items",
            }),
          ],
        }),
      ).rejects.toMatchObject({
        code: "LEARNING_EVENT_LESSON_MISMATCH",
        status: 400,
      });
    });
  }

  it("rejects a non-start first event and reused scenario revisions", async () => {
    const ownerId = `owner-${randomUUID()}`;
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const startedAt = "2026-08-02T05:00:00.000Z";
    await store.createSession(ownerId, {
      schemaVersion: 2,
      sessionId,
      canvasId,
      lessonKind: "flex-v1",
      startedAt,
    });
    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 2,
        expectedSequence: 0,
        events: [
          {
            eventVersion: 2,
            eventId: randomUUID(),
            sessionId,
            actorType: "user",
            type: "scenario-predict",
            answer: "gap-separates-items",
            at: startedAt,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_EVENT_TRANSITION_INVALID",
      status: 409,
    });

    const events: ScenarioLessonRecordedEvent[] = [
      {
        eventVersion: 2,
        eventId: randomUUID(),
        sessionId,
        actorType: "system",
        type: "scenario-start",
        lessonKind: "flex-v1",
        blocks: [
          { role: "source", blockId: "source" },
          { role: "experiment", blockId: "experiment" },
        ],
        at: startedAt,
      },
      {
        eventVersion: 2,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "scenario-predict",
        answer: "gap-separates-items",
        at: "2026-08-02T05:00:01.000Z",
      },
      {
        eventVersion: 2,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "scenario-experiment-saved",
        blockId: "experiment",
        revisionId: "same-revision",
        property: "gap",
        value: "32px",
        at: "2026-08-02T05:00:02.000Z",
      },
      {
        eventVersion: 2,
        eventId: randomUUID(),
        sessionId,
        actorType: "user",
        type: "scenario-experiment-saved",
        blockId: "experiment",
        revisionId: "same-revision",
        property: "justify-content",
        value: "center",
        at: "2026-08-02T05:00:03.000Z",
      },
    ];
    await expect(
      store.appendEvents(ownerId, sessionId, {
        schemaVersion: 2,
        expectedSequence: 0,
        events,
      }),
    ).rejects.toMatchObject({
      code: "LEARNING_REVISION_ALREADY_OBSERVED",
      status: 409,
    });
    expect((await store.getReplay(ownerId, sessionId)).events).toHaveLength(0);
  });

  it("deletes an owner-bound session idempotently and cascades its evidence", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt: "2026-08-02T06:00:00.000Z",
    });
    await expect(
      store.deleteSession(`other-${randomUUID()}`, sessionId),
    ).rejects.toMatchObject({
      code: "LEARNING_SESSION_FORBIDDEN",
      status: 403,
    });
    await expect(store.deleteSession(ownerId, sessionId)).resolves.toEqual({
      deleted: true,
    });
    await expect(store.deleteSession(ownerId, sessionId)).resolves.toEqual({
      deleted: false,
    });
    await expect(store.getReplay(ownerId, sessionId)).rejects.toMatchObject({
      code: "LEARNING_SESSION_NOT_FOUND",
      status: 404,
    });
  });

  it("derives an owner-bound learner model and removes it with the source session", async () => {
    const sessionId = randomUUID();
    const canvasId = randomUUID();
    const ownerId = `owner-${randomUUID()}`;
    await store.createSession(ownerId, {
      schemaVersion: 1,
      sessionId,
      canvasId,
      lessonKind: "box-model-v1",
      startedAt: "2026-08-02T07:00:00.000Z",
    });
    await store.appendEvents(ownerId, sessionId, {
      schemaVersion: 1,
      expectedSequence: 0,
      events: [
        {
          eventVersion: 1,
          eventId: randomUUID(),
          sessionId,
          actorType: "system",
          type: "start",
          blockId: "learner-model-block",
          at: "2026-08-02T07:00:00.000Z",
        },
      ],
    });
    await store.createEvidenceAnalysis(ownerId, sessionId, "current");
    expect(await store.getMinimalLearnerModel(`other-${randomUUID()}`)).toMatchObject({
      concepts: [],
    });
    expect(await store.getMinimalLearnerModel(ownerId)).toMatchObject({
      modelVersion: 1,
      scope: "learning-evidence-only",
      concepts: [
        {
          lessonKind: "box-model-v1",
          sourceSessionId: sessionId,
          explanationResult: "missing",
          practiceResult: {
            guidedObservation: "missing",
            independentTransfer: "missing",
          },
        },
      ],
    });
    await store.deleteSession(ownerId, sessionId);
    expect(await store.getMinimalLearnerModel(ownerId)).toMatchObject({
      concepts: [],
    });
  });
});
