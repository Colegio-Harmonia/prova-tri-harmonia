-- Criptografia de dados pessoais de aluno (LGPD) — etapa de ESTRUTURA.
-- Aditiva e reversível: só cria colunas e índices; não altera nem apaga dado.
-- Pode ser aplicada antes da publicação do código (a versão anterior ignora
-- as colunas novas). A conversão dos valores para cifra é feita depois, por
-- `npm run encrypt-student-data` (ver docs/CRIPTOGRAFIA_DADOS_ALUNO.md).
--
-- `*_hash` = índice cego para localizar o aluno e garantir unicidade quando a
-- coluna de texto estiver cifrada. Aqui nasce como SHA-256 simples do valor,
-- o mesmo que a aplicação calcula enquanto não há chave configurada; a
-- conversão troca por HMAC com a chave.

ALTER TABLE activity_classroom_results ADD COLUMN IF NOT EXISTS classroom_student_hash text;
ALTER TABLE exam_corrections ADD COLUMN IF NOT EXISTS classroom_student_hash text;
ALTER TABLE exam_corrections ADD COLUMN IF NOT EXISTS student_name_hash text;
ALTER TABLE exam_sheet_assignments ADD COLUMN IF NOT EXISTS classroom_student_hash text;

UPDATE activity_classroom_results
   SET classroom_student_hash = encode(sha256(convert_to(classroom_student_id, 'UTF8')), 'hex')
 WHERE classroom_student_hash IS NULL AND classroom_student_id NOT LIKE 'enc:v1:%';

UPDATE exam_corrections
   SET classroom_student_hash = encode(sha256(convert_to(classroom_student_id, 'UTF8')), 'hex')
 WHERE classroom_student_hash IS NULL AND classroom_student_id IS NOT NULL AND classroom_student_id NOT LIKE 'enc:v1:%';

UPDATE exam_corrections
   SET student_name_hash = encode(sha256(convert_to(student_name, 'UTF8')), 'hex')
 WHERE student_name_hash IS NULL AND student_name NOT LIKE 'enc:v1:%';

UPDATE exam_sheet_assignments
   SET classroom_student_hash = encode(sha256(convert_to(classroom_student_id, 'UTF8')), 'hex')
 WHERE classroom_student_hash IS NULL AND classroom_student_id NOT LIKE 'enc:v1:%';

CREATE UNIQUE INDEX IF NOT EXISTS activity_classroom_results_exam_student_hash_unique
  ON activity_classroom_results (exam_id, classroom_student_hash);
CREATE UNIQUE INDEX IF NOT EXISTS exam_sheet_assignments_active_student_hash_unique
  ON exam_sheet_assignments (exam_id, classroom_student_hash) WHERE status IN ('pronta', 'emitida');
CREATE INDEX IF NOT EXISTS exam_corrections_student_hash_idx ON exam_corrections (classroom_student_hash);
CREATE INDEX IF NOT EXISTS exam_corrections_student_name_hash_idx ON exam_corrections (student_name_hash);

-- Reversão (só estrutura; não desfaz a conversão para cifra):
--   DROP INDEX IF EXISTS activity_classroom_results_exam_student_hash_unique,
--     exam_sheet_assignments_active_student_hash_unique,
--     exam_corrections_student_hash_idx, exam_corrections_student_name_hash_idx;
--   ALTER TABLE activity_classroom_results DROP COLUMN IF EXISTS classroom_student_hash;
--   ALTER TABLE exam_corrections DROP COLUMN IF EXISTS classroom_student_hash, DROP COLUMN IF EXISTS student_name_hash;
--   ALTER TABLE exam_sheet_assignments DROP COLUMN IF EXISTS classroom_student_hash;
