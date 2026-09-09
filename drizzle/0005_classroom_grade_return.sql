ALTER TABLE "generated_exams" ADD COLUMN IF NOT EXISTS "classroom_coursework_id" text;
--> statement-breakpoint
ALTER TABLE "exam_corrections" ADD COLUMN IF NOT EXISTS "grade_returned_at" timestamp;
