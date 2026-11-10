import { habilidadesEF, habilidadesEM } from '@bncc/dados'
import { evaluateWithJev, type JevAnswers, type JsonValue } from '@/lib/ai/jevClient'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

export const BNCC_MIN_SCORE_PERCENT = 80
export const BNCC_CLASSIFICATION_VERSION = 'missing-bncc-v1'
export type BnccContext = { subject: string; gradeYear: number; segment: string }
export type BnccQuestion = Pick<ExamQuestion, 'statement' | 'supportText' | 'alternatives' | 'correctLetter' | 'expectedAnswer' | 'commentedResolution' | 'bnccCodes'>
export type BnccAssessment = {
  version: string
  status: 'classified' | 'no_match' | 'unavailable'
  source: 'provider' | 'cache' | 'fallback'
  model: string
  thresholdPercent: number
  assessedAt: string
  scores: Array<{ code: string; scorePercent: number }>
  candidateCount: number
  errorCode?: string
}
export type BnccClassification = Pick<ExamQuestion, 'bnccCodes' | 'bnccStatus' | 'bnccSummary' | 'bnccDetails'> & { bnccAssessment: BnccAssessment }
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const efComponents: Record<string, string> = {
  portugues: 'LP', 'lingua portuguesa': 'LP', literatura: 'LP', matematica: 'MA', ciencias: 'CI', historia: 'HI', geografia: 'GE', ingles: 'LI', artes: 'AR', arte: 'AR', 'educacao fisica': 'EF', 'ensino religioso': 'ER', computacao: 'CO',
}
const emAreas: Record<string, readonly string[]> = {
  matematica: ['MAT'], fisica: ['CNT'], quimica: ['CNT'], biologia: ['CNT'], ciencias: ['CNT'], 'ciencias-natureza': ['CNT'], 'ciencias da natureza': ['CNT'], historia: ['CHS'], geografia: ['CHS'], filosofia: ['CHS'], sociologia: ['CHS'], 'ciencias-humanas': ['CHS'], 'ciencias humanas': ['CHS'], portugues: ['LP', 'LGG'], 'lingua portuguesa': ['LP', 'LGG'], literatura: ['LP', 'LGG'], linguagens: ['LP', 'LGG'], ingles: ['LGG'], espanhol: ['LGG'], artes: ['LGG'], arte: ['LGG'], 'educacao fisica': ['LGG'],
}

export function hasBnccCodes(question: Pick<BnccQuestion, 'bnccCodes'>): boolean {
  return question.bnccCodes.some((code) => typeof code === 'string' && code.trim().length > 0)
}

/** All compatible official skills are scored; no keyword shortlist can hide a match. */
export function candidateBnccSkills(context: BnccContext) {
  const subject = normalize(context.subject)
  const highSchool = context.segment === 'ensino-medio'
  const component = efComponents[subject]
  const records = highSchool ? habilidadesEM().filter((skill) => {
    const area = skill.codigo.match(/^EM13([A-Z]+)\d+$/)?.[1]
    return Boolean(area && (!emAreas[subject] || emAreas[subject]!.includes(area)))
  }) : habilidadesEF({ ano: context.gradeYear, ...(component ? { componente: component } : {}) })
  return records.map((record) => getOfficialBnccSkill(record.codigo)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code))
}

export function selectBnccScores(answers: JevAnswers, codes: string[], thresholdPercent = BNCC_MIN_SCORE_PERCENT) {
  const scores = codes.flatMap((code) => {
    const answer = answers[code]
    if (answer?.type !== 'score' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 9) return []
    return [{ code, scorePercent: Number((answer.score / 9 * 100).toFixed(2)) }]
  }).sort((a, b) => b.scorePercent - a.scorePercent || a.code.localeCompare(b.code))
  return { scores, selected: scores.filter((item) => item.scorePercent > thresholdPercent) }
}

const rubric = [
  'Nenhuma relação entre a habilidade e a resolução da questão.',
  'Coincidência de palavras, sem relação cognitiva.',
  'Apenas tema ou contexto em comum.',
  'Relação indireta, dispensável para resolver.',
  'Pré-requisito distante, não medido pelo item.',
  'Parte do conteúdo coincide, mas a operação cognitiva não.',
  'Relação parcial; falta evidência de que o item mede a habilidade.',
  'Boa relação, mas o item mede apenas uma parte acessória da habilidade.',
  'Alinhamento forte: resolver exige o núcleo da habilidade e o item permite observá-lo.',
  'Alinhamento direto e inequívoco: o item mede a operação e o objeto da habilidade.',
]

export async function classifyQuestionBncc(question: BnccQuestion, context: BnccContext, options: { evaluate?: typeof evaluateWithJev; thresholdPercent?: number } = {}): Promise<BnccClassification> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const thresholdPercent = options.thresholdPercent ?? BNCC_MIN_SCORE_PERCENT
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) throw new Error('Limite BNCC inválido.')
  const candidates = candidateBnccSkills(context)
  const answers: JevAnswers = {}
  let source: BnccAssessment['source'] = 'cache'
  let model = 'jev-latest'
  let errorCode: string | undefined
  for (let offset = 0; offset < candidates.length; offset += 24) {
    const batch = candidates.slice(offset, offset + 24)
    const result = await evaluate({
      operation: 'jev/exams/missing-bncc', questionVersion: BNCC_CLASSIFICATION_VERSION,
      state: { ...context, question: { statement: question.statement, supportText: question.supportText ?? null, alternatives: question.alternatives ?? null, correctLetter: question.correctLetter ?? null, expectedAnswer: question.expectedAnswer ?? null, resolution: question.commentedResolution ?? null }, skills: batch.map((skill) => ({ code: skill.code, description: skill.text, context: skill.context, source: skill.source, dataVersion: skill.dataVersion })) } as JsonValue,
      questions: Object.fromEntries(batch.map((skill) => [skill.code, { type: 'score' as const, instructions: `Avalie independentemente quanto esta questão mede a habilidade ${skill.code}: ${skill.text}. Considere a operação necessária para resolver e o gabarito. Não associe apenas por palavra-chave, tema do texto ou pré-requisito. Várias habilidades podem ter nota alta. Use a escala de 0 a 9.`, criteria: rubric }])),
      route: () => ({ route: 'automatic', outcome: 'bncc_scored' }),
      fallback: { answers: {}, routing: { route: 'fallback', outcome: 'bncc_provider_unavailable' } },
      context: { ...context, candidateCount: batch.length, thresholdPercent },
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 20000,
    })
    model = result.model
    if (result.source === 'fallback') { source = 'fallback'; errorCode = result.failure?.category ?? 'provider_unavailable'; break }
    if (result.source === 'provider') source = 'provider'
    Object.assign(answers, result.answers)
  }
  const { scores, selected } = selectBnccScores(answers, candidates.map((skill) => skill.code), thresholdPercent)
  if (!errorCode && scores.length !== candidates.length) { errorCode = 'incomplete_scores'; source = 'fallback' }
  // Do not publish a partial candidate sweep as a complete multi-label result.
  const chosen = errorCode ? [] : selected
  const skills = chosen.map((item) => getOfficialBnccSkill(item.code)!)
  return {
    bnccCodes: chosen.map((item) => item.code), bnccStatus: chosen.length ? 'mapeado' : 'nao_mapeado',
    bnccSummary: skills.length ? skills.map((skill) => skill.text).join(' ') : null,
    bnccDetails: skills.map((skill) => ({ code: skill.code, description: skill.text, context: skill.context, source: skill.source, dataVersion: skill.dataVersion, record: skill.record as unknown as Record<string, unknown> })),
    bnccAssessment: { version: BNCC_CLASSIFICATION_VERSION, status: errorCode ? 'unavailable' : chosen.length ? 'classified' : 'no_match', source: candidates.length ? source : 'fallback', model, thresholdPercent, assessedAt: new Date().toISOString(), scores, candidateCount: candidates.length, ...(errorCode ? { errorCode } : candidates.length ? {} : { errorCode: 'no_official_candidates' }) },
  }
}

export async function classifyMissingQuestionBncc(questions: ExamQuestion[], context: BnccContext): Promise<ExamQuestion[]> {
  const result = [...questions]
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(8, questions.length) }, async () => {
    while (cursor < questions.length) {
      const index = cursor++
      const question = questions[index]!
      if (!hasBnccCodes(question)) result[index] = { ...question, ...await classifyQuestionBncc(question, context) }
    }
  }))
  return result
}
