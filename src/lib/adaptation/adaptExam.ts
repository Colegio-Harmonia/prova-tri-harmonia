import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import type { AdaptationProfileId } from '@/db/schema'
import { mergeAdaptationLibraries, type MergedAdaptation } from './mergeLibraries'
import { buildAdaptationPrompt } from './adaptationPromptBuilder'
import { adaptationResultSchema, ADAPTATION_RESPONSE_SCHEMA, type AdaptationResult, type AdaptedQuestion } from './adaptationSchema'
import { validateEquivalence, equivalenceApproved, type EquivalenceReport } from './equivalenceValidator'

// Motor de adaptação (Módulo 4): IA reescreve a FORMA das questões sob as
// diretrizes mescladas das bibliotecas; o validador de equivalência roda
// DENTRO do loop de reparo do structuredRepair — resposta que muda o
// construto avaliado é tratada como resposta inválida e reparada, não
// aceita. O payload adaptado final copia a questão original e substitui
// só os campos de forma: gabarito/BNCC/Bloom/critérios nunca passam pela
// IA nem podem ser alterados por ela.

export type AdaptedExamPayload = {
  metadata: ExamGenerationResult['metadata'] & {
    adaptation: {
      profiles: AdaptationProfileId[]
      libraryVersions: Record<string, string>
      layout: MergedAdaptation['layout']
    }
  }
  questions: Array<ExamQuestion & {
    adaptation: Omit<AdaptedQuestion, 'number'>
    // Campos de forma já substituídos pros builders de documento:
    statement: string
    supportText: string | null
    alternatives: ExamQuestion['alternatives']
  }>
}

export type AdaptExamOutcome = {
  payload: AdaptedExamPayload
  report: EquivalenceReport
  merged: MergedAdaptation
  repaired: boolean
}

export async function adaptExam(exam: ExamGenerationResult, profiles: AdaptationProfileId[]): Promise<AdaptExamOutcome> {
  const merged = mergeAdaptationLibraries(profiles)
  const prompt = buildAdaptationPrompt(exam.questions, merged)

  const generated = await generateValidatedStructuredContent<AdaptationResult, AdaptationResult>({
    context: 'adaptation/adapt-exam',
    prompt,
    responseSchema: ADAPTATION_RESPONSE_SCHEMA,
    zodSchema: adaptationResultSchema,
    // Equivalência dentro do loop de reparo: violação estrutural
    // (alternativa sumiu, questão faltando) vira issue e força a IA a
    // corrigir — não passa adiante.
    validate: (result) => {
      const report = validateEquivalence(exam.questions, result.questions)
      return { value: result, issues: report.issues, warnings: [] }
    },
  })

  const adaptedByNumber = new Map(generated.value.questions.map((q) => [q.number, q]))
  const report = validateEquivalence(exam.questions, generated.value.questions)
  if (!equivalenceApproved(report)) {
    // structuredRepair esgotou as tentativas e ainda há violação — quem
    // chama marca a linha como erro com o relatório.
    const error = new Error(`Adaptação reprovada pelo validador de equivalência: ${report.issues.join(' ')}`)
    ;(error as Error & { report?: EquivalenceReport }).report = report
    throw error
  }

  const questions = exam.questions.map((q) => {
    const adapted = adaptedByNumber.get(q.number)!
    const { number: _number, ...adaptationFields } = adapted
    return {
      ...q,
      statement: adapted.adaptedStatement,
      supportText: adapted.adaptedSupportText ?? q.supportText ?? null,
      alternatives: q.type === 'objetiva' ? (adapted.adaptedAlternatives ?? q.alternatives) : q.alternatives,
      adaptation: adaptationFields,
    }
  })

  return {
    payload: {
      metadata: {
        ...exam.metadata,
        adaptation: {
          profiles: merged.profiles,
          libraryVersions: merged.libraryVersions,
          layout: merged.layout,
        },
      },
      questions,
    },
    report,
    merged,
    repaired: generated.repaired,
  }
}
