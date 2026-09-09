-- Guarda o formulário que recebe as respostas da Atividade. Dados de
-- rubricas legadas permanecem intactos e novas publicações deixam rubric_id nulo.
ALTER TABLE "activity_classroom_syncs"
  ADD COLUMN IF NOT EXISTS "form_id" text;
