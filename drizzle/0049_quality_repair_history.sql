ALTER TABLE generation_job_items
  ADD COLUMN IF NOT EXISTS quality_repair_history jsonb NOT NULL DEFAULT '[]'::jsonb;
