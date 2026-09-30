import type { CurriculumSelection } from '@/types/exam'
import { SINGLE_QUESTION_RESPONSE_SCHEMA, singleQuestionResultSchema, type ExamQuestion, type SingleQuestionResult } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import type { QualityDiagnostic } from './qualityDiagnostics'

type RepairableDiagnostic = QualityDiagnostic & { repairAction: 'reparo_local' }

function canonical(value: string | null | undefined) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function repairable(diagnostics: QualityDiagnostic[]) {
  return diagnostics.filter((item): item is RepairableDiagnostic => item.repairAction === 'reparo_local')
}

/**
 * Corrige somente alternativas. A resposta completa continua sendo exigida
 * pelo schema, mas os campos pedagógicos e a resposta correta são conferidos
 * novamente antes de a versão reparada entrar no payload.
 */
export async function repairQuestionFromDiagnostics(params: {
  question: ExamQuestion
  curriculum: CurriculumSelection
  diagnostics: QualityDiagnostic[]
  context: string
}): Promise<{ question: ExamQuestion; warnings: string[] } | null> {
  const applicable = repairable(params.diagnostics)
  if (!applicable.length || params.question.type !== 'objetiva' || !params.question.alternatives || !params.question.correctLetter) return null

  const correctAlternative = params.question.alternatives.find((item) => item.letter === params.question.correctLetter)
  if (!correctAlternative) return null
  const protectedFields = [...new Set(applicable.flatMap((item) => item.protectedFields))]
  const prompt = `Você corrige UMA questão objetiva escolar já aprovada em todos os campos, exceto nas alternativas.

CONTEXTO PEDAGÓGICO
Disciplina: ${params.curriculum.subject}
Série: ${params.curriculum.gradeYear}º ano (${params.curriculum.segment})
BNCC obrigatória: ${params.question.bnccCodes.join(', ') || 'não mapeada'}
Conteúdo disponível: ${params.curriculum.units.map((unit) => `${unit.tituloCapitulo}: ${unit.conteudo ?? ''}`).join('\n').slice(0, 5000)}

QUESTÃO ATUAL (JSON)
${JSON.stringify(params.question)}

DIAGNÓSTICOS A CORRIGIR (JSON)
${JSON.stringify(applicable)}

REGRAS INEGOCIÁVEIS
- Altere SOMENTE "alternatives". Preserve literalmente statement, supportText, correctLetter, o texto da alternativa correta (${params.question.correctLetter}: ${correctAlternative.text}), tipo, BNCC, dificuldade, fonte e número.
- Gere alternativas distintas, plausíveis e que NUNCA sejam iguais ou equivalentes à resposta correta.
- Mantenha exatamente ${params.question.alternatives.length} alternativas e as mesmas letras.
- Não invente dados, fatos, valores ou habilidades BNCC.
- Campos protegidos: ${protectedFields.join(', ')}.

Retorne SOMENTE o JSON completo no schema solicitado, sem markdown.`

  const generated = await generateValidatedStructuredContent<SingleQuestionResult, ExamQuestion>({
    context: params.context,
    prompt,
    responseSchema: SINGLE_QUESTION_RESPONSE_SCHEMA,
    zodSchema: singleQuestionResultSchema,
    maxAttempts: 2,
    validate: (parsed) => {
      const candidate = { ...parsed.question, number: params.question.number, review: null }
      const { question, issues, warnings } = correctSingleQuestion(candidate, params.curriculum)
      const invariantIssues: string[] = []
      if (question.type !== params.question.type) invariantIssues.push('O tipo da questão não pode ser alterado no reparo local.')
      if (question.correctLetter !== params.question.correctLetter) invariantIssues.push('A letra do gabarito não pode ser alterada no reparo local.')
      if (canonical(question.statement) !== canonical(params.question.statement)) invariantIssues.push('O enunciado não pode ser alterado no reparo local.')
      if (canonical(question.supportText) !== canonical(params.question.supportText)) invariantIssues.push('O texto de apoio não pode ser alterado no reparo local.')
      if (canonical(question.alternatives?.find((item) => item.letter === params.question.correctLetter)?.text) !== canonical(correctAlternative.text)) {
        invariantIssues.push('A alternativa correta não pode ser alterada no reparo local.')
      }
      if (JSON.stringify(question.bnccCodes) !== JSON.stringify(params.question.bnccCodes) || question.bnccStatus !== params.question.bnccStatus) {
        invariantIssues.push('O vínculo BNCC não pode ser alterado no reparo local.')
      }
      return {
        value: question,
        issues: [...issues, ...invariantIssues],
        warnings,
        repairInstructions: applicable.map((item) => ({
          code: item.code,
          fields: item.fields,
          protectedFields: item.protectedFields,
          message: item.message,
        })),
      }
    },
  })

  return { question: generated.value, warnings: generated.warnings }
}
