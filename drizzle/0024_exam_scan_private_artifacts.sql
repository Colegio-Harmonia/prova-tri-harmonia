-- Derivados visuais produzidos pelo worker: página já normalizada e recorte
-- de resposta. Só são referências opacas ao Drive privado; nenhum URL público
-- ou conteúdo binário é registrado no banco.
ALTER TABLE "exam_scan_pages"
  ADD COLUMN "canonical_drive_file_id" text,
  ADD COLUMN "canonical_verified_sha256" text,
  ADD COLUMN "canonical_mime_type" text,
  ADD COLUMN "canonical_staging_object_key" text,
  ADD COLUMN "canonical_archived_at" timestamp,
  ADD COLUMN "canonical_archive_error_code" text;

ALTER TABLE "exam_scan_readings"
  ADD COLUMN "crop_drive_file_id" text,
  ADD COLUMN "crop_verified_sha256" text,
  ADD COLUMN "crop_mime_type" text,
  ADD COLUMN "crop_staging_object_key" text,
  ADD COLUMN "crop_archived_at" timestamp,
  ADD COLUMN "crop_archive_error_code" text;

CREATE UNIQUE INDEX "exam_scan_pages_canonical_drive_file_unique"
  ON "exam_scan_pages" USING btree ("canonical_drive_file_id");
CREATE UNIQUE INDEX "exam_scan_readings_crop_drive_file_unique"
  ON "exam_scan_readings" USING btree ("crop_drive_file_id");
