ALTER TABLE "session_event" ADD COLUMN "client_event_id" uuid;--> statement-breakpoint
UPDATE "session_event" SET "client_event_id" = gen_random_uuid() WHERE "client_event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "session_event" ALTER COLUMN "client_event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_event" ADD COLUMN "event_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_event" ADD COLUMN "payload_hash" text;--> statement-breakpoint
UPDATE "session_event" SET "payload_hash" = md5("payload_json"::text) WHERE "payload_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "session_event" ALTER COLUMN "payload_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_snapshot" ADD COLUMN "lesson_state_json" jsonb;--> statement-breakpoint
UPDATE "session_snapshot" SET "lesson_state_json" = '{"version":2,"sessionId":null,"phase":"idle","lessonBlockId":null,"transferBlockId":null,"prediction":null,"predictionCorrect":null,"observedPaddingPx":null,"explanationCorrect":null,"explanationAttempts":0,"transferCode":null,"transferPassed":null,"startedAt":null,"completedAt":null,"evidence":[]}'::jsonb WHERE "lesson_state_json" IS NULL;--> statement-breakpoint
ALTER TABLE "session_snapshot" ALTER COLUMN "lesson_state_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_snapshot" ADD COLUMN "snapshot_hash" text;--> statement-breakpoint
UPDATE "session_snapshot" SET "snapshot_hash" = md5(concat("canvas_snapshot_json"::text, "semantic_snapshot_json"::text, "lesson_state_json"::text)) || md5(concat("lesson_state_json"::text, "semantic_snapshot_json"::text, "canvas_snapshot_json"::text)) WHERE "snapshot_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "session_snapshot" ALTER COLUMN "snapshot_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_session" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_session" ADD COLUMN "lesson_kind" text DEFAULT 'box-model-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_session" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "session_event_session_client_event_unique" ON "session_event" USING btree ("session_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_snapshot_session_sequence_unique" ON "session_snapshot" USING btree ("session_id","through_sequence");
