CREATE TABLE IF NOT EXISTS application_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);
