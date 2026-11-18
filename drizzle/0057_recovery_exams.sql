-- Prova de recuperação individualizada (18/11/2026).
-- Um lote por turma do Classroom + disciplina + período (bimestre ou ano
-- todo, bimester NULL). O professor marca alunos; cada aluno ganha uma prova
-- própria (generated_exams.exam_kind = 'recuperacao') gerada a partir das
-- habilidades BNCC em que ficou abaixo de 60% de aproveitamento.
-- Aditiva: duas tabelas novas, nenhuma linha existente muda. exam_kind é
-- text sem CHECK, então o valor novo 'recuperacao' não precisa de ALTER.
-- (0055 continua reservada para a criptografia de dados de aluno, PR #65.)
--
-- Aplicar:
--   cat drizzle/0057_recovery_exams.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri
-- Reverter:
--   DROP TABLE IF EXISTS "recovery_students"; DROP TABLE IF EXISTS "recovery_rounds";

CREATE TABLE IF NOT EXISTS "recovery_rounds" (
  "id" serial PRIMARY KEY,
  "classroom_course_id" text NOT NULL,
  "class_label" text NOT NULL,
  "academic_year" integer NOT NULL,
  "segment" text NOT NULL,
  "grade_year" integer NOT NULL,
  "subject" text NOT NULL,
  "bimester" integer,
  "question_count" integer NOT NULL DEFAULT 10,
  "status" text NOT NULL DEFAULT 'aberto',
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "submitted_by" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "approved_by" integer REFERENCES "users"("id"),
  "approved_at" timestamp,
  "printed_by" integer REFERENCES "users"("id"),
  "printed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "recovery_rounds_status_check" CHECK ("status" IN ('aberto', 'em_aprovacao', 'aprovado', 'impresso')),
  CONSTRAINT "recovery_rounds_bimester_check" CHECK ("bimester" IS NULL OR "bimester" BETWEEN 1 AND 4),
  CONSTRAINT "recovery_rounds_question_count_check" CHECK ("question_count" BETWEEN 3 AND 20)
);

-- Um lote por turma/disciplina/período; NULLS NOT DISTINCT trata "ano todo"
-- (bimester NULL) como um valor só (Postgres 15+, produção é 16).
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_rounds_scope_unique"
  ON "recovery_rounds" ("classroom_course_id", "academic_year", "subject", "bimester") NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS "recovery_rounds_status_idx" ON "recovery_rounds" ("status");

CREATE TABLE IF NOT EXISTS "recovery_students" (
  "id" serial PRIMARY KEY,
  "round_id" integer NOT NULL REFERENCES "recovery_rounds"("id") ON DELETE CASCADE,
  "classroom_student_id" text NOT NULL,
  "student_name" text NOT NULL,
  "student_email" text,
  "status" text NOT NULL DEFAULT 'gerando',
  "weak_skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "insufficient_skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bncc_plan" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "exam_id" integer REFERENCES "generated_exams"("id"),
  "job_id" integer REFERENCES "generation_jobs"("id"),
  "flagged_by" integer NOT NULL REFERENCES "users"("id"),
  "flagged_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "recovery_students_status_check" CHECK ("status" IN ('gerando', 'gerada', 'sem_habilidades', 'removido'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_students_round_student_unique" ON "recovery_students" ("round_id", "classroom_student_id");
CREATE INDEX IF NOT EXISTS "recovery_students_exam_idx" ON "recovery_students" ("exam_id");
CREATE INDEX IF NOT EXISTS "recovery_students_job_idx" ON "recovery_students" ("job_id");
