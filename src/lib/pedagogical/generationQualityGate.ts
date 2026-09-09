import { z } from 'zod'

import type { CurriculumSelection } from '@/types/exam'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'

const DOK_CODES = ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4'] as const
const SOLO_CODES = ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] as const

const blindQuestionReviewSchema = z.object({
  number: z.number().int().positive(),
  dok: z.object({
    categoryCode: z.enum(DOK_CODES),
    confidence: z.number().min(0).max(1),
    justification: z.string().min(1),
    evidenceExcerpt: z.string().min(1),
  }),
  soloExpected: z.object({
    categoryCode: z.enum(SOLO_CODES),
    confidence: z.number().min(0).max(1),
    justification: z.string().min(1),
    evidenceExcerpt: z.string().min(1),
  }),
})

export const blindPedagogicalReviewSchema = z.object({
  questions: z.array(blindQuestionReviewSchema),
})

export type BlindPedagogicalReview = z.infer<typeof blindPedagogicalReviewSchema>

export const BLIND_PEDAGOGICAL_REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'dok', 'soloExpected'],
        properties: {
          number: { type: 'number' },
          dok: {
            type: 'object',
            required: ['categoryCode', 'confidence', 'justification', 'evidenceExcerpt'],
            properties: {
              categoryCode: { type: 'string', enum: [...DOK_CODES] },
              confidence: { type: 'number' },
              justification: { type: 'string' },
              evidenceExcerpt: { type: 'string' },
            },
          },
          soloExpected: {
            type: 'object',
            required: ['categoryCode', 'confidence', 'justification', 'evidenceExcerpt'],
            properties: {
              categoryCode: { type: 'string', enum: [...SOLO_CODES] },
              confidence: { type: 'number' },
              justification: { type: 'string' },
              evidenceExcerpt: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const

const MINIMUM_BLIND_CONFIDENCE = 0.72

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function questionSource(question: ExamQuestion) {
  return [
    question.supportText,
    question.statement,
    question.alternatives?.map((alternative) => alternative.text).join(' '),
    question.expectedAnswer,
    question.gradingCriteria,
  ].filter(Boolean).join('\n')
}

function sourceForBlindReview(question: ExamQuestion) {
  return [
    `QUESTÃO ${question.number}`,
    question.supportText ? `TEXTO/DADOS DE APOIO:\n${question.supportText}` : null,
    `ENUNCIADO:\n${question.statement}`,
    question.alternatives?.length
      ? `ALTERNATIVAS:\n${question.alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join('\n')}`
      : null,
    question.expectedAnswer ? `RESPOSTA ESPERADA:\n${question.expectedAnswer}` : null,
    question.gradingCriteria ? `CRITÉRIOS DE CORREÇÃO:\n${question.gradingCriteria}` : null,
  ].filter(Boolean).join('\n\n')
}

/**
 * A revisão recebe somente o artefato a ser avaliado. Ela nunca vê Bloom,
 * DOK ou SOLO declarados pela chamada que produziu a questão, evitando que
 * uma autoatribuição seja aceita como evidência.
 */
export function buildBlindPedagogicalReviewPrompt(
  curriculum: Pick<CurriculumSelection, 'segment' | 'gradeYear' | 'subject'>,
  questions: ExamQuestion[],
) {
  return `Você é o segundo avaliador pedagógico de uma avaliação escolar. Classifique de modo INDEPENDENTE cada questão abaixo para ${curriculum.subject}, ${curriculum.gradeYear}º ano (${curriculum.segment}). Você NÃO recebeu a classificação do autor e não deve inferi-la por verbos isolados.

Use estritamente estes critérios:
- DOK_1: recordação/reprodução ou procedimento rotineiro de uma etapa.
- DOK_2: uso de habilidade/conceito, etapas conhecidas ou relação limitada entre elementos, sem escolha estratégica justificada.
- DOK_3: decisão estratégica entre caminhos, integração real de evidências/dados ou justificativa fundamentada. Texto longo, cálculo longo ou o verbo "explique" não bastam.
- DOK_4: investigação prolongada, aberta e iterativa ao longo do tempo. Uma questão isolada de prova normalmente NÃO é DOK_4.
- SOLO_EXPECTED mede a estrutura da resposta esperada: UNIESTRUTURAL (um elemento), MULTIESTRUTURAL (vários sem integração), RELACIONAL (integra elementos), ABSTRATO_AMPLIADO (generaliza/transfere além do caso). Não deduza SOLO apenas a partir de DOK.

Para cada classificação, informe um trecho EXATO do próprio item em evidenceExcerpt. Classifique de forma conservadora quando a evidência não sustentar o nível mais alto. Retorne exatamente uma avaliação para cada número de questão.

ITENS PARA REVISÃO CEGA:
${questions.map(sourceForBlindReview).join('\n\n---\n\n')}`
}

export type PedagogicalFidelityGateResult = {
  corrected: ExamGenerationResult
  issues: string[]
  warnings: string[]
}

/** Valida o próprio parecer cego sem usar os rótulos declarados na geração. */
export function validateBlindPedagogicalReviewArtifacts(
  questions: ExamQuestion[],
  review: BlindPedagogicalReview,
) {
  const issues: string[] = []
  const reviewsByNumber = new Map<number, BlindPedagogicalReview['questions'][number]>()

  for (const reviewed of review.questions) {
    if (reviewsByNumber.has(reviewed.number)) {
      issues.push(`Revisão pedagógica cega: a questão ${reviewed.number} foi classificada mais de uma vez.`)
    }
    reviewsByNumber.set(reviewed.number, reviewed)
  }

  for (const question of questions) {
    const reviewed = reviewsByNumber.get(question.number)
    if (!reviewed) {
      issues.push(`Revisão pedagógica cega: faltou a questão ${question.number}.`)
      continue
    }

    const source = normalize(questionSource(question))
    for (const [taxonomy, proposal] of Object.entries({ dok: reviewed.dok, soloExpected: reviewed.soloExpected })) {
      if (proposal.confidence < MINIMUM_BLIND_CONFIDENCE) {
        issues.push(`Questão ${question.number}: revisão cega de ${taxonomy} sem confiança suficiente (${proposal.confidence.toFixed(2)}; mínimo ${MINIMUM_BLIND_CONFIDENCE.toFixed(2)}).`)
      }
      const excerpt = normalize(proposal.evidenceExcerpt)
      if (excerpt.length < 12 || !source.includes(excerpt)) {
        issues.push(`Questão ${question.number}: evidência de ${taxonomy} precisa ser um trecho literal e relevante da própria questão.`)
      }
    }
    if (reviewed.dok.categoryCode === 'DOK_4') {
      issues.push(`Questão ${question.number}: DOK_4 não é aceito para item isolado; transforme em DOK_3 ou modele uma investigação prolongada fora de uma prova comum.`)
    }
  }

  for (const number of reviewsByNumber.keys()) {
    if (!questions.some((question) => question.number === number)) {
      issues.push(`Revisão pedagógica cega: recebeu uma questão inexistente (${number}).`)
    }
  }

  return issues
}

/**
 * Confronta a classificação que veio junto da geração com uma revisão cega.
 * A segunda leitura é a classificação persistida. Divergências ficam
 * registradas como aviso auditável, não como falso consenso entre chamadas
 * probabilísticas do mesmo fluxo de IA.
 */
export function applyBlindPedagogicalReview(
  result: ExamGenerationResult,
  review: BlindPedagogicalReview,
): PedagogicalFidelityGateResult {
  const issues: string[] = []
  const warnings: string[] = []
  const reviewsByNumber = new Map<number, BlindPedagogicalReview['questions'][number]>()

  issues.push(...validateBlindPedagogicalReviewArtifacts(result.questions, review))

  for (const reviewed of review.questions) {
    if (reviewsByNumber.has(reviewed.number)) {
      issues.push(`Revisão pedagógica cega: a questão ${reviewed.number} foi classificada mais de uma vez.`)
    }
    reviewsByNumber.set(reviewed.number, reviewed)
  }

  const correctedQuestions = result.questions.map((question) => {
    const reviewed = reviewsByNumber.get(question.number)
    if (!reviewed) {
      issues.push(`Revisão pedagógica cega: faltou a questão ${question.number}.`)
      return question
    }

    const declared = question.pedagogicalClassification
    if (declared.dok.categoryCode !== reviewed.dok.categoryCode) {
      warnings.push(`Questão ${question.number}: DOK declarado (${declared.dok.categoryCode}) divergiu da revisão cega (${reviewed.dok.categoryCode}); a classificação cega foi adotada.`)
    }
    if (declared.soloExpected.categoryCode !== reviewed.soloExpected.categoryCode) {
      warnings.push(`Questão ${question.number}: SOLO esperado declarado (${declared.soloExpected.categoryCode}) divergiu da revisão cega (${reviewed.soloExpected.categoryCode}); a classificação cega foi adotada.`)
    }

    return {
      ...question,
      pedagogicalClassification: {
        ...declared,
        dok: {
          categoryCode: reviewed.dok.categoryCode,
          confidence: reviewed.dok.confidence,
          justification: reviewed.dok.justification,
          evidence: reviewed.dok.evidenceExcerpt,
        },
        soloExpected: {
          categoryCode: reviewed.soloExpected.categoryCode,
          confidence: reviewed.soloExpected.confidence,
          justification: reviewed.soloExpected.justification,
          evidence: reviewed.soloExpected.evidenceExcerpt,
        },
      },
    }
  })

  if (!issues.length) {
    warnings.push('DOK e SOLO esperado foram validados por revisão pedagógica cega antes da persistência.')
  }

  return {
    corrected: { ...result, questions: correctedQuestions },
    issues,
    warnings,
  }
}

export function isPedagogicalQualityGateEnabled(value = process.env.PEDAGOGICAL_QUALITY_GATE_ENABLED) {
  return value === 'true'
}
