-- Prova de recuperação por semestre (18/11/2026). O colégio é semestral: o
-- lote pode cobrir um bimestre, um semestre (1º = bimestres 1-2, 2º = 3-4) ou
-- o ano todo (bimester e semester NULL). Aditiva: coluna nova e troca do
-- índice único do escopo. Sem lote em produção quando foi escrita.
--
-- Aplicar:
--   cat drizzle/0058_recovery_semester.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri
-- Reverter:
--   DROP INDEX IF EXISTS "recovery_rounds_scope_unique";
--   ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_period_check", DROP COLUMN IF EXISTS "semester";
--   CREATE UNIQUE INDEX "recovery_rounds_scope_unique" ON "recovery_rounds" ("classroom_course_id", "academic_year", "subject", "bimester") NULLS NOT DISTINCT;

ALTER TABLE "recovery_rounds" ADD COLUMN IF NOT EXISTS "semester" integer;
ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_period_check";
ALTER TABLE "recovery_rounds" ADD CONSTRAINT "recovery_rounds_period_check"
  CHECK (("semester" IS NULL OR "semester" IN (1, 2)) AND NOT ("bimester" IS NOT NULL AND "semester" IS NOT NULL));

DROP INDEX IF EXISTS "recovery_rounds_scope_unique";
CREATE UNIQUE INDEX "recovery_rounds_scope_unique"
  ON "recovery_rounds" ("classroom_course_id", "academic_year", "subject", "bimester", "semester") NULLS NOT DISTINCT;
