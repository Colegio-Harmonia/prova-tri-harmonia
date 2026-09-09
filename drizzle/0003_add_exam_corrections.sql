CREATE TABLE IF NOT EXISTS "exam_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"exam_id" integer NOT NULL,
	"student_name" text NOT NULL,
	"student_email" text,
	"answers" jsonb NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_corrections" ADD CONSTRAINT "exam_corrections_exam_id_generated_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."generated_exams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_corrections" ADD CONSTRAINT "exam_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
