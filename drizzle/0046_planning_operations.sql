-- Bloco 8 — operação institucional: intervenções ligadas a habilidades e
-- histórico de decisões pedagógicas. Aditiva: não altera dado existente.
ALTER TABLE "pedagogical_interventions" ADD COLUMN IF NOT EXISTS "skill_codes" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "pedagogical_interventions" ADD COLUMN IF NOT EXISTS "bimester" smallint;
DO $$ BEGIN
  ALTER TABLE "pedagogical_interventions" ADD CONSTRAINT "pedagogical_interventions_bimester_check" CHECK (bimester IS NULL OR bimester BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pedagogical_decision_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL CHECK (entity_type IN ('plano','versao','intervencao')),
  "entity_id" integer NOT NULL,
  "plan_id" integer REFERENCES "curriculum_plans"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "summary" text NOT NULL,
  "details" jsonb,
  "actor_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pedagogical_decision_log_entity_idx" ON "pedagogical_decision_log" ("entity_type","entity_id","created_at");
CREATE INDEX IF NOT EXISTS "pedagogical_decision_log_plan_idx" ON "pedagogical_decision_log" ("plan_id","created_at");
CREATE INDEX IF NOT EXISTS "pedagogical_decision_log_created_idx" ON "pedagogical_decision_log" ("created_at");
