import type { ExamQuestion } from '@/lib/gemini/examSchema'
import {
  getCurrent,
  suggest,
  type PedagogicalClassification,
} from './classificationService'
import { PEDAGOGICAL_MANUAL_VERSION } from './catalog'
import { inferDokAndSoloExpected } from './questionHeuristics'

type PersistGeneratedQuestionClassificationsParams = {
  examId: number
  questions: ExamQuestion[]
  createdBy: number
  replaceExisting?: boolean
  modelProvider?: string | null
  modelName?: string | null
  promptVersion?: string | null
}

export type PersistGeneratedQuestionClassificationResult = {
  created: PedagogicalClassification[]
  skipped: Array<{
    questionNumber: number
    taxonomyCode: 'DOK' | 'SOLO_EXPECTED'
    reason: string
  }>
}

function questionText(question: ExamQuestion) {
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

function fallbackPedagogicalClassification(question: ExamQuestion) {
  const inferred = inferDokAndSoloExpected({
    text: questionText(question),
    bloomLevel: question.bloomLevel,
    questionType: question.type,
    expectedAnswer: question.expectedAnswer,
    gradingCriteria: question.gradingCriteria,
  })

  return {
    dok: {
      categoryCode: inferred.dok.categoryCode as 'DOK_1' | 'DOK_2' | 'DOK_3' | 'DOK_4',
      confidence: inferred.dok.confidence,
      justification: inferred.dok.explanation,
      evidence: inferred.dok.evidence,
    },
    soloExpected: {
      categoryCode: inferred.soloExpected.categoryCode as 'UNIESTRUTURAL' | 'MULTIESTRUTURAL' | 'RELACIONAL' | 'ABSTRATO_AMPLIADO',
      confidence: inferred.soloExpected.confidence,
      justification: inferred.soloExpected.explanation,
      evidence: inferred.soloExpected.evidence,
    },
  }
}

function getQuestionPedagogicalClassification(question: ExamQuestion) {
  return question.pedagogicalClassification ?? fallbackPedagogicalClassification(question)
}

export async function persistGeneratedQuestionClassifications(
  params: PersistGeneratedQuestionClassificationsParams,
): Promise<PersistGeneratedQuestionClassificationResult> {
  const created: PedagogicalClassification[] = []
  const skipped: PersistGeneratedQuestionClassificationResult['skipped'] = []

  for (const question of params.questions) {
    if (question.source !== 'ia') continue

    const classification = getQuestionPedagogicalClassification(question)
    const proposals = [
      {
        taxonomyCode: 'DOK' as const,
        categoryCode: classification.dok.categoryCode,
        confidence: classification.dok.confidence,
        explanation: classification.dok.justification,
        evidence: classification.dok.evidence,
      },
      {
        taxonomyCode: 'SOLO_EXPECTED' as const,
        categoryCode: classification.soloExpected.categoryCode,
        confidence: classification.soloExpected.confidence,
        explanation: classification.soloExpected.justification,
        evidence: classification.soloExpected.evidence,
      },
    ]

    for (const proposal of proposals) {
      const current = await getCurrent(
        'generated_exam_question',
        params.examId,
        question.number,
        proposal.taxonomyCode,
      )

      if (current && !params.replaceExisting) {
        skipped.push({
          questionNumber: question.number,
          taxonomyCode: proposal.taxonomyCode,
          reason: 'Ja existe classificacao corrente para a questao/taxonomia.',
        })
        continue
      }

      const inserted = await suggest({
        classifiableType: 'generated_exam_question',
        classifiableId: params.examId,
        classifiableSubId: question.number,
        taxonomyCode: proposal.taxonomyCode,
        categoryCode: proposal.categoryCode,
        confidence: proposal.confidence,
        source: 'AI',
        explanation: proposal.explanation,
        evidence: proposal.evidence,
        manualVersion: PEDAGOGICAL_MANUAL_VERSION,
        modelProvider: params.modelProvider ?? 'deepseek',
        modelName: params.modelName ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: params.promptVersion ?? 'exam-generation-pedagogical-v1',
        createdBy: params.createdBy,
      })

      created.push(inserted)
    }
  }

  return { created, skipped }
}
