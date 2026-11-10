import { getEnemSkillDescription, isEnemAreaCode } from '@/config/enemMatrix'
import { db } from '@/db/client'
import { enemAreas, enemCompetencies, enemSkills } from '@/db/schema'
import { evaluateWithJev, type JsonValue } from '@/lib/ai/jevClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { getSaebApplicability } from '@/config/saebApplicability'
import { getSaebDescriptorsForSubject } from '@/lib/sheets/bnccSaebMap'
import type { Segment } from '@/types/exam'
import { mapInBatches } from './questionConcurrency'

type Context = { subject: string; gradeYear: number; segment: string }
type Label = { code: string; description: string }
export type InepNode = Label & { children?: InepNode[] }
type Assessment = NonNullable<ExamQuestion['inepAssessment']>
type Catalog = { matrix: NonNullable<Assessment['matrix']>; areas: InepNode[]; approximate: boolean; referenceGrade: number | null }
const VERSION = 'jev-inep-hierarchy-v3'

/** Persist descriptions from the catalog, never text or codes invented by the provider. */
export async function loadInepCatalog(context: Context): Promise<Catalog | null> {
  const applicability = getSaebApplicability(context.segment as Segment, context.gradeYear, context.subject)
  if (!applicability.applicable) return null
  if (applicability.matrixType === 'enem') {
    const [areas, competencies, skills] = await Promise.all([
      db.select().from(enemAreas), db.select().from(enemCompetencies), db.select().from(enemSkills),
    ])
    return { matrix: 'enem', approximate: false, referenceGrade: null, areas: areas.map((area) => ({
      code: area.code, description: area.name,
      children: competencies.filter((c) => c.areaId === area.id).map((c) => ({
        code: `C${c.number}`, description: c.description,
        children: skills.filter((s) => s.competencyId === c.id).map((s) => ({ code: s.code, description: isEnemAreaCode(area.code) ? getEnemSkillDescription(area.code, Number(s.code.replace(/^H/, ''))) ?? s.description : s.description })),
      })),
    })) }
  }
  const descriptors = getSaebDescriptorsForSubject(context.subject, context.gradeYear) ?? []
  const subject = context.subject.trim().toLowerCase()
  const area = ['história', 'geografia'].includes(subject) ? 'Ciências Humanas'
    : ['ciências', 'ciencias'].includes(subject) ? 'Ciências da Natureza'
      : ['língua portuguesa', 'português'].includes(subject) ? 'Língua Portuguesa' : 'Matemática'
  const matrix = context.gradeYear === 2 || ['Ciências Humanas', 'Ciências da Natureza'].includes(area) ? 'novo_saeb' : 'classica'
  return {
    matrix, approximate: applicability.adapted,
    referenceGrade: context.gradeYear === 2 && ['Matemática', 'Língua Portuguesa'].includes(area) ? 2 : context.gradeYear <= 5 ? 5 : 9,
    areas: descriptors.length ? [{ code: area, description: area, children: [...new Set(descriptors.map((d) => d.topicId))].map((topicId) => ({
      code: topicId, description: descriptors.find((d) => d.topicId === topicId)!.topicLabel,
      children: descriptors.filter((d) => d.topicId === topicId).map((d) => ({ code: d.code, description: d.text })),
    })) }] : [],
  }
}

export async function classifyQuestionInep(
  question: ExamQuestion, context: Context, catalog: Catalog | null,
  evaluate: typeof evaluateWithJev = evaluateWithJev,
): Promise<ExamQuestion> {
  if (question.source === 'enem_bank') return question
  const assessment: Assessment = {
    version: VERSION, status: catalog ? 'no_match' : 'not_applicable', matrix: catalog?.matrix ?? null,
    source: 'fallback', model: 'jev-latest', confidence: null, classifiedAt: new Date().toISOString(),
    area: null, competency: null, skill: null, approximate: catalog?.approximate ?? false, referenceGrade: catalog?.referenceGrade ?? null,
  }
  // The legacy field continues feeding maps and exports, with the JEV result.
  const finish = (): ExamQuestion => ({ ...question, inepAssessment: assessment, saeb: {
    applicable: assessment.status === 'classified', source: assessment.matrix,
    value: assessment.status === 'classified' ? `${assessment.area!.description} › ${assessment.competency!.code} — ${assessment.competency!.description} › ${assessment.skill!.code} — ${assessment.skill!.description}` : null,
    approximate: assessment.approximate,
  } })
  if (!catalog) return finish()
  if (!catalog.areas.length) {
    assessment.status = 'unavailable'
    assessment.errorCode = 'empty_official_catalog'
    return finish()
  }
  let candidates = catalog.areas
  for (const stage of ['area', 'competency', 'skill'] as const) {
    if (!candidates.length) {
      assessment.status = 'unavailable'
      assessment.errorCode = 'incomplete_official_catalog'
      return finish()
    }
    const result = await evaluate({
      operation: `jev/exams/inep-${stage}`, questionVersion: VERSION, cacheTtlMs: 24 * 60 * 60 * 1000,
      state: { subject: context.subject, gradeYear: context.gradeYear, segment: context.segment, matrix: catalog.matrix, referenceGrade: catalog.referenceGrade,
        question: { type: question.type, statement: question.statement, supportText: question.supportText ?? null,
          alternatives: question.alternatives ?? null, correctLetter: question.correctLetter ?? null,
          expectedAnswer: question.expectedAnswer ?? null, gradingCriteria: question.gradingCriteria ?? null,
          originalMedia: question.acervoRef?.original.midias ?? null, imageDescription: question.imageDescription ?? question.imageQuery ?? null },
        area: assessment.area, competency: assessment.competency,
      } as JsonValue,
      questions: { selection: { type: 'choice',
        instructions: `Classifique a demanda real da questão na matriz ${catalog.matrix}. Etapa: ${stage}. Escolha obrigatoriamente a opção oficial MAIS ADERENTE à operação predominante exigida para resolver a questão, considerando o gabarito. O objetivo é indexar o item pela habilidade INEP para rastrear resultados na correção. Não exige equivalência literal perfeita. Compare todas as opções; se a relação for parcial, escolha a mais próxima e expresse isso na confiança. Respeite área → competência/eixo/tópico → habilidade/descritor. Não invente códigos nem use abstenção.`,
        criteria: Object.fromEntries(candidates.map((candidate) => [candidate.code, candidate.description])),
      } },
      route: () => ({ route: 'automatic', outcome: `inep_${stage}_classified` }),
      fallback: { answers: { selection: { type: 'choice', choice: 'no_match', confidence: 0 } }, routing: { route: 'fallback', outcome: 'inep_provider_unavailable' } },
      context: { subject: context.subject, gradeYear: context.gradeYear, segment: context.segment, questionNumber: question.number, stage },
    })
    assessment.model = result.model
    if (assessment.source !== 'provider' || result.source === 'provider') assessment.source = result.source
    const answer = result.answers.selection
    if (result.source === 'fallback' || answer?.type !== 'choice') {
      assessment.status = 'unavailable'
      assessment.source = 'fallback'
      assessment.errorCode = 'inep_provider_unavailable'
      return finish()
    }
    const selected = candidates.find((candidate) => candidate.code === answer.choice)
    if (!selected) {
      assessment.status = 'unavailable'
      assessment.errorCode = 'invalid_catalog_choice'
      return finish()
    }
    if (answer.confidence !== undefined) assessment.confidence = Math.min(assessment.confidence ?? 1, answer.confidence)
    assessment[stage] = { code: selected.code, description: selected.description }
    candidates = selected.children ?? []
  }
  assessment.status = 'classified'
  return finish()
}

export async function classifyQuestionsInep(questions: ExamQuestion[], context: Context): Promise<ExamQuestion[]> {
  if (!questions.some((question) => question.source !== 'enem_bank')) return questions
  let catalog: Catalog | null
  try {
    catalog = await loadInepCatalog(context)
  } catch {
    return questions.map((question) => question.source === 'enem_bank' ? question : ({ ...question,
      saeb: { applicable: false, source: null, value: null, approximate: false },
      inepAssessment: { version: VERSION, status: 'unavailable', matrix: context.segment === 'ensino-medio' ? 'enem' : null,
        source: 'fallback', model: 'jev-latest', confidence: null, classifiedAt: new Date().toISOString(),
        area: null, competency: null, skill: null, approximate: false, referenceGrade: null, errorCode: 'official_catalog_unavailable' },
    }))
  }
  return mapInBatches(questions, (question) => classifyQuestionInep(question, context, catalog))
}
