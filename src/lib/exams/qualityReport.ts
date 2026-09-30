import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
import { isNotApplicableEvidence, normalizeQualityChecks, runQuestionQualityTest, type QualityReportResult } from './questionQualityTest'
import { diagnosticFromIssue } from './qualityDiagnostics'

// Versão canônica do relatório persistido. Ao subir a versão, provas antigas
// passam a ser reauditadas automaticamente na próxima aprovação (auto-cura).
export const QUALITY_REPORT_VERSION = 'quality-test-v4'

export function latestQualityReport(payload: ExamGenerationResult) {
  return payload.metadata.qualityTest?.reports?.at(-1)
}

/** Sem relatório nenhum (ex.: prova regenerada), é preciso reauditar com IA. */
export function qualityReportNeedsRecompute(payload: ExamGenerationResult): boolean {
  return !payload.metadata.qualityTest?.reports?.length
}

/** Relatório de versão antiga: dá para limpar sem IA (só normalização). */
export function qualityReportNeedsNormalization(payload: ExamGenerationResult): boolean {
  return Boolean(payload.metadata.qualityTest?.reports?.length) && payload.metadata.qualityTest?.version !== QUALITY_REPORT_VERSION
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
      const checks = normalizeQualityChecks(result.checks)
      const issues = result.issues.map((issue) =>
        issue.severity === 'bloqueante' && (isNotApplicableEvidence(issue.reason) || /teste de qualidade\s*—\s*(linguagem|alinhamento)/i.test(issue.reason))
          ? { ...issue, severity: 'alerta' as const }
          : issue,
      )
      return {
        ...result,
        checks,
        issues,
        diagnostics: result.diagnostics ?? issues.map((issue) => diagnosticFromIssue(issue)),
        approved: !issues.some((issue) => issue.severity === 'bloqueante') && !checks.some((check) => check.status === 'reprovado' && !['linguagem', 'alinhamento'].includes(check.criterion)),
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
  const quality = await runQuestionQualityTest(params.curriculum, params.payload.questions)
  const previous = params.payload.metadata.qualityTest
  const report = { phase: params.phase, results: quality.report }
  const reports = params.preserveReports && previous?.reports?.length
    ? [...previous.reports.filter((item) => item.phase !== params.phase), report]
    : [report]

  const payload: ExamGenerationResult = {
    ...params.payload,
    metadata: {
      ...params.payload.metadata,
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
