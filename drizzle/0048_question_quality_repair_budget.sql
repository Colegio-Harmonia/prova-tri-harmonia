ALTER TABLE generation_job_items
  ADD COLUMN IF NOT EXISTS quality_repair_attempts integer NOT NULL DEFAULT 0;
