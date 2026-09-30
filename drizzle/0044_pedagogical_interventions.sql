CREATE TABLE IF NOT EXISTS "pedagogical_interventions" (
  "id" serial PRIMARY KEY NOT NULL,
  "segment" text NOT NULL,
  "grade_year" integer NOT NULL,
  "subject" text NOT NULL,
  "academic_year" integer,
  "action" text NOT NULL,
  "owner_name" text NOT NULL,
  "due_date" text,
  "status" text DEFAULT 'planejada' NOT NULL,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pedagogical_interventions_scope_idx" ON "pedagogical_interventions" ("academic_year", "segment", "grade_year", "subject");
CREATE INDEX IF NOT EXISTS "pedagogical_interventions_status_idx" ON "pedagogical_interventions" ("status", "due_date");
