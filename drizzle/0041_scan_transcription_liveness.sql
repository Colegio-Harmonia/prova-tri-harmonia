-- Mantém a identidade detectada pelo QR separada da associação oficial da
-- página. Uma folha de outra prova pode ser encaminhada, mas nunca pode
-- participar da correção da prova que recebeu o upload.
ALTER TABLE exam_scan_pages
  ADD COLUMN IF NOT EXISTS detected_sheet_assignment_id integer
  REFERENCES exam_sheet_assignments(id);

CREATE INDEX IF NOT EXISTS exam_scan_pages_detected_assignment_idx
  ON exam_scan_pages (detected_sheet_assignment_id);

-- Backfill seguro: preserva o assignment detectado e remove apenas o vínculo
-- inválido entre upload e correção de provas diferentes.
UPDATE exam_scan_pages page
SET detected_sheet_assignment_id = page.sheet_assignment_id,
    sheet_assignment_id = NULL
FROM exam_scan_uploads upload,
     exam_sheet_assignments assignment
WHERE page.upload_id = upload.id
  AND page.sheet_assignment_id = assignment.id
  AND upload.exam_id <> assignment.exam_id
  AND page.detected_sheet_assignment_id IS NULL;

CREATE OR REPLACE FUNCTION enforce_exam_scan_page_assignment_exam()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  upload_exam_id integer;
  assignment_exam_id integer;
BEGIN
  IF NEW.sheet_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT exam_id INTO upload_exam_id
  FROM exam_scan_uploads
  WHERE id = NEW.upload_id;

  SELECT exam_id INTO assignment_exam_id
  FROM exam_sheet_assignments
  WHERE id = NEW.sheet_assignment_id;

  IF upload_exam_id IS NULL OR assignment_exam_id IS NULL OR upload_exam_id <> assignment_exam_id THEN
    RAISE EXCEPTION 'exam_scan_pages: associação da página pertence a outra prova (upload %, assignment %)', NEW.upload_id, NEW.sheet_assignment_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_scan_pages_assignment_exam_guard ON exam_scan_pages;
CREATE CONSTRAINT TRIGGER exam_scan_pages_assignment_exam_guard
AFTER INSERT OR UPDATE OF upload_id, sheet_assignment_id ON exam_scan_pages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_exam_scan_page_assignment_exam();

-- Uma página só pode ter um lote de transcrição aguardando ou executando.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_scan_transcription_active_page_unique
  ON generation_jobs ((payload ->> 'examId'), (payload ->> 'pageId'))
  WHERE job_type = 'transcrever_scan' AND status IN ('pendente', 'gerando');

CREATE INDEX IF NOT EXISTS generation_jobs_scan_transcription_page_status_idx
  ON generation_jobs ((payload ->> 'pageId'), status, id)
  WHERE job_type = 'transcrever_scan';
