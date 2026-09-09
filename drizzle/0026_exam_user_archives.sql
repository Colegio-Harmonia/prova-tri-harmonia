-- Arquivamento individual de provas. Não altera o status pedagógico da prova
-- nem exclui dados: só registra que um usuário optou por ocultá-la da própria
-- visão normal.
CREATE TABLE IF NOT EXISTS "exam_user_archives" (
  "id" serial PRIMARY KEY NOT NULL,
  "exam_id" integer NOT NULL REFERENCES "generated_exams"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "archived_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "exam_user_archives_user_exam_unique"
  ON "exam_user_archives" USING btree ("user_id", "exam_id");

CREATE INDEX IF NOT EXISTS "exam_user_archives_user_archived_at_idx"
  ON "exam_user_archives" USING btree ("user_id", "archived_at");
