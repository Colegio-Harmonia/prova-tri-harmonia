CREATE TABLE IF NOT EXISTS "jev_decisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "operation" text NOT NULL,
  "question_version" text NOT NULL,
  "model" text NOT NULL,
  "state_hash" text NOT NULL,
  "cache_key" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL,
  "route" text NOT NULL,
  "outcome" text NOT NULL,
  "context" jsonb,
  "answers" jsonb,
  "duration_ms" integer,
  "error_code" text,
  "cache_expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "jev_decisions_cache_idx"
  ON "jev_decisions" ("cache_key", "status", "cache_expires_at");
CREATE INDEX IF NOT EXISTS "jev_decisions_operation_created_at_idx"
  ON "jev_decisions" ("operation", "created_at");
CREATE INDEX IF NOT EXISTS "jev_decisions_route_created_at_idx"
  ON "jev_decisions" ("route", "created_at");
