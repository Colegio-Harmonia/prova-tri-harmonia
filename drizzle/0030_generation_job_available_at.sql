-- Jobs bloqueados apenas por cota ficam pendentes até a próxima janela, sem
-- gastar tentativa nem exigir ação manual do professor.
ALTER TABLE "generation_jobs" ADD COLUMN IF NOT EXISTS "available_at" timestamp;
CREATE INDEX IF NOT EXISTS "generation_jobs_available_at_idx"
  ON "generation_jobs" ("status", "available_at", "priority", "id")
  WHERE "status" = 'pendente';
