-- Subtarefa 2 da Expansão do Sistema de Avaliação e Aprendizagem
-- (docs/SPEC_EXPANSAO_AVALIACAO_APRENDIZAGEM.md, seções 1.2, 1.5 e 1.4).
-- Motor de pontuação: Percentual (0-100%) × TRI INEP (0-1000, somente
-- provas/atividades com itens reais ENEM e parâmetros oficiais).
--
-- Aplicar manualmente (drizzle-kit generate/migrate segue quebrado):
--   cat drizzle/0016_scoring_engine.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri

-- Rótulo pedagógico da avaliação, escolhido na geração e imutável após
-- aprovação. scoring_method é definido pela origem das questões (itens
-- objetivos enem_bank ativam TRI) e materializado pra consulta barata.
ALTER TABLE "generated_exams"
  ADD COLUMN IF NOT EXISTS "assessment_kind" text NOT NULL DEFAULT 'padrao',
  ADD COLUMN IF NOT EXISTS "scoring_method" text NOT NULL DEFAULT 'percentual';

-- Resultado da pontuação por aluno, gravado pelo job 'pontuar_prova'
-- (worker) quando a correção fica 'revisado' — nunca recalculado na
-- leitura. Shape documentado em src/lib/scoring/scoringPolicy.ts.
ALTER TABLE "exam_corrections"
  ADD COLUMN IF NOT EXISTS "score_result" jsonb;

-- Parâmetros TRI oficiais por item do banco ENEM (modelo 3PL), capturados
-- dos microdados do INEP (scripts/import-tri-params.ts). Sempre armazenados
-- na métrica N(0,1); NUNCA preenchidos por
-- estimativa própria — item sem calibração oficial fica NULL e fora do
-- cálculo TRI (regra de honestidade da seção 1.4 da spec).
ALTER TABLE "imported_questions"
  ADD COLUMN IF NOT EXISTS "tri_param_a" real,
  ADD COLUMN IF NOT EXISTS "tri_param_b" real,
  ADD COLUMN IF NOT EXISTS "tri_param_c" real,
  ADD COLUMN IF NOT EXISTS "tri_param_source" text;
