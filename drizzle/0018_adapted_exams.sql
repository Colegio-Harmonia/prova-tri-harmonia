-- Módulo 4 da Expansão do Sistema de Avaliação e Aprendizagem
-- (docs/SPEC_EXPANSAO_AVALIACAO_APRENDIZAGEM.md, seção 4.2).
-- Prova Adaptada (Educação Inclusiva): versão DERIVADA de uma prova
-- aprovada — a original fica intocada. Perfis de laudo e versões das
-- bibliotecas aplicadas ficam gravados pra auditoria.
--
-- LGPD: laudo é dado pessoal sensível (saúde). target_student_label é
-- opcional e NUNCA vai pro documento impresso — o cabeçalho do doc só
-- indica os perfis/bibliotecas (decisão confirmada 24/07/2026).
--
-- Aplicar manualmente (drizzle-kit generate/migrate segue quebrado):
--   cat drizzle/0018_adapted_exams.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri

CREATE TABLE IF NOT EXISTS "adapted_exams" (
  "id" serial PRIMARY KEY,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id"),
  "adaptation_profiles" text[] NOT NULL,
  "library_versions" jsonb NOT NULL,
  "target_student_label" text,
  "adapted_payload" jsonb,
  "status" text NOT NULL DEFAULT 'gerando',
  -- 'gerando' | 'pronto_revisao' | 'aprovado' | 'erro'
  "validation_report" jsonb,
  "error_message" text,
  "prova_adaptada_doc_id" text,
  "prova_adaptada_doc_url" text,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "approved_by" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "approved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "adapted_exams_exam_idx" ON "adapted_exams" ("exam_id");
