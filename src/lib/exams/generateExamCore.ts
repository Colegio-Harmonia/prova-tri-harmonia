import { db } from '@/db/client'
import { generatedExams, users, type AssessmentKind, type ExamKind } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { buildExamPrompt, buildSingleQuestionPrompt } from '@/lib/gemini/promptBuilder'
import { examGenerationResultSchema, GEMINI_RESPONSE_SCHEMA, singleQuestionResultSchema, SINGLE_QUESTION_RESPONSE_SCHEMA, type ExamGenerationResult, type ExamQuestion, type SingleQuestionResult } from '@/lib/gemini/examSchema'
import { correctSingleQuestion, validateExamResult } from '@/lib/gemini/examValidator'
import { attachImagesToExam } from '@/lib/images/questionImageService'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { isPedagogicalQualityGateEnabled } from '@/lib/pedagogical/generationQualityGate'
import { validateGeneratedExamPedagogicalFidelity } from '@/lib/pedagogical/generationQualityGateService'
import { buildPlannedQuestionSlots, shouldRequireVisualAid, validateCurriculumPlan, type PlannedQuestionSlot } from '@/lib/exams/contentPlan'
import { assembleBestExamCandidates, compactQuestionContext, validateExamAssembly, type QuestionCandidate } from '@/lib/exams/examQualityAssembly'
import { auditFinalExamQuality } from '@/lib/exams/examQualityAudit'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import type { CurriculumPlanItem } from '@/types/exam'

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
  enemBankQuestionIds: number[]
  // Rótulo pedagógico exibido na prova. A TRI INEP é definida pelos itens
  // reais do banco, não por este campo. Default 'padrao'.
  assessmentKind?: AssessmentKind
  // Atividades FI/FII usam o mesmo motor de itens e revisão, mas ficam em
  // uma coleção própria e trazem o recorte BNCC explícito no payload.
  examKind?: Extract<ExamKind, 'prova' | 'atividade'>
  bnccCodes?: string[]
  classroomCourseId?: string | null
  contentPlan?: CurriculumPlanItem[]
  assignedTo?: number
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
  }

  let aiQuestions: ExamQuestion[] = []
  let warnings: string[] = []
  let qualityTestWarnings: string[] = []
  let qualityTestRepairedNumbers: number[] = []
  let qualityTestReports: Array<{ phase: string; results: Awaited<ReturnType<typeof runQuestionQualityTest>>['report'] }> = []
  const issues: string[] = []
  let alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5

  if (params.questionCount > 0) {
    const qualityGateEnabled = isPedagogicalQualityGateEnabled()
    if (params.contentPlan?.length) {
      const slots = buildPlannedQuestionSlots(params.contentPlan, params.questionCount)
      const byRowIndex = new Map(curriculum.units.map((unit) => [unit.rowIndex, unit]))
      const generateCandidate = async (slot: PlannedQuestionSlot, candidateNumber: number, avoidStatement: string, avoidContext?: string): Promise<QuestionCandidate> => {
        const unit = byRowIndex.get(slot.unitRowIndex)
        if (!unit) throw new ExamGenerationInputError(`Capítulo ${slot.unitRowIndex} não foi encontrado no planejamento.`)
        const unitCurriculum = { ...curriculum, units: [unit] }
        const visualAid = slot.visualAid === 'auto' && shouldRequireVisualAid(unit) ? 'obrigatorio' : slot.visualAid
        const prompt = await buildSingleQuestionPrompt(unitCurriculum, {
          type: slot.type,
          questionNumber: slot.number,
          avoidStatement,
          avoidContext,
          visualAid,
        })
        const generated = await generateValidatedStructuredContent<SingleQuestionResult, ExamQuestion>({
          context: `exams/generate-question-${slot.number}`,
          prompt,
          responseSchema: SINGLE_QUESTION_RESPONSE_SCHEMA,
          zodSchema: singleQuestionResultSchema,
          validate: async (parsedQuestion) => {
            const candidate = { ...parsedQuestion.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex }
            let { question, issues, warnings: questionWarnings } = correctSingleQuestion(candidate, unitCurriculum)
            if (question.type !== slot.type) issues.push(`Questão ${slot.number}: esperado tipo "${slot.type}", veio "${question.type}".`)
            if (visualAid === 'obrigatorio' && (!question.needsImage || !question.imageQuery?.trim())) {
              // A exigência da matriz é uma regra do sistema. Se o modelo
              // omitir o campo, corrigimos localmente e evitamos desperdiçar
              // uma rodada inteira de geração por uma falha de serialização.
              const fallbackQuery = `${unit.tituloCapitulo} ${unit.conteudo ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 180)
              question = { ...question, needsImage: true, imageQuery: question.imageQuery?.trim() || fallbackQuery }
              questionWarnings.push(`Questão ${slot.number}: recurso visual obrigatório foi normalizado a partir do capítulo.`)
            }
            // Difficulty não é requisito de aprovação da prova. O professor
            // não escolhe essa escala na composição e ela não pode tornar um
            // item curricularmente válido inviável por mera omissão da IA.
            // A revisão cega pedagógica é feita uma única vez sobre a prova
            // montada. Executá-la por item multiplica chamadas e torna uma
            // divergência local capaz de abortar toda a prova.
            return { value: question, issues, warnings: questionWarnings }
          },
        })
        warnings.push(...generated.warnings)
        if (generated.repaired) warnings.push(`Questão ${slot.number}, candidata ${candidateNumber}, validada após reparo (${generated.attempts} tentativa(s)).`)
        return { slotNumber: slot.number, candidateNumber, question: generated.value }
      }

      // Itens são independentes nesta etapa. Limitar a concorrência reduz o
      // tempo total sem saturar o provedor nem perder a auditoria global que
      // acontece depois sobre a prova inteira.
      const concurrency = Math.min(3, slots.length)
      const candidates: QuestionCandidate[] = []
      for (let offset = 0; offset < slots.length; offset += concurrency) {
        const group = await Promise.all(slots.slice(offset, offset + concurrency).map((slot) =>
          generateCandidate(slot, 1, 'Não há questão anterior; crie um item original.'),
        ))
        candidates.push(...group)
      }

      aiQuestions = assembleBestExamCandidates(slots, candidates)
      const firstQualityTest = await runQuestionQualityTest(curriculum, aiQuestions)
      warnings.push(...firstQualityTest.warnings)
      qualityTestWarnings.push(...firstQualityTest.warnings)
      qualityTestReports.push({ phase: 'Análise inicial', results: firstQualityTest.report })
      const firstAudit = await auditFinalExamQuality(curriculum, slots, aiQuestions)
      warnings.push(...firstAudit.warnings)
      const blockingIssues = [...validateExamAssembly(aiQuestions, slots), ...firstQualityTest.issues, ...firstAudit.issues].filter((issue) => issue.severity === 'bloqueante')

      if (blockingIssues.length) {
        const repairNumbers = [...new Set(blockingIssues.flatMap((issue) => issue.questionNumbers))]
        qualityTestRepairedNumbers = repairNumbers
        warnings.push(`Revisão editorial global encontrou ${repairNumbers.length} questão(ões) para reparo pontual.`)
        for (const number of repairNumbers) {
          const slot = slots.find((candidate) => candidate.number === number)
          const current = aiQuestions.find((candidate) => candidate.number === number)
          if (!slot || !current) continue
          const replacement = await generateCandidate(slot, 3, current.statement, compactQuestionContext(aiQuestions, number))
          aiQuestions = aiQuestions.map((question) => question.number === number ? replacement.question : question)
        }
        const finalDeterministicIssues = validateExamAssembly(aiQuestions, slots).filter((issue) => issue.severity === 'bloqueante')
        const finalQualityTest = await runQuestionQualityTest(curriculum, aiQuestions)
        warnings.push(...finalQualityTest.warnings)
        qualityTestWarnings.push(...finalQualityTest.warnings)
        qualityTestReports.push({ phase: 'Após reparo automático', results: finalQualityTest.report })
        const finalAudit = await auditFinalExamQuality(curriculum, slots, aiQuestions)
        warnings.push(...finalAudit.warnings)
        const unresolved = [...finalDeterministicIssues, ...finalQualityTest.issues.filter((issue) => issue.severity === 'bloqueante'), ...finalAudit.issues.filter((issue) => issue.severity === 'bloqueante')]
        if (unresolved.length) {
          // A geração já tentou reparar cada questão indicada. Se a segunda
          // versão ainda exigir julgamento pedagógico, preservamos a prova e
          // levamos a pendência explícita para a Conferência. Encerrar o job
          // aqui escondia justamente o material que o professor precisa
          // revisar e fazia uma falha editorial parecer falha técnica.
          const affectedNumbers = [...new Set(unresolved.flatMap((issue) => issue.questionNumbers))]
          warnings.push(`Revisão de qualidade pendente nas questões ${affectedNumbers.join(', ')}. A prova foi gerada para revisão humana; não a aprove sem conferir os apontamentos no relatório de qualidade.`)
          qualityTestWarnings.push(...unresolved.map((issue) => `Q${issue.questionNumbers.join('/Q')}: ${issue.reason}`))
        }
      }
      alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5
    } else {
      const prompt = await buildExamPrompt(curriculum, { questionCount: params.questionCount, mode: examKind === 'atividade' ? 'atividade' : 'prova', selectedBnccCodes })
      const generated = await generateValidatedStructuredContent<ExamGenerationResult, ExamGenerationResult>({
      context: 'exams/generate',
      prompt,
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      zodSchema: examGenerationResultSchema,
      validate: async (parsedExam) => {
        const validation = validateExamResult(parsedExam, curriculum, { ...params, enforcePedagogicalCompleteness: qualityGateEnabled })
        if (validation.issues.length) {
          return { value: validation.corrected, issues: validation.issues, warnings: validation.warnings }
        }
        const quality = await runQuestionQualityTest(curriculum, validation.corrected.questions)
        qualityTestReports = [{ phase: 'Análise da geração', results: quality.report }]
        if (quality.issues.some((issue) => issue.severity === 'bloqueante')) {
          const affectedNumbers = [...new Set(quality.issues.filter((issue) => issue.severity === 'bloqueante').flatMap((issue) => issue.questionNumbers))]
          qualityTestWarnings.push(...quality.issues.filter((issue) => issue.severity === 'bloqueante').map((issue) => `Q${issue.questionNumbers.join('/Q')}: ${issue.reason}`))
          return {
            value: validation.corrected,
            issues: [],
            warnings: [...validation.warnings, ...quality.warnings, `Teste de qualidade apontou pendências nas questões ${affectedNumbers.join(', ')}. A prova seguirá para revisão humana.`],
          }
        }
        qualityTestWarnings.push(...quality.warnings)
        if (!qualityGateEnabled) return { value: validation.corrected, issues: [], warnings: [...validation.warnings, ...quality.warnings] }
        const fidelity = await validateGeneratedExamPedagogicalFidelity(curriculum, validation.corrected)
        return {
          value: fidelity.corrected,
          issues: fidelity.issues,
          warnings: [...validation.warnings, ...fidelity.warnings],
        }
      },
      })
      aiQuestions = generated.value.questions
      warnings = generated.warnings
      if (generated.repaired) warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)
      alternativesCount = generated.value.metadata.alternativesCount
    }
    // Se uma questão declara imagem (por análise automática ou regra
    // obrigatória da matriz), ela não pode seguir sem o recurso visual.
    // Imagem é um recurso de apoio, não deve invalidar uma prova inteira. Se
    // os provedores não conseguirem produzir um gráfico/mapa confiável, a
    // questão segue para revisão sem imagem e o professor pode tentar gerá-la
    // novamente na própria tela.
    const examWithImages = await attachImagesToExam({ metadata: { segment: params.segment, gradeYear: params.gradeYear, subject: params.subject, bimester: params.bimester ?? null, questionCount: aiQuestions.length, objectiveCount: aiQuestions.filter((q) => q.type === 'objetiva').length, discursiveCount: aiQuestions.filter((q) => q.type === 'descritiva').length, alternativesCount }, questions: aiQuestions }, { requireResolvedImages: false, maxAttemptsPerImage: 2, subject: params.subject })
    aiQuestions = examWithImages.questions
    const unresolvedImages = aiQuestions.filter((question) => question.needsImage && !question.image).map((question) => question.number)
    if (unresolvedImages.length) {
      warnings.push(`Não foi possível obter imagem para a(s) questão(ões) ${unresolvedImages.join(', ')}. A prova foi gerada e a imagem pode ser tentada novamente na revisão.`)
    }
  }

  const bankQuestions = await buildBankExamQuestions(params.enemBankQuestionIds, aiQuestions.length + 1)
  if (bankQuestions.length < params.enemBankQuestionIds.length) {
    warnings.push(`${params.enemBankQuestionIds.length - bankQuestions.length} questão(ões) do banco ENEM selecionadas não foram encontradas (removidas do banco?) e ficaram de fora.`)
  }

  const allQuestions = [...aiQuestions, ...bankQuestions]
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
        qualityTest: { version: 'quality-test-v1', checkedAt: new Date().toISOString(), repairedQuestionNumbers: qualityTestRepairedNumbers, warnings: qualityTestWarnings, reports: qualityTestReports },
    },
    questions: allQuestions,
  }
  const generationPayload = examKind === 'atividade'
    ? {
        ...examWithBank,
        metadata: {
          ...examWithBank.metadata,
          activity: { bnccCodes: selectedBnccCodes, bnccDescriptions: Object.fromEntries(selectedBnccDescriptions), rubricVersion: 'bncc-v1' },
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
