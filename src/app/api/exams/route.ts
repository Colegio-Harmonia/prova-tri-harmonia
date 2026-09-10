import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { EXAM_KINDS, EXAM_STATUSES, generatedExams, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { Segment } from '@/types/exam'
import { isStaffSuperuser } from '@/lib/auth/roles'

const SEGMENTS: Segment[] = ['anos-iniciais', 'anos-finais', 'ensino-medio']

const MAX_PAGE_SIZE = 100

function parseIntParam(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const page = Math.max(1, parseIntParam(params.get('page')) ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseIntParam(params.get('pageSize')) ?? MAX_PAGE_SIZE))

  const subject = params.get('subject')
  const segment = params.get('segment')
  const gradeYear = parseIntParam(params.get('gradeYear'))
  const academicYear = parseIntParam(params.get('academicYear'))
  const bimester = parseIntParam(params.get('bimester'))
  const status = params.get('status')
  const assignedTo = parseIntParam(params.get('assignedTo'))
  const examKind = params.get('examKind')
  const includeArchived = params.get('archived') === 'true'

  const conditions = []
  // Professor só vê as provas atribuídas a ele — decisão confirmada
  // (2026-07-14): a tela de status é de acompanhamento do fluxo de revisão,
  // não um histórico geral pra quem não é coordenação/direção. Coordenação
  // e Direção (mesma visão de superusuário, ver isStaffSuperuser) podem
  // filtrar por qualquer atribuído via `assignedTo`.
  if (!isStaffSuperuser(currentUser.role)) {
    if (examKind === 'reforco_enem' || examKind === 'atividade') {
      conditions.push(or(eq(generatedExams.createdBy, currentUser.id), eq(generatedExams.assignedTo, currentUser.id)))
    } else {
      conditions.push(eq(generatedExams.assignedTo, currentUser.id))
    }
  } else if (assignedTo !== undefined) {
    conditions.push(eq(generatedExams.assignedTo, assignedTo))
  }
  if (subject) conditions.push(eq(generatedExams.subject, subject))
  if (segment && SEGMENTS.includes(segment as Segment)) conditions.push(eq(generatedExams.segment, segment as Segment))
  if (gradeYear !== undefined) conditions.push(eq(generatedExams.gradeYear, gradeYear))
  if (academicYear !== undefined) conditions.push(eq(generatedExams.academicYear, academicYear))
  if (bimester !== undefined) conditions.push(eq(generatedExams.bimester, bimester))
  if (status && (EXAM_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(generatedExams.status, status as (typeof EXAM_STATUSES)[number]))
  }
  if (examKind && (EXAM_KINDS as readonly string[]).includes(examKind)) {
    conditions.push(eq(generatedExams.examKind, examKind as (typeof EXAM_KINDS)[number]))
  }
  conditions.push(includeArchived ? isNotNull(generatedExams.archivedAt) : isNull(generatedExams.archivedAt))
  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    // Do not use `db.query.generatedExams.findMany` here: Drizzle aliases
    // its outer table as "generatedExams", while the correlated archive
    // subquery refers to the physical generated_exams table. Using the
    // regular select keeps that outer table unaliased and makes the
    // correlation valid in PostgreSQL.
    db
      .select()
      .from(generatedExams)
      .where(where)
      .orderBy(desc(generatedExams.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(generatedExams).where(where),
  ])

  const assigneeIds = [...new Set(rows.map((r) => r.assignedTo).filter((id): id is number => id != null))]
  const assignees = assigneeIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, assigneeIds), columns: { id: true, name: true } })
    : []
  const assigneeNameById = new Map(assignees.map((a) => [a.id, a.name]))

  // Full generationPayload isn't needed for the list view (RevisarExam's own
  // GET /api/exams/[examId] carries that) — strip it down to an image
  // summary so the status table can flag "still needs review" at a glance.
  const exams = rows.map(({ generationPayload, ...row }) => {
    const payload = generationPayload as ExamGenerationResult
    const withImage = payload?.questions?.filter((q) => q.image) ?? []
    const approved = withImage.filter((q) => q.image?.approved).length

    return {
      ...row,
      assigneeName: row.assignedTo != null ? (assigneeNameById.get(row.assignedTo) ?? null) : null,
      archivedAt: row.archivedAt,
      imageSummary: withImage.length ? { total: withImage.length, approved, pending: withImage.length - approved } : null,
    }
  })

  return NextResponse.json({ exams, total, page, pageSize })
}
