-- Atividades FI/FII: tipo próprio dentro de generated_exams e dados que
-- espelham (sem substituir) a correção feita pelo professor no Classroom.
-- Aplicar manualmente, como as migrations anteriores deste repositório.

CREATE TABLE IF NOT EXISTS "activity_classroom_syncs" (
  "id" serial PRIMARY KEY,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id") ON DELETE CASCADE,
  "course_id" text NOT NULL,
  "coursework_id" text NOT NULL,
  "rubric_id" text,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "last_imported_at" timestamp,
  "last_import_error" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "activity_classroom_syncs_exam_unique" ON "activity_classroom_syncs" ("exam_id");
CREATE UNIQUE INDEX IF NOT EXISTS "activity_classroom_syncs_coursework_unique" ON "activity_classroom_syncs" ("course_id", "coursework_id");

CREATE TABLE IF NOT EXISTS "activity_classroom_results" (
  "id" serial PRIMARY KEY,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id") ON DELETE CASCADE,
  "classroom_student_id" text NOT NULL,
  "classroom_submission_id" text NOT NULL,
  "student_name" text NOT NULL,
  "student_email" text,
  "submission_state" text,
  "assigned_grade" real,
  "assigned_rubric_grades" jsonb,
  "imported_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "activity_classroom_results_exam_student_unique" ON "activity_classroom_results" ("exam_id", "classroom_student_id");
CREATE INDEX IF NOT EXISTS "activity_classroom_results_exam_imported_idx" ON "activity_classroom_results" ("exam_id", "imported_at");
