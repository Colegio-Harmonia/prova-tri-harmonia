ALTER TABLE "generated_exams" ADD COLUMN IF NOT EXISTS "classroom_course_id" text;
--> statement-breakpoint
ALTER TABLE "exam_corrections" ADD COLUMN IF NOT EXISTS "classroom_student_id" text;
