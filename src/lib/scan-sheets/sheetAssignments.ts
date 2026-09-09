import { randomBytes } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examSheetAssignments } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { isInsufficientScopeError, listStudentsInCourse } from '@/lib/classroom/classroomClient'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import { planSheetPages } from './sheetLayout'

export const SNAPSHOTABLE_SHEET_STATUSES = ['aprovado', 'impresso'] as const

export class SheetAssignmentsSnapshotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SheetAssignmentsSnapshotError'
  }
}

function createPublicId() {
  return randomBytes(18).toString('base64url')
}

type SnapshotExam = {
  status: string
  classroomCourseId: string | null
  generationPayload: unknown
}

/**
 * Congela o roster e cria as fichas individuais. É idempotente para os
 * alunos que já possuem uma ficha pronta ou emitida, então pode ser chamado
 * pelo fluxo de impressão sem duplicar cartões.
 */
export async function snapshotSheetAssignments({
  examId,
  exam,
  currentUserId,
  googleAccessToken,
  googleRefreshFailed,
}: {
  examId: number
  exam: SnapshotExam
  currentUserId: number
  googleAccessToken: string | undefined
  googleRefreshFailed?: boolean
}) {
  if (!SNAPSHOTABLE_SHEET_STATUSES.includes(exam.status as (typeof SNAPSHOTABLE_SHEET_STATUSES)[number])) {
    throw new SheetAssignmentsSnapshotError(409, 'snapshot_not_allowed', 'O roster só pode ser congelado para uma prova aprovada ou já marcada como impressa.')
  }
  if (!exam.classroomCourseId) {
    throw new SheetAssignmentsSnapshotError(409, 'classroom_course_required', 'Vincule uma turma do Classroom antes de congelar o roster.')
  }
  if (googleRefreshFailed) {
    throw new SheetAssignmentsSnapshotError(401, 'reauth_required', 'Sua conexão com o Google expirou, entre novamente.')
  }
  if (!googleAccessToken) {
    throw new SheetAssignmentsSnapshotError(401, 'google_not_connected', 'Entre com sua conta Google pra importar o roster.')
  }

  let roster
  try {
    roster = await listStudentsInCourse(googleAccessToken, exam.classroomCourseId)
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      throw new SheetAssignmentsSnapshotError(401, 'reauth_required', 'Sua conta Google precisa autorizar acesso à lista de alunos de novo — entre com o Google outra vez.')
    }
    // O erro do cliente HTTP pode carregar a configuração com bearer token;
    // não o serializar em logs operacionais.
    console.error('[sheet-assignments/snapshot] falha ao buscar roster')
    throw new SheetAssignmentsSnapshotError(502, 'classroom_api_error', 'Não consegui buscar a lista de alunos no Google Classroom.')
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const emptyAnswers = buildEmptyAnswers(payload)
  let pageCount: number
  try {
    pageCount = planSheetPages(payload.questions).length
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível montar o layout da folha.'
    throw new SheetAssignmentsSnapshotError(422, 'layout_not_supported', message)
  }

  return db.transaction(async (tx) => {
    const corrections = await tx.query.examCorrections.findMany({
      where: eq(examCorrections.examId, examId),
      orderBy: [asc(examCorrections.id)],
    })
    const correctionByStudentId = new Map(
      corrections.filter((correction) => correction.classroomStudentId).map((correction) => [correction.classroomStudentId!, correction]),
    )

    const studentsWithoutCorrection = roster.filter((student) => !correctionByStudentId.has(student.classroomStudentId))
    if (studentsWithoutCorrection.length > 0) {
      await tx.insert(examCorrections).values(studentsWithoutCorrection.map((student) => ({
        examId,
        classroomStudentId: student.classroomStudentId,
        studentName: student.name,
        studentEmail: student.email,
        answers: emptyAnswers,
        createdBy: currentUserId,
      })))
    }

    const correctionsAfterInsert = studentsWithoutCorrection.length > 0
      ? await tx.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId), orderBy: [asc(examCorrections.id)] })
      : corrections
    const correctionAfterInsertByStudentId = new Map(
      correctionsAfterInsert.filter((correction) => correction.classroomStudentId).map((correction) => [correction.classroomStudentId!, correction]),
    )
    const assignments = await tx.query.examSheetAssignments.findMany({
      where: eq(examSheetAssignments.examId, examId),
      orderBy: [asc(examSheetAssignments.studentNameSnapshot)],
    })
    const activeStudentIds = new Set(
      assignments.filter((assignment) => assignment.status === 'pronta' || assignment.status === 'emitida').map((assignment) => assignment.classroomStudentId),
    )
    const studentsWithoutAssignment = roster.filter((student) => !activeStudentIds.has(student.classroomStudentId))

    if (studentsWithoutAssignment.length > 0) {
      await tx.insert(examSheetAssignments).values(studentsWithoutAssignment.map((student) => {
        const correction = correctionAfterInsertByStudentId.get(student.classroomStudentId)
        if (!correction) throw new Error(`Correção ausente para o aluno ${student.classroomStudentId}`)
        return {
          examId,
          examCorrectionId: correction.id,
          classroomStudentId: student.classroomStudentId,
          studentNameSnapshot: student.name,
          studentEmailSnapshot: student.email,
          publicId: createPublicId(),
          pageCount,
          issuedBy: currentUserId,
        }
      }))
    }

    const allAssignments = studentsWithoutAssignment.length > 0
      ? await tx.query.examSheetAssignments.findMany({
          where: eq(examSheetAssignments.examId, examId),
          orderBy: [asc(examSheetAssignments.studentNameSnapshot)],
        })
      : assignments

    return { created: studentsWithoutAssignment.length, assignments: allAssignments }
  })
}
