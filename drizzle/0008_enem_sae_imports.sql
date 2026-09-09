CREATE TABLE IF NOT EXISTS "enem_sae_imports" (
  "id" serial PRIMARY KEY NOT NULL,
  "academic_year" integer NOT NULL,
  "grade_year" smallint DEFAULT 3 NOT NULL,
  "bimester" smallint NOT NULL,
  "analysis" jsonb NOT NULL,
  "imported_by" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enem_sae_imports" ADD CONSTRAINT "enem_sae_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enem_sae_imports_period_unique" ON "enem_sae_imports" ("academic_year", "grade_year", "bimester");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enem_sae_imports_academic_year_idx" ON "enem_sae_imports" ("academic_year");

-- Rollback manual: DROP TABLE IF EXISTS "enem_sae_imports";
