import { db } from '@/db/client'
import { generationBatches, generationJobs, type GenerationJobType } from '@/db/schema'
import { gerarProvaJobPayloadSchema, type GerarAtividadeJobPayload, type GerarProvaJobPayload, type GerarReforcoEnemJobPayload } from './types'
import type { CurriculumPlanItem } from '@/types/exam'

export type GerarProvaBatchInput = {
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  gradeYear: number
  academicYear?: number
  classLabel?: string
  subjects: string[]
  config: {
    bimester?: number
    questionCount: number
    enemBankQuestionIds?: number[]
    assessmentKind?: 'padrao' | 'enem'
    contentPlan?: CurriculumPlanItem[]
  }
}

export class BatchValidationError extends Error {}

// Expansão pura do pedido do usuário (turma + N disciplinas) em payloads de
// job, 1 por disciplina — separada do insert pra ser testável sem banco.
export function buildGerarProvaJobPayloads(input: GerarProvaBatchInput): GerarProvaJobPayload[] {
  const subjects = [...new Set(input.subjects.map((s) => s.trim()).filter(Boolean))]
  if (!subjects.length) {
    throw new BatchValidationError('Selecione pelo menos uma disciplina.')
  }
  // Questões do banco ENEM são escolhidas por disciplina/área — não faz
  // sentido anexar a mesma seleção em N disciplinas diferentes.
  const bankIds = input.config.enemBankQuestionIds ?? []
  if (bankIds.length > 0 && subjects.length > 1) {
    throw new BatchValidationError('Questões do banco ENEM só podem ser usadas gerando uma disciplina por vez.')
  }
  if (input.config.contentPlan?.length && subjects.length > 1) {
    throw new BatchValidationError('A matriz da avaliação é definida por disciplina; gere uma disciplina por vez para usá-la.')
  }

  return subjects.map((subject) => {
    const parsed = gerarProvaJobPayloadSchema.safeParse({
      segment: input.segment,
      gradeYear: input.gradeYear,
      academicYear: input.academicYear,
      subject,
      bimester: input.config.bimester,
      questionCount: input.config.questionCount,
      enemBankQuestionIds: bankIds,
      classLabel: input.classLabel,
      assessmentKind: input.config.assessmentKind,
      contentPlan: input.config.contentPlan,
    })
    if (!parsed.success) {
      throw new BatchValidationError(parsed.error.issues.map((i) => i.message).join(' '))
    }
    return parsed.data
  })
}

export type EnqueuedBatch = {
  batchId: number
  jobs: Array<{ jobId: number; jobType: GenerationJobType; subject: string }>
}

// Job avulso de reforço ENEM (Módulo 3, sem batch — 1 atividade por
// disparo). Payload já validado pela rota via gerarReforcoEnemJobPayloadSchema.
export async function enqueueReforcoEnemJob(payload: GerarReforcoEnemJobPayload, requestedBy: number): Promise<number> {
  const [job] = await db
    .insert(generationJobs)
    .values({
      jobType: 'gerar_reforco_enem',
      payload,
      requestedBy,
    })
    .returning({ jobId: generationJobs.id })
  return job.jobId
}

export async function enqueueAtividadeJob(payload: GerarAtividadeJobPayload, requestedBy: number): Promise<number> {
  const [job] = await db
    .insert(generationJobs)
    .values({ jobType: 'gerar_atividade', payload, requestedBy })
    .returning({ jobId: generationJobs.id })
  return job.jobId
}

// Job avulso de adaptação inclusiva (Módulo 4) — a linha de adapted_exams
// já foi criada pela rota com status 'gerando'.
export async function enqueueAdaptarProvaJob(adaptedExamId: number, requestedBy: number): Promise<number> {
  const [job] = await db
    .insert(generationJobs)
    .values({
      jobType: 'adaptar_prova',
      payload: { adaptedExamId },
      requestedBy,
    })
    .returning({ jobId: generationJobs.id })
  return job.jobId
}

// Job avulso de pontuação (sem batch). Best-effort nos chamadores: falha
// ao enfileirar nunca derruba a ação principal (revisar/marcar corrigido) —
// o job é idempotente e pode ser reenfileirado depois.
export async function enqueuePontuarProvaJob(examId: number, requestedBy: number): Promise<number> {
  const [job] = await db
    .insert(generationJobs)
    .values({
      jobType: 'pontuar_prova',
      payload: { examId },
      requestedBy,
    })
    .returning({ jobId: generationJobs.id })
  return job.jobId
}

// Cria batch + jobs numa transação só — ou entra tudo na fila, ou nada.
export async function enqueueGerarProvaBatch(input: GerarProvaBatchInput, requestedBy: number): Promise<EnqueuedBatch> {
  const payloads = buildGerarProvaJobPayloads(input)

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(generationBatches)
      .values({
        requestedBy,
        segment: input.segment,
        gradeYear: input.gradeYear,
        academicYear: input.academicYear ?? new Date().getFullYear(),
        classLabel: input.classLabel ?? null,
      })
      .returning({ id: generationBatches.id })

    const inserted = await tx
      .insert(generationJobs)
      .values(payloads.map((payload) => ({
        batchId: batch.id,
        jobType: 'gerar_prova' as const,
        payload,
        requestedBy,
      })))
      .returning({ jobId: generationJobs.id, payload: generationJobs.payload })

    return {
      batchId: batch.id,
      jobs: inserted.map((row) => ({
        jobId: row.jobId,
        jobType: 'gerar_prova' as const,
        subject: (row.payload as GerarProvaJobPayload).subject,
      })),
    }
  })
}
