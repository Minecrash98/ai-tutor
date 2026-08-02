import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const blockType = pgEnum("block_type", [
  "explanation",
  "runnable",
  "comparison",
  "css-controller",
  "annotation",
  "group",
]);

export const authorType = pgEnum("author_type", [
  "user",
  "ai",
  "system",
]);

export const sessionStatus = pgEnum("session_status", [
  "active",
  "completed",
  "interrupted",
]);

export const canvases = pgTable("canvas", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonymousOwnerTokenHash: text("anonymous_owner_token_hash").notNull(),
  title: text("title").notNull(),
  currentDocumentSnapshot: jsonb("current_document_snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const teachingBlocks = pgTable("teaching_block", {
  id: uuid("id").defaultRandom().primaryKey(),
  canvasId: uuid("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  shapeId: text("shape_id").notNull(),
  type: blockType("type").notNull(),
  runtimeType: text("runtime_type"),
  currentRevisionId: uuid("current_revision_id"),
  props: jsonb("props_json").notNull(),
  createdBy: authorType("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const importSnapshots = pgTable("import_snapshot", {
  id: uuid("id").defaultRandom().primaryKey(),
  canvasId: uuid("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  manifest: jsonb("manifest_json").notNull(),
  files: jsonb("files_json").notNull(),
  contentHash: text("content_hash").notNull(),
  diagnostics: jsonb("diagnostics_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const codeRevisions = pgTable("code_revision", {
  id: uuid("id").defaultRandom().primaryKey(),
  blockId: uuid("block_id")
    .notNull()
    .references(() => teachingBlocks.id, { onDelete: "cascade" }),
  parentRevisionId: uuid("parent_revision_id"),
  authorType: authorType("author_type").notNull(),
  files: jsonb("files_json").notNull(),
  contentHash: text("content_hash").notNull(),
  changeSummary: text("change_summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const comparisons = pgTable("comparison", {
  id: uuid("id").defaultRandom().primaryKey(),
  blockId: uuid("block_id")
    .notNull()
    .references(() => teachingBlocks.id, { onDelete: "cascade" }),
  beforeRevisionId: uuid("before_revision_id")
    .notNull()
    .references(() => codeRevisions.id),
  afterRevisionId: uuid("after_revision_id")
    .notNull()
    .references(() => codeRevisions.id),
  mode: text("mode").notNull(),
  config: jsonb("config_json").notNull(),
});

export const teachingSessions = pgTable("teaching_session", {
  id: uuid("id").defaultRandom().primaryKey(),
  canvasId: uuid("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  status: sessionStatus("status").notNull(),
  schemaVersion: integer("schema_version").default(1).notNull(),
  lessonKind: text("lesson_kind").default("box-model-v1").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  latestSequence: bigint("latest_sequence", { mode: "number" })
    .default(0)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessionEvents = pgTable(
  "session_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    clientEventId: uuid("client_event_id").notNull(),
    eventVersion: integer("event_version").default(1).notNull(),
    eventType: text("event_type").notNull(),
    actorType: authorType("actor_type").notNull(),
    payload: jsonb("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("session_event_session_sequence_unique").on(
      table.sessionId,
      table.sequence,
    ),
    uniqueIndex("session_event_session_client_event_unique").on(
      table.sessionId,
      table.clientEventId,
    ),
  ],
);

export const sessionSnapshots = pgTable(
  "session_snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    throughSequence: bigint("through_sequence", { mode: "number" }).notNull(),
    canvasSnapshot: jsonb("canvas_snapshot_json").notNull(),
    semanticSnapshot: jsonb("semantic_snapshot_json").notNull(),
    lessonState: jsonb("lesson_state_json").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("session_snapshot_session_sequence_unique").on(
      table.sessionId,
      table.throughSequence,
    ),
  ],
);

export const learningEvidenceAnalyses = pgTable(
  "learning_evidence_analysis",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    sourceThroughSequence: bigint("source_through_sequence", {
      mode: "number",
    }).notNull(),
    analysisVersion: integer("analysis_version").notNull(),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    evaluatorId: text("evaluator_id").notNull(),
    evaluatorVersion: integer("evaluator_version").notNull(),
    scoringModel: text("scoring_model"),
    result: jsonb("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const transferAssessmentAssignments = pgTable(
  "transfer_assessment_assignment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    itemHash: text("item_hash").notNull(),
    assessmentKind: text("assessment_kind").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    passedAt: timestamp("passed_at", { withTimezone: true }),
    passedInWindow: boolean("passed_in_window"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("transfer_assignment_session_item_unique").on(
      table.sessionId,
      table.itemId,
    ),
    uniqueIndex("transfer_assignment_session_kind_unique").on(
      table.sessionId,
      table.assessmentKind,
    ),
  ],
);

export const transferAssessmentAttempts = pgTable(
  "transfer_assessment_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => transferAssessmentAssignments.id, {
        onDelete: "cascade",
      }),
    attemptSequence: integer("attempt_sequence").notNull(),
    submittedAnswer: text("submitted_answer").notNull(),
    normalizedAnswer: text("normalized_answer"),
    answerHash: text("answer_hash").notNull(),
    passed: boolean("passed").notNull(),
    submittedInWindow: boolean("submitted_in_window").notNull(),
    evaluatorId: text("evaluator_id").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("transfer_attempt_assignment_sequence_unique").on(
      table.assignmentId,
      table.attemptSequence,
    ),
  ],
);

export const tutorTurns = pgTable("tutor_turn", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => teachingSessions.id, { onDelete: "cascade" }),
  inputModality: text("input_modality").notNull(),
  userTranscript: text("user_transcript"),
  assistantTranscript: text("assistant_transcript"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
