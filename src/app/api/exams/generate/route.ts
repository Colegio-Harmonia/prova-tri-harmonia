import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { generateExamCore, ExamGenerationInputError, CurriculumReadError } from '@/lib/exams/generateExamCore'
import { RequiredQuestionImageError } from '@/lib/images/questionImageService'

const curriculumPlanItemSchema = z.object({
  unitRowIndex: z.number().int().positive(),
  questionCount: z.number().int().min(0).max(15),
  priority: z.enum(['alta', 'media', 'baixa']),
  visualAid: z.enum(['auto', 'obrigatorio', 'sem_imagem']),
})

// Geração síncrona (caminho original). A lógica de geração vive em
// generateExamCore (compartilhada com o worker da fila — Subtarefa 1a);
// esta rota só cuida de HTTP: auth, validação de body e mapeamento de
// erro pra status code.

const bodySchema = z
  .object({
    segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
    gradeYear: z.number().int(),
    academicYear: z.number().int().min(2020).max(2100).optional(),
    subject: z.string().min(1),
    bimester: z.number().int().min(1).max(4).optional(),
    // Nº de questões geradas por IA — pode ser 0 se a prova for só do
    // banco ENEM. O total (com enemBankQuestionIds) ainda precisa ficar
    // entre 12 e 15, ver o .refine() abaixo.
    questionCount: z.number().int().min(0).max(15),
    enemBankQuestionIds: z.array(z.number().int()).max(15).optional().default([]),
    assessmentKind: z.enum(['padrao', 'enem']).optional(),
    contentPlan: z.array(curriculumPlanItemSchema).max(60).optional(),
  })
  .refine((v) => v.questionCount + v.enemBankQuestionIds.length >= 12 && v.questionCount + v.enemBankQuestionIds.length <= 15, {
    message: 'O total de questões (geradas por IA + banco ENEM) precisa ficar entre 12 e 15.',
  })
  .refine((v) => v.assessmentKind !== 'enem' || v.enemBankQuestionIds.length > 0, {
    message: 'Simulado ENEM precisa incluir ao menos uma questão real do banco ENEM.',
  })

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (!await llmAvailable()) {
    return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }
  const params = parsed.data

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  try {
    const result = await generateExamCore(params, currentUser.id)
    return NextResponse.json({
      examId: result.examId,
      exam: result.exam,
      warnings: result.warnings,
      issues: result.issues,
      pedagogicalClassificationsCreated: result.pedagogicalClassificationsCreated,
    })
  } catch (err) {
    if (err instanceof TabResolutionError) {
      return NextResponse.json({ error: err.message, availableTabs: err.availableTabs }, { status: 422 })
    }
    if (err instanceof SheetNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    if (err instanceof ExamGenerationInputError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    if (err instanceof CurriculumReadError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    if (err instanceof StructuredGenerationError) {
      return aiFailureResponse(err, 'A IA não retornou uma prova válida após as tentativas de reparo.')
    }
    if (err instanceof RequiredQuestionImageError) {
      return NextResponse.json({
        error: 'A geração solicitou recurso visual, mas ele não ficou disponível após as tentativas automáticas. Nenhuma prova incompleta foi salva; tente gerar novamente.',
        questionNumbers: err.questionNumbers,
      }, { status: 502 })
    }
    console.error('[exams/generate] erro na geração:', err)
    return aiFailureResponse(err, 'Erro ao gerar questões com IA.')
  }
}
