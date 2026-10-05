import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { generateExamBlueprint, generateUnifiedQuestion } from '@/lib/generation'
import { cognitiveObjectives, pickTargetSkills } from '@/lib/exams/targetSkills'
import { resolveBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import type { CurriculumSelection, CurricularUnit } from '@/types/exam'

type Params = {
  curriculum: CurriculumSelection
  questionNumber: number
  type: ExamQuestion['type']
  instruction?: string
  forceNoVisual?: boolean
  unit?: CurricularUnit
  /** Habilidades BNCC que a questão substituta deve continuar medindo. */
  targetSkillCodes?: string[]
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

  const missingCodes = unit.habilidades.status === 'mapeado' ? unit.habilidades.skills.filter((skill) => !skill.description?.trim()).map((skill) => skill.code) : []
  const descriptions = missingCodes.length ? await resolveBnccDescriptions(missingCodes) : new Map<string, string>()
  const generated = await generateUnifiedQuestion({
    targetSkills: pickTargetSkills({ unit, slotIndexInUnit: params.questionNumber - 1, forcedCodes: params.targetSkillCodes, descriptions }),
    objectives: cognitiveObjectives(unit),
    questionNumber: params.questionNumber,
    subject: params.curriculum.subject,
    gradeYear: params.curriculum.gradeYear,
    segment: params.curriculum.segment,
    curriculumContent,
    contentPlanInstruction: params.instruction,
    forceNoVisual: params.forceNoVisual,
    questionType: params.type,
  }, slot)
  const corrected = correctSingleQuestion({
    ...generated.question,
    number: params.questionNumber,
    curriculumUnitRowIndex: unit.rowIndex,
    review: null,
  }, params.curriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
  return {
    question: { ...corrected.question, number: params.questionNumber, curriculumUnitRowIndex: unit.rowIndex, review: null },
    warnings: [
      ...blueprint.issues.map((issue) => `Blueprint: ${issue}`),
      ...generated.issues.map((issue) => `[${issue.severity}] ${issue.reason}`),
      ...corrected.issues.map((issue) => `Conferência para o Jev: ${issue}`),
      ...corrected.warnings,
    ],
  }
}
