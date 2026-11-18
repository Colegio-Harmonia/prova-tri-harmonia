import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { flagStudents, getRound, RecoveryError } from '@/lib/recovery/recoveryService'
import { classroomRoster, parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

const schema = z.object({ classroomStudentIds: z.array(z.string().min(1).max(64)).min(1).max(80) })

// Marca alunos para recuperação: calcula as habilidades abaixo de 60% de cada
// um e põe a prova individual na fila de geração.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Selecione os alunos.', issues: parsed.error.issues }, { status: 400 })
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    const roster = await classroomRoster(access.session, round.classroomCourseId)
    const wanted = new Set(parsed.data.classroomStudentIds)
    const students = roster.filter((student) => wanted.has(student.classroomStudentId))
    if (students.length !== wanted.size) throw new RecoveryError('Algum aluno selecionado não está mais matriculado nesta turma do Classroom.', 422)
    const outcome = await flagStudents(round, students, access.viewer)
    return NextResponse.json(outcome)
  } catch (error) {
    return recoveryErrorResponse(error, 'marcar alunos')
  }
}
