import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
import { isNotApplicableEvidence, normalizeQualityChecks, questionQualityFingerprint, runQuestionQualityTest, type QualityReportResult } from './questionQualityTest'
import { diagnosticFromIssue } from './qualityDiagnostics'

// Versão canônica do relatório persistido. Ao subir a versão, relatórios
// antigos são normalizados na próxima aprovação sem reauditar conteúdo válido.
export const QUALITY_REPORT_VERSION = 'quality-test-v10'

export function latestQualityReport(payload: ExamGenerationResult) {
  return payload.metadata.qualityTest?.reports?.at(-1)
}

/** Sem relatório nenhum (ex.: prova regenerada), é preciso reauditar com IA. */
export function qualityReportNeedsRecompute(payload: ExamGenerationResult): boolean {
  if (payload.metadata.generationEngine === 'whole-exam-v1') {
    return payload.questions.filter((q) => q.source === 'enem_bank').some((question) => {
      const result = latestQualityReport(payload)?.results.find((r) => r.questionNumber === question.number)
      return !['official_bank_verified', 'official_bank_invalid'].includes(result?.auditStatus ?? '') || result?.questionFingerprint !== questionQualityFingerprint(question, payload.metadata.classLabel)
    })
  }
  if (payload.metadata.qualityTest?.version !== QUALITY_REPORT_VERSION) return true
  const results = payload.metadata.qualityTest?.reports?.at(-1)?.results
  if (!results?.length || results.length !== payload.questions.length) return true
  return payload.questions.some((question) => {
    const result = results.find((item) => item.questionNumber === question.number)
    if (result?.auditStatus === 'jev_unavailable') return true
    if (question.source === 'enem_bank' && !['official_bank_verified', 'official_bank_invalid'].includes(result?.auditStatus ?? '')) return true
    return !result || result.questionFingerprint !== questionQualityFingerprint(question, payload.metadata.classLabel)
  })
}

/** Relatório de versão antiga: dá para limpar sem IA (só normalização). */
export function qualityReportNeedsNormalization(payload: ExamGenerationResult): boolean {
  return Boolean(payload.metadata.qualityTest?.reports?.length) && payload.metadata.qualityTest?.version !== QUALITY_REPORT_VERSION
}

function isLegacyClassroomCheck(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  return normalized.includes('grade_level_mismatch') || normalized.includes('adequacao_turma') || /adequacao.{0,40}turma/.test(normalized)
}

/**
 * Auto-cura determinística (sem IA): reescreve o relatório persistido com os
 * critérios normalizados, rebaixa bloqueios "não aplicáveis" e recalcula
 * `approved`. Usada quando o relatório é de uma versão anterior — evita
 * gastar gerações e mantém a tela coerente com a barreira de aprovação.
 */
export function normalizeStoredQualityReport(payload: ExamGenerationResult): ExamGenerationResult {
  const qualityTest = payload.metadata.qualityTest
  if (!qualityTest?.reports?.length) return payload

  const reports = qualityTest.reports.map((report) => ({
    ...report,
    results: report.results.map((result) => {
      const checks = normalizeQualityChecks(result.checks).map((check) => isLegacyClassroomCheck(check.criterion)
        ? { ...check, status: 'não_aplicável' as const, evidence: 'Critério antigo de adequação à turma removido; não participa mais da validação Jev.' }
        : check)
      const issues = result.issues.map((issue) => {
        if (isLegacyClassroomCheck(issue.reason)) {
          return { ...issue, severity: 'alerta' as const, reason: `Critério antigo de adequação à turma removido: ${issue.reason}` }
        }
        return issue.severity === 'bloqueante' && (isNotApplicableEvidence(issue.reason) || /teste de qualidade\s*—\s*(linguagem|alinhamento)/i.test(issue.reason))
          ? { ...issue, severity: 'alerta' as const }
          : issue
      })
      const diagnostics = (result.diagnostics ?? issues.map((issue) => diagnosticFromIssue(issue))).map((item) => isLegacyClassroomCheck(`${item.code} ${item.message} ${item.evidence ?? ''}`)
        ? { ...item, severity: 'alerta' as const, repairAction: 'nenhuma' as const, message: 'Critério antigo de adequação à turma removido; não bloqueia esta questão.', blocksApproval: false }
        : item)
      return {
        ...result,
        checks,
        issues,
        diagnostics,
        approved: result.auditStatus !== 'jev_unavailable' && !issues.some((issue) => issue.severity === 'bloqueante') && !checks.some((check) => check.status === 'reprovado' && !['linguagem', 'alinhamento'].includes(check.criterion)),
      }
    }),
  }))

  return {
    ...payload,
    metadata: {
      ...payload.metadata,
      qualityTest: { ...qualityTest, version: QUALITY_REPORT_VERSION, reports },
    },
  }
}

/** Reaudita a prova inteira e grava um relatório canônico e limpo. */
export async function recomputeQualityReport(params: {
  payload: ExamGenerationResult
  curriculum: CurriculumSelection
  phase: string
  repairedQuestionNumbers?: number[]
  /** Mantém o histórico de fases anteriores (senão substitui por este relatório). */
  preserveReports?: boolean
}): Promise<{ payload: ExamGenerationResult; report: QualityReportResult[]; warnings: string[] }> {
  const questions = params.payload.metadata.generationEngine === 'whole-exam-v1'
    ? params.payload.questions.filter((q) => q.source === 'enem_bank')
    : params.payload.questions
  const quality = await runQuestionQualityTest(params.curriculum, questions, new Map(), params.payload.metadata.classLabel)
  const previous = params.payload.metadata.qualityTest
  const report = { phase: params.phase, results: quality.report }
  const reports = params.preserveReports && previous?.reports?.length
    ? [...previous.reports.filter((item) => item.phase !== params.phase), report]
    : [report]
  const generationProgress = params.payload.metadata.generationProgress
  const approvedNumbers = new Set(quality.report.filter((item) => item.approved).map((item) => item.questionNumber))
  const pendingQuestionNumbers = generationProgress?.pendingQuestionNumbers.filter((number) => !approvedNumbers.has(number)) ?? []
  const pendingReasons = generationProgress?.pendingReasons
    ? Object.fromEntries(Object.entries(generationProgress.pendingReasons).filter(([number]) => pendingQuestionNumbers.includes(Number(number))))
    : undefined

  const payload: ExamGenerationResult = {
    ...params.payload,
    metadata: {
      ...params.payload.metadata,
      ...(generationProgress ? { generationProgress: {
        ...generationProgress,
        complete: pendingQuestionNumbers.length === 0,
        pendingQuestionNumbers,
        ...(pendingReasons ? { pendingReasons } : {}),
      } } : {}),
      qualityTest: {
        version: QUALITY_REPORT_VERSION,
        checkedAt: new Date().toISOString(),
        repairedQuestionNumbers: params.repairedQuestionNumbers ?? previous?.repairedQuestionNumbers ?? [],
        warnings: quality.warnings,
        reports,
      },
    },
  }
  return { payload, report: quality.report, warnings: quality.warnings }
}

/**
 * Atualiza apenas as questões trocadas no relatório mais recente — evita
 * reauditar a prova inteira só porque um item foi substituído. Descarta
 * resultados antigos das mesmas questões (evita relatório fantasma).
 */
export function mergeQualityResults(params: {
  payload: ExamGenerationResult
  updates: Array<{ questionNumber: number; result: QualityReportResult }>
  warnings?: string[]
  phase?: string
}): ExamGenerationResult {
  const previous = params.payload.metadata.qualityTest
  const phase = params.phase ?? previous?.reports?.at(-1)?.phase ?? 'Auditoria da revisão'
  const results = [...(previous?.reports?.at(-1)?.results ?? [])]
  for (const update of params.updates) {
    const index = results.findIndex((item) => item.questionNumber === update.questionNumber)
    if (index === -1) results.push(update.result)
    else results[index] = update.result
  }
  results.sort((a, b) => a.questionNumber - b.questionNumber)
  const reports = [...(previous?.reports?.slice(0, -1) ?? []), { phase, results }]

  return {
    ...params.payload,
    metadata: {
      ...params.payload.metadata,
      qualityTest: {
        version: QUALITY_REPORT_VERSION,
        checkedAt: new Date().toISOString(),
        repairedQuestionNumbers: previous?.repairedQuestionNumbers ?? [],
        warnings: [...(previous?.warnings ?? []), ...(params.warnings ?? [])],
        reports,
      },
    },
  }
}
