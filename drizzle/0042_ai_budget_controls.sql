CREATE TABLE IF NOT EXISTS ai_budget_controls (
  purpose text PRIMARY KEY,
  disabled boolean NOT NULL DEFAULT false,
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);
