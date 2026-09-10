-- Arquivamento passa a ser compartilhado por todos os usuários com acesso à
-- prova. Migra qualquer arquivo individual já existente para o estado global.
ALTER TABLE "generated_exams" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

UPDATE "generated_exams" AS exam
SET "archived_at" = legacy.first_archived_at
FROM (
  SELECT "exam_id", MIN("archived_at") AS first_archived_at
  FROM "exam_user_archives"
  GROUP BY "exam_id"
) AS legacy
WHERE exam."id" = legacy."exam_id" AND exam."archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "generated_exams_archived_at_idx"
  ON "generated_exams" USING btree ("archived_at");
