-- Prova de recuperação pelo fluxo da prova formal (18/11/2026). O lote ganha
-- a Composição (origem acervo/IA, total 10-30 e proporção de alternativas,
-- como na tela Gerar prova) e cada aluno uma Matriz por capítulo
-- (content_plan, mesmo formato de CurriculumPlanItem), revisada na
-- Conferência antes de gerar. Novo estado do aluno: 'planejado' (matriz
-- pronta, ainda não enviada para a fila). Aditiva; os valores atuais de
-- question_count (até 20) cabem na faixa nova.
--
-- Aplicar:
--   cat drizzle/0059_recovery_composition.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri
-- Reverter:
--   ALTER TABLE "recovery_students" DROP CONSTRAINT IF EXISTS "recovery_students_status_check", DROP COLUMN IF EXISTS "content_plan";
--   ALTER TABLE "recovery_students" ADD CONSTRAINT "recovery_students_status_check" CHECK ("status" IN ('gerando', 'gerada', 'sem_habilidades', 'removido'));
--   ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_question_source_check", DROP CONSTRAINT IF EXISTS "recovery_rounds_objective_percentage_check", DROP COLUMN IF EXISTS "question_source", DROP COLUMN IF EXISTS "objective_percentage";
--   (rodar antes: UPDATE "recovery_students" SET "status" = 'sem_habilidades' WHERE "status" = 'planejado';)

ALTER TABLE "recovery_rounds" ADD COLUMN IF NOT EXISTS "question_source" text NOT NULL DEFAULT 'acervo';
ALTER TABLE "recovery_rounds" ADD COLUMN IF NOT EXISTS "objective_percentage" integer NOT NULL DEFAULT 70;
ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_question_source_check";
ALTER TABLE "recovery_rounds" ADD CONSTRAINT "recovery_rounds_question_source_check" CHECK ("question_source" IN ('acervo', 'ia'));
ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_objective_percentage_check";
ALTER TABLE "recovery_rounds" ADD CONSTRAINT "recovery_rounds_objective_percentage_check" CHECK ("objective_percentage" BETWEEN 0 AND 100);
ALTER TABLE "recovery_rounds" DROP CONSTRAINT IF EXISTS "recovery_rounds_question_count_check";
ALTER TABLE "recovery_rounds" ADD CONSTRAINT "recovery_rounds_question_count_check" CHECK ("question_count" BETWEEN 3 AND 30);

ALTER TABLE "recovery_students" ADD COLUMN IF NOT EXISTS "content_plan" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "recovery_students" DROP CONSTRAINT IF EXISTS "recovery_students_status_check";
ALTER TABLE "recovery_students" ADD CONSTRAINT "recovery_students_status_check" CHECK ("status" IN ('planejado', 'gerando', 'gerada', 'sem_habilidades', 'removido'));
