import { db } from '@/db/client'
import { generatedExams, users, type AssessmentKind, type ExamKind } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { CurriculumPlanError } from '@/lib/curriculum/planCurriculum'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { computeQuestionSplit } from '@/lib/gemini/promptBuilder'
import { type ExamQuestion } from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { attachImagesToExam } from '@/lib/images/questionImageService'
import { planAutomaticVisuals } from '@/lib/illustrations/automaticVisualPlan'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { buildPlannedQuestionSlots, shouldRequireVisualAid, validateCurriculumPlan, type PlannedQuestionSlot } from '@/lib/exams/contentPlan'
import { assembleBestExamCandidates, compactQuestionContext, validateExamAssembly, type QuestionCandidate } from '@/lib/exams/examQualityAssembly'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { cognitiveObjectives, pickTargetSkills } from '@/lib/exams/targetSkills'
import { resolveBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { buildActivityBnccSlots, type ActivityBnccPlanItem, type ActivityBnccSlot } from '@/lib/exams/activityBnccPlan'
import { QUALITY_REPORT_VERSION } from '@/lib/exams/qualityReport'
import { repairQuestionFromDiagnostics } from '@/lib/exams/repairQuestion'
import { diagnosticFromIssue } from '@/lib/exams/qualityDiagnostics'
import { coherenceIssues, EXAM_OVERLAP_ALERT, EXAM_OVERLAP_BLOCK, generateExamBlueprint, generateStagedQuestion, generateUnifiedQuestion, isUnifiedGenerationEnabled, questionCoherenceText, textSimilarity } from '@/lib/generation'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'
import { decideExamGenerationStrategy, examGenerationStrategyInstruction } from '@/lib/ai/examGenerationDecision'
import { activityGenerationStrategyInstruction, decideActivityGenerationStrategy, type ActivityGenerationDecision, type ActivityPedagogicalIntent } from '@/lib/ai/activityGenerationDecision'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { getCompletedItems, getPendingSlotNumbers, initializeJobItems, saveItemProgress } from '@/lib/queue/jobProgress'
import type { CurriculumPlanItem } from '@/types/exam'

/** Falhas transitórias não devem gastar candidatas nem tentativas da fila. */
function isTransientProviderFailure(error: unknown): boolean {
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
  bimester?: number
  questionCount: number
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
  curriculumPlanId?: number
  /** Presente somente quando a geração vem da fila; habilita retomada por item. */
  generationJobId?: number
}

// Erros de entrada/recorte curricular (viram 422 na rota, mensagem legível
// no job). TabResolutionError e SheetNotConfiguredError propagam direto —
// a rota já os trata por instanceof, e a mensagem deles é auto-explicativa.
export class ExamGenerationInputError extends Error {}

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
  exam: {
    metadata: {
      segment: string
      gradeYear: number
      subject: string
      bimester: number | null
      questionCount: number
      objectiveCount: number
      discursiveCount: number
      alternativesCount: number
    }
    questions: ExamQuestion[]
  }
  warnings: string[]
  issues: string[]
  pedagogicalClassificationsCreated: number
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

  let curriculum
  try {
    curriculum = await getCurriculumForExam(params)
  } catch (err) {
    if (err instanceof CurriculumPlanError) throw new ExamGenerationInputError(err.message)
    if (err instanceof TabResolutionError || err instanceof SheetNotConfiguredError) throw err
    console.error('[generateExamCore] erro ao ler currículo:', err)
    throw new CurriculumReadError(err)
  }

  if (params.questionCount > 0 && !curriculum.units.length) {
    throw new ExamGenerationInputError('Nenhuma unidade curricular encontrada para os filtros selecionados.')
  }

  try {
    const planned = validateCurriculumPlan(curriculum.units, params.contentPlan, params.questionCount)
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
    const focusedUnits = curriculum.units.filter((unit) =>
      unit.habilidades.status === 'mapeado' && unit.habilidades.skills.some((skill) => selected.has(skill.code.toUpperCase())),
    )
    if (!focusedUnits.length) {
      throw new ExamGenerationInputError('Nenhuma unidade curricular corresponde às habilidades BNCC selecionadas. Atualize o recorte ou confira o currículo da série.')
    }
    for (const unit of focusedUnits) {
      for (const skill of unit.habilidades.skills) {
        const code = skill.code.toUpperCase()
        if (selected.has(code) && skill.description) selectedBnccDescriptions.set(code, skill.description)
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
  let finalQualityResult: Awaited<ReturnType<typeof runQuestionQualityTest>> | null = null
  let regenerateQuestion: ((questionNumber: number, current: ExamQuestion, forceNoVisual?: boolean) => Promise<ExamQuestion>) | null = null
  const visualAidByQuestion = new Map<number, CurriculumPlanItem['visualAid']>()
  const issues: string[] = []
  const autoQualityGateEnabled = process.env.EXAM_AUTO_QUALITY_GATE_ENABLED !== 'false'
  let alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5
  // Itens do banco ENEM são sempre objetivos. A proporção escolhida vale
  // para a prova inteira, portanto calculamos quanto dela ainda precisa ser
  // preenchido pelas questões da IA (limitado ao que é matematicamente
  // possível quando o banco já ultrapassa a meta).
  const objectiveTarget = Math.round((params.questionCount + params.enemBankQuestionIds.length) * (params.objectivePercentage ?? 70) / 100)
  const aiObjectiveCount = Math.max(0, Math.min(params.questionCount, objectiveTarget - params.enemBankQuestionIds.length))
  const aiObjectivePercentage = params.questionCount > 0 ? (aiObjectiveCount * 100) / params.questionCount : 0

  if (params.questionCount > 0) {
    if (isUnifiedGenerationEnabled()) {
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

      // BNCC como eixo: descrições oficiais ausentes na planilha são resolvidas
      // uma vez antes de gerar, para que toda questão receba a habilidade-alvo completa.
      const skillDescriptions = new Map(selectedBnccDescriptions)
      const missingDescriptionCodes = selectedUnitIndexes.flatMap((unitRowIndex) => {
        const unit = byRowIndex.get(unitRowIndex)
        return unit?.habilidades.status === 'mapeado' ? unit.habilidades.skills.filter((skill) => !skill.description?.trim() && !skillDescriptions.has(skill.code.toUpperCase())).map((skill) => skill.code) : []
      })
      if (missingDescriptionCodes.length) for (const [code, text] of await resolveBnccDescriptions(missingDescriptionCodes)) skillDescriptions.set(code, text)

      const generateUnifiedCandidate = async (slot: PlannedQuestionSlot, candidateNumber: number, previousStatement = '', feedback = '', forceNoVisual = false): Promise<QuestionCandidate> => {
        const unit = byRowIndex.get(slot.unitRowIndex)
        const blueprintSlot = blueprint.slots.find((candidate) => candidate.slotNumber === slot.number)
        if (!unit || !blueprintSlot) throw new ExamGenerationInputError(`Não foi possível preparar a questão ${slot.number} no pipeline unificado.`)
        const unitCurriculum = { ...curriculum, units: [unit] }
        let lastError = 'falha desconhecida'
        // Sem isto, cada uma das 3 tentativas locais mandava essencialmente
        // o mesmo prompt de novo — o motivo específico da rejeição (ex:
        // "texto de apoio ausente" de correctSingleQuestion) ficava só em
        // lastError pro log, nunca voltava pro modelo. Resultado: retries
        // caros que não corrigiam o problema real, só tentavam a sorte de
        // novo (bug real de Português, 21/09/2026 — Questão 9 rejeitada 3x
        // seguidas pelo mesmo motivo, nunca informado à IA).
        let retryReason: string | null = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (params.generationJobId) await saveItemProgress(params.generationJobId, slot.number, 'gerando')
            const unified = await generateUnifiedQuestion({
              questionNumber: slot.number,
              subject: params.subject,
              gradeYear: params.gradeYear,
              segment: params.segment,
              curriculumContent: blueprintSlot.curriculumContent,
              targetSkills: pickTargetSkills({
                unit,
                slotIndexInUnit: slots.filter((other) => other.unitRowIndex === slot.unitRowIndex && other.number < slot.number).length,
                forcedCodes: activityBnccSlots[slot.number - 1] ? [activityBnccSlots[slot.number - 1]!.code] : undefined,
                descriptions: skillDescriptions,
              }),
              objectives: cognitiveObjectives(unit),
              contentPlanInstruction: [
                `capítulo "${unit.tituloCapitulo}"; tipo ${slot.type}; candidata ${candidateNumber}.${attempt}`,
                previousStatement ? `Não repita este enunciado rejeitado: ${previousStatement.slice(0, 500)}.` : '',
                feedback ? `Corrija especificamente: ${feedback.slice(0, 900)}.` : '',
                retryReason ? `A tentativa anterior desta mesma questão foi rejeitada por: ${retryReason.slice(0, 500)}. Corrija exatamente isso, sem repetir o mesmo erro.` : '',
              ].filter(Boolean).join(' '),
              forceNoVisual,
              questionType: slot.type,
            }, blueprintSlot)
            const corrected = correctSingleQuestion({ ...unified.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }, unitCurriculum, { allowMathReviewFallback: true })
            if (corrected.issues.length) throw new Error(corrected.issues.join(' '))
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
            if (params.generationJobId) await saveItemProgress(params.generationJobId, slot.number, 'concluido', question)
            return { slotNumber: slot.number, candidateNumber, question }
          } catch (error) {
            if (error instanceof AiBudgetExceededError || isTransientProviderFailure(error)) throw error
            lastError = generationFailureMessage(error)
            retryReason = lastError
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
        throw new ExamGenerationInputError(`Questão ${slot.number} não atingiu os requisitos locais após 3 tentativas: ${lastError}`)
      }

      const completed = params.generationJobId ? await getCompletedItems(params.generationJobId) : new Map<number, ExamQuestion>()
      const pendingNumbers = params.generationJobId ? new Set(await getPendingSlotNumbers(params.generationJobId)) : new Set(slots.map((slot) => slot.number))
      const candidates: QuestionCandidate[] = slots.flatMap((slot) => {
        const question = completed.get(slot.number)
        return question && !pendingNumbers.has(slot.number) ? [{ slotNumber: slot.number, candidateNumber: 0, question }] : []
      })
      const slotsToGenerate = slots.filter((slot) => !completed.has(slot.number) || pendingNumbers.has(slot.number))
      const concurrency = Math.min(3, slots.length)
      for (let offset = 0; offset < slotsToGenerate.length; offset += concurrency) {
        const group = await Promise.all(slotsToGenerate.slice(offset, offset + concurrency).map((slot) =>
          generateUnifiedCandidate(slot, slot.number),
        ))
        candidates.push(...group)
      }
      aiQuestions = assembleBestExamCandidates(slots, candidates)
      let blockingIssues = validateExamAssembly(aiQuestions, slots).filter((issue) => issue.severity === 'bloqueante')
      // Conflitos entre itens (repetição, cobertura e similares) só são
      // conhecidos depois da montagem. Refazemos exclusivamente os slots
      // afetados, no máximo duas vezes, com o motivo no próximo prompt.
      for (let round = 1; round <= 2 && blockingIssues.length; round++) {
        const numbers = [...new Set(blockingIssues.flatMap((issue) => issue.questionNumbers))]
        warnings.push(`Montagem unificada: refazendo as questões ${numbers.join(', ')} (rodada ${round}/2).`)
        const replacements = await Promise.all(numbers.map(async (number) => {
          const slot = slots.find((candidate) => candidate.number === number)
          const current = aiQuestions.find((question) => question.number === number)
          if (!slot || !current) throw new ExamGenerationInputError(`Não foi possível reparar a posição ${number} da montagem unificada.`)
          const feedback = blockingIssues
            .filter((issue) => issue.questionNumbers.includes(number))
            .map((issue) => issue.reason)
            .join(' ')
          return { number, question: (await generateUnifiedCandidate(slot, round * 1000 + number, current.statement, feedback)).question }
        }))
        const byNumber = new Map(replacements.map((item) => [item.number, item.question]))
        aiQuestions = aiQuestions.map((question) => byNumber.get(question.number) ?? question)
        blockingIssues = validateExamAssembly(aiQuestions, slots).filter((issue) => issue.severity === 'bloqueante')
      }
      if (blockingIssues.length) {
        const numbers = [...new Set(blockingIssues.flatMap((issue) => issue.questionNumbers))]
        throw new ExamGenerationInputError(`A montagem unificada não conseguiu resolver os conflitos nas questões ${numbers.join(', ')} após duas substituições locais.`)
      }
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false) => {
        const slot = slots.find((candidate) => candidate.number === questionNumber)
        if (!slot) throw new ExamGenerationInputError(`Não foi possível localizar a posição ${questionNumber} para substituição automática.`)
        return (await generateUnifiedCandidate(slot, 100 + questionNumber, current.statement, 'A auditoria automática reprovou a versão anterior; entregue uma única resposta correta.', forceNoVisual)).question
      }
      alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5
    } else if (params.contentPlan?.length) {
      const slots = buildPlannedQuestionSlots(params.contentPlan, params.questionCount, aiObjectivePercentage)
      const byRowIndex = new Map(curriculum.units.map((unit) => [unit.rowIndex, unit]))
      const generateCandidate = async (slot: PlannedQuestionSlot, candidateNumber: number, avoidStatement: string, avoidContext?: string, forceNoVisual = false): Promise<QuestionCandidate> => {
        const unit = byRowIndex.get(slot.unitRowIndex)
        if (!unit) throw new ExamGenerationInputError(`Capítulo ${slot.unitRowIndex} não foi encontrado no planejamento.`)
        const unitCurriculum = { ...curriculum, units: [unit] }
        const visualAid = forceNoVisual ? 'sem_imagem' : slot.visualAid === 'auto' && shouldRequireVisualAid(unit) ? 'obrigatorio' : slot.visualAid
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
              curriculumContent: [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'),
              contentPlanInstruction: `capítulo "${unit.tituloCapitulo}"; tipo ${slot.type}; recurso visual ${visualAid}; candidata ${candidateNumber}.${attempt}; ${variation} Evite este enunciado anterior: ${avoidStatement.slice(0, 500)}. ${avoidContext ?? ''}${retryReason ? ` A tentativa anterior desta mesma questão foi rejeitada por: ${retryReason.slice(0, 500)}. Corrija exatamente isso, sem repetir o mesmo erro.` : ''}`,
              forceNoVisual,
              questionType: slot.type,
            })
            let question: ExamQuestion = { ...staged.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }
            // Correção determinística (integridade de texto, BNCC, SAEB,
            // alternativas e ficha técnica canônica) antes de aceitar a
            // questão fragmentada. Problemas aqui acionam o fallback padrão.
            const corrected = correctSingleQuestion(question, unitCurriculum, { allowMathReviewFallback: true })
            if (corrected.issues.length) throw new Error(corrected.issues.join(' '))
            question = { ...corrected.question, curriculumUnitRowIndex: slot.unitRowIndex }
            if (visualAid === 'obrigatorio' && (!question.needsImage || !question.imageQuery?.trim())) {
              const fallbackQuery = `${unit.tituloCapitulo} ${unit.conteudo ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 180)
              question = { ...question, needsImage: true, imageQuery: fallbackQuery }
            }
            warnings.push(`Questão ${slot.number}: gerada pelo pipeline fragmentado.`)
            warnings.push(...staged.issues.map((issue) => `Questão ${slot.number} [${issue.severity}]: ${issue.reason}`))
            warnings.push(...corrected.warnings)
            return { slotNumber: slot.number, candidateNumber, question }
          } catch (error) {
            if (error instanceof AiBudgetExceededError) throw error
            if (isTransientProviderFailure(error)) throw error
            lastError = error instanceof Error ? error.message : 'erro'
            retryReason = lastError
          }
        }
        throw new ExamGenerationInputError(`Questão ${slot.number} não atingiu os requisitos após 4 tentativas: ${lastError}`)
      }
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false) => {
        const slot = slots.find((candidate) => candidate.number === questionNumber)
        if (!slot) throw new ExamGenerationInputError(`Não foi possível localizar a posição ${questionNumber} para substituição automática.`)
        return (await generateCandidate(slot, 2, current.statement, compactQuestionContext(aiQuestions, questionNumber), forceNoVisual)).question
      }

      // Itens são independentes nesta etapa. Limitar a concorrência reduz o
      // tempo total sem saturar o provedor nem perder a auditoria global que
      // acontece depois sobre a prova inteira.
      const concurrency = Math.min(3, slots.length)
      const candidates: QuestionCandidate[] = []
      for (let offset = 0; offset < slots.length; offset += concurrency) {
        const group = await Promise.all(slots.slice(offset, offset + concurrency).map((slot) =>
          // A identidade da candidata varia por posição. Assim, mesmo
          // capítulos repetidos recebem orientações e templates diferentes
          // antes da montagem global, sem multiplicar chamadas à IA.
          generateCandidate(slot, slot.number, 'Não há questão anterior; crie um item original.'),
        ))
        candidates.push(...group)
      }

      aiQuestions = assembleBestExamCandidates(slots, candidates)
      const blockingIssues = validateExamAssembly(aiQuestions, slots).filter((issue) => issue.severity === 'bloqueante')

      if (blockingIssues.length) {
        let unresolved = blockingIssues
        const repaired = new Set<number>()
        for (let round = 1; round <= 3 && unresolved.length; round++) {
          const repairNumbers = [...new Set(unresolved.flatMap((issue) => issue.questionNumbers))]
          warnings.push(`Revisão editorial global: substituindo ${repairNumbers.length} questão(ões) na rodada ${round}.`)
          for (const number of repairNumbers) {
            const slot = slots.find((candidate) => candidate.number === number)
            const current = aiQuestions.find((candidate) => candidate.number === number)
            if (!slot || !current) continue
            // Só a posição realmente conflitante é refeita. Duas opções
            // bastam para a escolha local e evitam a explosão de chamadas que
            // ocorria ao substituir praticamente a prova inteira por rodada.
            const attempts = await Promise.allSettled([1, 2].map((offset) =>
              generateCandidate(slot, round * 100 + number * 10 + offset, current.statement, compactQuestionContext(aiQuestions, number)),
            ))
            const variants = attempts
              .filter((result): result is PromiseFulfilledResult<QuestionCandidate> => result.status === 'fulfilled')
              .map((result) => result.value)
            if (!variants.length) continue
            const replacement = variants.sort((left, right) => {
              const leftTrial = aiQuestions.map((question) => question.number === number ? left.question : question)
              const rightTrial = aiQuestions.map((question) => question.number === number ? right.question : question)
              const leftBlocks = validateExamAssembly(leftTrial, slots).filter((issue) => issue.severity === 'bloqueante').length
              const rightBlocks = validateExamAssembly(rightTrial, slots).filter((issue) => issue.severity === 'bloqueante').length
              return leftBlocks - rightBlocks || left.candidateNumber - right.candidateNumber
            })[0]
            aiQuestions = aiQuestions.map((question) => question.number === number ? replacement.question : question)
            repaired.add(number)
          }
          unresolved = validateExamAssembly(aiQuestions, slots).filter((issue) => issue.severity === 'bloqueante')
        }
        qualityTestRepairedNumbers = [...new Set([...qualityTestRepairedNumbers, ...repaired])]
        if (unresolved.length) {
          const affectedNumbers = [...new Set(unresolved.flatMap((issue) => issue.questionNumbers))]
          throw new ExamGenerationInputError(`A montagem automática não conseguiu obter questões distintas e válidas para as posições ${affectedNumbers.join(', ')} após três rodadas de substituição.`)
        }
      }
      alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5
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
      regenerateQuestion = async (questionNumber, current, forceNoVisual = false) => {
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
              curriculumContent: activityContext.content,
              contentPlanInstruction: `${examKind === 'atividade' ? 'atividade' : 'prova'}; tipo ${questionType}; ${activityContext.instruction} substitua o enunciado anterior: ${current.statement.slice(0, 300)}`,
              forceNoVisual,
              questionType,
            })
            const corrected = correctSingleQuestion({ ...staged.question, number: questionNumber }, curriculum, { allowMathReviewFallback: true })
            if (corrected.issues.length) throw new Error(corrected.issues.join(' '))
            return applyPlannedBncc({ ...corrected.question, number: questionNumber }, questionNumber)
          } catch (error) {
            if (error instanceof AiBudgetExceededError) throw error
            if (isTransientProviderFailure(error)) throw error
            lastError = error instanceof Error ? error.message : 'erro'
          }
        }
        throw new ExamGenerationInputError(`Questão ${questionNumber} não pôde ser substituída automaticamente: ${lastError}`)
      }

      for (let index = 0; index < params.questionCount; index++) {
        const questionType: ExamQuestion['type'] = index < split.objectiveCount ? 'objetiva' : 'descritiva'
        const activityContext = activityContextForQuestion(index + 1)
        const priorText = stagedQuestions.slice(-5).map((question) => question.statement.slice(0, 200)).join(' | ')
        let accepted: ExamQuestion | null = null
        let lastQuestionError = 'falha desconhecida'
        try {
          // Uma falha de estágio isola a candidata, não a prova toda. Cada
          // nova candidata recebe contexto de variação, evitando repetir a
          // mesma saída inválida (como distratores duplicados).
          for (let candidateAttempt = 1; candidateAttempt <= 4 && !accepted; candidateAttempt++) {
            for (let coherenceAttempt = 0; coherenceAttempt < 2 && !accepted; coherenceAttempt++) {
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
                  curriculumContent: activityContext.content,
                  contentPlanInstruction: `${examKind === 'atividade' ? 'atividade' : 'prova'}; tipo ${questionType}; ${activityContext.instruction}${avoid ? `; ${avoid}` : ''}`,
                  questionType,
                })
                const corrected = correctSingleQuestion({ ...staged.question, number: index + 1 }, curriculum, { allowMathReviewFallback: true })
                if (corrected.issues.length) throw new Error(corrected.issues.join(' '))
                const candidate = applyPlannedBncc({ ...corrected.question, number: index + 1 }, index + 1)
                const worst = stagedQuestions.reduce(
                  (max, question) => Math.max(max, textSimilarity(questionCoherenceText(candidate), questionCoherenceText(question))),
                  0,
                )
                warnings.push(...staged.issues.map((issue) => `Questão ${index + 1} [${issue.severity}]: ${issue.reason}`))
                warnings.push(...corrected.warnings)
                if (worst >= EXAM_OVERLAP_BLOCK && coherenceAttempt === 0) {
                  warnings.push(`Questão ${index + 1}: enunciado ${Math.round(worst * 100)}% semelhante a outra; regerando para diferenciar.`)
                  continue
                }
                if (worst >= EXAM_OVERLAP_ALERT) {
                  warnings.push(`Questão ${index + 1}: semelhança de ${Math.round(worst * 100)}% com outra questão; confira na revisão.`)
                }
                accepted = candidate
              } catch (error) {
                if (error instanceof AiBudgetExceededError) throw error
                if (isTransientProviderFailure(error)) throw error
                lastQuestionError = error instanceof Error ? error.message : 'erro'
                // Não repete a mesma candidata após falha de pipeline; a
                // próxima iteração altera o contexto de geração.
                break
              }
            }
          }
          if (!accepted) throw new Error(lastQuestionError === 'falha desconhecida' ? 'não foi possível diferenciar o enunciado das demais questões.' : lastQuestionError)
          stagedQuestions.push(accepted)
        } catch (error) {
          if (error instanceof AiBudgetExceededError) throw error
          if (isTransientProviderFailure(error)) throw error
          stagedFailure = `Questão ${index + 1}: ${error instanceof Error ? error.message : 'falha no pipeline fragmentado'}.`
          break
        }
      }

      if (stagedFailure) {
        throw new ExamGenerationInputError(`${stagedFailure} A prova não foi criada porque nenhuma questão sem validação pode substituir o item.`)
      }
      aiQuestions = stagedQuestions
      warnings.push(`${params.questionCount} questão(ões) geradas pelo pipeline fragmentado.`)
      alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5
    }

    if (autoQualityGateEnabled) {
      // Esta é a única auditoria de qualidade por questão. Qualquer item
      // bloqueado é descartado e substituído antes de a prova existir.
      for (let round = 1; round <= 3; round++) {
        const quality = await runQuestionQualityTest(curriculum, aiQuestions)
        warnings.push(...quality.warnings)
        qualityTestWarnings.push(...quality.warnings)
        const rejected = quality.rejected
        if (!rejected.length) {
          finalQualityResult = quality
          break
        }
        if (!regenerateQuestion || round === 3) {
          throw new ExamGenerationInputError(`A auditoria automática não conseguiu aprovar as questões ${rejected.join(', ')} após substituições automáticas.`)
        }
        warnings.push(`Auditoria automática substituindo as questões ${rejected.join(', ')} (rodada ${round}).`)
        const replacements: Array<{ number: number; question: ExamQuestion }> = []
        const concurrency = Math.min(3, rejected.length)
        for (let offset = 0; offset < rejected.length; offset += concurrency) {
          const group = await Promise.all(rejected.slice(offset, offset + concurrency).map(async (number) => {
            const current = aiQuestions.find((question) => question.number === number)
            if (!current) throw new ExamGenerationInputError(`A auditoria indicou a questão inexistente ${number}.`)
            const diagnostics = quality.report.find((result) => result.questionNumber === number)?.diagnostics ?? []
            // Problemas locais (principalmente distratores) não precisam
            // destruir uma questão válida. Reparamos somente o campo
            // indicado e voltamos pelo mesmo gate na rodada seguinte.
            try {
              const repaired = await repairQuestionFromDiagnostics({
                question: current,
                curriculum,
                diagnostics,
                context: `exams/quality-repair-${number}-round-${round}`,
              })
              if (repaired) {
                warnings.push(`Questão ${number}: reparo local orientado pelo diagnóstico de qualidade.`)
                warnings.push(...repaired.warnings)
                return { number, question: repaired.question }
              }
            } catch (repairError) {
              // O reparo é uma otimização. Se ele não obedecer às invariantes,
              // seguimos para a substituição orientada já existente.
              warnings.push(`Questão ${number}: reparo local não aprovado (${repairError instanceof Error ? repairError.message : 'erro'}); regenerando a questão.`)
            }
            return { number, question: await regenerateQuestion!(number, current) }
          }))
          replacements.push(...group)
        }
        const replacementByNumber = new Map(replacements.map((item) => [item.number, item.question]))
        aiQuestions = aiQuestions.map((question) => replacementByNumber.get(question.number) ?? question)
        qualityTestRepairedNumbers = [...new Set([...qualityTestRepairedNumbers, ...rejected])]
      }
      if (!finalQualityResult) throw new ExamGenerationInputError('A auditoria automática não produziu um relatório final aprovado.')
      qualityTestReports = [{ phase: 'Auditoria automática final', results: finalQualityResult.report }]
    } else {
      warnings.push('Auditoria automática temporariamente desativada; revise todas as questões antes de publicar a prova.')
    }

    // Se uma questão declara visual obrigatório, ela não pode seguir sem o
    // recurso validado. Uma falha isola a questão: ela é substituída, nunca
    // "aceita" sem figura para ser consertada depois na revisão.
    const visualPlanning = await planAutomaticVisuals(params.subject, aiQuestions)
    if (visualPlanning.blockedQuestionNumbers.length) {
      throw new ExamGenerationInputError(`As questões ${visualPlanning.blockedQuestionNumbers.join(', ')} dependem de figura, gráfico, mapa ou diagrama que não foi fornecido. Elas precisam ser substituídas antes de concluir a prova.`)
    }
    aiQuestions = visualPlanning.questions
    const examWithImages = await attachImagesToExam({ metadata: { segment: params.segment, gradeYear: params.gradeYear, subject: params.subject, bimester: params.bimester ?? null, questionCount: aiQuestions.length, objectiveCount: aiQuestions.filter((q) => q.type === 'objetiva').length, discursiveCount: aiQuestions.filter((q) => q.type === 'descritiva').length, alternativesCount }, questions: aiQuestions }, { requireResolvedImages: false, maxAttemptsPerImage: 2, subject: params.subject })
    aiQuestions = examWithImages.questions
    const unresolvedImages = aiQuestions.filter((question) => question.needsImage && !question.image).map((question) => question.number)
    if (unresolvedImages.length) {
      if (!regenerateQuestion) throw new ExamGenerationInputError(`Não foi possível obter imagem válida para a(s) questão(ões) ${unresolvedImages.join(', ')}.`)
      const regenerateWithVisual = regenerateQuestion
      const replacements = await Promise.all(unresolvedImages.map(async (questionNumber) => {
        const current = aiQuestions.find((question) => question.number === questionNumber)
        if (!current) throw new ExamGenerationInputError(`Não foi possível localizar a questão ${questionNumber} para substituir após falha visual.`)
        // Visuais automáticos melhoram a questão, mas não podem impedir a
        // entrega da prova quando o provedor de imagem falha. Uma exigência
        // explícita da matriz continua bloqueante e pede intervenção humana.
        if (visualAidByQuestion.get(questionNumber) === 'obrigatorio') {
          throw new ExamGenerationInputError(`Questão ${questionNumber} exige recurso visual obrigatório, mas não foi possível obter uma imagem válida.`)
        }
        let lastError = 'falha desconhecida'
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const candidate = await regenerateWithVisual(questionNumber, current, true)
            if (candidate.needsImage || candidate.visualPlan?.required) throw new Error('A substituta ainda depende de ilustração.')
            return candidate
          } catch (error) {
            if (error instanceof AiBudgetExceededError) throw error
            if (isTransientProviderFailure(error)) throw error
            lastError = error instanceof Error ? error.message : String(error)
          }
        }
        throw new ExamGenerationInputError(`Questão ${questionNumber} não pôde ser refeita sem imagem após falha visual: ${lastError}`)
      }))
      const byNumber = new Map(replacements.map((question) => [question.number, question]))
      aiQuestions = aiQuestions.map((question) => byNumber.get(question.number) ?? question)
      warnings.push(`Questão(ões) ${unresolvedImages.join(', ')} foram refeitas sem imagem porque o visual automático não pôde ser validado.`)
    }
  }

  const bankQuestions = await buildBankExamQuestions(params.enemBankQuestionIds, aiQuestions.length + 1)
  if (bankQuestions.length < params.enemBankQuestionIds.length) {
    warnings.push(`${params.enemBankQuestionIds.length - bankQuestions.length} questão(ões) do banco ENEM selecionadas não foram encontradas (removidas do banco?) e ficaram de fora.`)
  }

  const allQuestions = [...aiQuestions, ...bankQuestions]
  // Relatório final de coerência da prova (repetição/duplicação entre itens).
  for (const issue of coherenceIssues(aiQuestions)) {
    warnings.push(`Coerência da prova: ${issue.reason}`)
  }
  // Itens do banco não passam pela geração atual; auditamos somente eles e
  // juntamos seu resultado ao relatório já aprovado das questões geradas.
  if (bankQuestions.length && autoQualityGateEnabled) {
    const bankQuality = await runQuestionQualityTest(curriculum, bankQuestions)
    if (bankQuality.rejected.length) {
      throw new ExamGenerationInputError(`Questões do banco ENEM reprovadas pela auditoria automática: ${bankQuality.rejected.join(', ')}.`)
    }
    qualityTestWarnings.push(...bankQuality.warnings)
    warnings.push(...bankQuality.warnings)
    qualityTestReports = [{
      phase: 'Auditoria automática final',
      results: [...(finalQualityResult?.report ?? []), ...bankQuality.report].sort((a, b) => a.questionNumber - b.questionNumber),
    }]
  } else if (bankQuestions.length) {
    warnings.push('Auditoria automática do banco ENEM temporariamente desativada; revise as questões antes de publicar a prova.')
  }
  const examWithBank = {
      metadata: {
      segment: params.segment,
      gradeYear: params.gradeYear,
      subject: params.subject,
      bimester: params.bimester ?? null,
      questionCount: allQuestions.length,
      objectiveCount: allQuestions.filter((q) => q.type === 'objetiva').length,
      discursiveCount: allQuestions.filter((q) => q.type === 'descritiva').length,
        alternativesCount,
        ...(params.curriculumPlanId ? { curriculumPlanId: params.curriculumPlanId } : {}),
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
      status: examKind === 'prova' ? 'atribuido' : 'rascunho',
      // Atividades são autogeridas pelo professor que as criou. O vínculo
      // facilita visibilidade e correção posterior, sem atribuição formal
      // ou notificação da coordenação.
      ...(examKind === 'prova'
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
