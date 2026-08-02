CREATE TABLE "learning_evidence_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_through_sequence" bigint NOT NULL,
	"analysis_version" integer NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"evaluator_id" text NOT NULL,
	"evaluator_version" integer NOT NULL,
	"scoring_model" text,
	"result_json" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_evidence_analysis" ADD CONSTRAINT "learning_evidence_analysis_session_id_teaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teaching_session"("id") ON DELETE cascade ON UPDATE no action;