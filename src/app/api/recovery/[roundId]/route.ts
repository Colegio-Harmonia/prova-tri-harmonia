import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { diagnoseStudents, getRound, roundCurriculum, roundDetail, updateComposition } from '@/lib/recovery/recoveryService'
import { RECOVERY_RULES } from '@/lib/recovery/recoveryPlan'
import { classroomRoster, parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

// Detalhe do lote. Enquanto aberto, também devolve o roster do Classroom com
// o diagnóstico de cada aluno, para o professor decidir quem marcar.
export async function GET(_req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    const detail = await roundDetail(round)
    // Capítulos do Planejamento do período: base da Matriz por aluno.
    let chapters = null
    let chaptersError: string | null = null
    try {
      chapters = (await roundCurriculum(round)).chapters
    } catch (error) {
      chaptersError = error instanceof Error && 'status' in error ? error.message : 'Não foi possível ler o planejamento do período.'
      if (!(error instanceof Error && 'status' in error)) console.error('[recovery] planejamento:', error)
    }
    if (round.status !== 'aberto') return NextResponse.json({ ...detail, chapters, chaptersError, roster: null, rosterError: null })
    let roster = null
    let rosterError: string | null = null
    try {
      const [students, diagnosis] = await Promise.all([classroomRoster(access.session, round.classroomCourseId), diagnoseStudents(round, access.viewer)])
      roster = students.map((student) => {
        const skills = diagnosis.get(student.classroomStudentId) ?? { weak: [], insufficient: [] }
        return { classroomStudentId: student.classroomStudentId, name: student.name, email: student.email, weakSkills: skills.weak, insufficientSkills: skills.insufficient }
      }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    } catch (error) {
      rosterError = error instanceof Error && 'status' in error ? error.message : 'Não foi possível ler os alunos da turma no Classroom.'
      if (!(error instanceof Error && 'status' in error)) console.error('[recovery] roster:', error)
    }
    return NextResponse.json({ ...detail, chapters, chaptersError, roster, rosterError })
  } catch (error) {
    return recoveryErrorResponse(error, 'detalhe do lote')
  }
}

const compositionSchema = z.object({
  questionSource: z.enum(['acervo', 'ia']).optional(),
  objectivePercentage: z.number().int().min(0).max(100).optional(),
  questionCount: z.number().int().min(RECOVERY_RULES.minQuestions).max(RECOVERY_RULES.maxQuestions).optional(),
})

// Composição do lote (origem, total, proporção de alternativas).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const parsed = compositionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Composição inválida.', issues: parsed.error.issues }, { status: 400 })
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    return NextResponse.json(await updateComposition(round, parsed.data))
  } catch (error) {
    return recoveryErrorResponse(error, 'composição do lote')
  }
}
