import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { planIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { enqueueAdicionarQuestaoJob } from '@/lib/queue/enqueue'
import { llmAvailable } from '@/lib/gemini/llmClient'

const bodySchema = z.object({
  bnccCode: z.string().trim().min(4).max(20),
  unitRowIndex: z.number().int().min(0),
  questionType: z.enum(['objetiva', 'descritiva']),
}).strict()

const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_revisao', 'revisao_concluida']

async function loadContext(examId: number, email: string) {
  const access = await authorizeExamAccess(examId, email)
  if ('error' in access) return { response: access.error } as const
  const { exam } = access
  if (!EDITABLE_STATUSES.includes(exam.status)) {
    return { response: NextResponse.json({ error: 'Só é possível adicionar questões enquanto a prova está em revisão.' }, { status: 409 }) } as const
  }
  const payload = exam.generationPayload as ExamGenerationResult
  if (payload.metadata.generationEngine === 'whole-exam-v1') {
    return { response: NextResponse.json({ error: 'Esta prova foi gerada como um conjunto. Para mudar a quantidade, inicie uma nova geração com o total desejado.' }, { status: 409 }) } as const
  }
  const curriculum = await getCurriculumForExam({
    segment: exam.segment,
    gradeYear: exam.gradeYear,
    academicYear: exam.academicYear,
    subject: exam.subject,
    bimester: exam.bimester ?? undefined,
    curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
  })
  return { exam, curriculum, currentUser: access.currentUser } as const
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const examId = Number((await props.params).examId)
  if (!Number.isSafeInteger(examId) || examId <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  try {
    const context = await loadContext(examId, session.user.email)
    if ('response' in context) return context.response
    const skills = context.curriculum.units.flatMap((unit) => unit.habilidades.status === 'mapeado'
      ? unit.habilidades.skills.flatMap((mapped) => {
          const official = getOfficialBnccSkill(mapped.code)
          if (!official) return []
          return [{
            code: official.code,
            description: official.text,
            context: official.context,
            source: official.source,
            dataVersion: official.dataVersion,
            unitRowIndex: unit.rowIndex,
            unitTitle: unit.tituloCapitulo,
            curriculumSummary: (unit.conteudo ?? '').slice(0, 600),
          }]
        })
      : [])
    const unique = [...new Map(skills.map((skill) => [`${skill.code}:${skill.unitRowIndex}`, skill])).values()]
    return NextResponse.json({ examId, subject: context.exam.subject, gradeYear: context.exam.gradeYear, bimester: context.exam.bimester, skills: unique })
  } catch (error) {
    console.error('[exams/add-question] não foi possível carregar BNCC:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar as habilidades do planejamento.' }, { status: 422 })
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const examId = Number((await props.params).examId)
  if (!Number.isSafeInteger(examId) || examId <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Escolha uma habilidade BNCC, uma unidade e o tipo de questão.' }, { status: 400 })

  try {
    const context = await loadContext(examId, session.user.email)
    if ('response' in context) return context.response
    const official = getOfficialBnccSkill(parsed.data.bnccCode)
    const unit = context.curriculum.units.find((candidate) => candidate.rowIndex === parsed.data.unitRowIndex)
    const isMapped = unit?.habilidades.status === 'mapeado'
      && unit.habilidades.skills.some((skill) => skill.code.toUpperCase() === parsed.data.bnccCode.toUpperCase())
    if (!official || !isMapped) {
      return NextResponse.json({ error: 'A habilidade escolhida não pertence ao planejamento aprovado desta prova.' }, { status: 422 })
    }
    if (!await llmAvailable()) return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })
    const payload = context.exam.generationPayload as ExamGenerationResult
    const questionNumber = payload.metadata.generationProgress?.pendingQuestionNumbers[0]
      ?? Math.max(0, ...payload.questions.map((question) => question.number)) + 1
    const jobId = await enqueueAdicionarQuestaoJob({
      examId,
      questionNumber,
      bnccCode: official.code,
      questionType: parsed.data.questionType,
      unitRowIndex: parsed.data.unitRowIndex,
    }, context.currentUser.id)
    return NextResponse.json({ jobId, status: 'pendente', resultExamId: examId, skill: { code: official.code, description: official.text, context: official.context, unitTitle: unit?.tituloCapitulo }, currentQuestionCount: payload.questions.length }, { status: 202 })
  } catch (error) {
    const dbError = error as { code?: string }
    if (dbError.code === '23505') return NextResponse.json({ error: 'Já existe uma questão sendo gerada para esta prova. Aguarde a conclusão antes de iniciar outra.' }, { status: 409 })
    console.error('[exams/add-question] não foi possível enfileirar:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível iniciar a geração da questão.' }, { status: 422 })
  }
}
