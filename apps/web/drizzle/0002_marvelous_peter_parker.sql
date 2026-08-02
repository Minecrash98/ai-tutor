CREATE TABLE "transfer_assessment_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"item_hash" text NOT NULL,
	"assessment_kind" text NOT NULL,
	"due_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"passed_at" timestamp with time zone,
	"passed_in_window" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_assessment_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"attempt_sequence" integer NOT NULL,
	"submitted_answer" text NOT NULL,
	"normalized_answer" text,
	"answer_hash" text NOT NULL,
	"passed" boolean NOT NULL,
	"submitted_in_window" boolean NOT NULL,
	"evaluator_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transfer_assessment_assignment" ADD CONSTRAINT "transfer_assessment_assignment_session_id_teaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teaching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_assessment_attempt" ADD CONSTRAINT "transfer_assessment_attempt_assignment_id_transfer_assessment_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."transfer_assessment_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_assignment_session_item_unique" ON "transfer_assessment_assignment" USING btree ("session_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_assignment_session_kind_unique" ON "transfer_assessment_assignment" USING btree ("session_id","assessment_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_attempt_assignment_sequence_unique" ON "transfer_assessment_attempt" USING btree ("assignment_id","attempt_sequence");