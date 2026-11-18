import { NextResponse } from 'next/server'
import { diagnoseStudents, getRound, roundDetail } from '@/lib/recovery/recoveryService'
import { classroomRoster, parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

// Detalhe do lote. Enquanto aberto, também devolve o roster do Classroom com
// o diagnóstico de cada aluno, para o professor decidir quem marcar.
export async function GET(_req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    const detail = await roundDetail(round)
    if (round.status !== 'aberto') return NextResponse.json({ ...detail, roster: null, rosterError: null })
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
    return NextResponse.json({ ...detail, roster, rosterError })
  } catch (error) {
    return recoveryErrorResponse(error, 'detalhe do lote')
  }
}
