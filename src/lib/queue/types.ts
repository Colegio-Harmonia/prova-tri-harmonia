import { z } from 'zod'
import { ASSESSMENT_KINDS, type GenerationJobStatus } from '@/db/schema'

// Payload do job 'gerar_prova' — espelha o body da rota síncrona
// /api/exams/generate (mesmas regras: total de questões entre 12 e 15
// somando IA + banco ENEM). O worker revalida com este schema antes de
// executar: payload em JSONB não tem garantia de shape no banco.
export const gerarProvaJobPayloadSchema = z
  .object({
    segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
    gradeYear: z.number().int(),
    academicYear: z.number().int().min(2020).max(2100).optional(),
    subject: z.string().min(1),
    bimester: z.number().int().min(1).max(4).optional(),
    questionCount: z.number().int().min(0).max(15),
    enemBankQuestionIds: z.array(z.number().int()).max(15).optional().default([]),
    classLabel: z.string().min(1).optional(),
    assessmentKind: z.enum(ASSESSMENT_KINDS).optional().default('padrao'),
  })
  .refine((v) => v.questionCount + v.enemBankQuestionIds.length >= 12 && v.questionCount + v.enemBankQuestionIds.length <= 15, {
    message: 'O total de questões (geradas por IA + banco ENEM) precisa ficar entre 12 e 15.',
  })
  .refine((v) => v.assessmentKind === 'padrao' || v.segment === 'ensino-medio', {
    message: 'Simulado ENEM só existe no Ensino Médio.',
  })
  .refine((v) => v.assessmentKind !== 'enem' || v.enemBankQuestionIds.length > 0, {
    message: 'Simulado ENEM precisa incluir ao menos uma questão real do banco ENEM.',
  })

export type GerarProvaJobPayload = z.infer<typeof gerarProvaJobPayloadSchema>

// Payload do job 'pontuar_prova' (Subtarefa 2) — pontua todas as
// correções 'revisado' da prova, na escala do scoring_method dela.
export const pontuarProvaJobPayloadSchema = z.object({
  examId: z.number().int().positive(),
})

export type PontuarProvaJobPayload = z.infer<typeof pontuarProvaJobPayloadSchema>

// Um job carrega somente identificadores opacos. A imagem e a resposta do
// aluno continuam no armazenamento privado e são acessadas pelo worker.
export const transcreverScanJobPayloadSchema = z.object({
  examId: z.number().int().positive(),
  pageId: z.number().int().positive(),
  questionNumber: z.number().int().positive(),
}).strict()

export type TranscreverScanJobPayload = z.infer<typeof transcreverScanJobPayloadSchema>

// Processa localmente um upload PTR1 já arquivado. O formato mantém os IDs e
// QR codes das folhas históricas; somente o leitor e o encadeamento mudam.
export const processarScanJobPayloadSchema = z.object({
  uploadId: z.number().int().positive(),
  examId: z.number().int().positive(),
  attemptId: z.number().int().positive(),
}).strict()

export type ProcessarScanJobPayload = z.infer<typeof processarScanJobPayloadSchema>

// Payload do job 'gerar_reforco_enem' (Módulo 3) — atividade de reforço
// por habilidade INEP, só Ensino Médio, questões do banco real. Sem regra
// 12-15/60-40: quantidade livre entre 3 e 30.
export const gerarReforcoEnemJobPayloadSchema = z.object({
  gradeYear: z.number().int().min(1).max(3),
  academicYear: z.number().int().min(2020).max(2100).optional(),
  subject: z.string().min(1),
  enemSkills: z.array(z.string().regex(/^H\d{1,2}$/i, 'Habilidade deve ser H1-H30')).min(1).max(10),
  // Recorte opcional para trabalhar uma edição específica do ENEM. Ausente
  // significa usar o banco inteiro, mantendo o comportamento anterior.
  enemQuestionYear: z.number().int().min(2009).max(2100).optional(),
  questionCount: z.number().int().min(3).max(30),
  classLabel: z.string().min(1).optional(),
  classroomCourseId: z.string().min(1).optional(),
})

export type GerarReforcoEnemJobPayload = z.infer<typeof gerarReforcoEnemJobPayloadSchema>

type ActivitySegment = 'anos-iniciais' | 'anos-finais' | 'ensino-medio'

export function isActivityGradeCompatible(segment: ActivitySegment, gradeYear: number) {
  return (segment === 'anos-iniciais' && gradeYear >= 2 && gradeYear <= 5) ||
    (segment === 'anos-finais' && gradeYear >= 6 && gradeYear <= 9) ||
    (segment === 'ensino-medio' && gradeYear >= 1 && gradeYear <= 3)
}

// Atividades formativas da Educação Básica. A BNCC é obrigatória: ela
// define o recorte de geração e é exibida na descrição do Classroom.
export const gerarAtividadeJobPayloadSchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  academicYear: z.number().int().min(2020).max(2100).optional(),
  subject: z.string().min(1),
  bimester: z.number().int().min(1).max(4).optional(),
  questionCount: z.number().int().min(12).max(15),
  bnccCodes: z.array(z.string().min(3)).min(1).max(10),
  classLabel: z.string().min(1).max(120).optional(),
  classroomCourseId: z.string().min(1).optional(),
}).refine((payload) => isActivityGradeCompatible(payload.segment, payload.gradeYear), {
  message: 'A série precisa pertencer ao segmento selecionado.',
  path: ['gradeYear'],
})

export type GerarAtividadeJobPayload = z.infer<typeof gerarAtividadeJobPayloadSchema>

// Payload do job 'adaptar_prova' (Módulo 4) — a linha de adapted_exams já
// existe (criada pela rota, status 'gerando'); o job só executa o motor e
// atualiza a linha. Retry reusa a mesma linha, sem duplicar adaptação.
export const adaptarProvaJobPayloadSchema = z.object({
  adaptedExamId: z.number().int().positive(),
})

export type AdaptarProvaJobPayload = z.infer<typeof adaptarProvaJobPayloadSchema>

// Decisão de retry após falha de execução. `attempts` já foi incrementado
// no claim (conta a tentativa que acabou de falhar) — se ainda há
// tentativas sobrando, o job volta pra fila; senão vira erro definitivo.
export function nextStatusAfterFailure(attempts: number, maxAttempts: number): Extract<GenerationJobStatus, 'pendente' | 'erro'> {
  return attempts < maxAttempts ? 'pendente' : 'erro'
}
