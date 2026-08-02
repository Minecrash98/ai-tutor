CREATE TYPE "public"."author_type" AS ENUM('user', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('explanation', 'runnable', 'comparison', 'css-controller', 'annotation', 'group');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'completed', 'interrupted');--> statement-breakpoint
CREATE TABLE "canvas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_owner_token_hash" text NOT NULL,
	"title" text NOT NULL,
	"current_document_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"author_type" "author_type" NOT NULL,
	"files_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"change_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"before_revision_id" uuid NOT NULL,
	"after_revision_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"config_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"files_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"diagnostics_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" "author_type" NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"through_sequence" bigint NOT NULL,
	"canvas_snapshot_json" jsonb NOT NULL,
	"semantic_snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"shape_id" text NOT NULL,
	"type" "block_type" NOT NULL,
	"runtime_type" text,
	"current_revision_id" uuid,
	"props_json" jsonb NOT NULL,
	"created_by" "author_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teaching_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"status" "session_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"latest_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"input_modality" text NOT NULL,
	"user_transcript" text,
	"assistant_transcript" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "code_revision" ADD CONSTRAINT "code_revision_block_id_teaching_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."teaching_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_block_id_teaching_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."teaching_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_before_revision_id_code_revision_id_fk" FOREIGN KEY ("before_revision_id") REFERENCES "public"."code_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_after_revision_id_code_revision_id_fk" FOREIGN KEY ("after_revision_id") REFERENCES "public"."code_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_snapshot" ADD CONSTRAINT "import_snapshot_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_session_id_teaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teaching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_snapshot" ADD CONSTRAINT "session_snapshot_session_id_teaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teaching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_block" ADD CONSTRAINT "teaching_block_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_session" ADD CONSTRAINT "teaching_session_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_turn" ADD CONSTRAINT "tutor_turn_session_id_teaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teaching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_event_session_sequence_unique" ON "session_event" USING btree ("session_id","sequence");