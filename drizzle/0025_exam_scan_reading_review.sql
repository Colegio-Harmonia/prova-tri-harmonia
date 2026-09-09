-- A decisão humana é distinta da sugestão do worker. Valores confirmados
-- preservam a evidência de edição e permitem reconciliar a correção formal.
ALTER TABLE "exam_scan_readings"
  ADD COLUMN "confirmed_letter" text,
  ADD COLUMN "confirmed_transcription" text,
  ADD COLUMN "reviewed_by" integer REFERENCES "users"("id"),
  ADD COLUMN "reviewed_at" timestamp;

CREATE INDEX "exam_scan_readings_reviewed_by_idx"
  ON "exam_scan_readings" USING btree ("reviewed_by", "reviewed_at");
