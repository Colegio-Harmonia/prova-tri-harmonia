ALTER TABLE "exam_corrections"
  ADD COLUMN IF NOT EXISTS "attendance_status" text NOT NULL DEFAULT 'presente',
  ADD COLUMN IF NOT EXISTS "absence_marked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "absence_marked_by" integer REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_corrections_exam_attendance_idx"
  ON "exam_corrections" ("exam_id", "attendance_status");
