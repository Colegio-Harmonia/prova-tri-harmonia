import { loadPlannedEnemCandidates, selectPlannedEnemQuestions, loadPlanningQuestionHistory } from './plannedEnemSelection'
import { planningTargetForUnit } from './planningAlignment'
import { classifyExamQuestions } from './questionClassification'
import { classifyMissingQuestionBncc } from './questionBnccClassification'
import { classifyImportedQuestionBloom } from './importedQuestionBloom'
import { acervoIdentity } from './questionOrigin'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, generationJobs, users, type AssessmentKind, type ExamKind } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { CurriculumPlanError } from '@/lib/curriculum/planCurriculum'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { alternativesCountForSegment, computeQuestionSplit } from '@/lib/gemini/promptBuilder'
import { type ExamGenerationResult, type ExamQuestion } from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { attachImagesToExam } from '@/lib/images/questionImageService'
import { planAutomaticVisuals } from '@/lib/illustrations/automaticVisualPlan'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { buildPlannedQuestionSlots, shouldRequireVisualAid, validateCurriculumPlan, type PlannedQuestionSlot } from '@/lib/exams/contentPlan'
import { assembleBestExamCandidates, compactQuestionContext, validateExamAssembly, type QuestionCandidate } from '@/lib/exams/examQualityAssembly'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { cognitiveObjectives, pickTargetEnemSkill, pickTargetSkills } from '@/lib/exams/targetSkills'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { buildActivityBnccSlots, type ActivityBnccPlanItem, type ActivityBnccSlot } from '@/lib/exams/activityBnccPlan'
import { QUALITY_REPORT_VERSION } from '@/lib/exams/qualityReport'
import { repairQuestionFromDiagnostics } from '@/lib/exams/repairQuestion'
import { diagnosticFromIssue, shouldRegenerateQuestionFromDiagnostics, unauthorizedRepairChanges } from '@/lib/exams/qualityDiagnostics'
import { coherenceIssues, EXAM_OVERLAP_ALERT, generateExamBlueprint, generateStagedQuestion, generateUnifiedQuestion, isUnifiedGenerationEnabled, questionCoherenceText, textSimilarity } from '@/lib/generation'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'
import { JevUnavailableError } from '@/lib/ai/jevClient'
import { generateApprovedQuestionStatement, type ApprovedQuestionStatement } from '@/lib/exams/questionGenerationStages'
import { mapWithConcurrency, QUESTION_GENERATION_CONCURRENCY } from '@/lib/exams/questionConcurrency'
import { decideExamGenerationStrategy, examGenerationStrategyInstruction } from '@/lib/ai/examGenerationDecision'
import { activityGenerationStrategyInstruction, decideActivityGenerationStrategy, type ActivityGenerationDecision, type ActivityPedagogicalIntent } from '@/lib/ai/activityGenerationDecision'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { appendQualityRepairHistory, getReusableQuestionPayloads, getPersistedQuestionQualityReports, getQualityRepairHistory, getQuestionStageCheckpoints, initializeJobItems, releaseQualityRepairAttempt, reserveQualityRepairAttempt, saveItemProgress, saveQuestionStageCheckpoint, setJobItemStage, type QualityRepairHistoryEntry } from '@/lib/queue/jobProgress'
import type { CurriculumPlanItem, CurriculumSelection } from '@/types/exam'
import { shouldPreferFundamentalOneVisual } from '@/lib/pedagogical/gradeInstructions'
import { generateWholeExam, classifyExamDifficulty, assignExamPercentageWeights, type WholeExamBlueprintSlot } from './wholeExamGeneration'
import { reviewExamVisuals } from './examVisualReview'

/** Falhas transitórias não devem gastar candidatas nem tentativas da fila. */
function isTransientProviderFailure(error: unknown): boolean {
  if (error instanceof JevUnavailableError) return error.retryable
  return error instanceof StructuredGenerationError && [
    'rate_limited',
    'timeout',
    'provider_unavailable',
    'provider_request_failed',
  ].includes(error.failureCode)
}

/** Mantém o diagnóstico estruturado da IA visível na fila, sem expor JSON bruto. */
function generationFailureMessage(error: unknown): string {
  if (error instanceof StructuredGenerationError) {
    const details = [...new Set(error.issues.map((issue) => issue.trim()).filter(Boolean))].slice(0, 3)
    const suffix = details.length ? ` Detalhe: ${details.join(' | ')}` : ''
    return `[ia:${error.failureCode}] ${error.message}${suffix}`
  }
  return error instanceof Error ? error.message : 'erro'
}

function isApprovedQuestionStatement(value: unknown): value is ApprovedQuestionStatement {
  if (!value || typeof value !== 'object') return false
  const statement = value as Partial<ApprovedQuestionStatement>
  return typeof statement.statement === 'string'
    && (typeof statement.supportText === 'string' || statement.supportText === null)
    && Boolean(statement.visual && typeof statement.visual === 'object' && statement.visual.pendingReview !== true)
}

function isQuestionStatementDraft(value: unknown): value is Pick<ApprovedQuestionStatement, 'statement' | 'supportText'> {
  if (!value || typeof value !== 'object') return false
  const statement = value as Partial<ApprovedQuestionStatement>
  return typeof statement.statement === 'string' && (typeof statement.supportText === 'string' || statement.supportText === null)
}

// Core da geração de prova, compartilhado entre a rota síncrona
// (/api/exams/generate) e o worker da fila (job 'gerar_prova') — Subtarefa
// 1a, 24/07/2026. Extraído da rota sem mudança de comportamento: a rota
// continua mapeando os mesmos erros pros mesmos códigos HTTP, e o worker
// converte qualquer erro em status 'erro' do job.
//
// Este módulo NÃO faz autenticação nem validação de body — quem chama é
// responsável por entregar params já validados (Zod na rota, Zod de
// payload de job no worker) e um userId real.

export type GenerateExamCoreParams = {
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  gradeYear: number
  academicYear?: number
  subject: string
  classLabel?: string
  bimester?: number
  questionCount: number
  questionSource?: 'acervo' | 'ia'
  objectivePercentage?: number
  enemBankQuestionIds: number[]
  // Rótulo pedagógico exibido na prova. A TRI INEP é definida pelos itens
  // reais do banco, não por este campo. Default 'padrao'.
  assessmentKind?: AssessmentKind
  // Atividades FI/FII usam o mesmo motor de itens e revisão, mas ficam em
  // uma coleção própria e trazem o recorte BNCC explícito no payload.
  examKind?: Extract<ExamKind, 'prova' | 'atividade'>
  bnccCodes?: string[]
  bnccPlan?: ActivityBnccPlanItem[]
  classroomCourseId?: string | null
  pedagogicalIntent?: ActivityPedagogicalIntent
  contentPlan?: CurriculumPlanItem[]
  assignedTo?: number
  // Planejamento interno aprovado usado como currículo no lugar da planilha.
  curriculumPlanVersionId?: number
  contentPlanIncludesEnem?: boolean
  curriculumPlanId?: number
  /** Presente somente quando a geração vem da fila; habilita retomada por item. */
  generationJobId?: number
}

// Erros de entrada/recorte curricular (viram 422 na rota, mensagem legível
// no job). TabResolutionError e SheetNotConfiguredError propagam direto —
// a rota já os trata por instanceof, e a mensagem deles é auto-explicativa.
export class ExamGenerationInputError extends Error {}
class FinalQuestionError extends ExamGenerationInputError {}

// Falha genérica lendo a planilha de currículo (Sheets fora do ar, credencial
// etc.) — distinta de falha de IA: a rota mapeia pra 500 com a mesma mensagem
// que a versão síncrona original usava, e o job mostra uma mensagem que
// aponta pra planilha, não pro DeepSeek.
export class CurriculumReadError extends Error {
  constructor(public readonly cause: unknown) {
    super('Erro ao ler a planilha de currículo.')
  }
}

export type GenerateExamCoreResult = {
  examId: number
  exam: ExamGenerationResult
  warnings: string[]
  issues: string[]
  pedagogicalClassificationsCreated: number
}

/** Encaminha provas novas para a chamada de exame completo. A função evita
 * estreitar o código de compatibilidade legado durante a checagem de tipos. */
function shouldGenerateWholeExam(params: GenerateExamCoreParams) {
  return params.questionCount > 0 || params.enemBankQuestionIds.length > 0
}

async function generateAndPersistWholeExam(params: {
  input: GenerateExamCoreParams
  createdBy: number
  formalAssigneeId?: number
  assessmentKind: AssessmentKind
  examKind: Extract<ExamKind, 'prova' | 'atividade'>
  curriculum: CurriculumSelection
  slots: PlannedQuestionSlot[]
  activityBnccSlots: ActivityBnccSlot[]
  selectedBnccCodes: string[]
  selectedBnccDescriptions: Map<string, string>
  warnings: string[]
  aiObjectiveCount: number
}): Promise<GenerateExamCoreResult> {
  const { input, createdBy, assessmentKind, examKind, curriculum } = params
  const alternativesCount = alternativesCountForSegment(input.segment)
  const byRowIndex = new Map(curriculum.units.map((unit) => [unit.rowIndex, unit]))
  const countInUnit = new Map<number, number>()
  const allowedBloom = input.segment === 'anos-iniciais'
    ? ['lembrar', 'compreender', 'aplicar'] as const
    : input.segment === 'anos-finais'
      ? ['compreender', 'aplicar', 'analisar', 'avaliar'] as const
      : ['compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const
  const blueprintSlots: WholeExamBlueprintSlot[] = params.slots.map((slot) => {
    const unit = byRowIndex.get(slot.unitRowIndex)
    if (!unit) throw new ExamGenerationInputError(`Capítulo ${slot.unitRowIndex} não foi encontrado no planejamento.`)
    const offset = countInUnit.get(slot.unitRowIndex) ?? 0
    countInUnit.set(slot.unitRowIndex, offset + 1)
    const activitySlot = params.activityBnccSlots.find((candidate) => candidate.questionNumber === slot.number)
    const targets = pickTargetSkills({
      unit,
      slotIndexInUnit: offset,
      forcedCodes: activitySlot ? [activitySlot.code] : undefined,
    })
    const targetSkills = targets.map((skill) => {
      const official = getOfficialBnccSkill(skill.code)
      if (!official) throw new ExamGenerationInputError(`Habilidade ${skill.code} sem cartão oficial completo em @bncc/dados.`)
      return official
    })
    return {
      ...slot,
      targetBloomLevel: allowedBloom[(slot.number - 1) % allowedBloom.length]!,
      targetSkills,
      targetEnemSkill: pickTargetEnemSkill({ unit, slotIndexInUnit: offset }),
      unitTitle: unit.tituloCapitulo,
      curriculumContent: unit.conteudo,
      enrichedContent: unit.enrichedContent ?? null,
      objectives: cognitiveObjectives(unit),
    }
  })

  if (input.generationJobId) {
    await initializeJobItems(input.generationJobId, params.slots.map((slot) => slot.number))
    await Promise.all(params.slots.map((slot) => setJobItemStage(input.generationJobId!, slot.number, 'aguardando_busca_acervo')))
  }

  let bankQuestions = await classifyImportedQuestionBloom(await buildBankExamQuestions(input.enemBankQuestionIds, params.slots.length + 1), input)
  const bankWarnings: string[] = []
  const history = input.segment === 'ensino-medio' ? await loadPlanningQuestionHistory(input) : []
  const historicalBankIds = new Set(history.flatMap((question) => question.enemBankRef ? [question.enemBankRef.questionId] : []))
  for (const id of input.enemBankQuestionIds) if (historicalBankIds.has(id)) bankWarnings.push(`A questão ENEM ${id} já foi utilizada neste recorte; mantida por seleção explícita.`)
  if (input.contentPlanIncludesEnem && input.enemBankQuestionIds.length) {
    const candidates = await loadPlannedEnemCandidates(input.subject, input.enemBankQuestionIds)
    const selection = await selectPlannedEnemQuestions({ candidates, count: input.enemBankQuestionIds.length, strictLanguage: true,
      slots: blueprintSlots.map((slot) => ({ ...slot, target: planningTargetForUnit(byRowIndex.get(slot.unitRowIndex)!, input, slot.targetEnemSkill, slot.targetSkills.map((skill) => skill.code)) })),
    })
    if (selection.assignments.length !== input.enemBankQuestionIds.length) throw new ExamGenerationInputError('As questões ENEM selecionadas não cobrem posições compatíveis do planejamento. Revise a seleção: ' + selection.warnings.join(' '))
    bankWarnings.push(...selection.warnings)
    const assignments = new Map(selection.assignments.map((assignment) => [assignment.questionId, assignment]))
    bankQuestions = bankQuestions.map((question) => {
      const assignment = assignments.get(question.enemBankRef!.questionId)!
      const slot = blueprintSlots.find((slot) => slot.number === assignment.slotNumber)!
      return { ...question, number: slot.number, slotId: `q${String(slot.number).padStart(2, '0')}`, curriculumUnitRowIndex: slot.unitRowIndex,
        plannedEnemSkill: slot.targetEnemSkill, planningAlignment: assignment.alignment,
        curriculumSnapshot: { unitTitle: slot.unitTitle, content: slot.curriculumContent, enrichedContent: slot.enrichedContent, objectives: slot.objectives } }
    })
    const occupied = new Set(selection.assignments.map((assignment) => assignment.slotNumber))
    blueprintSlots.splice(0, blueprintSlots.length, ...blueprintSlots.filter((slot) => !occupied.has(slot.number)))
  }
  const actualObjectiveCount = blueprintSlots.filter((slot) => slot.type === 'objetiva').length
  let aiQuestions: ExamQuestion[]
  const reusable = input.generationJobId ? await getReusableQuestionPayloads(input.generationJobId) : new Map<number, ExamQuestion>()
  const reusableQuestions = blueprintSlots.map((slot) => reusable.get(slot.number))
  const reusableExamIsComplete = reusableQuestions.every((question, index) =>
    question?.slotId === `q${String(blueprintSlots[index]!.number).padStart(2, '0')}`
    && question.number === blueprintSlots[index]!.number,
  )
  if (!blueprintSlots.length) {
    aiQuestions = []
  } else if (reusableExamIsComplete) {
    aiQuestions = await classifyMissingQuestionBncc(await classifyImportedQuestionBloom(reusableQuestions as ExamQuestion[], input), input)
  } else {
    const generated = await generateWholeExam({
      subject: input.subject,
      segment: input.segment,
      gradeYear: input.gradeYear,
      academicYear: input.academicYear ?? new Date().getFullYear(),
      classLabel: input.classLabel,
      bimester: input.bimester,
      questionCount: blueprintSlots.length,
      alternativesCount,
      objectiveCount: actualObjectiveCount,
      discursiveCount: blueprintSlots.length - actualObjectiveCount,
      slots: blueprintSlots,
      questionSource: input.questionSource,
      generationJobId: input.generationJobId,
      excludedQuestions: [...bankQuestions, ...history],
      onStage: async (number, stage) => { if (input.generationJobId) await setJobItemStage(input.generationJobId, number, stage) },
      generationInstruction: examKind === 'atividade'
        ? `Intenção pedagógica selecionada pelo professor: ${input.pedagogicalIntent ?? 'formativa'}. Habilidades da atividade: ${params.selectedBnccCodes.join(', ')}.`
        : `Tipo de avaliação: ${assessmentKind}.`,
    })
    aiQuestions = generated.questions
  }

  if (input.generationJobId) await Promise.all(aiQuestions.map((question) => setJobItemStage(input.generationJobId!, question.number, 'revisando_coerencia_visual')))
  const visualReview = await reviewExamVisuals(aiQuestions, { subject: input.subject, segment: input.segment, gradeYear: input.gradeYear })
  aiQuestions = visualReview.questions
  if (input.generationJobId) await Promise.all(aiQuestions.map((question) => saveItemProgress(input.generationJobId!, question.number, 'gerando', question)))

  if (bankQuestions.length !== input.enemBankQuestionIds.length) {
    throw new ExamGenerationInputError('Uma ou mais questões ENEM selecionadas não estão mais disponíveis. Atualize a seleção antes de gerar a prova.')
  }
  let allQuestions = [...aiQuestions, ...bankQuestions].sort((a, b) => a.number - b.number)
  const warnings = [...params.warnings, ...bankWarnings, ...visualReview.warnings, ...aiQuestions.filter((q) => q.acervoFallbackReason).map((q) => `Questão ${q.number}: GERADO POR IA. ${q.acervoFallbackReason}`)]
  const classContext = input.segment === 'ensino-medio'
    ? `Ensino Médio ${input.gradeYear}º ano do ensino brasileiro`
    : `${input.gradeYear}º ano do Ensino Fundamental, ${input.segment === 'anos-iniciais' ? 'Anos Iniciais' : 'Anos Finais'}, do ensino brasileiro`
  if (input.generationJobId) {
    await Promise.all(aiQuestions.map((question) => setJobItemStage(input.generationJobId!, question.number, 'classificando_dificuldade')))
  }
  const difficulty = await classifyExamDifficulty(allQuestions, classContext, input.subject)
  if (difficulty.source === 'fallback') warnings.push('O JEV não respondeu à classificação de dificuldade; as questões receberam dificuldade média provisória e pesos iguais até revisão.')
  allQuestions = await classifyExamQuestions(assignExamPercentageWeights(difficulty.questions), input)
  const hasPendingImages = allQuestions.some((question) => (question.needsImage ?? question.hasImage) && !question.image)

  const objectiveCount = allQuestions.filter((question) => question.type === 'objetiva').length
  const discursiveCount = allQuestions.filter((question) => question.type === 'descritiva').length
  const updatedAt = new Date().toISOString()
  const basePayload: ExamGenerationResult = {
    metadata: {
      generationEngine: 'whole-exam-v1',
      questionSource: input.questionSource ?? 'acervo',
      acervoHistory: aiQuestions.flatMap((q) => { const key = acervoIdentity(q); return key ? [{ key, statement: q.statement, questionId: q.acervoRef!.questionId }] : [] }),
      segment: input.segment,
      gradeYear: input.gradeYear,
      academicYear: input.academicYear ?? new Date().getFullYear(),
      subject: input.subject,
      ...(input.classLabel ? { classLabel: input.classLabel } : {}),
      bimester: input.bimester ?? null,
      questionCount: allQuestions.length,
      objectiveCount,
      discursiveCount,
      alternativesCount,
      ...(input.curriculumPlanId ? { curriculumPlanId: input.curriculumPlanId } : {}),
      ...(curriculum.planReference ? { curriculumPlanVersionId: curriculum.planReference.versionId } : {}),
      difficultyClassification: {
        version: 'jev-difficulty-v1',
        source: difficulty.source,
        model: difficulty.model,
        classifiedAt: difficulty.classifiedAt,
        distribution: difficulty.distribution,
        weightBasis: 'difficulty_normalized_to_100',
      },
      imageGeneration: {
        status: hasPendingImages ? 'pending' : 'complete',
        jobId: null,
        pendingQuestionNumbers: hasPendingImages ? allQuestions.filter((question) => (question.needsImage ?? question.hasImage) && !question.image).map((question) => question.number) : [],
        updatedAt,
      },
    },
    questions: allQuestions,
  }
  const activityPayload = examKind === 'atividade'
    ? {
      ...basePayload,
      metadata: {
        ...basePayload.metadata,
        activity: {
          bnccCodes: params.selectedBnccCodes,
          bnccPlan: input.bnccPlan ?? null,
          bnccDescriptions: Object.fromEntries(params.selectedBnccDescriptions),
          pedagogicalIntent: input.pedagogicalIntent ?? 'formativa',
          strategy: null,
          rubricVersion: 'bncc-v1',
        },
      },
    }
    : basePayload
  const warningsWithImageState = hasPendingImages
    ? [...warnings, 'A prova foi salva. A produção das imagens será executada em segundo plano.']
    : warnings

  const persisted = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(generatedExams).values({
      createdBy,
      segment: input.segment,
      gradeYear: input.gradeYear,
      academicYear: input.academicYear ?? new Date().getFullYear(),
      subject: input.subject,
      bimester: input.bimester ?? null,
      questionCount: allQuestions.length,
      objectiveCount,
      discursiveCount,
      enemBankQuestionIds: input.enemBankQuestionIds.length ? input.enemBankQuestionIds : null,
      examKind,
      assessmentKind,
      scoringMethod: scoringMethodForQuestions(allQuestions),
      status: examKind === 'prova' ? 'atribuido' : 'rascunho',
      generationPayload: activityPayload,
      unmappedWarnings: [...curriculum.unmappedWarnings, ...warningsWithImageState],
      classroomCourseId: input.classroomCourseId ?? null,
      ...(examKind === 'prova' ? { assignedTo: params.formalAssigneeId, assignedBy: createdBy, assignedAt: new Date() } : { assignedTo: createdBy, assignedBy: createdBy, assignedAt: new Date() }),
    }).returning()

    let imageJobId: number | null = null
    if (hasPendingImages) {
      const [imageJob] = await tx.insert(generationJobs).values({
        jobType: 'gerar_imagens_prova',
        payload: { examId: inserted.id },
        requestedBy: createdBy,
        priority: 6,
      }).returning({ id: generationJobs.id })
      imageJobId = imageJob!.id
    }
    const storedPayload: ExamGenerationResult = {
      ...activityPayload,
      metadata: {
        ...activityPayload.metadata,
        imageGeneration: {
          ...activityPayload.metadata.imageGeneration!,
          jobId: imageJobId,
        },
      },
    }
    if (hasPendingImages) await tx.update(generatedExams).set({ generationPayload: storedPayload }).where(eq(generatedExams.id, inserted.id))
    if (input.generationJobId) {
      await tx.update(generationJobs).set({ resultExamId: inserted.id }).where(eq(generationJobs.id, input.generationJobId))
    }
    return { inserted, payload: storedPayload, imageJobId }
  })

  if (input.generationJobId) {
    await Promise.all(allQuestions.map((question) => saveItemProgress(input.generationJobId!, question.number, 'concluido', question)))
  }
  let classificationsCreated = 0
  try {
    const pedagogical = await persistGeneratedQuestionClassifications({
      examId: persisted.inserted.id,
      questions: allQuestions,
      createdBy,
      modelProvider: 'whole-exam',
      modelName: 'whole-exam-v1',
      promptVersion: 'whole-exam-v1',
    })
    classificationsCreated = pedagogical.created.length
  } catch (error) {
    warningsWithImageState.push('A prova foi salva, mas as classificações taxonômicas DOK/SOLO não foram persistidas.')
    console.error('[generateExamCore] falha ao persistir classificações taxonômicas:', error)
  }
  return {
    examId: persisted.inserted.id,
    exam: persisted.payload,
    warnings: warningsWithImageState,
    issues: [],
    pedagogicalClassificationsCreated: classificationsCreated,
  }
}

export async function generateExamCore(params: GenerateExamCoreParams, createdBy: number): Promise<GenerateExamCoreResult> {
  const assessmentKind = params.assessmentKind ?? 'padrao'
  const examKind = params.examKind ?? 'prova'
  const creator = await db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, createdBy), columns: { id: true, role: true } })
  if (!creator) throw new ExamGenerationInputError('Usuário solicitante não encontrado.')
  // Professor sempre recebe a própria prova. Coordenação precisa informar o
  // professor responsável antes que a geração entre no fluxo formal.
  const formalAssigneeId = examKind === 'prova' ? (isStaffSuperuser(creator.role) ? params.assignedTo : createdBy) : undefined
  if (examKind === 'prova' && !formalAssigneeId) throw new ExamGenerationInputError('Selecione o professor responsável pela prova antes de gerar.')
  if (formalAssigneeId) {
    const assignee = await db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, formalAssigneeId), columns: { id: true, active: true, role: true } })
    if (!assignee?.active || assignee.role !== 'professor') throw new ExamGenerationInputError('O responsável selecionado precisa ser um professor ativo.')
  }
  // Regra de negócio garantida aqui (não só na validação de borda): o
  // simulado ENEM pressupõe o banco/matriz do Ensino Médio.
  if (assessmentKind !== 'padrao' && params.segment !== 'ensino-medio') {
    throw new ExamGenerationInputError('Simulado ENEM só existe no Ensino Médio.')
  }
  if (assessmentKind === 'enem' && !params.enemBankQuestionIds.length) {
    throw new ExamGenerationInputError('Um simulado ENEM precisa incluir ao menos uma questão real do banco ENEM.')
  }
  if (params.questionCount + params.enemBankQuestionIds.length <= 0) {
    throw new ExamGenerationInputError('A prova precisa ter pelo menos uma questão gerada ou selecionada do banco ENEM.')
  }
  if (examKind === 'prova' && params.questionCount > 0 && !params.curriculumPlanId) {
    throw new ExamGenerationInputError('A geração de provas exige um planejamento aprovado da aba Planejamentos. A planilha não é usada como origem nesta etapa.')
  }

  // O insert da prova e a referência do job são confirmados na mesma
  // transação. Uma retomada do worker depois de salvar não cria outra prova.
  if (params.generationJobId) {
    const existingJob = await db.query.generationJobs.findFirst({ where: (table, { eq }) => eq(table.id, params.generationJobId!) })
    if (existingJob?.resultExamId) {
      const existingExam = await db.query.generatedExams.findFirst({ where: (table, { eq }) => eq(table.id, existingJob.resultExamId!) })
      if (existingExam) {
        const exam = existingExam.generationPayload as GenerateExamCoreResult['exam']
        return { examId: existingExam.id, exam, warnings: [], issues: [], pedagogicalClassificationsCreated: 0 }
      }
    }
  }

  let curriculum
  try {
    curriculum = await getCurriculumForExam(params)
  } catch (err) {
    if (err instanceof CurriculumPlanError) throw new ExamGenerationInputError(err.message)
    if (err instanceof TabResolutionError || err instanceof SheetNotConfiguredError) throw err
    console.error('[generateExamCore] erro ao ler currículo:', err)
    throw new CurriculumReadError(err)
  }

  if (curriculum.planReference && !params.curriculumPlanVersionId) {
    params = { ...params, curriculumPlanVersionId: curriculum.planReference.versionId }
    if (params.generationJobId) {
      const job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, params.generationJobId) })
      if (job) await db.update(generationJobs).set({ payload: { ...(job.payload as Record<string, unknown>), curriculumPlanVersionId: curriculum.planReference.versionId } }).where(eq(generationJobs.id, params.generationJobId))
    }
  }

  if (params.questionCount > 0 && !curriculum.units.length) {
    throw new ExamGenerationInputError('Nenhuma unidade curricular encontrada para os filtros selecionados.')
  }

  try {
    const planned = validateCurriculumPlan(curriculum.units, params.contentPlan, params.questionCount + (params.contentPlanIncludesEnem ? params.enemBankQuestionIds.length : 0))
    if (params.contentPlan?.length) curriculum = { ...curriculum, units: planned.selectedUnits }
  } catch (error) {
    throw new ExamGenerationInputError(error instanceof Error ? error.message : 'Matriz da avaliação inválida.')
  }

  const selectedBnccCodes = [...new Set((params.bnccCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))]
  const selectedBnccDescriptions = new Map<string, string>()
  let activityBnccSlots: ActivityBnccSlot[] = []
  if (examKind === 'atividade') {
    if (!selectedBnccCodes.length) throw new ExamGenerationInputError('Selecione pelo menos uma habilidade BNCC para a atividade.')
    const selected = new Set(selectedBnccCodes)
    const invalidCodes = selectedBnccCodes.filter((code) => !getOfficialBnccSkill(code))
    if (invalidCodes.length) throw new ExamGenerationInputError(`Código(s) BNCC sem correspondência oficial em @bncc/dados: ${invalidCodes.join(', ')}.`)
    const focusedUnits = curriculum.units.filter((unit) =>
      unit.habilidades.status === 'mapeado' && unit.habilidades.skills.some((skill) => selected.has(skill.code.toUpperCase())),
    )
    if (!focusedUnits.length) {
      throw new ExamGenerationInputError('Nenhuma unidade curricular corresponde às habilidades BNCC selecionadas. Atualize o recorte ou confira o currículo da série.')
    }
    for (const unit of focusedUnits) {
      for (const skill of unit.habilidades.skills) {
        const code = skill.code.toUpperCase()
        const official = getOfficialBnccSkill(code)
        if (selected.has(code) && official) selectedBnccDescriptions.set(code, official.text)
      }
    }
    curriculum = { ...curriculum, units: focusedUnits }
    try {
      activityBnccSlots = buildActivityBnccSlots(curriculum, params.bnccPlan, params.questionCount)
    } catch (error) {
      throw new ExamGenerationInputError(error instanceof Error ? error.message : 'Matriz BNCC inválida.')
    }
  }

  let aiQuestions: ExamQuestion[] = []
  let warnings: string[] = []
  let activityGenerationDecision: ActivityGenerationDecision | null = null
  let qualityTestWarnings: string[] = []
  let qualityTestRepairedNumbers: number[] = []
  let qualityTestReports: Array<{ phase: string; results: Awaited<ReturnType<typeof runQuestionQualityTest>>['report'] }> = []
  let regenerateQuestion: ((questionNumber: number, current: ExamQuestion, forceNoVisual?: boolean, diagnostics?: import('./qualityDiagnostics').QualityDiagnostic[]) => Promise<ExamQuestion>) | null = null
  let repairQualityIssue: ((questionNumber: number, current: ExamQuestion, diagnostics: import('./qualityDiagnostics').QualityDiagnostic[], attempt: number) => Promise<ExamQuestion | null>) | null = null
  const jevEvidenceByQuestion = new Map<number, string[]>()
  const individuallyFinalizedQuestions = new Map<number, { question: ExamQuestion; report: Awaited<ReturnType<typeof runQuestionQualityTest>>['report'][number] }>()
  const visualAidByQuestion = new Map<number, CurriculumPlanItem['visualAid']>()
  const jevRequiredVisualByQuestion = new Set<number>()
  const issues: string[] = []
  const pendingQuestionFailures = new Map<number, string>()
  const stageCheckpoints = params.generationJobId ? await getQuestionStageCheckpoints(params.generationJobId) : new Map()
  const finalizeGeneratedQuestion = async (
    initialQuestion: ExamQuestion,
  ): Promise<ExamQuestion> => {
    let question = initialQuestion
    const number = question.number
    if (params.generationJobId) await setJobItemStage(params.generationJobId, number, 'produzindo_imagem')
    let visualPlanning = await planAutomaticVisuals(params.subject, [question])
    const plannedQuestion = visualPlanning.questions[0] ?? question
    if (visualPlanning.blockedQuestionNumbers.includes(number)) {
      plannedQuestion.needsImage = true
      plannedQuestion.imageQuery ??= plannedQuestion.visualPlan?.rationale ?? 'Recurso visual citado no enunciado; classificar dependência com Jev.'
    }
    if (params.generationJobId) {
      await setJobItemStage(params.generationJobId, number, plannedQuestion.needsImage ? 'produzindo_imagem' : 'visual_nao_necessario')
      await saveQuestionStageCheckpoint(params.generationJobId, number, {
        version: 1,
        visualDecision: { required: Boolean(plannedQuestion.needsImage), plan: plannedQuestion.visualPlan ?? null },
      })
    }
    const attached = await attachImagesToExam({
      metadata: {
        segment: params.segment,
        gradeYear: params.gradeYear,
        subject: params.subject,
        bimester: params.bimester ?? null,
        questionCount: 1,
        objectiveCount: plannedQuestion.type === 'objetiva' ? 1 : 0,
        discursiveCount: plannedQuestion.type === 'descritiva' ? 1 : 0,
        alternativesCount,
      },
      questions: [plannedQuestion],
    }, {
      requireResolvedImages: false,
      maxAttemptsPerImage: 2,
      subject: params.subject,
      onQuestionStart: async () => {
        if (params.generationJobId) await setJobItemStage(params.generationJobId, number, 'produzindo_imagem')
      },
    })
    let completedQuestion = attached.questions[0] ?? plannedQuestion
    if (completedQuestion.needsImage && !completedQuestion.image) {
      const message = `Questão ${number} precisa de imagem, mas o recurso visual não foi gerado e validado.`
      qualityTestWarnings.push(message)
    }
    if (params.generationJobId) {
      await saveItemProgress(params.generationJobId, number, 'gerando', completedQuestion)
      await setJobItemStage(params.generationJobId, number, 'validando_respostas')
    }
    let audit = await runQuestionQualityTest(
      curriculum,
      [completedQuestion],
      jevEvidenceByQuestion,
      params.classLabel,
      undefined,
      undefined,
      'full',
    )
    qualityTestWarnings.push(...audit.warnings)
    let report = audit.report[0]
    const requiresHumanReview = report?.diagnostics?.some((item) => item.blocksApproval && item.repairAction === 'revisao_humana')
    if (!report?.approved && report?.auditStatus !== 'jev_unavailable' && !requiresHumanReview) {
      const diagnostics = report?.diagnostics?.filter((item) => item.blocksApproval) ?? []
      if (diagnostics.length) {
        if (params.generationJobId) await setJobItemStage(params.generationJobId, number, 'reparando_respostas')
        const repaired = await repairQuestionFromDiagnostics({
          question: completedQuestion,
          curriculum,
          diagnostics,
          context: `exams/final-quality-repair-${number}`,
          classLabel: params.classLabel,
          scope: 'answers',
        })
        if (repaired && JSON.stringify(repaired.question) !== JSON.stringify(completedQuestion)) {
          completedQuestion = repaired.question
          if (params.generationJobId) await setJobItemStage(params.generationJobId, number, 'produzindo_imagem')
          const repairedVisual = await planAutomaticVisuals(params.subject, [completedQuestion])
          if (repairedVisual.blockedQuestionNumbers.includes(number)) {
            const message = `A correção da questão ${number} passou a depender de um recurso visual que não foi fornecido.`
            if (params.generationJobId) await saveItemProgress(params.generationJobId, number, 'erro', completedQuestion, [{ severity: 'bloqueante', code: 'VISUAL_REQUIRED_MISSING', message, reason: message }], message)
            throw new FinalQuestionError(message)
          }
          const repairedImageExam = await attachImagesToExam({
            metadata: {
              segment: params.segment,
              gradeYear: params.gradeYear,
              subject: params.subject,
              bimester: params.bimester ?? null,
              questionCount: 1,
              objectiveCount: completedQuestion.type === 'objetiva' ? 1 : 0,
              discursiveCount: completedQuestion.type === 'descritiva' ? 1 : 0,
              alternativesCount,
            },
            questions: repairedVisual.questions,
          }, {
            requireResolvedImages: false,
            maxAttemptsPerImage: 2,
            subject: params.subject,
          })
          completedQuestion = repairedImageExam.questions[0] ?? completedQuestion
          if (completedQuestion.needsImage && !completedQuestion.image) {
            const message = `A correção da questão ${number} exige uma imagem que não pôde ser gerada e validada.`
            if (params.generationJobId) await saveItemProgress(params.generationJobId, number, 'erro', completedQuestion, [{ severity: 'bloqueante', code: 'REQUIRED_IMAGE_UNAVAILABLE', message, reason: message }], message)
            throw new FinalQuestionError(message)
          }
          jevEvidenceByQuestion.set(number, [
            ...(jevEvidenceByQuestion.get(number) ?? []),
            ...diagnostics.map((item) => `Diagnóstico Jev usado no reparo: ${item.evidence ?? item.message}`),
            ...repaired.warnings,
          ])
          if (params.generationJobId) {
            await saveItemProgress(params.generationJobId, number, 'gerando', completedQuestion)
            await setJobItemStage(params.generationJobId, number, 'validando_respostas')
          }
          audit = await runQuestionQualityTest(curriculum, [completedQuestion], jevEvidenceByQuestion, params.classLabel)
          qualityTestWarnings.push(...audit.warnings)
          report = audit.report[0]
        }
      }
    }
    if (!report?.approved) {
      const detail = report?.diagnostics?.filter((item) => item.blocksApproval).map((item) => item.message).slice(0, 3).join('; ')
        || report?.verdictReason
        || 'O Jev não aprovou a questão.'
      const itemIssues = report?.diagnostics?.filter((item) => item.blocksApproval).map((item) => ({
        severity: item.severity,
        code: item.code,
        message: item.message,
        reason: item.evidence ?? item.message,
      })) ?? []
      const reason = report?.auditStatus === 'jev_unavailable'
        ? `Validação do Jev indisponível; rascunho preservado para repetir somente a validação: ${detail}`
        : `Pendente de revisão Jev: ${detail}`
      individuallyFinalizedQuestions.set(number, { question: completedQuestion, report: report! })
      pendingQuestionFailures.set(number, reason)
      if (params.generationJobId) {
        await saveQuestionStageCheckpoint(params.generationJobId, number, { version: 1, responsePayload: completedQuestion, answerAudit: report })
        await saveItemProgress(params.generationJobId, number, 'erro', completedQuestion, itemIssues, reason)
      }
      return completedQuestion
    }
    individuallyFinalizedQuestions.set(number, { question: completedQuestion, report })
    if (params.generationJobId) {
      await saveQuestionStageCheckpoint(params.generationJobId, number, { version: 1, responsePayload: completedQuestion, answerAudit: report })
      await saveItemProgress(params.generationJobId, number, 'concluido', completedQuestion, [{ code: 'JEV_QUALITY_REPORT', report }])
    }
    return completedQuestion
  }
  let alternativesCount = alternativesCountForSegment(params.segment)
  // Itens do banco ENEM são sempre objetivos. A proporção escolhida vale
  // para a prova inteira, portanto calculamos quanto dela ainda precisa ser
  // preenchido pelas questões da IA (limitado ao que é matematicamente
  // possível quando o banco já ultrapassa a meta).
  const objectiveTarget = Math.round((params.questionCount + params.enemBankQuestionIds.length) * (params.objectivePercentage ?? 70) / 100)
  const aiObjectiveCount = Math.max(0, Math.min(params.questionCount, objectiveTarget - params.enemBankQuestionIds.length))
  const aiObjectivePercentage = params.questionCount > 0 ? (aiObjectiveCount * 100) / params.questionCount : 0

  if (shouldGenerateWholeExam(params)) {
    const split = computeQuestionSplit(params.questionCount, aiObjectivePercentage)
    const plannedTotal = params.questionCount + (params.contentPlanIncludesEnem ? params.enemBankQuestionIds.length : 0)
    const plannedObjectivePercentage = params.contentPlanIncludesEnem ? Math.max(params.objectivePercentage ?? 70, params.enemBankQuestionIds.length / Math.max(1, plannedTotal) * 100) : aiObjectivePercentage
    const slots: PlannedQuestionSlot[] = params.contentPlan?.length
      ? buildPlannedQuestionSlots(params.contentPlan, plannedTotal, plannedObjectivePercentage)
      : activityBnccSlots.length
        ? activityBnccSlots.map((activitySlot, index) => ({
          number: activitySlot.questionNumber,
          unitRowIndex: activitySlot.units[0]!.rowIndex,
          type: index < split.objectiveCount ? 'objetiva' : 'descritiva',
          visualAid: 'auto',
        }))
        : Array.from({ length: params.questionCount }, (_, index) => {
            const unit = curriculum.units[index % curriculum.units.length]
            return {
              number: index + 1,
              unitRowIndex: unit!.rowIndex,
              type: index < split.objectiveCount ? 'objetiva' : 'descritiva',
              visualAid: 'auto' as const,
            }
          })
    // Na prova completa, auto deixa a decisão visual com o gerador.
    // A preferência por imagens nos Anos Iniciais não altera a escolha docente.
    return generateAndPersistWholeExam({
      input: params,
      createdBy,
      formalAssigneeId,
      assessmentKind,
      examKind,
      curriculum,
      slots,
      activityBnccSlots,
      selectedBnccCodes,
      selectedBnccDescriptions,
      warnings,
      aiObjectiveCount,
    })
  }

  if (params.questionCount > 0 || params.enemBankQuestionIds.length > 0) {
    if (params.questionCount > 0) {
      // O professor já definiu os slots curriculares. A IA só equilibra
      // estratégia/dificuldade dentro deles e cada questão nasce em uma
      // chamada unificada, com gates locais antes de qualquer auditoria IA.
      const split = computeQuestionSplit(params.questionCount, aiObjectivePercentage)
      const slots: PlannedQuestionSlot[] = params.contentPlan?.length
        ? buildPlannedQuestionSlots(params.contentPlan, params.questionCount, aiObjectivePercentage)
        : activityBnccSlots.length
          ? activityBnccSlots.map((activitySlot, index) => ({
            number: activitySlot.questionNumber,
            unitRowIndex: activitySlot.units[0]!.rowIndex,
            type: index < split.objectiveCount ? 'objetiva' : 'descritiva',
            visualAid: 'auto',
          }))
          : Array.from({ length: params.questionCount }, (_, index) => {
              const unit = curriculum.units[index % curriculum.units.length]
              return {
                number: index + 1,
                unitRowIndex: unit!.rowIndex,
                type: index < split.objectiveCount ? 'objetiva' : 'descritiva',
                visualAid: 'auto' as const,
              }
            })
      const byRowIndex = new Map(curriculum.units.map((unit) => [unit.rowIndex, unit]))
      for (const slot of slots) {
        const unit = byRowIndex.get(slot.unitRowIndex)
        if (unit && slot.visualAid === 'auto' && shouldPreferFundamentalOneVisual(
          params.segment,
          params.gradeYear,
          unit.tituloCapitulo,
          `${unit.conteudo ?? ''} ${unit.enrichedContent ?? ''}`,
        )) slot.visualAid = 'obrigatorio'
      }
      const planByRowIndex = new Map((params.contentPlan ?? []).map((item) => [item.unitRowIndex, item]))
      const selectedUnitIndexes = [...new Set(slots.map((slot) => slot.unitRowIndex))]

      const generationDecision = examKind === 'prova' ? await decideExamGenerationStrategy({
        segment: params.segment,
        gradeYear: params.gradeYear,
        subject: params.subject,
        assessmentKind,
        objectiveCount: split.objectiveCount + params.enemBankQuestionIds.length,
        discursiveCount: split.discursiveCount,
        units: selectedUnitIndexes.map((unitRowIndex) => {
          const unit = byRowIndex.get(unitRowIndex)
          if (!unit) throw new ExamGenerationInputError(`Capítulo ${unitRowIndex} não foi encontrado no planejamento.`)
          const plan = planByRowIndex.get(unitRowIndex)
          return {
            title: unit.tituloCapitulo,
            content: unit.conteudo,
            objectives: unit.objetivos.map((objective) => objective.text),
            bnccCodes: unit.habilidades.status === 'mapeado' ? unit.habilidades.skills.map((skill) => skill.code) : [],
            plannedQuestions: slots.filter((slot) => slot.unitRowIndex === unitRowIndex).length,
            priority: plan?.priority ?? 'media',
            visualAid: plan?.visualAid ?? 'auto',
          }
        }),
      }) : null
      if (examKind === 'atividade') {
        activityGenerationDecision = await decideActivityGenerationStrategy({
          segment: params.segment,
          gradeYear: params.gradeYear,
          subject: params.subject,
          pedagogicalIntent: params.pedagogicalIntent ?? 'formativa',
          questionCount: params.questionCount,
          selectedSkills: selectedBnccCodes.map((code) => ({
            code,
            description: selectedBnccDescriptions.get(code) ?? null,
            plannedQuestions: params.bnccPlan?.find((item) => item.code.trim().toUpperCase() === code)?.questionCount ?? null,
          })),
          units: selectedUnitIndexes.map((unitRowIndex) => {
            const unit = byRowIndex.get(unitRowIndex)
            if (!unit) throw new ExamGenerationInputError(`Capítulo ${unitRowIndex} não foi encontrado no planejamento.`)
            return {
              title: unit.tituloCapitulo,
              objectives: unit.objetivos.map((objective) => objective.text),
              bnccCodes: unit.habilidades.status === 'mapeado' ? unit.habilidades.skills.map((skill) => skill.code) : [],
            }
          }),
        })
      }
      if (generationDecision?.source === 'fallback') warnings.push('Jev indisponível para decidir a estratégia; foi aplicada a estratégia pedagógica equilibrada.')
      else if (generationDecision?.needsReview) warnings.push('Jev indicou baixa segurança no recorte; a estratégia sugerida deve ser conferida na revisão docente.')
      if (activityGenerationDecision?.source === 'fallback') warnings.push('Jev indisponível para decidir a recuperação; foi aplicada a retomada guiada com progressão gradual.')
      else if (activityGenerationDecision?.needsReview) warnings.push('Jev indicou baixa segurança na estratégia da atividade; confira a progressão na revisão docente.')
      const strategyInstruction = generationDecision
        ? examGenerationStrategyInstruction(generationDecision.strategy)
        : activityGenerationDecision
          ? activityGenerationStrategyInstruction(activityGenerationDecision.strategy, selectedBnccCodes)
          : undefined
      const blueprint = await generateExamBlueprint({
        subject: params.subject,
        gradeYear: params.gradeYear,
        segment: params.segment,
        ...(strategyInstruction ? { strategyInstruction } : {}),
        slots: slots.map((slot) => {
          const unit = byRowIndex.get(slot.unitRowIndex)
          if (!unit) throw new ExamGenerationInputError(`Capítulo ${slot.unitRowIndex} não foi encontrado no planejamento.`)
          return {
            number: slot.number,
            unitRowIndex: slot.unitRowIndex,
            type: slot.type,
            visualAid: slot.visualAid,
            curriculumContent: [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'),
            unitTitle: unit.tituloCapitulo,
          }
        }),
      })
      warnings.push(...blueprint.issues.map((issue) => `Blueprint: ${issue}`))
      if (blueprint.slots.length !== slots.length) {
        throw new ExamGenerationInputError('O blueprint não cobriu todos os slots escolhidos pelo professor.')
      }
      if (params.generationJobId) await initializeJobItems(params.generationJobId, slots.map((slot) => slot.number))

      const generateUnifiedCandidate = async (slot: PlannedQuestionSlot, candidateNumber: number, previousStatement = '', feedback = '', forceNoVisual = false, regenerationMode?: 'same_topic' | 'alternate_angle' | 'safe', skipFinalization = false, ignoreSavedStatement = false): Promise<QuestionCandidate> => {
        const unit = byRowIndex.get(slot.unitRowIndex)
        const blueprintSlot = blueprint.slots.find((candidate) => candidate.slotNumber === slot.number)
        if (!unit || !blueprintSlot) throw new ExamGenerationInputError(`Não foi possível preparar a questão ${slot.number} no pipeline unificado.`)
        visualAidByQuestion.set(slot.number, slot.visualAid)
        const unitCurriculum = { ...curriculum, units: [unit] }
        let lastError = 'falha desconhecida'
        for (let attempt = 1; attempt <= 1; attempt++) {
          try {
            if (params.generationJobId) await saveItemProgress(params.generationJobId, slot.number, 'gerando')
            const targetSkills = pickTargetSkills({
              unit,
              slotIndexInUnit: slots.filter((other) => other.unitRowIndex === slot.unitRowIndex && other.number < slot.number).length,
              forcedCodes: activityBnccSlots[slot.number - 1] ? [activityBnccSlots[slot.number - 1]!.code] : undefined,
              descriptions: new Map(unit.habilidades.status === 'mapeado'
                ? unit.habilidades.skills.flatMap((skill) => {
                  const official = getOfficialBnccSkill(skill.code)
                  return official ? [[official.code, official.text] as const] : []
                })
                : []),
            })
            const targetEnemSkill = pickTargetEnemSkill({
              unit,
              slotIndexInUnit: slots.filter((other) => other.unitRowIndex === slot.unitRowIndex && other.number < slot.number).length,
            })
            const missingOfficialSkills = targetSkills.filter((skill) => !getOfficialBnccSkill(skill.code))
            if (missingOfficialSkills.length) {
              throw new ExamGenerationInputError(`Habilidade(s) sem ficha BNCC oficial completa: ${missingOfficialSkills.map((skill) => skill.code).join(', ')}.`)
            }
            const savedApprovedStatement = !ignoreSavedStatement ? stageCheckpoints.get(slot.number)?.approvedStatement : undefined
            const approvedStatement = isApprovedQuestionStatement(savedApprovedStatement) && !forceNoVisual
              ? savedApprovedStatement
              : await generateApprovedQuestionStatement({
                targetEnemSkill,
                questionNumber: slot.number,
                subject: params.subject,
                segment: params.segment,
                gradeYear: params.gradeYear,
                classLabel: params.classLabel,
                questionType: slot.type,
                difficulty: blueprintSlot.difficulty,
                curriculumContent: blueprintSlot.curriculumContent,
                targetSkills: targetSkills.map((skill) => {
                  const official = getOfficialBnccSkill(skill.code)
                  return {
                    code: official?.code ?? skill.code,
                    description: official?.text ?? skill.description ?? null,
                    context: official?.context ?? [],
                    source: official?.source ?? '',
                    dataVersion: official?.dataVersion ?? '',
                  }
                }),
                objectives: cognitiveObjectives(unit),
              }, {
                savedDraft: isQuestionStatementDraft(savedApprovedStatement) && !forceNoVisual ? savedApprovedStatement : undefined,
                onDraft: async (draft) => {
                  if (!params.generationJobId) return
                  const checkpoint = { version: 1 as const, approvedStatement: { ...(isQuestionStatementDraft(savedApprovedStatement) ? savedApprovedStatement : {}), ...draft } }
                  await saveQuestionStageCheckpoint(params.generationJobId, slot.number, checkpoint)
                  stageCheckpoints.set(slot.number, { ...stageCheckpoints.get(slot.number), ...checkpoint })
                },
                forcedVisual: slot.visualAid === 'obrigatorio',
                forceNoVisual: forceNoVisual || slot.visualAid === 'sem_imagem',
                previousStatement,
                feedback,
                onStage: async (stage) => {
                  if (params.generationJobId) await setJobItemStage(params.generationJobId, slot.number, stage)
                },
              })
            if (approvedStatement.visual.pendingReview) {
              const reason = `O Jev não decidiu com confiança suficiente se a questão depende de imagem: ${approvedStatement.visual.rationale}`
              pendingQuestionFailures.set(slot.number, reason)
              if (params.generationJobId) {
                await saveQuestionStageCheckpoint(params.generationJobId, slot.number, { version: 1, approvedStatement })
                await saveItemProgress(params.generationJobId, slot.number, 'erro', undefined, [{ severity: 'bloqueante', code: 'JEV_ALIGNMENT_REVIEW', message: reason, reason }], reason)
              }
              throw new FinalQuestionError(`Questão ${slot.number} preservada como rascunho; repita somente a validação do Jev: ${reason}`)
            }
            if (params.generationJobId && approvedStatement !== savedApprovedStatement) {
              await saveQuestionStageCheckpoint(params.generationJobId, slot.number, { version: 1, approvedStatement })
              stageCheckpoints.set(slot.number, { ...stageCheckpoints.get(slot.number), version: 1, approvedStatement })
            }
            if (approvedStatement.visual.required) jevRequiredVisualByQuestion.add(slot.number)
            const slotWithJevVisualDecision = {
              ...blueprintSlot,
              needsVisual: approvedStatement.visual.required,
            }
            if (params.generationJobId) await setJobItemStage(params.generationJobId, slot.number, 'gerando_respostas')
            const unified = await generateUnifiedQuestion({
              targetEnemSkill,
              questionNumber: slot.number,
              subject: params.subject,
              gradeYear: params.gradeYear,
              segment: params.segment,
              classLabel: params.classLabel,
              curriculumContent: blueprintSlot.curriculumContent,
              targetSkills,
              objectives: cognitiveObjectives(unit),
              contentPlanInstruction: [
                `capítulo "${unit.tituloCapitulo}"; tipo ${slot.type}; candidata ${candidateNumber}.${attempt}`,
                previousStatement ? `Não repita este enunciado rejeitado: ${previousStatement.slice(0, 500)}.` : '',
                feedback ? `Corrija especificamente: ${feedback.slice(0, 900)}.` : '',
              ].filter(Boolean).join(' '),
              approvedStatement,
              forceNoVisual,
              regenerationMode,
              questionType: slot.type,
            }, slotWithJevVisualDecision, {
              onSchemaValidated: async () => {
                if (params.generationJobId) await setJobItemStage(params.generationJobId, slot.number, 'validando_formato_respostas')
              },
            })
            const corrected = correctSingleQuestion({ ...unified.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }, unitCurriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
            jevEvidenceByQuestion.set(slot.number, [
              `Necessidade visual decidida pelo Jev: ${approvedStatement.visual.required ? 'sim' : 'não'} (${approvedStatement.visual.rationale}).`,
              ...(unified.issues ?? []).map((issue) => issue.reason),
              ...corrected.issues,
            ])
            warnings.push(`Questão ${slot.number}: a dependência de imagem foi ${approvedStatement.visual.required ? 'identificada' : 'considerada dispensável'} pelo Jev${approvedStatement.visual.probability === null ? '' : ` (${Math.round(approvedStatement.visual.probability * 100)}%)`}.`)
            let question = { ...corrected.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }
            const activitySlot = activityBnccSlots[slot.number - 1]
            if (activitySlot) {
              question = {
                ...question,
                bnccCodes: [activitySlot.code],
                bnccStatus: 'mapeado',
                bnccSummary: selectedBnccDescriptions.get(activitySlot.code) ?? question.bnccSummary ?? null,
              }
            }
            if (slot.visualAid === 'obrigatorio' && (!question.needsImage || !question.imageQuery?.trim())) {
              question = {
                ...question,
                needsImage: true,
                imageQuery: `${unit.tituloCapitulo} ${unit.conteudo ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 180),
              }
            }
            warnings.push(`Questão ${slot.number}: gerada pelo pipeline unificado${unified.needsAudit ? ' com auditoria seletiva' : ''}.`)
            warnings.push(...unified.issues.map((issue) => `Questão ${slot.number} [${issue.severity}]: ${issue.reason}`))
            warnings.push(...corrected.warnings)
            if (params.generationJobId) await saveQuestionStageCheckpoint(params.generationJobId, slot.number, { version: 1, responsePayload: question })
            if (params.generationJobId) await saveItemProgress(params.generationJobId, slot.number, 'gerando', question)
            const finalizedQuestion = skipFinalization
              ? question
              : await finalizeGeneratedQuestion(question)
            return { slotNumber: slot.number, candidateNumber, question: finalizedQuestion }
          } catch (error) {
            if (error instanceof FinalQuestionError) throw error
            if (error instanceof AiBudgetExceededError || isTransientProviderFailure(error)) throw error
            lastError = generationFailureMessage(error)
          }
        }
        if (params.generationJobId) {
          const diagnostic = diagnosticFromIssue({ severity: 'bloqueante', reason: lastError })
          await saveItemProgress(params.generationJobId, slot.number, 'erro', undefined, [{
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
            reason: diagnostic.evidence ?? diagnostic.message,
          }], lastError)
        }
        throw new ExamGenerationInputError(`Questão ${slot.number} não passou pela validação local: ${lastError}`)
      }

      repairQualityIssue = async (questionNumber, current, diagnostics, attempt) => {
        const slot = slots.find((candidate) => candidate.number === questionNumber)
        const unit = byRowIndex.get(slot?.unitRowIndex ?? -1)
        const blueprintSlot = blueprint.slots.find((candidate) => candidate.slotNumber === questionNumber)
        if (!slot || !unit || !blueprintSlot) return null
        if (attempt >= 3 || shouldRegenerateQuestionFromDiagnostics(diagnostics)) {
          const mode = attempt >= 5 ? 'safe' : attempt >= 4 ? 'alternate_angle' : 'same_topic'
          const feedback = diagnostics.map((item) => `Critério ${item.code}: ${item.message} Local: ${item.location ?? item.alternativeLetter ?? 'questão'}. Evidência disponível: ${item.evidence ?? 'não localizada pelo Jev'}. Correção exigida: ${item.resolutionCheck ?? item.message}`).join(' ')
          return (await generateUnifiedCandidate(slot, 100 + attempt, current.statement, feedback, false, mode)).question
        }
        const history = params.generationJobId ? await getQualityRepairHistory(params.generationJobId, questionNumber) : []
        const previous = history.at(-1)
        const repaired = await repairQuestionFromDiagnostics({
          question: current,
          curriculum: { ...curriculum, units: [unit] },
          diagnostics,
          context: `exams/quality-repair-${questionNumber}`,
          blueprintSlot,
          classLabel: params.classLabel,
          scope: 'answers',
          previousAttempt: previous ? {
            attempt: previous.attempt,
            blockingCriteria: previous.blockingCriteriaAfter,
            changedFields: previous.changedFields,
            outcome: previous.outcome,
          } : null,
        })
        if (!repaired) return null
        jevEvidenceByQuestion.set(questionNumber, [
          ...diagnostics.map((item) => `Jev: ${item.evidence ?? item.message}`),
          ...repaired.warnings,
        ])
        warnings.push(`Questão ${questionNumber}: reparo direcionado (${repaired.repairKind}).`)
        warnings.push(...repaired.warnings)
        return repaired.question
      }

      const reusable = params.generationJobId ? await getReusableQuestionPayloads(params.generationJobId) : new Map<number, ExamQuestion>()
      const persistedReports = params.generationJobId ? await getPersistedQuestionQualityReports(params.generationJobId) : new Map<number, Record<string, unknown>>()
      const candidates: QuestionCandidate[] = []
      for (const slot of slots) {
        const question = reusable.get(slot.number)
        if (!question) continue
        visualAidByQuestion.set(slot.number, slot.visualAid)
        // A retomada sem o histórico em memória deve preservar a exigência de
        // imagem já materializada na questão; não substituí-la silenciosamente.
        if (question.needsImage) jevRequiredVisualByQuestion.add(slot.number)
      }
      // Cada vaga acompanha um item até o final. Uma questão que falha não
      // cancela as outras; os resultados aprovados ficam como checkpoints.
      const settledQuestions = await mapWithConcurrency(slots, async (slot): Promise<QuestionCandidate> => {
        const savedQuestion = reusable.get(slot.number)
        const savedReport = persistedReports.get(slot.number)
        if (savedQuestion && savedReport) {
          individuallyFinalizedQuestions.set(slot.number, { question: savedQuestion, report: savedReport as Awaited<ReturnType<typeof runQuestionQualityTest>>['report'][number] })
          return { slotNumber: slot.number, candidateNumber: 0, question: savedQuestion }
        }
        if (savedQuestion) {
          const question = await finalizeGeneratedQuestion(savedQuestion)
          return { slotNumber: slot.number, candidateNumber: 0, question }
        }
        return generateUnifiedCandidate(slot, slot.number)
      }, QUESTION_GENERATION_CONCURRENCY)
      const failedQuestions = settledQuestions.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      candidates.push(...settledQuestions.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
      failedQuestions.forEach((result) => {
        const index = settledQuestions.indexOf(result)
        const number = slots[index]?.number
        if (number) pendingQuestionFailures.set(number, generationFailureMessage(result.reason))
      })
      if (params.generationJobId) await Promise.all(failedQuestions.map((result) => {
        const index = settledQuestions.indexOf(result)
        const number = slots[index]?.number
        if (!number) return Promise.resolve()
        const message = generationFailureMessage(result.reason)
        return saveItemProgress(params.generationJobId!, number, 'erro', undefined, [{ severity: 'bloqueante', code: 'QUESTION_GENERATION_FAILED', message, reason: message }], message)
      }))
      aiQuestions = assembleBestExamCandidates(slots, candidates)
      if (failedQuestions.length) warnings.push(`${failedQuestions.length} questão(ões) não concluíram a geração; as demais continuarão até a revisão.`)
      const assemblyEvidence = validateExamAssembly(aiQuestions, slots)
      for (const issue of assemblyEvidence) {
        for (const number of issue.questionNumbers) {
          jevEvidenceByQuestion.set(number, [...(jevEvidenceByQuestion.get(number) ?? []), `Conferência da prova para o Jev: ${issue.reason}`])
        }
      }
      warnings.push(...assemblyEvidence.map((issue) => `Conferência da prova encaminhada ao Jev: ${issue.reason}`))
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false, diagnostics = []) => {
        const slot = slots.find((candidate) => candidate.number === questionNumber)
        if (!slot) throw new ExamGenerationInputError(`Não foi possível localizar a posição ${questionNumber} para substituição automática.`)
        const feedback = diagnostics.length
          ? diagnostics.map((item) => `Corrija especificamente ${item.code}: ${item.message}${item.evidence ? ` Evidência localizada: ${item.evidence}` : ''} Campos a alterar: ${item.fields.join(', ') || 'questão completa'}. Preserve: ${item.protectedFields.join(', ') || 'tema, habilidade e tipo'}.`).join(' ')
          : jevEvidenceByQuestion.get(questionNumber)?.join(' ')
            || 'O Jev reprovou a versão anterior. Corrija o problema apontado no diagnóstico recebido.'
        return (await generateUnifiedCandidate(slot, 100 + questionNumber, current.statement, feedback, forceNoVisual)).question
      }
      alternativesCount = alternativesCountForSegment(params.segment)
    } else if (params.contentPlan?.length) {
      const slots = buildPlannedQuestionSlots(params.contentPlan, params.questionCount, aiObjectivePercentage)
      const byRowIndex = new Map(curriculum.units.map((unit) => [unit.rowIndex, unit]))
      const generateCandidate = async (slot: PlannedQuestionSlot, candidateNumber: number, avoidStatement: string, avoidContext?: string, forceNoVisual = false): Promise<QuestionCandidate> => {
        const unit = byRowIndex.get(slot.unitRowIndex)
        if (!unit) throw new ExamGenerationInputError(`Capítulo ${slot.unitRowIndex} não foi encontrado no planejamento.`)
        const unitCurriculum = { ...curriculum, units: [unit] }
        const visualAid = forceNoVisual ? 'sem_imagem' : slot.visualAid === 'auto' && (shouldRequireVisualAid(unit) || shouldPreferFundamentalOneVisual(params.segment, params.gradeYear, unit.tituloCapitulo, `${unit.conteudo ?? ''} ${unit.enrichedContent ?? ''}`)) ? 'obrigatorio' : slot.visualAid
        visualAidByQuestion.set(slot.number, slot.visualAid)

        // Uma questão só nasce pelo pipeline com gates. Não há fallback
        // monolítico: uma resposta sem garantias não pode entrar na prova.
        let lastError = 'falha desconhecida'
        // Mesmo problema do pipeline unificado acima: sem isto, as 4
        // tentativas repetiam quase o mesmo prompt sem nunca dizer à IA por
        // que a tentativa anterior foi rejeitada.
        let retryReason: string | null = null
        const variation = candidateNumber % 3 === 1
          ? 'Use um contexto cotidiano diferente e dados inéditos.'
          : candidateNumber % 3 === 2
            ? 'Use uma abordagem ou representação diferente, sem repetir situação, valores ou pergunta das demais questões.'
            : 'Use um cenário de aplicação distinto e avalie a mesma habilidade por outro ângulo pedagógico.'
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const staged = await generateStagedQuestion({
              questionNumber: slot.number,
              subject: params.subject,
              gradeYear: params.gradeYear,
              segment: params.segment,
              classLabel: params.classLabel,
              curriculumContent: [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'),
              contentPlanInstruction: `capítulo "${unit.tituloCapitulo}"; tipo ${slot.type}; recurso visual ${visualAid}; candidata ${candidateNumber}.${attempt}; ${variation} Evite este enunciado anterior: ${avoidStatement.slice(0, 500)}. ${avoidContext ?? ''}${retryReason ? ` A tentativa anterior desta mesma questão foi rejeitada por: ${retryReason.slice(0, 500)}. Corrija exatamente isso, sem repetir o mesmo erro.` : ''}`,
              forceNoVisual,
              questionType: slot.type,
            })
            let question: ExamQuestion = { ...staged.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }
            // Correção determinística (integridade de texto, BNCC, SAEB,
            // alternativas e ficha técnica canônica) antes de aceitar a
            // questão fragmentada. Os apontamentos seguem ao Jev como evidência.
            const corrected = correctSingleQuestion(question, unitCurriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
            jevEvidenceByQuestion.set(slot.number, [...staged.issues.map((issue) => issue.reason), ...corrected.issues])
            question = { ...corrected.question, curriculumUnitRowIndex: slot.unitRowIndex }
            if (visualAid === 'obrigatorio' && (!question.needsImage || !question.imageQuery?.trim())) {
              const fallbackQuery = `${unit.tituloCapitulo} ${unit.conteudo ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 180)
              question = { ...question, needsImage: true, imageQuery: fallbackQuery }
            }
            warnings.push(`Questão ${slot.number}: gerada pelo pipeline fragmentado.`)
            warnings.push(...staged.issues.map((issue) => `Questão ${slot.number} [${issue.severity}]: ${issue.reason}`))
            warnings.push(...corrected.warnings)
            const finalizedQuestion = await finalizeGeneratedQuestion(question)
            return { slotNumber: slot.number, candidateNumber, question: finalizedQuestion }
          } catch (error) {
            if (error instanceof FinalQuestionError) throw error
            if (error instanceof AiBudgetExceededError) throw error
            if (isTransientProviderFailure(error)) throw error
            lastError = error instanceof Error ? error.message : 'erro'
            retryReason = lastError
          }
        }
        throw new ExamGenerationInputError(`Questão ${slot.number} não atingiu os requisitos após 4 tentativas: ${lastError}`)
      }
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false, diagnostics = []) => {
        const slot = slots.find((candidate) => candidate.number === questionNumber)
        if (!slot) throw new ExamGenerationInputError(`Não foi possível localizar a posição ${questionNumber} para substituição automática.`)
        const jevFeedback = diagnostics.length
          ? diagnostics.map((item) => `Corrija especificamente ${item.code}: ${item.message}${item.evidence ? ` Evidência localizada: ${item.evidence}` : ''} Campos a alterar: ${item.fields.join(', ') || 'questão completa'}. Preserve: ${item.protectedFields.join(', ') || 'tema, habilidade e tipo'}.`).join(' ')
          : jevEvidenceByQuestion.get(questionNumber)?.join(' ') ?? ''
        return (await generateCandidate(slot, 2, current.statement, [compactQuestionContext(aiQuestions, questionNumber), jevFeedback].filter(Boolean).join(' '), forceNoVisual)).question
      }

      const candidates: QuestionCandidate[] = []
      const matrixResults = await mapWithConcurrency(slots, (slot) =>
        generateCandidate(slot, slot.number, 'Não há questão anterior; crie um item original.'),
        QUESTION_GENERATION_CONCURRENCY,
      )
      candidates.push(...matrixResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
      matrixResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const number = slots[index]?.number
          if (number) {
            const message = generationFailureMessage(result.reason)
            pendingQuestionFailures.set(number, message)
          }
        }
      })
      if (params.generationJobId) await Promise.all(matrixResults.flatMap((result, index) => result.status === 'rejected' && slots[index]
        ? [saveItemProgress(params.generationJobId!, slots[index]!.number, 'erro', undefined, [{ severity: 'bloqueante', code: 'QUESTION_GENERATION_FAILED', message: generationFailureMessage(result.reason), reason: generationFailureMessage(result.reason) }], generationFailureMessage(result.reason))]
        : []))

      aiQuestions = assembleBestExamCandidates(slots, candidates)
      if (pendingQuestionFailures.size) warnings.push(`${pendingQuestionFailures.size} questão(ões) não concluíram a geração; as demais continuarão até a revisão.`)
      const assemblyEvidence = validateExamAssembly(aiQuestions, slots)
      for (const issue of assemblyEvidence) {
        for (const number of issue.questionNumbers) {
          jevEvidenceByQuestion.set(number, [...(jevEvidenceByQuestion.get(number) ?? []), `Conferência da prova para o Jev: ${issue.reason}`])
        }
      }
      warnings.push(...assemblyEvidence.map((issue) => `Conferência da prova encaminhada ao Jev: ${issue.reason}`))
      alternativesCount = alternativesCountForSegment(params.segment)
    } else {
      // Sem matriz: gera cada questão pelo pipeline fragmentado (padrão). Se
      // alguma questão falhar de forma definitiva, cai no fluxo monolítico da
      // prova inteira para não perder a geração.
      const split = computeQuestionSplit(params.questionCount, aiObjectivePercentage)
      const stagedCurriculumContent = curriculum.units
        .map((unit) => [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'))
        .join('\n\n')
        .slice(0, 12000)
      const activityContextForQuestion = (questionNumber: number) => {
        const slot = activityBnccSlots[questionNumber - 1]
        if (!slot) return { content: stagedCurriculumContent, instruction: '' }
        const content = slot.units
          .map((unit) => [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'))
          .join('\n\n')
          .slice(0, 12000)
        const description = selectedBnccDescriptions.get(slot.code)
        return {
          content,
          instruction: `HABILIDADE BNCC OBRIGATÓRIA: ${slot.code}${description ? ` — ${description}` : ''}. A questão deve avaliar exatamente esta habilidade.`,
        }
      }
      const applyPlannedBncc = (question: ExamQuestion, questionNumber: number): ExamQuestion => {
        const slot = activityBnccSlots[questionNumber - 1]
        if (!slot) return question
        return {
          ...question,
          bnccCodes: [slot.code],
          bnccStatus: 'mapeado',
          bnccSummary: selectedBnccDescriptions.get(slot.code) ?? question.bnccSummary ?? null,
        }
      }
      const stagedQuestions: ExamQuestion[] = []
      let stagedFailure: string | null = null
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false, diagnostics = []) => {
        const questionType: ExamQuestion['type'] = questionNumber <= split.objectiveCount ? 'objetiva' : 'descritiva'
        const activityContext = activityContextForQuestion(questionNumber)
        let lastError = 'falha desconhecida'
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const staged = await generateStagedQuestion({
              questionNumber,
              subject: params.subject,
              gradeYear: params.gradeYear,
              segment: params.segment,
              classLabel: params.classLabel,
              curriculumContent: activityContext.content,
              contentPlanInstruction: `${examKind === 'atividade' ? 'atividade' : 'prova'}; tipo ${questionType}; ${activityContext.instruction} substitua o enunciado anterior: ${current.statement.slice(0, 300)}. ${diagnostics.map((item) => `Corrija especificamente ${item.code}: ${item.message}${item.evidence ? ` Evidência: ${item.evidence}` : ''} Altere ${item.fields.join(', ') || 'a questão'} e preserve ${item.protectedFields.join(', ') || 'tema, habilidade e tipo'}.`).join(' ')}`,
              forceNoVisual,
              questionType,
            })
            const corrected = correctSingleQuestion({ ...staged.question, number: questionNumber }, curriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
            jevEvidenceByQuestion.set(questionNumber, [...staged.issues.map((issue) => issue.reason), ...corrected.issues])
            return applyPlannedBncc({ ...corrected.question, number: questionNumber }, questionNumber)
          } catch (error) {
            if (error instanceof FinalQuestionError) throw error
            if (error instanceof AiBudgetExceededError) throw error
            if (isTransientProviderFailure(error)) throw error
            lastError = error instanceof Error ? error.message : 'erro'
          }
        }
        throw new ExamGenerationInputError(`Questão ${questionNumber} não pôde ser substituída automaticamente: ${lastError}`)
      }

      const generateFallbackQuestion = async (index: number, priorQuestions: ExamQuestion[]) => {
        const questionType: ExamQuestion['type'] = index < split.objectiveCount ? 'objetiva' : 'descritiva'
        const activityContext = activityContextForQuestion(index + 1)
        const priorText = priorQuestions.slice(-5).map((question) => question.statement.slice(0, 200)).join(' | ')
        let lastQuestionError = 'falha desconhecida'
        try {
          // Uma falha de estágio isola a candidata, não a prova toda. Cada
          // nova candidata recebe contexto de variação, evitando repetir a
          // mesma saída inválida (como distratores duplicados).
          for (let candidateAttempt = 1; candidateAttempt <= 1; candidateAttempt++) {
            for (let coherenceAttempt = 0; coherenceAttempt < 1; coherenceAttempt++) {
              try {
                const avoid = [
                  priorText ? `não repita estes enunciados: ${priorText}` : null,
                  candidateAttempt > 1 ? `Esta é a candidata ${candidateAttempt}: use outra abordagem, outro recorte do conteúdo e alternativas inequivocamente distintas.` : null,
                  coherenceAttempt > 0 ? 'MUDE o cenário/contexto: o enunciado anterior ficou muito parecido com outra questão.' : null,
                ].filter(Boolean).join(' ')
                const staged = await generateStagedQuestion({
                  questionNumber: index + 1,
                  subject: params.subject,
                  gradeYear: params.gradeYear,
                  segment: params.segment,
                  classLabel: params.classLabel,
                  curriculumContent: activityContext.content,
                  contentPlanInstruction: `${examKind === 'atividade' ? 'atividade' : 'prova'}; tipo ${questionType}; ${activityContext.instruction}${avoid ? `; ${avoid}` : ''}`,
                  questionType,
                })
                const corrected = correctSingleQuestion({ ...staged.question, number: index + 1 }, curriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
                jevEvidenceByQuestion.set(index + 1, [...staged.issues.map((issue) => issue.reason), ...corrected.issues])
                const candidate = applyPlannedBncc({ ...corrected.question, number: index + 1 }, index + 1)
                const worst = priorQuestions.reduce(
                  (max, question) => Math.max(max, textSimilarity(questionCoherenceText(candidate), questionCoherenceText(question))),
                  0,
                )
                warnings.push(...staged.issues.map((issue) => `Questão ${index + 1} [${issue.severity}]: ${issue.reason}`))
                warnings.push(...corrected.warnings)
                if (worst >= EXAM_OVERLAP_ALERT) {
                  warnings.push(`Questão ${index + 1}: semelhança de ${Math.round(worst * 100)}% com outra questão; encaminhada ao Jev.`)
                }
                jevEvidenceByQuestion.set(index + 1, [
                  ...(jevEvidenceByQuestion.get(index + 1) ?? []),
                  ...(worst >= EXAM_OVERLAP_ALERT ? [`Semelhança com outra questão: ${Math.round(worst * 100)}%.`] : []),
                ])
                return { question: await finalizeGeneratedQuestion(candidate) }
              } catch (error) {
                if (error instanceof FinalQuestionError) throw error
                if (error instanceof AiBudgetExceededError) throw error
                if (isTransientProviderFailure(error)) throw error
                lastQuestionError = error instanceof Error ? error.message : 'erro'
                // Não repete a mesma candidata após falha de pipeline; a
                // próxima iteração altera o contexto de geração.
                break
              }
            }
          }
          throw new Error(lastQuestionError === 'falha desconhecida' ? 'não foi possível diferenciar o enunciado das demais questões.' : lastQuestionError)
        } catch (error) {
          if (error instanceof FinalQuestionError) throw error
          if (error instanceof AiBudgetExceededError) throw error
          if (isTransientProviderFailure(error)) throw error
          return { error: `Questão ${index + 1}: ${error instanceof Error ? error.message : 'falha no pipeline fragmentado'}.` }
        }
        return { error: 'falha desconhecida' }
      }

      const fallbackResults = await mapWithConcurrency(
        Array.from({ length: params.questionCount }, (_, index) => index),
        (index) => generateFallbackQuestion(index, [...stagedQuestions]),
        QUESTION_GENERATION_CONCURRENCY,
      )
      fallbackResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          if (result.reason instanceof AiBudgetExceededError || isTransientProviderFailure(result.reason)) throw result.reason
          const message = result.reason instanceof Error ? result.reason.message : 'falha no pipeline fragmentado'
          stagedFailure = stagedFailure ?? message
          pendingQuestionFailures.set(index + 1, message)
        } else if (result.value.question) {
          stagedQuestions.push(result.value.question)
        } else if (result.value.error) {
          stagedFailure = stagedFailure ?? result.value.error
          pendingQuestionFailures.set(index + 1, result.value.error)
        }
      })
      if (params.generationJobId) await Promise.all([...pendingQuestionFailures.entries()].map(([number, message]) => saveItemProgress(params.generationJobId!, number, 'erro', undefined, [{ severity: 'bloqueante', code: 'QUESTION_GENERATION_FAILED', message, reason: message }], message)))

      if (stagedFailure) {
        warnings.push(`${pendingQuestionFailures.size} questão(ões) não concluíram a geração; as demais continuarão até a revisão.`)
      }
      aiQuestions = stagedQuestions
      warnings.push(`${params.questionCount} questão(ões) geradas pelo pipeline fragmentado.`)
      alternativesCount = alternativesCountForSegment(params.segment)
    }

    // Itens recuperados de jobs antigos também percorrem o fluxo por inteiro.
    // Questões novas já foram finalizadas dentro da própria geração, antes de
    // iniciar a próxima posição.
    for (let index = 0; index < aiQuestions.length; index++) {
      const question = aiQuestions[index]!
      const finalized = individuallyFinalizedQuestions.get(question.number)
      if (finalized) aiQuestions[index] = finalized.question
      else aiQuestions[index] = await finalizeGeneratedQuestion(question)
    }
  }

  const bankQuestions = await buildBankExamQuestions(params.enemBankQuestionIds, params.questionCount + 1)
  if (bankQuestions.length < params.enemBankQuestionIds.length) {
    warnings.push(`${params.enemBankQuestionIds.length - bankQuestions.length} questão(ões) do banco ENEM selecionadas não foram encontradas (removidas do banco?) e ficaram de fora.`)
  }

  let allQuestions = [...aiQuestions, ...bankQuestions]
  // Relatório final de coerência da prova (repetição/duplicação entre itens).
  for (const issue of coherenceIssues(aiQuestions)) {
    warnings.push(`Coerência da prova: ${issue.reason}`)
  }
  // O Jev faz a auditoria inicial uma vez. Questões corrigidas depois disso
  // não são reavaliadas, conforme a configuração operacional solicitada.
  const persistedAuditReports = params.generationJobId
    ? await getPersistedQuestionQualityReports(params.generationJobId)
    : new Map<number, Record<string, unknown>>()
  const questionsToAudit = allQuestions.filter((question) => question.source !== 'ia' || (!persistedAuditReports.has(question.number) && !individuallyFinalizedQuestions.has(question.number)))
  const currentAudit = await runQuestionQualityTest(
    curriculum,
    questionsToAudit,
    jevEvidenceByQuestion,
    params.classLabel,
    async (questionNumber) => {
      if (params.generationJobId) await setJobItemStage(params.generationJobId, questionNumber, 'validando_respostas')
    },
    async (report) => {
      const question = allQuestions.find((candidate) => candidate.number === report.questionNumber)
      if (params.generationJobId && question?.source === 'ia' && report.approved) {
        await saveItemProgress(params.generationJobId, report.questionNumber, 'concluido', question, [{ code: 'JEV_QUALITY_REPORT', report }])
      }
    },
    'full',
  )
  const combinedAuditReports = new Map<number, (typeof currentAudit.report)[number]>()
  for (const [number, report] of persistedAuditReports) combinedAuditReports.set(number, report as (typeof currentAudit.report)[number])
  for (const [number, entry] of individuallyFinalizedQuestions) combinedAuditReports.set(number, entry.report)
  for (const report of currentAudit.report) combinedAuditReports.set(report.questionNumber, report)
  const finalAuditBase = {
    ...currentAudit,
    report: allQuestions.flatMap((question) => {
      const report = combinedAuditReports.get(question.number)
      return report ? [report] : []
    }),
  }
  const finalAudit = {
    ...finalAuditBase,
    rejected: finalAuditBase.report.filter((report) => !report.approved).map((report) => report.questionNumber),
  }
  const initialAuditResults = [...finalAudit.report]
  const initialRejected = [...finalAudit.rejected]
  const MAX_QUALITY_STAGES = 1
  const replacementAttempts = new Set<string>()
  const localRepairAttempts = new Map<number, number>()
  for (let round = 1; finalAudit.rejected.length && round <= MAX_QUALITY_STAGES; round++) {
    const candidates: Array<{ number: number; question: ExamQuestion; cycle: Omit<QualityRepairHistoryEntry, 'blockingCriteriaAfter' | 'outcome'> }> = []
    let reservedAnyStage = false
    for (const number of finalAudit.rejected) {
      const current = allQuestions.find((question) => question.number === number)
      const report = finalAudit.report.find((item) => item.questionNumber === number)
      if (!current || current.source !== 'ia' || !report?.diagnostics?.length || report.auditStatus === 'jev_unavailable') continue
      const diagnostics = report.diagnostics.filter((item) => item.blocksApproval)
      const actionable = diagnostics.some((item) => ['reparo_local', 'regenerar_questao'].includes(item.repairAction))
      if (!actionable) continue
      let attempt: number
      if (params.generationJobId) {
        // Um item pode já ter contador legado de execuções anteriores. O limite
        // agora é uma única correção nesta execução, não um ciclo global acumulado.
        const reserved = await reserveQualityRepairAttempt(params.generationJobId, number, 2_147_483_647)
        if (reserved === null) {
          warnings.push(`Questão ${number}: não foi possível reservar a etapa de correção.`)
          continue
        }
        attempt = reserved
      } else {
        attempt = (localRepairAttempts.get(number) ?? 0) + 1
        if (attempt > MAX_QUALITY_STAGES) continue
        localRepairAttempts.set(number, attempt)
      }
      reservedAnyStage = true
      const fingerprint = JSON.stringify(current)
      const cycleKey = `${number}:${attempt}:${fingerprint}`
      if (replacementAttempts.has(cycleKey)) continue
      replacementAttempts.add(cycleKey)
      const startedAt = Date.now()
      const beforeCriteria = diagnostics.map((item) => item.code)
      let stage: QualityRepairHistoryEntry['stage'] = attempt >= 5
        ? 'safe_regeneration'
        : attempt === 4
          ? 'alternate_angle_regeneration'
          : attempt >= 3 || shouldRegenerateQuestionFromDiagnostics(diagnostics)
            ? 'same_topic_regeneration'
            : 'targeted_repair'
      const isRegeneration = stage !== 'targeted_repair'
      const authorizedFields = isRegeneration
        ? Object.keys(current)
        : [...new Set(diagnostics.flatMap((item) => item.fields))]
      if (params.generationJobId) await setJobItemStage(params.generationJobId, number, 'reparando_respostas')
      try {
      const candidate = repairQualityIssue
          ? await repairQualityIssue(number, current, diagnostics, attempt)
          : (await repairQuestionFromDiagnostics({
            question: current,
            curriculum,
            diagnostics,
            context: `exams/final-quality-repair-${number}-stage-${attempt}`,
            classLabel: params.classLabel,
          scope: 'answers',
            ...(params.generationJobId ? { previousAttempt: (await getQualityRepairHistory(params.generationJobId, number)).map((entry) => ({
              attempt: entry.attempt, blockingCriteria: entry.blockingCriteriaAfter, changedFields: entry.changedFields, outcome: entry.outcome,
            })).at(-1) ?? null } : {}),
          }))?.question ?? null
        if (!candidate || JSON.stringify(candidate) === fingerprint) {
          warnings.push(`Questão ${number}: a correção não alterou o JSON; a versão será incluída sem reauditoria Jev, conforme configuração.`)
          const entry: QualityRepairHistoryEntry = {
            attempt, stage, blockingCriteriaBefore: beforeCriteria, authorizedFields, changedFields: [], contentIdentical: true,
            blockingCriteriaAfter: beforeCriteria, outcome: 'not_audited', durationMs: Date.now() - startedAt, recordedAt: new Date().toISOString(),
          }
          if (params.generationJobId) await appendQualityRepairHistory(params.generationJobId, number, entry)
          continue
        }
        const scopeViolations = unauthorizedRepairChanges(current, candidate, diagnostics, isRegeneration)
        if (scopeViolations.length) {
          warnings.push(`Questão ${number}: correção alterou campo(s) fora do diagnóstico (${scopeViolations.join(', ')}); a versão original será incluída sem reauditoria Jev.`)
          if (params.generationJobId) await appendQualityRepairHistory(params.generationJobId, number, {
            attempt, stage, blockingCriteriaBefore: beforeCriteria, authorizedFields, changedFields: scopeViolations, contentIdentical: false,
            blockingCriteriaAfter: beforeCriteria, outcome: 'escopo_violado', durationMs: Date.now() - startedAt, recordedAt: new Date().toISOString(),
          })
          continue
        }
        const changedFields = [...new Set([...Object.keys(current), ...Object.keys(candidate)].filter((key) => JSON.stringify(current[key as keyof ExamQuestion]) !== JSON.stringify(candidate[key as keyof ExamQuestion])))].sort()
        candidates.push({ number, question: candidate, cycle: {
          attempt, stage, blockingCriteriaBefore: beforeCriteria, authorizedFields, changedFields, contentIdentical: false,
          durationMs: Date.now() - startedAt, recordedAt: new Date().toISOString(),
        } })
      } catch (error) {
        if (error instanceof AiBudgetExceededError || isTransientProviderFailure(error)) {
          if (params.generationJobId) await releaseQualityRepairAttempt(params.generationJobId, number)
          throw error
        }
        warnings.push(`Questão ${number}: correção falhou (${error instanceof Error ? error.message : 'erro'}); a questão permanece bloqueada pela reprovação Jev.`)
        if (params.generationJobId) await appendQualityRepairHistory(params.generationJobId, number, {
          attempt, stage, blockingCriteriaBefore: beforeCriteria, authorizedFields, changedFields: [], contentIdentical: false,
          blockingCriteriaAfter: beforeCriteria, outcome: 'not_audited', durationMs: Date.now() - startedAt, recordedAt: new Date().toISOString(),
        })
      }
    }
    if (!reservedAnyStage && !finalAudit.rejected.length) break
    for (const item of candidates) {
      const index = allQuestions.findIndex((question) => question.number === item.number)
      if (index >= 0) allQuestions[index] = item.question
      const aiIndex = aiQuestions.findIndex((question) => question.number === item.number)
      if (aiIndex >= 0) aiQuestions[aiIndex] = item.question
    }
    if (candidates.length) {
      // Toda versão alterada recebe uma auditoria própria antes de substituir
      // a questão original. Correções sem parecer válido continuam bloqueadas.
      const reaudited = await runQuestionQualityTest(
        curriculum,
        candidates.map((item) => item.question),
        jevEvidenceByQuestion,
        params.classLabel,
        async (questionNumber) => {
          if (params.generationJobId) await setJobItemStage(params.generationJobId, questionNumber, 'validando_respostas')
        },
        async (report) => {
          const question = candidates.find((candidate) => candidate.number === report.questionNumber)?.question
          if (params.generationJobId && question && report.approved) {
            await saveItemProgress(params.generationJobId, report.questionNumber, 'concluido', question, [{ code: 'JEV_QUALITY_REPORT', report }])
          }
        },
        'full',
      )
      qualityTestWarnings.push(...reaudited.warnings)
      warnings.push(...reaudited.warnings)
      const reauditedByNumber = new Map(reaudited.report.map((result) => [result.questionNumber, result]))
      const candidateNumbers = new Set(candidates.map((item) => item.number))
      finalAudit.report = finalAudit.report.map((result) => reauditedByNumber.get(result.questionNumber) ?? result)
      finalAudit.rejected = [...new Set([
        ...finalAudit.rejected.filter((number) => !candidateNumbers.has(number)),
        ...reaudited.rejected,
      ])]
      for (const item of candidates) {
        const audit = reauditedByNumber.get(item.number)
        if (audit?.approved) {
          qualityTestRepairedNumbers = [...new Set([...qualityTestRepairedNumbers, item.number])]
          if (params.generationJobId) await saveItemProgress(params.generationJobId, item.number, 'concluido', item.question, [{ code: 'JEV_QUALITY_REPORT', report: audit }], null)
        } else if (params.generationJobId) {
          await saveItemProgress(params.generationJobId, item.number, 'erro', item.question, audit?.diagnostics?.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
            reason: diagnostic.evidence ?? diagnostic.message,
          })) ?? [], audit?.verdictReason ?? 'A versão corrigida não recebeu aprovação Jev.')
        }
        if (params.generationJobId) {
          const blockingAfter = audit?.diagnostics?.filter((diagnostic) => diagnostic.blocksApproval).map((diagnostic) => diagnostic.code) ?? []
          const blockingBefore = item.cycle.blockingCriteriaBefore
          await appendQualityRepairHistory(params.generationJobId, item.number, {
            ...item.cycle,
            blockingCriteriaAfter: blockingAfter,
            outcome: audit?.approved ? 'resolved' : blockingAfter.some((code) => !blockingBefore.includes(code)) ? 'new_defect' : 'same_criteria_rejected',
          })
        }
      }
    }
  }
  qualityTestWarnings.push(...finalAudit.warnings)
  warnings.push(...finalAudit.warnings)
  qualityTestReports = initialRejected.length
    ? [
        { phase: 'Auditoria Jev inicial', results: initialAuditResults },
        { phase: 'Auditoria das versões corrigidas', results: finalAudit.report },
      ]
    : [{ phase: 'Auditoria Jev inicial', results: finalAudit.report }]
  if (finalAudit.rejected.length) {
    const details = finalAudit.report
      .filter((report) => finalAudit.rejected.includes(report.questionNumber))
      .map((report) => `Q${report.questionNumber}: ${report.diagnostics?.filter((item) => item.blocksApproval).map((item) => `${item.location ? `${item.location}: ` : ''}${item.message}${item.resolutionCheck ? ` Correção exigida: ${item.resolutionCheck}` : ''}`).filter(Boolean).slice(0, 2).join('; ') || report.verdictReason}`)
      .join(' | ')
    // Uma questão reprovada não invalida as aprovadas. Persistimos as falhas
    // como posições pendentes e guardamos um rascunho parcial para revisão.
    if (params.generationJobId) {
      await Promise.all(finalAudit.rejected.map(async (number) => {
        const question = allQuestions.find((candidate) => candidate.number === number)
        const report = finalAudit.report.find((candidate) => candidate.questionNumber === number)
        if (!question || question.source !== 'ia') return
        const details = (report?.diagnostics ?? []).filter((item) => item.blocksApproval).map((item) => ({ severity: item.severity, code: item.code, message: item.message, reason: item.evidence ?? item.message, location: item.location ?? undefined, resolutionCheck: item.resolutionCheck ?? undefined }))
        await saveItemProgress(params.generationJobId!, number, 'erro', question, details, `Reprovada pelo Jev: ${details.map((item) => `${item.location ? `${item.location}: ` : ''}${item.message}`).slice(0, 3).join('; ')}`)
      }))
    }
    for (const number of finalAudit.rejected) {
      const report = finalAudit.report.find((item) => item.questionNumber === number)
      pendingQuestionFailures.set(number, report?.verdictReason || report?.diagnostics?.filter((item) => item.blocksApproval).map((item) => item.message).join('; ') || 'A questão precisa de correção antes de entrar na prova.')
    }
      warnings.push(`O Jev manteve ${finalAudit.rejected.length} questão(ões) pendente(s); os rascunhos foram preservados para revisão e nova validação.`)
  }
  for (let number = 1; number <= params.questionCount; number++) {
    if (!allQuestions.some((question) => question.number === number)) {
      pendingQuestionFailures.set(number, pendingQuestionFailures.get(number) ?? 'A questão não foi concluída e precisa ser gerada novamente.')
    }
  }
  const requestedQuestionCount = params.questionCount + params.enemBankQuestionIds.length
  const pendingQuestionNumbers = [...pendingQuestionFailures.keys()].sort((a, b) => a - b)
  const isPartial = pendingQuestionNumbers.length > 0 || allQuestions.length < requestedQuestionCount
  if (isPartial) warnings.push(`Rascunho parcial: ${allQuestions.length} de ${requestedQuestionCount} questões incluídas. Pendentes: ${pendingQuestionNumbers.join(', ') || 'questão(ões) do banco'}.`)
  allQuestions = await classifyExamQuestions(allQuestions, curriculum)
  const examWithBank = {
      metadata: {
      segment: params.segment,
      gradeYear: params.gradeYear,
      academicYear: params.academicYear ?? new Date().getFullYear(),
      subject: params.subject,
      ...(params.classLabel ? { classLabel: params.classLabel } : {}),
      bimester: params.bimester ?? null,
      questionCount: allQuestions.length,
      objectiveCount: allQuestions.filter((q) => q.type === 'objetiva').length,
      discursiveCount: allQuestions.filter((q) => q.type === 'descritiva').length,
        alternativesCount,
        ...(params.curriculumPlanId ? { curriculumPlanId: params.curriculumPlanId } : {}),
        ...(isPartial ? { generationProgress: {
          complete: false,
          requestedQuestionCount,
          pendingQuestionNumbers,
          pendingReasons: Object.fromEntries(pendingQuestionFailures),
          acceptedReducedQuestionCount: false,
        } } : {}),
        qualityTest: { version: QUALITY_REPORT_VERSION, checkedAt: new Date().toISOString(), repairedQuestionNumbers: qualityTestRepairedNumbers, warnings: qualityTestWarnings, reports: qualityTestReports },
    },
    questions: allQuestions,
  }
  const generationPayload = examKind === 'atividade'
    ? {
        ...examWithBank,
        metadata: {
          ...examWithBank.metadata,
          activity: {
            bnccCodes: selectedBnccCodes,
            bnccPlan: params.bnccPlan ?? null,
            bnccDescriptions: Object.fromEntries(selectedBnccDescriptions),
            pedagogicalIntent: params.pedagogicalIntent ?? 'formativa',
            strategy: activityGenerationDecision ? { ...activityGenerationDecision.strategy, source: activityGenerationDecision.source, needsReview: activityGenerationDecision.needsReview, readinessProbability: activityGenerationDecision.readinessProbability } : null,
            rubricVersion: 'bncc-v1',
          },
        },
      }
    : examWithBank

  const [inserted] = await db
    .insert(generatedExams)
    .values({
      createdBy,
      segment: params.segment,
      gradeYear: params.gradeYear,
      academicYear: params.academicYear ?? new Date().getFullYear(),
      subject: params.subject,
      bimester: params.bimester ?? null,
      questionCount: examWithBank.metadata.questionCount,
      objectiveCount: examWithBank.metadata.objectiveCount,
      discursiveCount: examWithBank.metadata.discursiveCount,
      enemBankQuestionIds: params.enemBankQuestionIds.length ? params.enemBankQuestionIds : null,
      examKind,
      assessmentKind,
      scoringMethod: scoringMethodForQuestions(examWithBank.questions),
      status: examKind === 'prova' && !isPartial ? 'atribuido' : 'rascunho',
      // Atividades são autogeridas pelo professor que as criou. O vínculo
      // facilita visibilidade e correção posterior, sem atribuição formal
      // ou notificação da coordenação.
      ...(examKind === 'prova' && !isPartial
        ? { assignedTo: formalAssigneeId, assignedBy: createdBy, assignedAt: new Date() }
        : examKind === 'atividade'
        ? { assignedTo: createdBy, assignedBy: createdBy, assignedAt: new Date() }
        : {}),
      generationPayload,
      unmappedWarnings: [...curriculum.unmappedWarnings, ...warnings, ...issues],
      classroomCourseId: params.classroomCourseId ?? null,
    })
    .returning()

  let pedagogicalClassificationsCreated = 0
  try {
    const pedagogical = await persistGeneratedQuestionClassifications({
      examId: inserted.id,
      questions: examWithBank.questions,
      createdBy,
      modelProvider: 'deepseek',
      modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
      promptVersion: 'exam-generation-pedagogical-v1',
    })
    if (pedagogical.skipped.length > 0) {
      warnings.push(`${pedagogical.skipped.length} classificação(ões) pedagógica(s) já existiam e foram preservadas.`)
    }
    pedagogicalClassificationsCreated = pedagogical.created.length
  } catch (classificationError) {
    // Prova já está salva — falha de classificação nunca desfaz a geração
    // (mesmo comportamento da rota original).
    console.error('[generateExamCore] erro ao persistir classificações pedagógicas:', classificationError)
    warnings.push('Prova gerada, mas houve erro ao persistir classificações pedagógicas estruturadas.')
  }

  return {
    examId: inserted.id,
    exam: examWithBank,
    warnings,
    issues,
    pedagogicalClassificationsCreated,
  }
}
