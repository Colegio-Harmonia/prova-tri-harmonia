"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Minus, Plus, X } from "lucide-react";
import type { CorrectionAnswer } from "@/types/correction";
import type { ExamGenerationResult } from "@/lib/gemini/examSchema";
import { totalGrade } from "@/lib/corrections/totalGrade";

type Correction = {
  id: number;
  studentName: string;
  status: "pendente" | "revisado";
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
    cropAvailable?: boolean;
  } | null;
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
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [readingQuestion, setReadingQuestion] = useState<number | null>(null);
  const [scanUploadIds, setScanUploadIds] = useState<number[]>([]);
  const [deletingUploadId, setDeletingUploadId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [examResponse, correctionsResponse, evidenceResponse] =
      await Promise.all([
        fetch(`/api/exams/${examId}`),
        fetch(`/api/exams/${examId}/corrections`),
        fetch(
          `/api/exams/${examId}/corrections/${correctionId}/scan-evidence${uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : ""}`,
        ),
      ]);
    const [examData, correctionsData, evidenceData] = await Promise.all([
      examResponse.json(),
      correctionsResponse.json(),
      evidenceResponse.json(),
    ]);
    if (!examResponse.ok || !correctionsResponse.ok || !evidenceResponse.ok)
      throw new Error(
        examData.error ??
          correctionsData.error ??
          evidenceData.error ??
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
    setExam(examData.exam);
    setCorrection({ ...current, answers: answersWithScan });
    setEvidence(evidenceData.evidence);
    setScanUploadIds(evidenceData.scanUploadIds ?? []);
  }, [examId, correctionId, uploadId]);
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
    setCorrection((current) =>
      current
        ? {
            ...current,
            answers: current.answers.map((answer) =>
              answer.questionNumber === questionNumber
                ? { ...answer, ...patch }
                : answer,
            ),
          }
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
  async function save(status?: "pendente" | "revisado") {
    if (!correction) return;
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
      if (!response.ok)
        throw new Error(data.error ?? "Não foi possível salvar.");
      setCorrection(data.correction);
      if (status === "revisado")
        window.location.assign(`/gerar/${examId}/corrigir`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function suggestDiscursiveGrades() {
    setSuggesting(true);
    setError(null);
    try {
      await save();
      const response = await fetch(
        `/api/exams/${examId}/corrections/${correctionId}/suggest`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "A IA não conseguiu sugerir as notas.");
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
  async function undoApproval() {
    if (!confirm("Desfazer esta correção? A nota oficial deixará de contar no desempenho e a entrega voltará para pendente.")) return;
    await save("pendente");
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
  const liveTotal = totalGrade(correction.answers);
  const locked = correction.status === "revisado";
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
        <h1 className="mt-3 text-2xl font-semibold">
          Correção de {correction.studentName}
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Revise a evidência de cada resposta, a leitura automática e a avaliação antes de aprovar.
        </p>
      </header>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              Nota parcial: {liveTotal === null ? "—" : liveTotal.toFixed(1)} /
              10
            </p>
            <p className="text-sm text-content-secondary">
              A aprovação grava a nota oficial e atualiza desempenho, perfil do
              aluno e dashboards.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${correction.status === "revisado" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
          >
            {correction.status === "revisado"
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
          return (
            <article
              key={question.number}
              className="rounded-xl border border-border bg-surface p-5"
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
                      <textarea
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
          disabled={saving || locked}
          onClick={() => void save("revisado")}
          className="relative rounded bg-harmonia-green px-4 py-2 text-sm font-semibold text-transparent disabled:opacity-50 after:absolute after:inset-0 after:grid after:place-items-center after:text-white after:content-['Aprovar_correção']"
        >
          {saving ? "Salvando…" : "Aprovar correção e atualizar desempenho"}
        </button>
        {locked && <button type="button" disabled={saving} onClick={() => void undoApproval()} className="rounded border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50">Desfazer correção</button>}
      </footer>
    </main>
  );
}
