-- Módulo 3 da Expansão do Sistema de Avaliação e Aprendizagem
-- (docs/SPEC_EXPANSAO_AVALIACAO_APRENDIZAGEM.md, seção 3.2).
-- Uma atividade de reforço ENEM É um generated_exams com
-- exam_kind='reforco_enem' — herda de graça revisão/aprovação, geração
-- de documentos, autorização, pasta no Drive e /status.
--
-- Aplicar manualmente (drizzle-kit generate/migrate segue quebrado):
--   cat drizzle/0017_exam_kind.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri

ALTER TABLE "generated_exams"
  ADD COLUMN IF NOT EXISTS "exam_kind" text NOT NULL DEFAULT 'prova';
