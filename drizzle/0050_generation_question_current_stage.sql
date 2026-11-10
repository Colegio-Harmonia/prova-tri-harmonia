ALTER TABLE generation_job_items
  ADD COLUMN IF NOT EXISTS current_stage text;
