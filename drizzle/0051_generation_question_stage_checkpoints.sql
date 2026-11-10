ALTER TABLE generation_job_items
  ADD COLUMN IF NOT EXISTS stage_checkpoints jsonb NOT NULL DEFAULT '{}'::jsonb;
