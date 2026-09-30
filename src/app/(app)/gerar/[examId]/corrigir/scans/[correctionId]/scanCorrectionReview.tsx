"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock3, Minus, Plus, X } from "lucide-react";
import type { CorrectionAnswer } from "@/types/correction";
import type { ExamGenerationResult } from "@/lib/gemini/examSchema";
import { totalGrade } from "@/lib/corrections/totalGrade";
import { missingGradeQuestionNumbers } from "@/lib/corrections/gradeValidation";

type Correction = {
  id: number;
  studentName: string;
  status: "pendente" | "revisado";
  attendanceStatus: "presente" | "ausente";
  gradeReturnedAt: string | null;
  answers: CorrectionAnswer[];
};
type Evidence = {
  questionNumber: number;
  page: {
    id: number;
    sheetPageNumber: number | null;
    imageAvailable: boolean;
  } | null;
  reading: {
    id: number;
    suggestedLetter: string | null;
    confirmedLetter: string | null;
    suggestedTranscription: string | null;
    confirmedTranscription: string | null;
    exceptionCode?: string | null;
    transcriptionActive?: boolean;
    transcriptionJobStatus?: "pendente" | "gerando" | null;
    cropAvailable?: boolean;
    reviewStatus?: "pending" | "accepted" | "rejected";
  } | null;
};
type TranscriptionSummary = {
  total: number;
  completed: number;
  queued: number;
  processing: number;
  deferred: number;
  needsReview: number;
  failed: number;
  active: number;
  canApprove: boolean;
};

export default function ScanCorrectionReview({
  examId,
  correctionId,
}: {
  examId: number;
  correctionId: number;
}) {
  const searchParams = useSearchParams();
  const uploadId = searchParams.get("uploadId");
  const [exam, setExam] = useState<{
    generationPayload: ExamGenerationResult;
  } | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const correctionRef = useRef<Correction | null>(null);
  const dirtyQuestionsRef = useRef<Set<number>>(new Set());
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [transcriptionSummary, setTranscriptionSummary] = useState<TranscriptionSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [readingQuestion, setReadingQuestion] = useState<number | null>(null);
  const [reviewingQuestion, setReviewingQuestion] = useState<number | null>(null);
  const [scanUploadIds, setScanUploadIds] = useState<number[]>([]);
  const [deletingUploadId, setDeletingUploadId] = useState<number | null>(null);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [missingGradeQuestions, setMissingGradeQuestions] = useState<number[]>([]);
  const questionRefs = useRef<Record<number, HTMLElement | null>>({});
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [examResponse, correctionsResponse, evidenceResponse, transcriptionsResponse] =
      await Promise.all([
        fetch(`/api/exams/${examId}`),
        fetch(`/api/exams/${examId}/corrections`),
        fetch(
          `/api/exams/${examId}/corrections/${correctionId}/scan-evidence${uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : ""}`,
        ),
        fetch(`/api/exams/${examId}/scan-transcriptions`),
      ]);
    const [examData, correctionsData, evidenceData, transcriptionsData] = await Promise.all([
      examResponse.json(),
      correctionsResponse.json(),
      evidenceResponse.json(),
      transcriptionsResponse.json(),
    ]);
    if (!examResponse.ok || !correctionsResponse.ok || !evidenceResponse.ok || !transcriptionsResponse.ok)
      throw new Error(
        examData.error ??
          correctionsData.error ??
          evidenceData.error ??
          transcriptionsData.error ??
          "Não foi possível carregar a correção.",
      );
    const current = (correctionsData.corrections as Correction[]).find(
      (item) => item.id === correctionId,
    );
    if (!current) throw new Error("Correção não encontrada.");
    const scanByQuestion = new Map(
      (evidenceData.evidence as Evidence[]).map((item) => [
        item.questionNumber,
        item,
      ]),
    );
    // A leitura é trazida para o rascunho de correção, mas só se torna
    // oficial quando o professor salva/aprova esta página.
    const answersWithScan = current.answers.map((answer) => {
      if (answer.transcribedAnswer.trim()) return answer;
      const reading = scanByQuestion.get(answer.questionNumber)?.reading;
      if (!reading) return answer;
      if (answer.type === "objetiva") {
        const letter = reading.confirmedLetter ?? reading.suggestedLetter;
        if (!letter) return answer;
        const isCorrect = letter === answer.correctLetter;
        const questionWeight =
          examData.exam.generationPayload.questions.find(
            (question: { number: number; weight?: number }) =>
              question.number === answer.questionNumber,
          )?.weight ??
          answer.weight ??
          1;
        return {
          ...answer,
          weight: answer.weight ?? questionWeight,
          transcribedAnswer: letter,
          isCorrect,
          finalGrade: isCorrect ? questionWeight : 0,
        };
      }
      const transcription =
        reading.confirmedTranscription ?? reading.suggestedTranscription;
      return transcription
        ? { ...answer, transcribedAnswer: transcription }
        : answer;
    });
    const previous = correctionRef.current;
    const nextCorrection = {
      ...current,
      answers: answersWithScan.map((answer) => dirtyQuestionsRef.current.has(answer.questionNumber)
        ? previous?.answers.find((item) => item.questionNumber === answer.questionNumber) ?? answer
        : answer),
    };
    setExam(examData.exam);
    correctionRef.current = nextCorrection;
    setCorrection(nextCorrection);
    setEvidence(evidenceData.evidence);
    setScanUploadIds(evidenceData.scanUploadIds ?? []);
    setTranscriptionSummary((transcriptionsData.corrections ?? []).find((item: { correctionId: number }) => item.correctionId === correctionId)?.summary ?? { total: 0, completed: 0, queued: 0, processing: 0, deferred: 0, needsReview: 0, failed: 0, active: 0, canApprove: true });
    setError(null);
  }, [examId, correctionId, uploadId]);
  useEffect(() => {
    const source = new EventSource(`/api/exams/${examId}/scan-events`);
    const refresh = () => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao atualizar a transcrição.")); };
    source.addEventListener("scan-update", refresh);
    const fallback = window.setInterval(() => { refresh(); }, 10_000);
    return () => { source.close(); window.clearInterval(fallback); };
  }, [examId, load]);
  useEffect(() => {
    void load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Erro ao carregar."),
    );
  }, [load]);
  const evidenceByQuestion = useMemo(
    () => new Map(evidence.map((item) => [item.questionNumber, item])),
    [evidence],
  );
  function update(questionNumber: number, patch: Partial<CorrectionAnswer>) {
    dirtyQuestionsRef.current.add(questionNumber);
    setCorrection((current) =>
      current
        ? (() => {
            const next = {
            ...current,
            answers: current.answers.map((answer) =>
              answer.questionNumber === questionNumber
                ? { ...answer, ...patch }
                : answer,
            ),
            };
            correctionRef.current = next;
            return next;
          })()
        : current,
    );
  }
  async function readWithAi(questionNumber: number) {
    setReadingQuestion(questionNumber);
    setError(null);
    try {
      const response = await fetch(
        `/api/exams/${examId}/corrections/${correctionId}/scan-evidence${uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionNumber }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "A IA não conseguiu ler esta resposta.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "A IA não conseguiu ler esta resposta.",
      );
    } finally {
      setReadingQuestion(null);
    }
  }
  async function save(status?: "pendente" | "revisado"): Promise<boolean> {
    if (!correction) return false;
    if (status === "revisado") {
      const missing = missingGradeQuestionNumbers(correction.answers);
      if (missing.length > 0) {
        setMissingGradeQuestions(missing);
        scrollToQuestion(missing[0]);
        return false;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/exams/${examId}/corrections/${correctionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: correction.answers, status }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "grades_missing") {
          const missing = Array.isArray(data.missingQuestionNumbers) ? data.missingQuestionNumbers.filter((value: unknown): value is number => typeof value === "number") : [];
          setMissingGradeQuestions(missing);
          if (missing[0]) scrollToQuestion(missing[0]);
          return false;
        }
        if ((data.code === "ocr_in_progress" || data.code === "ocr_needs_review") && data.transcription) {
          setTranscriptionSummary(data.transcription);
        }
        throw new Error(data.error ?? "Não foi possível salvar.");
      }
      dirtyQuestionsRef.current.clear();
      correctionRef.current = data.correction;
      setCorrection(data.correction);
      if (status === "revisado")
        window.location.assign(`/gerar/${examId}/corrigir`);
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível salvar.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function suggestDiscursiveGrades() {
    setSuggesting(true);
    setError(null);
    try {
      if (!(await save())) return;
      const response = await fetch(
        `/api/exams/${examId}/corrections/${correctionId}/suggest`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "A IA não conseguiu sugerir as notas.");
      correctionRef.current = data.correction;
      setCorrection(data.correction);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "A IA não conseguiu sugerir as notas.",
      );
    } finally {
      setSuggesting(false);
    }
  }
  async function reviewReading(questionNumber: number) {
    const scan = evidenceByQuestion.get(questionNumber);
    const answer = correction?.answers.find((item) => item.questionNumber === questionNumber);
    if (!scan?.reading || !answer) return;
    const transcription = answer.transcribedAnswer.trim();
    setReviewingQuestion(questionNumber);
    setError(null);
    try {
      if (!(await save())) return;
      const response = await fetch(
        `/api/exams/${examId}/scan-readings/${scan.reading.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            transcription
              ? { decision: "accepted", confirmedTranscription: transcription }
              : { decision: "rejected" },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Não foi possível concluir a revisão.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível concluir a revisão.",
      );
    } finally {
      setReviewingQuestion(null);
    }
  }
  async function undoApproval() {
    if (!confirm("Desfazer esta correção? A nota oficial deixará de contar no desempenho e a entrega voltará para pendente.")) return;
    await save("pendente");
  }
  async function updateAttendance(attendanceStatus: "presente" | "ausente") {
    const isAbsent = attendanceStatus === "ausente";
    const prompt = isAbsent
      ? "Marcar este aluno como ausente? A correção não contará no desempenho e nenhuma nota será enviada ao Classroom."
      : "Desfazer a ausência? A correção voltará para pendente e precisará ser revisada novamente.";
    if (!confirm(prompt)) return;
    setAttendanceBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/exams/${examId}/corrections/${correctionId}/attendance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar a presença.");
      window.location.assign(`/gerar/${examId}/corrigir`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a presença.");
    } finally {
      setAttendanceBusy(false);
    }
  }
  async function deleteScan(uploadIdToDelete: number) {
    if (!confirm("Excluir este scan? As respostas lidas, a nota oficial e o desempenho desta entrega serão removidos. A folha emitida continuará disponível para novo scan.")) return;
    setDeletingUploadId(uploadIdToDelete);
    setError(null);
    try {
      const response = await fetch(`/api/exams/${examId}/scans/${uploadIdToDelete}/cancel`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir o scan.");
      window.location.assign(`/gerar/${examId}/corrigir`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir o scan.");
      setDeletingUploadId(null);
    }
  }
  if (error && !correction)
    return <p className="text-sm text-red-700">{error}</p>;
  if (!exam || !correction)
    return (
      <p className="text-sm text-content-secondary">
        Carregando correção…
      </p>
    );
  const questions = exam.generationPayload.questions;
  const isAbsent = correction.attendanceStatus === "ausente";
  const liveTotal = isAbsent ? null : totalGrade(correction.answers);
  const locked = correction.status === "revisado" || isAbsent;
  const transcriptionActive = (transcriptionSummary?.active ?? 0) > 0;
  function scrollToQuestion(questionNumber: number) {
    window.requestAnimationFrame(() => {
      const element = questionRefs.current[questionNumber];
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    });
  }
  function openPreview(src: string, alt: string) {
    setZoom(1);
    setPreview({ src, alt });
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 pb-14 text-content-primary">
      <header>
        <Link
          href={`/gerar/${examId}/corrigir`}
          className="text-sm text-harmonia-green hover:underline"
        >
          ← Correções
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              Correção de {correction.studentName}
            </h1>
            <p className="mt-1 text-sm text-content-secondary">
              Revise a evidência de cada resposta, a leitura automática e a avaliação antes de aprovar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void updateAttendance(isAbsent ? "presente" : "ausente")}
            disabled={attendanceBusy || (!isAbsent && Boolean(correction.gradeReturnedAt))}
            title={!isAbsent && correction.gradeReturnedAt ? "A nota já foi lançada no Classroom." : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${isAbsent ? "border-harmonia-green text-harmonia-green hover:bg-harmonia-green/10" : "border-slate-400 text-slate-700 hover:bg-slate-100"}`}
          >
            <Clock3 size={17} />
            {attendanceBusy ? "Salvando…" : isAbsent ? "Desfazer ausência" : "Marcar como ausente"}
          </button>
        </div>
      </header>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {isAbsent && (
        <section className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-slate-800" role="status">
          <p className="font-semibold">Aluno marcado como ausente</p>
          <p className="mt-1 text-sm">Esta prova não contará no desempenho e nenhuma nota será importada para o Google Classroom. Desfaça a ausência acima para iniciar a correção.</p>
        </section>
      )}
      {transcriptionActive && (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950">
          <p className="font-semibold">Transcrição automática em andamento</p>
          <p className="mt-1 text-sm">{transcriptionSummary?.completed} de {transcriptionSummary?.total} resposta(s) discursiva(s) concluída(s). Você pode salvar a correção, mas aguarde essa etapa antes de aprovar.</p>
        </section>
      )}
      {transcriptionSummary?.needsReview ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">Existe resposta discursiva para revisão manual</p>
          <p className="mt-1 text-sm">Confira o recorte e preencha a resposta antes de aprovar esta correção.</p>
        </section>
      ) : null}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              Nota parcial: {liveTotal === null ? "—" : liveTotal.toFixed(1)} /
              10
            </p>
            <p className="text-sm text-content-secondary">
              {isAbsent ? "A ausência exclui esta prova do desempenho e do lançamento no Classroom." : "A aprovação grava a nota oficial e atualiza desempenho, perfil do aluno e dashboards."}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${isAbsent ? "bg-slate-200 text-slate-700" : correction.status === "revisado" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
          >
            {isAbsent ? "Ausente" : correction.status === "revisado"
              ? "Correção aprovada"
              : "Pendente"}
          </span>
        </div>
        {scanUploadIds.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-content-secondary">Este resultado foi preenchido a partir do scan enviado.</p>
            <div className="flex flex-wrap gap-2">
              {scanUploadIds.map((scanUploadId) => (
                <button key={scanUploadId} type="button" disabled={deletingUploadId !== null} onClick={() => void deleteScan(scanUploadId)} className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
                  {deletingUploadId === scanUploadId ? "Excluindo scan…" : scanUploadIds.length === 1 ? "Excluir scan" : `Excluir scan #${scanUploadId}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || suggesting || locked}
          onClick={() => void suggestDiscursiveGrades()}
          className="rounded border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-800 disabled:opacity-50"
        >
          {suggesting ? "IA avaliando…" : "Sugerir notas das dissertativas"}
        </button>
      </div>
      <section className="space-y-4">
        {questions.map((question) => {
          const answer = correction.answers.find(
            (item) => item.questionNumber === question.number,
          );
          const scan = evidenceByQuestion.get(question.number);
          if (!answer) return null;
          const max = question.weight ?? answer.weight ?? 1;
          const questionTranscribing = question.type === "descritiva" && Boolean(scan?.reading?.transcriptionActive);
          const readingNeedsReview = question.type === "descritiva" && scan?.reading?.reviewStatus === "pending" && !questionTranscribing;
          return (
            <article
              key={question.number}
              ref={(element) => { questionRefs.current[question.number] = element; }}
              tabIndex={-1}
              className={`rounded-xl border bg-surface p-5 transition-shadow ${missingGradeQuestions.includes(question.number) ? "border-red-400 ring-2 ring-red-200" : "border-border"}`}
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <p className="text-sm font-semibold">
                    Questão {question.number} ·{" "}
                    {question.type === "descritiva"
                      ? "Resposta escrita"
                      : "Objetiva"}{" "}
                    · vale {max} ponto(s)
                  </p>
                  {question.supportText && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-content-secondary">
                      {question.supportText}
                    </p>
                  )}
                  <p className="mt-3 whitespace-pre-wrap font-medium">
                    {question.statement}
                  </p>
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                    <p className="font-semibold text-emerald-900">
                      Resposta esperada
                    </p>
                    {question.type === "objetiva" ? (
                      <p className="mt-1">
                        Alternativa correta:{" "}
                        <strong className="rounded bg-emerald-700 px-2 py-0.5 text-white">
                          {answer.correctLetter ?? "—"}
                        </strong>
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 whitespace-pre-wrap">
                          {question.expectedAnswer ||
                            "Sem resposta de referência cadastrada."}
                        </p>
                        {question.gradingCriteria && (
                          <p className="mt-2 border-t border-emerald-200 pt-2">
                            <strong>Critérios:</strong>{" "}
                            {question.gradingCriteria}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {question.type === "objetiva" ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-border bg-surface-raised p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Alternativas e marcação do aluno</p>
                        <div className="mt-2 space-y-2">
                          {(question.alternatives ?? []).map((option) => {
                            const selected = answer.transcribedAnswer === option.letter;
                            const correct = answer.correctLetter === option.letter;
                            return <div key={option.letter} className={`flex gap-2 rounded border px-3 py-2 text-sm ${selected ? "border-sky-400 bg-sky-50" : "border-transparent"} ${correct ? "ring-1 ring-emerald-300" : ""}`}>
                              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-bold ${selected ? "bg-sky-600 text-white" : "bg-neutral-100"}`}>{option.letter}</span>
                              <span className="flex-1">{option.text}</span>
                              {selected && <span className="text-xs font-semibold text-sky-800">marcada</span>}
                              {correct && <span className="text-xs font-semibold text-emerald-800">gabarito</span>}
                            </div>;
                          })}
                        </div>
                      </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-sm">
                        Resposta lida{" "}
                        <select
                          disabled={locked}
                          value={answer.transcribedAnswer}
                          onChange={(event) => {
                            const letter = event.target.value;
                            update(question.number, {
                              transcribedAnswer: letter,
                              isCorrect: letter
                                ? letter === answer.correctLetter
                                : null,
                              finalGrade: letter
                                ? letter === answer.correctLetter
                                  ? max
                                  : 0
                                : null,
                            });
                          }}
                          className="ml-2 rounded border border-border bg-surface px-2 py-1"
                        >
                          <option value="">—</option>
                          {(question.alternatives ?? []).map((option) => (
                            <option key={option.letter} value={option.letter}>
                              {option.letter}
                            </option>
                          ))}
                        </select>
                      </label>
                      {scan?.reading?.suggestedLetter && (
                        <span className="text-xs text-content-secondary">
                          Importado do scan: {scan.reading.suggestedLetter}
                        </span>
                      )}
                    </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {scan?.reading?.cropAvailable && (
                        <figure className="rounded-lg border border-border bg-surface-raised p-3">
                          <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">Recorte da resposta manuscrita</figcaption>
                          <button type="button" onClick={() => openPreview(`/api/exams/${examId}/scan-readings/${scan.reading!.id}/crop`, `Recorte da resposta da questão ${question.number}`)} className="block w-full cursor-zoom-in" aria-label={`Ampliar recorte da questão ${question.number}`}>
                            <Image unoptimized src={`/api/exams/${examId}/scan-readings/${scan.reading.id}/crop`} width={900} height={360} className="max-h-72 w-full rounded object-contain" alt={`Recorte da resposta da questão ${question.number}`} />
                          </button>
                        </figure>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          Resposta do aluno
                        </span>
                        <button
                          type="button"
                          onClick={() => void readWithAi(question.number)}
                          disabled={
                            readingQuestion === question.number ||
                            !scan?.page?.imageAvailable || locked
                          }
                          className="rounded border border-harmonia-green px-3 py-1.5 text-xs font-semibold text-harmonia-green disabled:opacity-50"
                        >
                          {readingQuestion === question.number
                            ? "Lendo com IA…"
                            : "Ler resposta com IA"}
                        </button>
                      </div>
                      {readingNeedsReview && (
                        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                          <p>A leitura automática precisa de revisão manual. Digite/corrija a resposta ou confirme que o aluno não respondeu.</p>
                          <button
                            type="button"
                            onClick={() => void reviewReading(question.number)}
                            disabled={reviewingQuestion === question.number || saving || locked}
                            className="mt-2 rounded border border-amber-700 px-3 py-1.5 font-semibold text-amber-900 disabled:opacity-50"
                          >
                            {reviewingQuestion === question.number
                              ? "Salvando revisão…"
                              : answer.transcribedAnswer.trim()
                                ? "Concluir revisão manual"
                                : "Marcar como sem resposta"}
                          </button>
                        </div>
                      )}
                      {questionTranscribing && <p className="rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">Esta resposta está sendo transcrita automaticamente. O resultado aparecerá aqui assim que a leitura terminar.</p>}
                      <textarea
                        aria-label={`Resposta transcrita da questão ${question.number}`}
                        disabled={locked}
                        value={answer.transcribedAnswer}
                        onChange={(event) =>
                          update(question.number, {
                            transcribedAnswer: event.target.value,
                          })
                        }
                        rows={5}
                        className="w-full rounded border border-border bg-surface p-2 font-normal"
                        placeholder="Digite ou corrija a resposta do aluno…"
                      />
                      {scan?.reading?.suggestedTranscription && (
                        <p className="text-xs text-content-secondary">
                          Texto pré-preenchido a partir do scan; revise antes de
                          aprovar.
                        </p>
                      )}
                      {!scan?.page?.imageAvailable && (
                        <p className="text-xs text-amber-700">
                          A leitura por IA exige que a imagem da página seja
                          processada primeiro.
                        </p>
                      )}
                      <label className="text-sm">
                        Nota (máx. {max})
                        <input
                          disabled={locked}
                          type="number"
                          min="0"
                          max={max}
                          step="0.01"
                          value={answer.finalGrade ?? ""}
                          onChange={(event) =>
                            update(question.number, {
                              finalGrade:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                          className="ml-2 w-20 rounded border border-border bg-surface px-2 py-1"
                        />
                      </label>
                      {(answer.finalFeedback || answer.aiSuggestedFeedback) && (
                        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                          <p className="font-semibold">Feedback da avaliação</p>
                          <p className="mt-1 whitespace-pre-wrap">{answer.finalFeedback ?? answer.aiSuggestedFeedback}</p>
                          {answer.aiSuggestedGrade !== null && <p className="mt-2 text-xs font-medium">Sugestão da IA: {answer.aiSuggestedGrade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/{max}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <aside>
                  {(question.type === "objetiva" && scan?.page?.imageAvailable) || (question.type === "descritiva" && !scan?.reading?.cropAvailable && scan?.page?.imageAvailable) ? (
                    <>
                      <button type="button" onClick={() => openPreview(`/api/exams/${examId}/scan-pages/${scan!.page!.id}/image`, `Página escaneada da questão ${question.number}`)} className="block w-full cursor-zoom-in" aria-label={`Ampliar página escaneada da questão ${question.number}`}>
                        <Image
                          unoptimized
                          src={`/api/exams/${examId}/scan-pages/${scan.page.id}/image`}
                          width={520}
                          height={730}
                          className="max-h-[360px] w-full rounded border object-contain"
                          alt={`Página escaneada da questão ${question.number}`}
                        />
                      </button>
                      <p className="mt-2 text-xs text-content-secondary">Página {scan.page.sheetPageNumber ?? "identificada"} — clique para ampliar</p>
                    </>
                  ) : (
                    <div className="rounded border border-dashed border-border p-4 text-sm text-content-secondary">
                      {question.type === "objetiva" ? "A imagem da página ainda não está disponível; a marcação foi apresentada nas alternativas ao lado." : "O recorte da resposta ainda não está disponível. A questão continua disponível para correção manual."}
                    </div>
                  )}
                </aside>
              </div>
            </article>
          );
        })}
      </section>
      {preview && (
        <div role="dialog" aria-modal="true" aria-label={preview.alt} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 sm:p-6" onClick={() => setPreview(null)}>
          <div className="flex h-full w-full max-w-6xl min-h-0 flex-col" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 text-white"><p className="truncate text-sm font-medium">{preview.alt}</p><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} className="rounded bg-white/15 p-2 hover:bg-white/25" aria-label="Diminuir zoom"><Minus size={18}/></button><span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} className="rounded bg-white/15 p-2 hover:bg-white/25" aria-label="Aumentar zoom"><Plus size={18}/></button><button type="button" onClick={() => setZoom(1)} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">100%</button><button type="button" onClick={() => setPreview(null)} className="rounded bg-white/15 p-2 hover:bg-white/25" aria-label="Fechar"><X size={18}/></button></div></div>
            <div className="min-h-0 flex-1 overflow-auto rounded bg-black/30 p-2" onWheel={(event) => { if (!event.ctrlKey) return; event.preventDefault(); setZoom((value) => Math.min(3, Math.max(0.5, value + (event.deltaY < 0 ? 0.1 : -0.1)))) }}>
              <div className="mx-auto" style={{ width: `${Math.max(55, zoom * 100)}%`, minWidth: zoom > 1 ? `${zoom * 900}px` : undefined }}><Image unoptimized src={preview.src} width={1800} height={2200} alt={preview.alt} className="h-auto w-full" /></div>
            </div>
          </div>
        </div>
      )}
      {missingGradeQuestions.length > 0 && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="missing-grade-title">
          <div className="w-full max-w-md rounded-xl border border-amber-300 bg-surface-raised p-6 shadow-xl">
            <h2 id="missing-grade-title" className="text-lg font-semibold text-amber-950">Nota necessária antes da aprovação</h2>
            <p className="mt-2 text-sm leading-6 text-content-secondary">É necessário atribuir uma nota para a questão {missingGradeQuestions[0]} antes de aprovar esta correção.</p>
            {missingGradeQuestions.length > 1 && <p className="mt-2 text-sm leading-6 text-content-secondary">Também estão sem nota: {missingGradeQuestions.slice(1).join(", ")}.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMissingGradeQuestions([])} className="rounded border border-border px-4 py-2 text-sm font-medium">Fechar</button>
              <button type="button" onClick={() => { setMissingGradeQuestions([]); scrollToQuestion(missingGradeQuestions[0]); }} className="rounded bg-harmonia-green px-4 py-2 text-sm font-semibold text-white">Ir para questão {missingGradeQuestions[0]}</button>
            </div>
          </div>
        </div>
      )}
      <footer className="sticky bottom-4 flex flex-wrap justify-end gap-3 rounded-xl border border-border bg-surface-raised p-4 shadow-lg">
        <button
          type="button"
          disabled={saving || locked}
          onClick={() => void save()}
          className="rounded border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Salvar progresso
        </button>
        <button
          type="button"
          disabled={saving || locked || transcriptionSummary === null || !transcriptionSummary.canApprove}
          onClick={() => void save("revisado")}
          title={transcriptionActive ? "Aguarde a transcrição das respostas discursivas." : transcriptionSummary?.needsReview ? "Preencha manualmente as respostas que não foram lidas." : undefined}
          className="relative rounded bg-harmonia-green px-4 py-2 text-sm font-semibold text-transparent disabled:opacity-50 after:absolute after:inset-0 after:grid after:place-items-center after:text-white after:content-['Aprovar_correção']"
        >
          {saving ? "Salvando…" : "Aprovar correção e atualizar desempenho"}
        </button>
        {transcriptionActive && <span className="w-full text-right text-xs text-sky-800">Aprovação bloqueada enquanto houver transcrição em andamento.</span>}
        {!transcriptionActive && transcriptionSummary?.needsReview ? <span className="w-full text-right text-xs text-amber-800">Aprovação bloqueada até revisar as respostas sem leitura automática.</span> : null}
        {correction.status === "revisado" && !isAbsent && <button type="button" disabled={saving} onClick={() => void undoApproval()} className="rounded border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50">Desfazer correção</button>}
      </footer>
    </main>
  );
}
