import { classifyMissingQuestionBncc } from './questionBnccClassification'
import { classifyExamQuestions } from './questionClassification'
import { findAcervoQuestion, AcervoUnavailableError, type AcervoHistory } from './acervoQuestions'
import { questionContentKey } from './questionOrigin'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { generateExamBlueprint, generateUnifiedQuestion } from '@/lib/generation'
import { cognitiveObjectives, pickTargetEnemSkill, pickTargetSkills } from '@/lib/exams/targetSkills'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import type { CurriculumSelection, CurricularUnit } from '@/types/exam'
import { generateApprovedQuestionStatement } from '@/lib/exams/questionGenerationStages'
import { assessPlanningAlignment, planningTargetForUnit, PlanningAlignmentUnavailableError } from './planningAlignment'

type Params = {
  curriculum: CurriculumSelection
  sourcePreference?: 'auto' | 'acervo' | 'ia'
  excludedQuestions?: ExamQuestion[]
  acervoHistory?: AcervoHistory
  questionNumber: number
  type: ExamQuestion['type']
  instruction?: string
  forceNoVisual?: boolean
  unit?: CurricularUnit
  /** Habilidades BNCC que a questão substituta deve continuar medindo. */
  targetSkillCodes?: string[]
  /** Habilidade ENEM (C:H) que a questão substituta deve continuar medindo. */
  targetEnemCode?: string
  classLabel?: string
  /** Provas inteiras fazem a decisão visual separadamente das classificações. */
  skipJevVisualDecision?: boolean
  /** Contexto das demais questões para evitar sobreposição numa substituição. */
  statementContext?: string
  onStage?: (stage: 'buscando_acervo' | 'gerando_enunciado' | 'decidindo_imagem' | 'gerando_respostas' | 'validando_formato_respostas') => Promise<void>
}

/**
 * Entrada única para gerar ou substituir uma questão. Evita que rotas de
 * revisão usem um pipeline diferente daquele empregado pela fila principal.
 */
export async function generateQuestionWithUnifiedFlow(params: Params): Promise<{
  question: ExamQuestion
  warnings: string[]
}> {
  const unit = params.unit ?? params.curriculum.units[(params.questionNumber - 1) % params.curriculum.units.length]
  if (!unit) throw new Error('Não há unidade curricular disponível para gerar a questão.')

  const curriculumContent = [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent]
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!curriculumContent) throw new Error(`A unidade "${unit.tituloCapitulo}" não possui conteúdo para ancorar a questão.`)

  if (params.sourcePreference !== 'ia') await params.onStage?.('buscando_acervo')
  const earlyTargets = pickTargetSkills({ unit, slotIndexInUnit: params.questionNumber - 1, forcedCodes: params.targetSkillCodes })
  const targetEnemSkill = pickTargetEnemSkill({ unit, slotIndexInUnit: params.questionNumber - 1, forcedCode: params.targetEnemCode })
  const planningTarget = planningTargetForUnit(unit, { ...params.curriculum, classLabel: params.classLabel }, targetEnemSkill, earlyTargets.map((skill) => skill.code))
  const found = params.sourcePreference === 'ia' ? null : await findAcervoQuestion({
    codes: earlyTargets.map((skill) => skill.code), number: params.questionNumber, type: params.type,
    excludedQuestions: params.excludedQuestions, history: params.acervoHistory,
    visualAid: params.forceNoVisual ? 'sem_imagem' : 'auto',
    ...(params.curriculum.segment === 'ensino-medio' ? {
      planningSearch: { subject: params.curriculum.subject, content: unit.conteudo ?? '', title: unit.tituloCapitulo },
      acceptCandidate: async (question: ExamQuestion) => {
        const alignment = await assessPlanningAlignment(question, planningTarget)
        question.plannedEnemSkill = targetEnemSkill
        question.planningAlignment = alignment
        if (alignment.status === 'unavailable') throw new PlanningAlignmentUnavailableError(alignment.evidence)
        return alignment.status === 'aligned'
      },
    } : {}),
  })
  if (found?.question) {
    const [classified] = await classifyExamQuestions([found.question], params.curriculum)
    return { question: { ...classified!, curriculumUnitRowIndex: unit.rowIndex }, warnings: [] }
  }
  if (params.sourcePreference === 'acervo') throw new AcervoUnavailableError(found?.reason ?? 'Não foi encontrada outra questão no acervo.')

  const blueprint = await generateExamBlueprint({
    subject: params.curriculum.subject,
    gradeYear: params.curriculum.gradeYear,
    segment: params.curriculum.segment,
    slots: [{
      number: params.questionNumber,
      unitRowIndex: unit.rowIndex,
      type: params.type,
      visualAid: 'auto',
      curriculumContent,
      unitTitle: unit.tituloCapitulo,
    }],
  })
  const slot = blueprint.slots[0]
  if (!slot) throw new Error('O plano de geração não cobriu a questão solicitada.')

  const officialDescriptions = new Map(unit.habilidades.status === 'mapeado'
    ? unit.habilidades.skills.flatMap((skill) => {
      const official = getOfficialBnccSkill(skill.code)
      return official ? [[official.code, official.text] as const] : []
    })
    : [])
  const targetSkills = pickTargetSkills({ unit, slotIndexInUnit: params.questionNumber - 1, forcedCodes: params.targetSkillCodes, descriptions: officialDescriptions })
    .map((skill) => {
      const official = getOfficialBnccSkill(skill.code)
      return official ? { ...skill, code: official.code, description: official.text } : skill
    })
  const missingOfficialSkills = targetSkills.filter((skill) => !getOfficialBnccSkill(skill.code))
  if (missingOfficialSkills.length) {
    throw new Error(`Habilidade(s) sem ficha BNCC oficial completa: ${missingOfficialSkills.map((skill) => skill.code).join(', ')}.`)
  }
  const approvedStatement = await generateApprovedQuestionStatement({
    targetEnemSkill,
    questionNumber: params.questionNumber,
    subject: params.curriculum.subject,
    gradeYear: params.curriculum.gradeYear,
    segment: params.curriculum.segment,
    classLabel: params.classLabel,
    questionType: params.type,
    difficulty: slot.difficulty,
    curriculumContent,
    targetSkills: targetSkills.map((skill) => {
      const official = getOfficialBnccSkill(skill.code)
      return {
        code: skill.code,
        description: skill.description,
        context: official?.context ?? [],
        source: official?.source ?? '',
        dataVersion: official?.dataVersion ?? '',
      }
    }),
    objectives: cognitiveObjectives(unit),
  }, {
    forcedVisual: slot.needsVisual,
    forceNoVisual: params.forceNoVisual,
    skipJevVisualDecision: params.skipJevVisualDecision,
    feedback: params.statementContext,
    onStage: params.onStage,
  })
  const generated = await generateUnifiedQuestion({
    targetEnemSkill,
    targetSkills,
    objectives: cognitiveObjectives(unit),
    questionNumber: params.questionNumber,
    subject: params.curriculum.subject,
    gradeYear: params.curriculum.gradeYear,
    segment: params.curriculum.segment,
    classLabel: params.classLabel,
    curriculumContent,
    contentPlanInstruction: params.instruction,
    forceNoVisual: params.forceNoVisual,
    approvedStatement: { statement: approvedStatement.statement, supportText: approvedStatement.supportText },
    questionType: params.type,
  }, slot, {
    onSchemaValidated: async () => params.onStage?.('validando_formato_respostas'),
  })
  const corrected = correctSingleQuestion({
    ...generated.question,
    number: params.questionNumber,
    curriculumUnitRowIndex: unit.rowIndex,
    review: null,
  }, params.curriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
  const excluded = new Set([...(params.excludedQuestions ?? []).map(questionContentKey), ...(params.acervoHistory ?? []).map(questionContentKey)])
  if (excluded.has(questionContentKey(corrected.question))) throw new Error('A questão gerada por IA repete uma questão já usada nesta prova.')
  const [mapped] = await classifyMissingQuestionBncc([corrected.question], params.curriculum)
  const [classified] = await classifyExamQuestions([mapped!], params.curriculum)
  if (params.curriculum.segment === 'ensino-medio') {
    classified!.plannedEnemSkill = targetEnemSkill
    classified!.planningAlignment = await assessPlanningAlignment(classified!, planningTarget)
  }
  return {
    question: { acervoFallbackReason: found?.reason, ...classified!, number: params.questionNumber, curriculumUnitRowIndex: unit.rowIndex, review: null },
    warnings: [
      ...blueprint.issues.map((issue) => `Blueprint: ${issue}`),
      ...generated.issues.map((issue) => `[${issue.severity}] ${issue.reason}`),
      ...corrected.issues.map((issue) => `Conferência para o Jev: ${issue}`),
      ...corrected.warnings,
    ],
  }
}
