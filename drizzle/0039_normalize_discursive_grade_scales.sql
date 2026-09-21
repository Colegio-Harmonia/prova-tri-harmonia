-- Normaliza somente respostas descritivas já fora do intervalo permitido.
-- O contrato histórico do modelo era 0–10; logo, quando a nota automática
-- coincide com a nota final acima do máximo, ela é convertida proporcionalmente.
WITH expanded AS (
  SELECT c.id, c.exam_id, c.created_by, a.ordinality, a.value AS answer,
    COALESCE(CASE WHEN a.value->>'weight' ~ '^[0-9]+([.][0-9]+)?$' AND (a.value->>'weight')::numeric > 0 THEN (a.value->>'weight')::numeric END,
      CASE WHEN q.value->>'weight' ~ '^[0-9]+([.][0-9]+)?$' AND (q.value->>'weight')::numeric > 0 THEN (q.value->>'weight')::numeric END, 1::numeric) AS max_grade,
    CASE WHEN a.value->>'aiSuggestedGrade' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (a.value->>'aiSuggestedGrade')::numeric END AS ai_grade,
    CASE WHEN a.value->>'finalGrade' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (a.value->>'finalGrade')::numeric END AS final_grade
  FROM exam_corrections c JOIN generated_exams e ON e.id = c.exam_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.answers) = 'array' THEN c.answers ELSE '[]'::jsonb END) WITH ORDINALITY a(value, ordinality)
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.generation_payload->'questions') = 'array' THEN e.generation_payload->'questions' ELSE '[]'::jsonb END) value WHERE value->>'number' = a.value->>'questionNumber' LIMIT 1) q ON true
), rebuilt AS (
  SELECT id, exam_id, created_by, jsonb_agg(CASE
    WHEN answer->>'type' = 'descritiva' AND (COALESCE(ai_grade, 0) > max_grade OR COALESCE(final_grade, 0) > max_grade) THEN
      answer || jsonb_build_object('weight', max_grade)
      || CASE WHEN ai_grade > max_grade THEN jsonb_build_object('aiSuggestedRawGrade', ai_grade, 'aiSuggestedGradeScale', '0-10', 'aiSuggestedGrade', round(GREATEST(0, LEAST(max_grade, ai_grade / 10 * max_grade)), 2)) ELSE '{}'::jsonb END
      || CASE WHEN final_grade > max_grade THEN jsonb_build_object('finalGrade', CASE WHEN ai_grade > max_grade AND final_grade = ai_grade THEN round(GREATEST(0, LEAST(max_grade, final_grade / 10 * max_grade)), 2) ELSE max_grade END) ELSE '{}'::jsonb END
    ELSE answer END ORDER BY ordinality) AS answers
  FROM expanded GROUP BY id, exam_id, created_by
), updated AS (
  UPDATE exam_corrections c SET answers = rebuilt.answers, score_result = NULL, updated_at = now()
  FROM rebuilt WHERE c.id = rebuilt.id AND c.answers IS DISTINCT FROM rebuilt.answers
  RETURNING c.exam_id, c.created_by
), enqueued AS (
  INSERT INTO generation_jobs (job_type, payload, requested_by, priority)
  SELECT 'pontuar_prova', jsonb_build_object('examId', exam_id), min(created_by), 3 FROM updated GROUP BY exam_id
  RETURNING id
)
SELECT (SELECT count(*) FROM updated) AS repaired_corrections, (SELECT count(*) FROM enqueued) AS rescoring_jobs;
