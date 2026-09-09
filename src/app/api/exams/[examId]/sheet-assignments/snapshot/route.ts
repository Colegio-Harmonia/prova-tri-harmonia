import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examSheetAssignments } from '@/db/schema'
import { auth } from '@/auth/auth'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { SheetAssignmentsSnapshotError, snapshotSheetAssignments } from '@/lib/scan-sheets/sheetAssignments'

// A lista pode ser congelada depois da aprovação (antes da impressão) e
// continua acessível durante a reimpressão, mas nunca é aberta depois da
// aplicação. Isso impede que mudanças tardias no Classroom entrem no lote.
export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error

  const assignments = await db.query.examSheetAssignments.findMany({
    where: eq(examSheetAssignments.examId, examId),
    orderBy: [asc(examSheetAssignments.studentNameSnapshot)],
  })
  return NextResponse.json({ assignments })
}

export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { currentUser, exam } = result

  try {
    const snapshot = await snapshotSheetAssignments({
      examId,
      exam,
      currentUserId: currentUser.id,
      googleAccessToken: session.googleAccessToken,
      googleRefreshFailed: session.googleError === 'RefreshAccessTokenError',
    })
    return NextResponse.json(snapshot)
  } catch (err) {
    if (err instanceof SheetAssignmentsSnapshotError) {
      if (err.code === 'snapshot_not_allowed') {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status })
    }
    console.error('[sheet-assignments/snapshot] falha ao preparar fichas')
    return NextResponse.json({ error: 'sheet_snapshot_failed', message: 'Não foi possível preparar as fichas da turma.' }, { status: 500 })
  }
}
