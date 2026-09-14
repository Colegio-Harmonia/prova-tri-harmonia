-- Subtarefa 1a da Expansão do Sistema de Avaliação e Aprendizagem
-- (docs/SPEC_EXPANSAO_AVALIACAO_APRENDIZAGEM.md, seção 2.2).
-- Fila de geração assíncrona em Postgres puro (FOR UPDATE SKIP LOCKED),
-- consumida pelo serviço Docker `worker`.
--
-- Aplicar manualmente (drizzle-kit generate/migrate segue quebrado):
--   cat drizzle/0015_generation_queue.sql | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri

CREATE TABLE IF NOT EXISTS "generation_batches" (
  "id" serial PRIMARY KEY,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "segment" text NOT NULL,
  "grade_year" integer NOT NULL,
  "academic_year" integer NOT NULL,
  "class_label" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "generation_jobs" (
  "id" serial PRIMARY KEY,
  "batch_id" integer REFERENCES "generation_batches"("id"),
  "job_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pendente',
  "priority" integer NOT NULL DEFAULT 5,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 2,
  "result_exam_id" integer REFERENCES "generated_exams"("id"),
  "result_ref" jsonb,
  "error_message" text,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "finished_at" timestamp
);

-- Índice parcial pro claim do worker: só linhas 'pendente' entram,
-- ordenadas por prioridade e ordem de chegada.
CREATE INDEX IF NOT EXISTS "generation_jobs_poll_idx"
  ON "generation_jobs" ("status", "priority", "id")
  WHERE "status" = 'pendente';

-- Listagem "meus jobs" na aba Histórico e Fila.
CREATE INDEX IF NOT EXISTS "generation_jobs_requester_idx"
  ON "generation_jobs" ("requested_by", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "generation_jobs_batch_idx"
  ON "generation_jobs" ("batch_id");
