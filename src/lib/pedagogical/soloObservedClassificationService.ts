import { z } from 'zod'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import { prepareStudentAnswerForAi } from '@/lib/ai/promptSafety'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { getCurrent, suggest } from './classificationService'

const SOLO_OBSERVED_LEVELS = ['PRE_ESTRUTURAL', 'UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] as const

const SOLO_OBSERVED_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    soloObserved: { type: 'string', enum: [...SOLO_OBSERVED_LEVELS] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    justification: { type: 'string' },
    evidence: { type: 'string' },
    limitations: { type: 'string', nullable: true },
    requiresHumanReview: { type: 'boolean' },
  },
  required: ['soloObserved', 'confidence', 'justification', 'evidence', 'limitations', 'requiresHumanReview'],
}

const soloObservedResultSchema = z.object({
  soloObserved: z.enum(SOLO_OBSERVED_LEVELS),
  confidence: z.number().min(0).max(1),
  justification: z.string().min(1),
  evidence: z.string().min(1),
  limitations: z.string().nullable(),
  requiresHumanReview: z.boolean(),
})

type SoloObservedResult = z.infer<typeof soloObservedResultSchema>

export type PersistSoloObservedParams = {
  examId: number
  correctionId: number
  answers: CorrectionAnswer[]
  payload: ExamGenerationResult
  createdBy: number
  modelProvider?: string | null
  modelName?: string | null
  promptVersion?: string | null
}

export type PersistSoloObservedResult = {
  created: number[]
  skipped: Array<{ questionNumber: number; reason: string }>
  warnings: string[]
}

function isAnalyzableDiscursiveAnswer(answer: CorrectionAnswer) {
  return answer.type === 'descritiva' && answer.transcribedAnswer.trim().length > 0
}

function buildSoloObservedPrompt(params: {
  questionStatement: string
  expectedAnswer: string | null
  gradingCriteria: string | null
  studentAnswer: string
}) {
  return `Classifique SOLO_OBSERVED para uma resposta discursiva real de aluno.

Regras obrigatórias:
- SOLO_OBSERVED mede a estrutura real demonstrada na resposta do aluno.
- Nunca trate SOLO_OBSERVED como nota.
- Não use SOLO_EXPECTED da questão como atalho.
- Classifique pela estrutura do raciocínio demonstrado, mesmo que haja erro de conta.
- Se a resposta só traz resultado final sem justificativa, nunca use RELACIONAL ou ABSTRATO_AMPLIADO.
- Se a resposta é vazia, cópia, ruído ou não se relaciona à pergunta, use PRE_ESTRUTURAL.
- Use somente uma destas categorias: PRE_ESTRUTURAL, UNIESTRUTURAL, MULTIESTRUTURAL, RELACIONAL, ABSTRATO_AMPLIADO.

Critérios resumidos:
- PRE_ESTRUTURAL: sem relação lógica, cópia, ruído ou vazio.
- UNIESTRUTURAL: usa uma informação correta, mas ignora o restante.
- MULTIESTRUTURAL: usa várias informações corretas, mas isoladas, sem conexão explícita.
- RELACIONAL: conecta informações numa explicação coerente e completa.
- ABSTRATO_AMPLIADO: resolve e generaliza o princípio para além do caso específico.

Enunciado:
"""
${params.questionStatement}
"""

${params.expectedAnswer ? `Resposta esperada:\n"""\n${params.expectedAnswer}\n"""\n\n` : ''}${params.gradingCriteria ? `Critérios de correção:\n"""\n${params.gradingCriteria}\n"""\n\n` : ''}Resposta do aluno:
"""
${prepareStudentAnswerForAi(params.studentAnswer)}
"""

Retorne evidence como trecho curto da resposta do aluno que sustenta a classificação.`
}

async function classifySoloObserved(params: {
  answer: CorrectionAnswer
  payload: ExamGenerationResult
}): Promise<SoloObservedResult> {
  const question = params.payload.questions.find((q) => q.number === params.answer.questionNumber)
  if (!question) {
    throw new Error(`Questao ${params.answer.questionNumber} nao encontrada no payload da prova.`)
  }

  const prompt = buildSoloObservedPrompt({
    questionStatement: question.statement,
    expectedAnswer: question.expectedAnswer ?? null,
    gradingCriteria: question.gradingCriteria ?? null,
    studentAnswer: params.answer.transcribedAnswer.trim(),
  })

  const generated = await generateValidatedStructuredContent<SoloObservedResult>({
    context: 'solo-observed',
    prompt,
    responseSchema: SOLO_OBSERVED_RESPONSE_SCHEMA,
    zodSchema: soloObservedResultSchema,
  })

  return generated.value
}

export async function persistSoloObservedForCorrection(params: PersistSoloObservedParams): Promise<PersistSoloObservedResult> {
  const result: PersistSoloObservedResult = { created: [], skipped: [], warnings: [] }
  const promptVersion = params.promptVersion ?? 'solo-observed-v1'

  for (const answer of params.answers) {
    if (answer.type === 'objetiva') {
      result.skipped.push({ questionNumber: answer.questionNumber, reason: 'Questao objetiva nao recebe SOLO_OBSERVED.' })
      continue
    }

    if (!isAnalyzableDiscursiveAnswer(answer)) {
      result.skipped.push({ questionNumber: answer.questionNumber, reason: 'Resposta discursiva sem texto analisavel.' })
      continue
    }

    const current = await getCurrent('exam_correction_answer', params.correctionId, answer.questionNumber, 'SOLO_OBSERVED')
    if (current?.status === 'aprovada' || current?.status === 'em_revisao') {
      result.skipped.push({ questionNumber: answer.questionNumber, reason: 'Classificacao atual protegida por revisao humana.' })
      continue
    }

    const classification = await classifySoloObserved({ answer, payload: params.payload })
    const inserted = await suggest({
      classifiableType: 'exam_correction_answer',
      classifiableId: params.correctionId,
      classifiableSubId: answer.questionNumber,
      taxonomyCode: 'SOLO_OBSERVED',
      categoryCode: classification.soloObserved,
      confidence: classification.confidence,
      source: 'AI',
      explanation: `${classification.justification}${classification.limitations ? ` Limitacoes: ${classification.limitations}` : ''}`,
      evidence: classification.evidence,
      modelProvider: params.modelProvider ?? 'deepseek',
      modelName: params.modelName ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
      promptVersion,
      createdBy: params.createdBy,
    })
    result.created.push(inserted.id)

    if (classification.requiresHumanReview) {
      result.warnings.push(`Questao ${answer.questionNumber}: SOLO_OBSERVED marcado pela IA como requerendo revisao humana.`)
    }
  }

  return result
}
