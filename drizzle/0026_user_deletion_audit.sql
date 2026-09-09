-- Preserva o histórico administrativo quando uma conta sem uso pedagógico é
-- excluída. O evento mantém os dados em previous_value e perde apenas a FK do
-- usuário, que deixa de existir.
ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_fkey";

ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_users_id_fk";

ALTER TABLE "administrative_audit"
  ADD CONSTRAINT "administrative_audit_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
