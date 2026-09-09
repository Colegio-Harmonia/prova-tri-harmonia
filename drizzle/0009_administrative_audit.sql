CREATE TABLE IF NOT EXISTS "administrative_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "action" text NOT NULL,
  "actor_id" integer NOT NULL REFERENCES "users"("id"),
  "target_user_id" integer REFERENCES "users"("id"),
  "previous_value" jsonb,
  "next_value" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "administrative_audit_created_at_idx" ON "administrative_audit" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "administrative_audit_target_user_idx" ON "administrative_audit" ("target_user_id");
