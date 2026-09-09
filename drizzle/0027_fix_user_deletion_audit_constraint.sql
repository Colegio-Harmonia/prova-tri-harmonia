-- Reparo para ambientes que já executaram a migração 0026 com o nome de
-- constraint gerado pelo banco legado. É seguro também em banco novo.
ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_fkey";

ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_users_id_fk";

ALTER TABLE "administrative_audit"
  ADD CONSTRAINT "administrative_audit_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
