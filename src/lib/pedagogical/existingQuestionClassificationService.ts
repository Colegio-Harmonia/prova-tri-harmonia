import { and, desc, eq } from 'drizzle-orm'
import { getPedagogicalConfidenceBand } from '@/config/pedagogicalConfidence'
import { db } from '@/db/client'
import { EXAM_STATUSES, generatedExams } from '@/db/schema'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import {
  getCurrent,
  suggest,
  type PedagogicalClassification,
} from './classificationService'
import { PEDAGOGICAL_MANUAL_VERSION } from './catalog'
import {
  compactPedagogicalEvidence,
  inferDokAndSoloExpected,
  type PedagogicalQuestionProposal,
} from './questionHeuristics'

export type ExistingGeneratedQuestionSampleParams = {
  limit?: number
  examId?: number
  subject?: string
  segment?: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  status?: (typeof EXAM_STATUSES)[number]
  includeEnemBank?: boolean
  apply?: boolean
}

type ExistingExamRow = typeof generatedExams.$inferSelect

export type ExistingGeneratedQuestionSampleClassification = {
  exam: {
    id: number
    segment: ExistingExamRow['segment']
    gradeYear: number
    academicYear: number
    subject: string
    status: ExistingExamRow['status']
  }
  question: {
    number: number
    source: ExamQuestion['source']
    type: ExamQuestion['type']
    bloomLevel: ExamQuestion['bloomLevel']
  }
  preview: string
  proposals: Array<PedagogicalQuestionProposal & {
    confidenceBand: ReturnType<typeof getPedagogicalConfidenceBand>
    existingCurrent: PedagogicalClassification | null
    created: PedagogicalClassification | null
    skippedReason: string | null
  }>
}

function buildQuestionText(question: ExamQuestion) {
  const alternatives = question.alternatives
    ?.map((alternative) => `${alternative.letter}) ${alternative.text}`)
    .join('\n')

  return [
    question.statement,
    question.supportText,
    alternatives,
    question.expectedAnswer ? `Resposta esperada: ${question.expectedAnswer}` : null,
    question.gradingCriteria ? `Criterios de correcao: ${question.gradingCriteria}` : null,
    question.bnccSummary ? `BNCC: ${question.bnccSummary}` : null,
  ].filter(Boolean).join('\n\n')
}

async function fetchExistingExamRows(params: ExistingGeneratedQuestionSampleParams) {
  const conditions = []

  if (params.examId) conditions.push(eq(generatedExams.id, params.examId))
  if (params.subject) conditions.push(eq(generatedExams.subject, params.subject))
  if (params.segment) conditions.push(eq(generatedExams.segment, params.segment))
  if (params.status) conditions.push(eq(generatedExams.status, params.status))

  return db.query.generatedExams.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(generatedExams.createdAt)],
    limit: params.examId ? 1 : 20,
  })
}

export async function classifyExistingGeneratedQuestionSample(
  params: ExistingGeneratedQuestionSampleParams = {},
): Promise<ExistingGeneratedQuestionSampleClassification[]> {
  const safeLimit = Math.min(Math.max(params.limit ?? 5, 1), 25)
  const includeEnemBank = params.includeEnemBank ?? true
  const exams = await fetchExistingExamRows(params)
  const results: ExistingGeneratedQuestionSampleClassification[] = []

  for (const exam of exams) {
    const payload = exam.generationPayload as ExamGenerationResult
    const questions = payload?.questions ?? []

    for (const question of questions) {
      if (results.length >= safeLimit) return results
      if (!includeEnemBank && question.source === 'enem_bank') continue

      const text = buildQuestionText(question)
      const { dok, soloExpected } = inferDokAndSoloExpected({
        text,
        bloomLevel: question.bloomLevel,
        questionType: question.type,
        expectedAnswer: question.expectedAnswer,
        gradingCriteria: question.gradingCriteria,
      })
      const proposals: ExistingGeneratedQuestionSampleClassification['proposals'] = []

      for (const proposal of [dok, soloExpected]) {
        const existingCurrent = await getCurrent(
          'generated_exam_question',
          exam.id,
          question.number,
          proposal.taxonomyCode,
        )
        const shouldSkip = Boolean(existingCurrent)
        const created = params.apply && !shouldSkip
          ? await suggest({
              classifiableType: 'generated_exam_question',
              classifiableId: exam.id,
              classifiableSubId: question.number,
              taxonomyCode: proposal.taxonomyCode,
              categoryCode: proposal.categoryCode,
              confidence: proposal.confidence,
              source: 'SYSTEM_RULE',
              explanation: proposal.explanation,
              evidence: proposal.evidence,
              manualVersion: PEDAGOGICAL_MANUAL_VERSION,
              modelProvider: 'system',
              modelName: 'existing-question-heuristic',
              promptVersion: 'existing-question-sample-v1',
            })
          : null

        proposals.push({
          ...proposal,
          confidenceBand: getPedagogicalConfidenceBand(proposal.confidence),
          existingCurrent,
          created,
          skippedReason: shouldSkip
            ? 'Ja existe classificacao corrente para esta questao/taxonomia; amostra nao substitui classificacoes existentes.'
            : null,
        })
      }

      results.push({
        exam: {
          id: exam.id,
          segment: exam.segment,
          gradeYear: exam.gradeYear,
          academicYear: exam.academicYear,
          subject: exam.subject,
          status: exam.status,
        },
        question: {
          number: question.number,
          source: question.source,
          type: question.type,
          bloomLevel: question.bloomLevel,
        },
        preview: compactPedagogicalEvidence(text).slice(0, 220),
        proposals,
      })
    }
  }

  return results
}
