-- Base da emissão individual de cartões-resposta. A correção permanece em
-- exam_corrections; esta tabela apenas congela a identidade antes da aplicação.
CREATE TABLE "exam_sheet_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id"),
  "exam_correction_id" integer NOT NULL REFERENCES "exam_corrections"("id"),
  "classroom_student_id" text NOT NULL,
  "student_name_snapshot" text NOT NULL,
  "student_email_snapshot" text,
  "public_id" text NOT NULL,
  "token_digest" text,
  "layout_version" text DEFAULT 'PTR1' NOT NULL,
  "page_count" smallint DEFAULT 2 NOT NULL,
  "status" text DEFAULT 'pronta' NOT NULL,
  "issued_by" integer NOT NULL REFERENCES "users"("id"),
  "emitted_at" timestamp,
  "emitted_by" integer REFERENCES "users"("id"),
  "voided_at" timestamp,
  "voided_by" integer REFERENCES "users"("id"),
  "reprint_of_id" integer REFERENCES "exam_sheet_assignments"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX "exam_sheet_assignments_public_id_unique"
  ON "exam_sheet_assignments" USING btree ("public_id");
CREATE UNIQUE INDEX "exam_sheet_assignments_token_digest_unique"
  ON "exam_sheet_assignments" USING btree ("token_digest");
CREATE UNIQUE INDEX "exam_sheet_assignments_active_student_unique"
  ON "exam_sheet_assignments" USING btree ("exam_id", "classroom_student_id")
  WHERE "status" IN ('pronta', 'emitida');
CREATE INDEX "exam_sheet_assignments_correction_idx"
  ON "exam_sheet_assignments" USING btree ("exam_correction_id");
CREATE INDEX "exam_sheet_assignments_exam_status_idx"
  ON "exam_sheet_assignments" USING btree ("exam_id", "status");
