import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { ExamGenerationInputError } from '@/lib/exams/generateExamCore'
import { selectReinforcementQuestions } from './selectQuestions'
import { generateCommentedResolutions } from './commentedResolution'

// Core da atividade de reforço ENEM (Módulo 3, spec seção 3) — executado
// pelo job 'gerar_reforco_enem'. Uma atividade É um generated_exams com
// examKind 'reforco_enem': compartilha a infraestrutura de documentos,
// autorização e /status, mas é autogerida por quem a criou — não passa pela
// fila de atribuição/revisão/aprovação das provas formais. Diferenças pro
// fluxo de prova: questões vêm SÓ do banco real filtrado por habilidade
// INEP (nada de currículo/planilha), sem proporção 60/40 nem regra 12-15,
// e cada questão ganha resolução comentada pro documento "Gabarito
// Comentado".

export type ReinforcementCoreParams = {
  gradeYear: number
  academicYear?: number
  subject: string
  enemSkills: string[]
  enemQuestionYear?: number
  questionCount: number
  classLabel?: string
  classroomCourseId?: string | null
}

export type ReinforcementCoreResult = {
  examId: number
  questionCount: number
  perSkill: Record<string, number>
  warnings: string[]
}

export async function generateReinforcementCore(params: ReinforcementCoreParams, createdBy: number): Promise<ReinforcementCoreResult> {
  const area = getEnemAreaForSubject(params.subject)
  if (!area) {
    throw new ExamGenerationInputError(`A disciplina "${params.subject}" não tem área ENEM correspondente — reforço ENEM só existe pra disciplinas do Ensino Médio com matriz.`)
  }

  const skillCodes = [...new Set(params.enemSkills.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!skillCodes.length) {
    throw new ExamGenerationInputError('Selecione pelo menos uma habilidade INEP (H1-H30).')
  }

  const selection = await selectReinforcementQuestions({
    area,
    skillCodes,
    count: params.questionCount,
    year: params.enemQuestionYear,
  })
  if (!selection.selected.length) {
    throw new ExamGenerationInputError(
      `Nenhuma questão elegível no banco ENEM${params.enemQuestionYear ? ` de ${params.enemQuestionYear}` : ''} pras habilidades ${skillCodes.join(', ')} (${params.subject}). Ajuste as habilidades ou confira a classificação do banco.`,
    )
  }

  // Reusa o merge da geração de prova: monta ExamQuestion completo
  // (alternativas, saeb com a habilidade, classificação pedagógica
  // inferida) a partir dos ids selecionados, numerando a partir de 1.
  const questions = await buildBankExamQuestions(selection.selected.map((c) => c.id), 1)
  const warnings = [...selection.warnings]

  const { resolutions, warnings: resolutionWarnings } = await generateCommentedResolutions(questions)
  warnings.push(...resolutionWarnings)
  const questionsWithResolutions = questions.map((q) => ({
    ...q,
    commentedResolution: resolutions.get(q.number) ?? null,
  }))

  const payload = {
    metadata: {
      segment: 'ensino-medio',
      gradeYear: params.gradeYear,
      subject: params.subject,
      bimester: null,
      questionCount: questionsWithResolutions.length,
      objectiveCount: questionsWithResolutions.length,
      discursiveCount: 0,
      alternativesCount: 5,
      // Bloco específico do reforço — usado pelos documentos e pelo título
      // padrão da publicação no Classroom.
      reinforcement: {
        enemArea: area,
        enemSkills: skillCodes,
        enemQuestionYear: params.enemQuestionYear ?? null,
        perSkill: selection.perSkill,
      },
    },
    questions: questionsWithResolutions,
  }

  const [inserted] = await db
    .insert(generatedExams)
    .values({
      createdBy,
      segment: 'ensino-medio',
      gradeYear: params.gradeYear,
      academicYear: params.academicYear ?? new Date().getFullYear(),
      subject: params.subject,
      bimester: null,
      questionCount: payload.metadata.questionCount,
      objectiveCount: payload.metadata.objectiveCount,
      discursiveCount: 0,
      enemBankQuestionIds: selection.selected.map((c) => c.id),
      examKind: 'reforco_enem',
      // Quando houver correção individual, uma atividade 100% ENEM usa a
      // mesma TRI INEP da prova: somente os itens que tiverem calibração
      // oficial entram no cálculo. O percentual geral continua ao lado.
      assessmentKind: 'padrao',
      scoringMethod: 'tri',
      status: 'rascunho',
      // Faz a atividade aparecer imediatamente para o professor que a
      // solicitou e garante que ele possa corrigir depois da aplicação. Não
      // é uma atribuição pela coordenação e não dispara notificação.
      assignedTo: createdBy,
      assignedBy: createdBy,
      assignedAt: new Date(),
      generationPayload: payload,
      unmappedWarnings: warnings,
      classroomCourseId: params.classroomCourseId ?? null,
    })
    .returning()

  return {
    examId: inserted.id,
    questionCount: payload.metadata.questionCount,
    perSkill: selection.perSkill,
    warnings,
  }
}
