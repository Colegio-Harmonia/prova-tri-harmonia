CREATE TABLE IF NOT EXISTS ai_budget_resets (
  id serial PRIMARY KEY,
  purpose text,
  reset_by integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_budget_resets_purpose_created_at_idx ON ai_budget_resets (purpose, created_at);
