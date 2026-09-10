import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { adaptedExams, generatedExams, type AdaptationProfileId } from '@/db/schema'
import { llmAvailable } from '@/lib/gemini/llmClient'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { generateExamCore } from '@/lib/exams/generateExamCore'
import { generateReinforcementCore } from '@/lib/reinforcement/generateReinforcementCore'
import { scoreExamCorrections } from '@/lib/scoring/scoreCorrections'
import { adaptExam } from '@/lib/adaptation/adaptExam'
import { executeDiscursiveTranscriptionJob } from '@/lib/scan-ingest/transcriptionQueue'
import { processLocalScan } from '@/lib/scan-ingest/localScanProcessor'
import type { EquivalenceReport } from '@/lib/adaptation/equivalenceValidator'
import type { ClaimedJob } from './claim'
import { adaptarProvaJobPayloadSchema, gerarAtividadeJobPayloadSchema, gerarProvaJobPayloadSchema, gerarReforcoEnemJobPayloadSchema, pontuarProvaJobPayloadSchema, processarScanJobPayloadSchema, transcreverScanJobPayloadSchema } from './types'

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

async function executeProcessarScan(job: ClaimedJob): Promise<JobExecutionResult> {
  const parsed = processarScanJobPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error(`Payload do job inválido: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  const result = await processLocalScan(parsed.data)
  return {
    resultExamId: parsed.data.examId,
    resultRef: result,
    label: `Processamento de scan (upload #${parsed.data.uploadId}, prova #${parsed.data.examId})`,
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
    bimester: payload.bimester,
    questionCount: payload.questionCount,
    enemBankQuestionIds: [],
    assessmentKind: 'padrao',
    examKind: 'atividade',
    bnccCodes: payload.bnccCodes,
    classroomCourseId: payload.classroomCourseId ?? null,
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
      classLabel: payload.classLabel,
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
  const result = await executeDiscursiveTranscriptionJob({ ...parsed.data, requestedBy: job.requestedBy })
  return {
    resultExamId: parsed.data.examId,
    resultRef: { pageId: parsed.data.pageId, questionNumber: parsed.data.questionNumber, ...result },
    label: `Transcrição da questão ${parsed.data.questionNumber} (prova #${parsed.data.examId})`,
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
      bimester: payload.bimester,
      questionCount: payload.questionCount,
      enemBankQuestionIds: payload.enemBankQuestionIds,
      assessmentKind: payload.assessmentKind,
      contentPlan: payload.contentPlan,
      assignedTo: payload.assignedTo,
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
