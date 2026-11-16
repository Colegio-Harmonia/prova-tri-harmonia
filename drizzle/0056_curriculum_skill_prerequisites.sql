-- Pré-requisitos curriculares entre habilidades BNCC ("A é base para B").
-- A IA sugere escolhendo só entre códigos já planejados antes; a coordenação
-- aprova ou rejeita. Só os aprovados entram na Teia do aluno.
-- Aditiva: tabela nova, nenhuma linha existente muda. (0055 está reservada
-- para a criptografia de dados de aluno, PR #65.)
CREATE TABLE IF NOT EXISTS "curriculum_skill_prerequisites" (
  "id" serial PRIMARY KEY,
  "subject" text NOT NULL,
  "prerequisite_code" text NOT NULL,
  "prerequisite_segment" text NOT NULL,
  "prerequisite_grade_year" integer NOT NULL,
  "skill_code" text NOT NULL,
  "skill_segment" text NOT NULL,
  "skill_grade_year" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'sugerida',
  "source" text NOT NULL,
  "strength" text NOT NULL,
  "rationale" text NOT NULL,
  "suggested_by" integer REFERENCES "users"("id"),
  "suggested_at" timestamp NOT NULL DEFAULT now(),
  "reviewed_by" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "review_note" text,
  CONSTRAINT "curriculum_skill_prerequisites_status_check" CHECK ("status" IN ('sugerida', 'aprovada', 'rejeitada')),
  CONSTRAINT "curriculum_skill_prerequisites_source_check" CHECK ("source" IN ('ia', 'coordenacao')),
  CONSTRAINT "curriculum_skill_prerequisites_strength_check" CHECK ("strength" IN ('essencial', 'importante', 'apoio')),
  CONSTRAINT "curriculum_skill_prerequisites_not_self" CHECK ("prerequisite_code" <> "skill_code")
);

-- Um par por linha: uma rejeição não volta como sugestão nova.
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_skill_prerequisites_pair_unique" ON "curriculum_skill_prerequisites" ("prerequisite_code", "skill_code");
CREATE INDEX IF NOT EXISTS "curriculum_skill_prerequisites_skill_idx" ON "curriculum_skill_prerequisites" ("skill_code");
CREATE INDEX IF NOT EXISTS "curriculum_skill_prerequisites_status_idx" ON "curriculum_skill_prerequisites" ("status");
