CREATE TABLE generation_job_items (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  question_payload JSONB,
  issues JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL,
  UNIQUE(job_id, slot_number)
);

CREATE INDEX generation_job_items_job_status_idx ON generation_job_items(job_id, status);
