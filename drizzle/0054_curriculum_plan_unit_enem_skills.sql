-- Ensino Médio: habilidades da Matriz do ENEM planejadas por unidade, no mesmo
-- formato da coluna "Habilidades ENEM" da planilha ("C2:H5 (Unesp-2022)", uma
-- por linha; repetição = peso). Texto livre lido por enemSkillsParser.ts.
-- Aditiva e anulável: nenhuma linha existente muda.
ALTER TABLE "curriculum_plan_units" ADD COLUMN IF NOT EXISTS "enem_skills" text;
