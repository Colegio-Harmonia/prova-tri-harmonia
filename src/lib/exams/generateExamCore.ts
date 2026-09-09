import { db } from '@/db/client'
import { generatedExams, type AssessmentKind, type ExamKind } from '@/db/schema'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { buildExamPrompt } from '@/lib/gemini/promptBuilder'
import { examGenerationResultSchema, GEMINI_RESPONSE_SCHEMA, type ExamGenerationResult, type ExamQuestion } from '@/lib/gemini/examSchema'
import { validateExamResult } from '@/lib/gemini/examValidator'
import { attachImagesToExam } from '@/lib/images/questionImageService'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { isPedagogicalQualityGateEnabled } from '@/lib/pedagogical/generationQualityGate'
import { validateGeneratedExamPedagogicalFidelity } from '@/lib/pedagogical/generationQualityGateService'
import { validateCurriculumPlan } from '@/lib/exams/contentPlan'
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
  const issues: string[] = []
  let alternativesCount = params.segment === 'anos-iniciais' ? 4 : 5

  if (params.questionCount > 0) {
    const qualityGateEnabled = isPedagogicalQualityGateEnabled()
    const prompt = await buildExamPrompt(curriculum, { questionCount: params.questionCount, mode: examKind === 'atividade' ? 'atividade' : 'prova', selectedBnccCodes, contentPlan: params.contentPlan })
    const generated = await generateValidatedStructuredContent<ExamGenerationResult, ExamGenerationResult>({
      context: 'exams/generate',
      prompt,
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      zodSchema: examGenerationResultSchema,
      validate: async (parsedExam) => {
        const validation = validateExamResult(parsedExam, curriculum, { ...params, enforcePedagogicalCompleteness: qualityGateEnabled })
        if (validation.issues.length || !qualityGateEnabled) {
          return { value: validation.corrected, issues: validation.issues, warnings: validation.warnings }
        }
        const fidelity = await validateGeneratedExamPedagogicalFidelity(curriculum, validation.corrected)
        return {
          value: fidelity.corrected,
          issues: fidelity.issues,
          warnings: [...validation.warnings, ...fidelity.warnings],
        }
      },
    })

    // Se uma questão declara imagem (por análise automática ou regra
    // obrigatória da matriz), ela não pode seguir sem o recurso visual.
    const examWithImages = await attachImagesToExam(generated.value, { requireResolvedImages: true, maxAttemptsPerImage: 2 })
    aiQuestions = examWithImages.questions
    warnings = generated.warnings
    if (generated.repaired) warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)
    alternativesCount = examWithImages.metadata.alternativesCount
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
      status: 'rascunho',
      // Atividades são autogeridas pelo professor que as criou. O vínculo
      // facilita visibilidade e correção posterior, sem atribuição formal
      // ou notificação da coordenação.
      ...(examKind === 'atividade'
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
