-- Fluxo formal simplificado, preservando registros e artefatos existentes.
UPDATE generated_exams
SET status = 'em_revisao'
WHERE exam_kind = 'prova' AND status IN ('em_andamento', 'revisao_concluida');
