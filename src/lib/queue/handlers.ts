import { acervoIdentity, questionContentKey } from '@/lib/exams/questionOrigin'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { adaptedExams, generatedExams, generationJobs, type AdaptationProfileId } from '@/db/schema'
import { llmAvailable } from '@/lib/gemini/llmClient'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { generateExamCore } from '@/lib/exams/generateExamCore'
import { generateReinforcementCore } from '@/lib/reinforcement/generateReinforcementCore'
import { scoreExamCorrections } from '@/lib/scoring/scoreCorrections'
import { adaptExam } from '@/lib/adaptation/adaptExam'
import { executeDiscursivePageTranscriptionJob, executeDiscursiveTranscriptionJob } from '@/lib/scan-ingest/transcriptionQueue'
import { processLocalScan } from '@/lib/scan-ingest/localScanProcessor'
import type { EquivalenceReport } from '@/lib/adaptation/equivalenceValidator'
import type { ClaimedJob } from './claim'
import { adicionarQuestaoJobPayloadSchema, adaptarProvaJobPayloadSchema, gerarAtividadeJobPayloadSchema, gerarImagensProvaJobPayloadSchema, gerarProvaJobPayloadSchema, gerarReforcoEnemJobPayloadSchema, pontuarProvaJobPayloadSchema, processarScanJobPayloadSchema, transcreverScanJobPayloadSchema } from './types'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { planIdFromExamPayload, planVersionIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { generateQuestionWithUnifiedFlow } from '@/lib/exams/unifiedQuestionGeneration'
import { questionQualityFingerprint, runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { QUALITY_REPORT_VERSION } from '@/lib/exams/qualityReport'
import { attachImagesToExam } from '@/lib/images/questionImageService'
import { alternativesCountForSegment } from '@/lib/gemini/promptBuilder'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'
import { initializeJobItems, saveItemProgress, setJobItemStage } from '@/lib/queue/jobProgress'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'

// Handlers de execução por tipo de job. O worker chama executeJob() e trata
// sucesso/falha de forma uniforme — cada handler só precisa validar o
// payload (JSONB não tem shape garantido) e devolver o resultado.
// Tipos novos ('gerar_reforco_enem', 'adaptar_prova', 'pontuar_prova')
// ganham um case aqui nas próximas subtarefas, sem mexer no worker.

export type JobExecutionResult = {
  resultExamId?: number
  resultRef?: unknown
  // Rótulo humano do job pra log e notificação ("História — 8º ano (8º Ano B)").
  label: string
  // Só jobs voltados ao usuário (gerar_prova) notificam no Chat — pontuação
  // é interna, ninguém precisa de DM avisando que uma nota foi consolidada.
  notifyRequester: boolean
}

export async function executeJob(job: ClaimedJob): Promise<JobExecutionResult> {
  switch (job.jobType) {
    case 'gerar_prova':
      return executeGerarProva(job)
    case 'gerar_imagens_prova':
      return executeGerarImagensProva(job)
    case 'adicionar_questao':
      return executeAdicionarQuestao(job)
    case 'gerar_reforco_enem':
      return executeGerarReforcoEnem(job)
    case 'gerar_atividade':
      return executeGerarAtividade(job)
    case 'adaptar_prova':
      return executeAdaptarProva(job)
    case 'pontuar_prova':
      return executePontuarProva(job)
    case 'transcrever_scan':
      return executeTranscreverScan(job)
    case 'processar_scan':
      return executeProcessarScan(job)
    default:
      throw new Error(`Tipo de job ainda sem handler implementado: ${job.jobType}`)
  }
}

async function executeGerarImagensProva(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = gerarImagensProvaJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error(`Payload do job de imagens inválido: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, parsed.data.examId) })
  if (!exam) throw new Error(`Prova #${parsed.data.examId} não encontrada para produzir imagens.`)
  const original = exam.generationPayload as ExamGenerationResult
  const attached = await attachImagesToExam(original, { requireResolvedImages: false, maxAttemptsPerImage: 2, subject: exam.subject })
  const unresolved = attached.questions.filter((question) => (question.needsImage ?? question.hasImage) && !question.image).map((question) => question.number)
  const nextPayload: ExamGenerationResult = {
    ...attached,
    metadata: {
      ...attached.metadata,
      imageGeneration: {
        status: unresolved.length ? 'partial' : 'complete',
        jobId: job.id,
        pendingQuestionNumbers: unresolved,
        updatedAt: new Date().toISOString(),
      },
    },
  }
  await db.update(generatedExams).set({
    generationPayload: nextPayload,
    unmappedWarnings: unresolved.length
      ? [...(Array.isArray(exam.unmappedWarnings) ? exam.unmappedWarnings as string[] : []), `Imagens ainda pendentes nas questões ${unresolved.join(', ')}.`]
      : exam.unmappedWarnings,
  }).where(eq(generatedExams.id, exam.id))
  return {
    resultExamId: exam.id,
    resultRef: { pendingQuestionNumbers: unresolved },
    label: `Imagens da prova #${exam.id}`,
    notifyRequester: false,
  }
}

async function executeAdicionarQuestao(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = adicionarQuestaoJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error(`Payload do job inválido: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  const { examId, questionNumber, bnccCode, questionType } = parsed.data
  await initializeJobItems(job.id, [questionNumber])
  await saveItemProgress(job.id, questionNumber, 'gerando')
  let activeStage = 'gerando_enunciado'

  try {
    if (!await llmAvailable()) throw new Error('A chave do provedor de texto ativo não está configurada no servidor.')
    const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
    if (!exam) throw new Error(`Prova #${examId} não encontrada.`)
    if (!['rascunho', 'atribuido', 'em_revisao', 'revisao_concluida'].includes(exam.status)) {
      throw new Error('A prova não está em uma etapa que permite adicionar questões.')
    }
    const curriculum = await getCurriculumForExam({
      segment: exam.segment,
      gradeYear: exam.gradeYear,
      academicYear: exam.academicYear,
      subject: exam.subject,
      bimester: exam.bimester ?? undefined,
      curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
      curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload),
    })
    const unit = curriculum.units.find((candidate) => candidate.rowIndex === parsed.data.unitRowIndex)
    if (!unit || unit.habilidades.status !== 'mapeado' || !unit.habilidades.skills.some((skill) => skill.code.toUpperCase() === bnccCode.toUpperCase())) {
      throw new Error(`A habilidade ${bnccCode} não está vinculada a uma unidade do planejamento desta prova.`)
    }
    const official = getOfficialBnccSkill(bnccCode)
    if (!official) throw new Error(`A habilidade ${bnccCode} não foi encontrada na base oficial da BNCC.`)
    const initialPayload = exam.generationPayload as ExamGenerationResult
    const initialProgress = initialPayload.metadata.generationProgress
    const currentlyNextNumber = initialProgress?.pendingQuestionNumbers[0]
      ?? Math.max(0, ...initialPayload.questions.map((question) => question.number)) + 1
    if (currentlyNextNumber !== questionNumber) {
      throw new Error(`A posição da questão mudou enquanto a solicitação aguardava na fila (era ${questionNumber}, agora é ${currentlyNextNumber}). Inicie a adição novamente.`)
    }
    const requestedNumber = questionNumber
    const generated = await generateQuestionWithUnifiedFlow({
      curriculum,
      unit,
      questionNumber: requestedNumber,
      excludedQuestions: initialPayload.questions,
      acervoHistory: initialPayload.metadata.acervoHistory,
      type: questionType,
      targetSkillCodes: [official.code],
      classLabel: initialPayload.metadata.classLabel,
      instruction: `Adicionar à prova #${examId}. Habilidade escolhida pelo professor: ${official.code}: ${official.text}. Contexto BNCC: ${official.context.join('; ')}. Preserve exatamente esta habilidade e a unidade indicada.`,
      onStage: async (stage) => {
        activeStage = stage
        await setJobItemStage(job.id, questionNumber, stage)
      },
    })
    let question = { ...generated.question, number: requestedNumber }
    await saveItemProgress(job.id, questionNumber, 'gerando', question)

    activeStage = 'produzindo_imagem'
    await setJobItemStage(job.id, questionNumber, activeStage)
    const withImage = await attachImagesToExam({
      metadata: {
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        bimester: exam.bimester,
        questionCount: 1,
        objectiveCount: question.type === 'objetiva' ? 1 : 0,
        discursiveCount: question.type === 'descritiva' ? 1 : 0,
        alternativesCount: alternativesCountForSegment(exam.segment),
      },
      questions: [question],
    }, { requireResolvedImages: false, maxAttemptsPerImage: 2, subject: exam.subject })
    question = withImage.questions[0] ?? question
    if (question.needsImage && !question.image) throw new Error('A questão precisa de uma imagem, mas o recurso visual não foi gerado.')

    activeStage = 'validando_respostas'
    await setJobItemStage(job.id, questionNumber, activeStage)
    const audit = await runQuestionQualityTest(curriculum, [question], new Map(), initialPayload.metadata.classLabel)
    const qualityResult = audit.report.find((item) => item.questionNumber === requestedNumber)
    if (!qualityResult?.approved) {
      const detail = qualityResult?.diagnostics?.filter((item) => item.blocksApproval).map((item) => item.message).slice(0, 4).join('; ')
        || qualityResult?.verdictReason
        || 'O Jev não aprovou a questão.'
      throw new Error(`A questão adicional não foi inserida: ${detail}`)
    }

    activeStage = 'salvando_questao'
    await setJobItemStage(job.id, questionNumber, activeStage)
    const saved = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM generated_exams WHERE id = ${examId} FOR UPDATE`)
      const latestExam = await tx.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
      if (!latestExam || !['rascunho', 'atribuido', 'em_revisao', 'revisao_concluida'].includes(latestExam.status)) {
        throw new Error('A prova mudou de etapa durante a geração; a questão não foi inserida.')
      }
      const latestPayload = latestExam.generationPayload as ExamGenerationResult
      const progress = latestPayload.metadata.generationProgress
      const slotNumber = progress?.pendingQuestionNumbers[0]
        ?? Math.max(0, ...latestPayload.questions.map((item) => item.number)) + 1
      if (slotNumber !== questionNumber) {
        throw new Error(`A posição da questão mudou durante a geração (era ${questionNumber}, agora é ${slotNumber}). A questão não foi inserida; tente novamente.`)
      }
      question = { ...question, number: slotNumber }
      const updatedQuestions = [...latestPayload.questions, question].sort((left, right) => left.number - right.number)
      const pending = (progress?.pendingQuestionNumbers ?? []).filter((number) => number !== slotNumber)
      const pendingReasons = { ...(progress?.pendingReasons ?? {}) }
      delete pendingReasons[String(slotNumber)]
      const updatedProgress = progress ? {
        ...progress,
        complete: pending.length === 0 && updatedQuestions.length >= progress.requestedQuestionCount,
        pendingQuestionNumbers: pending,
        pendingReasons,
      } : undefined
      const qualityTest = latestPayload.metadata.qualityTest
      const oldReports = qualityTest?.reports ?? []
      const previousResults = oldReports.at(-1)?.results ?? []
      const insertedReport = {
        ...qualityResult,
        questionNumber: slotNumber,
        questionFingerprint: questionQualityFingerprint(question, latestPayload.metadata.classLabel),
      }
      const currentQuestionNumbers = new Set(updatedQuestions.map((item) => item.number))
      const mergedResults = [...previousResults.filter((result) => result.questionNumber !== slotNumber && currentQuestionNumbers.has(result.questionNumber)), insertedReport]
        .sort((left, right) => left.questionNumber - right.questionNumber)
      const updatedQualityTest = {
        version: qualityTest?.version ?? QUALITY_REPORT_VERSION,
        checkedAt: new Date().toISOString(),
        repairedQuestionNumbers: qualityTest?.repairedQuestionNumbers ?? [],
        warnings: [...(qualityTest?.warnings ?? []), ...audit.warnings],
        reports: [...oldReports, { phase: `Questão ${slotNumber} adicionada`, results: mergedResults }],
      }
      if (latestPayload.questions.some((peer) => peer.number !== question.number && (questionContentKey(peer) === questionContentKey(question) || (acervoIdentity(question) && acervoIdentity(peer) === acervoIdentity(question))))) throw new Error('A questão já foi incluída nesta prova durante a geração. Solicite outra questão.')
      const nextPayload: ExamGenerationResult = {
        ...latestPayload,
        metadata: {
          ...latestPayload.metadata,
          acervoHistory: [...(latestPayload.metadata.acervoHistory ?? []), ...[question].flatMap((q) => { const key = acervoIdentity(q); return key ? [{ key, statement: q.statement, questionId: q.acervoRef!.questionId }] : [] })],
          questionCount: updatedQuestions.length,
          objectiveCount: updatedQuestions.filter((item) => item.type === 'objetiva').length,
          discursiveCount: updatedQuestions.filter((item) => item.type === 'descritiva').length,
          qualityTest: updatedQualityTest,
          ...(updatedProgress ? { generationProgress: updatedProgress } : {}),
        },
        questions: updatedQuestions,
      }
      await tx.update(generatedExams).set({
        generationPayload: nextPayload,
        questionCount: updatedQuestions.length,
        objectiveCount: nextPayload.metadata.objectiveCount,
        discursiveCount: nextPayload.metadata.discursiveCount,
        scoringMethod: scoringMethodForQuestions(updatedQuestions),
      }).where(eq(generatedExams.id, examId))
      return { question, nextPayload }
    })

    await saveItemProgress(job.id, questionNumber, 'concluido', saved.question, [{ code: 'JEV_QUALITY_REPORT', report: qualityResult }])
    try {
      await persistGeneratedQuestionClassifications({
        examId,
        questions: [saved.question],
        createdBy: job.requestedBy,
        replaceExisting: true,
        modelProvider: 'deepseek',
        modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: 'exam-generation-pedagogical-v1',
      })
    } catch (error) {
      console.error('[queue/add-question] classificação não persistida:', error)
    }
    return {
      resultExamId: examId,
      resultRef: { questionNumber: saved.question.number, bnccCode: official.code },
      label: `Questão ${saved.question.number} adicionada à prova #${examId}`,
      notifyRequester: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao gerar a questão adicional.'
    await setJobItemStage(job.id, questionNumber, activeStage)
    await saveItemProgress(job.id, questionNumber, 'erro', undefined, [{ severity: 'bloqueante', code: 'ADDITIONAL_QUESTION_FAILED', message, reason: message }], message)
    throw error
  }
}

async function executeProcessarScan(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = processarScanJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error(`Payload do job inválido: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  const result = await processLocalScan(parsed.data)
  return {
    resultExamId: parsed.data.examId,
    resultRef: result,
    label: `Processamento de scan (upload #${parsed.data.uploadId}${parsed.data.pageId ? `, página #${parsed.data.pageId}` : ''}, prova #${parsed.data.examId})`,
    notifyRequester: false,
  }
}

async function executeGerarAtividade(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = gerarAtividadeJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error(`Payload do job inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  const payload = parsed.data
  if (!await llmAvailable()) throw new Error('A chave do provedor de texto ativo não está configurada no servidor.')

  const result = await generateExamCore({
    segment: payload.segment,
    gradeYear: payload.gradeYear,
    academicYear: payload.academicYear,
    subject: payload.subject,
    classLabel: payload.classLabel,
    bimester: payload.bimester,
    questionCount: payload.questionCount,
    enemBankQuestionIds: [],
    assessmentKind: 'padrao',
    examKind: 'atividade',
    bnccCodes: payload.bnccCodes,
    bnccPlan: payload.bnccPlan,
    classroomCourseId: payload.classroomCourseId ?? null,
    pedagogicalIntent: payload.pedagogicalIntent,
    generationJobId: job.id,
  }, job.requestedBy)

  return {
    resultExamId: result.examId,
    resultRef: { bnccCodes: payload.bnccCodes, warnings: result.warnings, issues: result.issues },
    label: `Atividade ${payload.subject} — ${payload.gradeYear}º ano${payload.classLabel ? ` (${payload.classLabel})` : ''}`,
    notifyRequester: true,
  }
}

async function executeGerarReforcoEnem(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = gerarReforcoEnemJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Payload do job inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  const payload = parsed.data

  // A seleção do banco é determinística, mas a resolução comentada usa IA.
  if (!await llmAvailable()) {
    throw new Error('A chave do provedor de texto ativo não está configurada no servidor.')
  }

  const result = await generateReinforcementCore(
    {
      gradeYear: payload.gradeYear,
      academicYear: payload.academicYear,
      subject: payload.subject,
      enemSkills: payload.enemSkills,
      enemQuestionYear: payload.enemQuestionYear,
      questionCount: payload.questionCount,
      classroomCourseId: payload.classroomCourseId ?? null,
    },
    job.requestedBy,
  )

  const skillsLabel = payload.enemSkills.map((s) => s.toUpperCase()).join(', ')
  return {
    resultExamId: result.examId,
    resultRef: { perSkill: result.perSkill, warnings: result.warnings, questionCount: result.questionCount },
    label: `Reforço ENEM ${skillsLabel} — ${payload.subject} (${payload.gradeYear}º EM${payload.classLabel ? `, ${payload.classLabel}` : ''})`,
    notifyRequester: true,
  }
}

async function executeAdaptarProva(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = adaptarProvaJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Payload do job inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }

  const adaptation = await db.query.adaptedExams.findFirst({ where: eq(adaptedExams.id, parsed.data.adaptedExamId) })
  if (!adaptation) throw new Error(`Adaptação #${parsed.data.adaptedExamId} não encontrada.`)
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, adaptation.examId) })
  if (!exam) throw new Error(`Prova #${adaptation.examId} não encontrada.`)

  if (!await llmAvailable()) {
    throw new Error('A chave do provedor de texto ativo não está configurada no servidor.')
  }

  const profiles = adaptation.adaptationProfiles as AdaptationProfileId[]
  const label = `Adaptação ${profiles.map((p) => p.toUpperCase()).join('+')} — ${exam.subject} (prova #${exam.id})`

  // Retry reusa a mesma linha: volta pra 'gerando' antes de executar.
  await db.update(adaptedExams).set({ status: 'gerando', errorMessage: null }).where(eq(adaptedExams.id, adaptation.id))

  try {
    const outcome = await adaptExam(exam.generationPayload as ExamGenerationResult, profiles)
    await db
      .update(adaptedExams)
      .set({
        adaptedPayload: outcome.payload,
        validationReport: outcome.report,
        libraryVersions: outcome.merged.libraryVersions,
        status: 'pronto_revisao',
        errorMessage: null,
      })
      .where(eq(adaptedExams.id, adaptation.id))

    return {
      resultExamId: exam.id,
      resultRef: { adaptedExamId: adaptation.id, report: outcome.report, repaired: outcome.repaired },
      label,
      notifyRequester: true,
    }
  } catch (err) {
    // Grava o erro na linha (a UI da aba de adaptação mostra) e propaga
    // pro ciclo de retry/erro do job.
    const report = (err as Error & { report?: EquivalenceReport }).report ?? null
    await db
      .update(adaptedExams)
      .set({
        status: 'erro',
        errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
        ...(report ? { validationReport: report } : {}),
      })
      .where(eq(adaptedExams.id, adaptation.id))
    throw err
  }
}

async function executePontuarProva(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = pontuarProvaJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Payload do job inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  const result = await scoreExamCorrections(parsed.data.examId)
  return {
    resultExamId: parsed.data.examId,
    resultRef: result,
    label: `Pontuação da prova #${parsed.data.examId} (${result.method}, ${result.scored} correção(ões))`,
    notifyRequester: false,
  }
}

async function executeTranscreverScan(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = transcreverScanJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Payload do job inválido: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  }
  const result = parsed.data.questionNumbers
    ? await executeDiscursivePageTranscriptionJob({ examId: parsed.data.examId, pageId: parsed.data.pageId, questionNumbers: parsed.data.questionNumbers, requestedBy: job.requestedBy })
    : await executeDiscursiveTranscriptionJob({ examId: parsed.data.examId, pageId: parsed.data.pageId, questionNumber: parsed.data.questionNumber!, requestedBy: job.requestedBy })
  return {
    resultExamId: parsed.data.examId,
    resultRef: { pageId: parsed.data.pageId, questionNumber: parsed.data.questionNumber, questionNumbers: parsed.data.questionNumbers, ...result },
    label: parsed.data.questionNumbers ? `Transcrição de ${parsed.data.questionNumbers.length} questões da página ${parsed.data.pageId} (prova #${parsed.data.examId})` : `Transcrição da questão ${parsed.data.questionNumber} (prova #${parsed.data.examId})`,
    notifyRequester: false,
  }
}

export function gerarProvaJobLabel(payload: { subject?: string; gradeYear?: number; classLabel?: string }): string {
  const base = `${payload.subject ?? 'Disciplina?'} — ${payload.gradeYear ?? '?'}º ano`
  return payload.classLabel ? `${base} (${payload.classLabel})` : base
}

async function executeGerarProva(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = gerarProvaJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Payload do job inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  const payload = parsed.data

  if (!await llmAvailable()) {
    throw new Error('A chave do provedor de texto ativo não está configurada no servidor.')
  }

  const result = await generateExamCore(
    {
      segment: payload.segment,
      gradeYear: payload.gradeYear,
      academicYear: payload.academicYear,
      subject: payload.subject,
      classLabel: payload.classLabel,
      bimester: payload.bimester,
      questionCount: payload.questionCount,
      questionSource: payload.questionSource,
      objectivePercentage: payload.objectivePercentage,
      enemBankQuestionIds: payload.enemBankQuestionIds,
      assessmentKind: payload.assessmentKind,
      contentPlan: payload.contentPlan,
      assignedTo: payload.assignedTo,
      curriculumPlanId: payload.curriculumPlanId,
      curriculumPlanVersionId: payload.curriculumPlanVersionId,
      contentPlanIncludesEnem: payload.contentPlanIncludesEnem,
      generationJobId: job.id,
    },
    job.requestedBy,
  )

  return {
    resultExamId: result.examId,
    resultRef: {
      warnings: result.warnings,
      issues: result.issues,
      pedagogicalClassificationsCreated: result.pedagogicalClassificationsCreated,
    },
    label: gerarProvaJobLabel(payload),
    notifyRequester: true,
  }
}
