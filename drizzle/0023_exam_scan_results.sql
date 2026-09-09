-- Resultado estruturado do worker, sem imagem ou resposta final aprovada.
ALTER TABLE "exam_scan_pages"
  ADD COLUMN "sheet_assignment_id" integer REFERENCES "exam_sheet_assignments"("id"),
  ADD COLUMN "sheet_page_number" smallint,
  ADD COLUMN "page_type" text,
  ADD COLUMN "qr_token_digest" text,
  ADD COLUMN "quality_score" real;

CREATE INDEX "exam_scan_pages_assignment_idx"
  ON "exam_scan_pages" USING btree ("sheet_assignment_id");

CREATE TABLE "exam_scan_readings" (
  "id" serial PRIMARY KEY NOT NULL,
  "page_id" integer NOT NULL REFERENCES "exam_scan_pages"("id"),
  "question_number" smallint NOT NULL,
  "kind" text NOT NULL,
  "suggested_letter" text,
  "suggested_transcription" text,
  "confidence" real,
  "exception_code" text,
  "model_reference" text,
  "review_status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX "exam_scan_readings_page_question_unique"
  ON "exam_scan_readings" USING btree ("page_id", "question_number");
CREATE INDEX "exam_scan_readings_page_review_idx"
  ON "exam_scan_readings" USING btree ("page_id", "review_status");
