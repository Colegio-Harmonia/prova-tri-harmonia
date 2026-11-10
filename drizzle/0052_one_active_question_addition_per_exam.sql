-- Impede que cliques repetidos ou duas abas gerem questões concorrentes
-- para a mesma prova e sobrescrevam alterações feitas durante a geração.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_one_active_question_addition_per_exam_idx
  ON generation_jobs ((payload ->> 'examId'))
  WHERE job_type = 'adicionar_questao'
    AND status IN ('pendente', 'gerando');
