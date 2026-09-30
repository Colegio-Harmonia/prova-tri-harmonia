import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examSheetAssignments } from '@/db/schema'

export const ACTIVE_ASSIGNMENT_STATUSES = ['pronta', 'emitida'] as const

export type ExamCompletionSummary = {
  expected: number
  completed: number
  reviewed: number
  absent: number
  pending: number
  withoutClassroomStudent: number
  outOfRoster: number
  ready: boolean
  classroomReady: boolean
  correctionIds: number[]
}

type CompletionAssignment = { examCorrectionId: number; status: string }
type CompletionCorrection = { id: number; status: string; attendanceStatus?: string | null; classroomStudentId?: string | null }

export function isCorrectionComplete(correction: {
  status: string
  attendanceStatus?: string | null
}) {
  return correction.attendanceStatus === 'ausente' ||
    (correction.attendanceStatus !== 'ausente' && correction.status === 'revisado')
}

export function summarizeExamCompletion(assignments: CompletionAssignment[], corrections: CompletionCorrection[]): ExamCompletionSummary {
  const activeAssignments = assignments.filter((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status as (typeof ACTIVE_ASSIGNMENT_STATUSES)[number]),
  )
  const expectedIds = activeAssignments.length
    ? new Set(activeAssignments.map((assignment) => assignment.examCorrectionId))
    : new Set(corrections.map((correction) => correction.id))
  const expected = corrections.filter((correction) => expectedIds.has(correction.id))
  const assignmentCorrectionIds = new Set(assignments.map((assignment) => assignment.examCorrectionId))
  const outOfRoster = activeAssignments.length
    ? corrections.filter((correction) => !assignmentCorrectionIds.has(correction.id)).length
    : 0
  const absent = expected.filter((correction) => correction.attendanceStatus === 'ausente').length
  const reviewed = expected.filter((correction) => correction.attendanceStatus !== 'ausente' && correction.status === 'revisado').length
  const completed = absent + reviewed
  const pending = Math.max(expected.length - completed, 0)
  const withoutClassroomStudent = expected.filter((correction) =>
    correction.attendanceStatus !== 'ausente' && correction.status === 'revisado' && !correction.classroomStudentId,
  ).length

  return {
    expected: expected.length,
    completed,
    reviewed,
    absent,
    pending,
    withoutClassroomStudent,
    outOfRoster,
    ready: expected.length > 0 && pending === 0 && outOfRoster === 0,
    classroomReady: expected.length > 0 && pending === 0 && outOfRoster === 0 && withoutClassroomStudent === 0,
    correctionIds: expected.map((correction) => correction.id),
  }
}

/**
 * Calcula o fechamento da prova usando o mesmo denominador dos cartões:
 * quando há roster congelado, só atribuições ativas entram; sem cartões, a
 * lista de correções cadastradas é a fonte de expectativa.
 */
export async function getExamCompletionSummary(examId: number): Promise<ExamCompletionSummary> {
  const [assignments, corrections] = await Promise.all([
    db.query.examSheetAssignments.findMany({
      where: eq(examSheetAssignments.examId, examId),
      columns: { examCorrectionId: true, status: true },
    }),
    db.query.examCorrections.findMany({
      where: eq(examCorrections.examId, examId),
      columns: { id: true, status: true, attendanceStatus: true, classroomStudentId: true },
    }),
  ])

  return summarizeExamCompletion(assignments, corrections)
}
