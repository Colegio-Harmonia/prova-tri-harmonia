import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { getPedagogicalConfidenceBand } from '@/config/pedagogicalConfidence'
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

type ImportedEnemQuestion = {
  id: number
  year: number
  questionIndex: number
  discipline: string | null
  language: string | null
  title: string
  context: string | null
  alternativesIntroduction: string | null
  bloomLevel: string | null
  axisCode: string | null
}

export type ClassifyImportedEnemSampleParams = {
  limit?: number
  year?: number
  discipline?: string
  apply?: boolean
  includeExisting?: boolean
}

export type ImportedEnemSampleClassification = {
  question: Pick<ImportedEnemQuestion, 'id' | 'year' | 'questionIndex' | 'discipline' | 'language'>
  preview: string
  proposals: Array<PedagogicalQuestionProposal & {
    confidenceBand: ReturnType<typeof getPedagogicalConfidenceBand>
    existingCurrent: PedagogicalClassification | null
    created: PedagogicalClassification | null
    skippedReason: string | null
  }>
}

function buildQuestionText(question: ImportedEnemQuestion) {
  return [
    question.title,
    question.context,
    question.alternativesIntroduction,
  ].filter(Boolean).join('\n\n')
}

async function fetchImportedEnemSample(params: Required<Pick<ClassifyImportedEnemSampleParams, 'limit'>> & ClassifyImportedEnemSampleParams) {
  const rows = await db.execute<ImportedEnemQuestion>(
    sql`
      SELECT
        q.id,
        q.year,
        q.question_index AS "questionIndex",
        q.discipline,
        q.language,
        q.title,
        q.context,
        q.alternatives_introduction AS "alternativesIntroduction",
        c.bloom_level AS "bloomLevel",
        ax.code AS "axisCode"
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      LEFT JOIN enem_cognitive_axes ax ON ax.id = c.enem_cognitive_axis_id
      WHERE q.source = 'enem'
        AND (q.language IS NULL OR q.language = '')
        AND (q.files IS NULL OR q.files = '[]'::jsonb)
        AND (q.context IS NOT NULL OR q.alternatives_introduction IS NOT NULL)
        ${params.year ? sql`AND q.year = ${params.year}` : sql``}
        ${params.discipline ? sql`AND q.discipline = ${params.discipline}` : sql``}
      ORDER BY q.year DESC, q.question_index ASC
      LIMIT ${params.limit}
    `,
  )

  return rows as unknown as ImportedEnemQuestion[]
}

export async function classifyImportedEnemSample(
  params: ClassifyImportedEnemSampleParams = {},
): Promise<ImportedEnemSampleClassification[]> {
  const safeLimit = Math.min(Math.max(params.limit ?? 5, 1), 25)
  const questions = await fetchImportedEnemSample({ ...params, limit: safeLimit })

  const results: ImportedEnemSampleClassification[] = []

  for (const question of questions) {
    const text = buildQuestionText(question)
    const { dok, soloExpected } = inferDokAndSoloExpected({
      text,
      bloomLevel: question.bloomLevel,
      cognitiveAxisCode: question.axisCode,
    })
    const proposals: ImportedEnemSampleClassification['proposals'] = []

    for (const proposal of [dok, soloExpected]) {
      const existingCurrent = await getCurrent(
        'imported_question',
        question.id,
        null,
        proposal.taxonomyCode,
      )
      const shouldSkip = Boolean(existingCurrent && !params.includeExisting)
      const created = params.apply && !shouldSkip
        ? await suggest({
            classifiableType: 'imported_question',
            classifiableId: question.id,
            classifiableSubId: null,
            taxonomyCode: proposal.taxonomyCode,
            categoryCode: proposal.categoryCode,
            confidence: proposal.confidence,
            source: 'ENEM_IMPORT',
            explanation: proposal.explanation,
            evidence: proposal.evidence,
            manualVersion: PEDAGOGICAL_MANUAL_VERSION,
            modelProvider: 'system',
            modelName: 'enem-sample-heuristic',
            promptVersion: 'enem-import-sample-v1',
          })
        : null

      proposals.push({
        ...proposal,
        confidenceBand: getPedagogicalConfidenceBand(proposal.confidence),
        existingCurrent,
        created,
        skippedReason: shouldSkip
          ? 'Ja existe classificacao corrente para esta taxonomia; use includeExisting apenas para simular comparacao.'
          : null,
      })
    }

    results.push({
      question: {
        id: question.id,
        year: question.year,
        questionIndex: question.questionIndex,
        discipline: question.discipline,
        language: question.language,
      },
      preview: compactPedagogicalEvidence(text).slice(0, 220),
      proposals,
    })
  }

  return results
}
