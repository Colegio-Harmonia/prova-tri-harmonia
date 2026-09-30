-- A fila de OCR é consultada por tipo/status e o painel consulta jobs por prova.
-- Índices parciais evitam carregar jobs de geração que não participam do scan.
CREATE INDEX IF NOT EXISTS generation_jobs_scan_transcription_poll_idx
  ON generation_jobs (status, priority, id)
  WHERE job_type = 'transcrever_scan';

CREATE INDEX IF NOT EXISTS generation_jobs_scan_transcription_exam_status_idx
  ON generation_jobs ((payload ->> 'examId'), status, id)
  WHERE job_type = 'transcrever_scan';

