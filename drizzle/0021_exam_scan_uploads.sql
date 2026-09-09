-- Ingestão privada do arquivo bruto de scanner. Não cria permissões públicas
-- no Drive; as páginas/leituras serão adicionadas em migrations posteriores.
CREATE TABLE "exam_scan_uploads" (
  "id" serial PRIMARY KEY NOT NULL,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id"),
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "staging_object_key" text,
  "status" text DEFAULT 'staged' NOT NULL,
  "drive_file_id" text,
  "drive_verified_sha256" text,
  "archived_at" timestamp,
  "archive_error_code" text,
  "technical_metadata" jsonb,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX "exam_scan_uploads_drive_file_unique"
  ON "exam_scan_uploads" USING btree ("drive_file_id");
CREATE INDEX "exam_scan_uploads_sha256_idx"
  ON "exam_scan_uploads" USING btree ("sha256");
CREATE INDEX "exam_scan_uploads_exam_status_idx"
  ON "exam_scan_uploads" USING btree ("exam_id", "status");

CREATE TABLE "exam_scan_audit_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id"),
  "upload_id" integer REFERENCES "exam_scan_uploads"("id"),
  "action" text NOT NULL,
  "actor_id" integer REFERENCES "users"("id"),
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "exam_scan_audit_events_upload_created_at_idx"
  ON "exam_scan_audit_events" USING btree ("upload_id", "created_at");
CREATE INDEX "exam_scan_audit_events_exam_created_at_idx"
  ON "exam_scan_audit_events" USING btree ("exam_id", "created_at");
