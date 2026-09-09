-- Páginas lógicas e tentativas de despacho privado para n8n.
CREATE TABLE "exam_scan_pages" (
  "id" serial PRIMARY KEY NOT NULL,
  "upload_id" integer NOT NULL REFERENCES "exam_scan_uploads"("id"),
  "page_index" smallint NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "exception_code" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX "exam_scan_pages_upload_page_unique"
  ON "exam_scan_pages" USING btree ("upload_id", "page_index");
CREATE INDEX "exam_scan_pages_upload_status_idx"
  ON "exam_scan_pages" USING btree ("upload_id", "status");

CREATE TABLE "exam_scan_processing_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "upload_id" integer NOT NULL REFERENCES "exam_scan_uploads"("id"),
  "attempt_number" smallint NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "delivered_at" timestamp,
  "delivery_error_code" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX "exam_scan_processing_attempts_upload_attempt_unique"
  ON "exam_scan_processing_attempts" USING btree ("upload_id", "attempt_number");
CREATE INDEX "exam_scan_processing_attempts_upload_status_idx"
  ON "exam_scan_processing_attempts" USING btree ("upload_id", "status");
