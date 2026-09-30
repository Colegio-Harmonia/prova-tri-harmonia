import { describe, expect, it } from 'vitest'
import { summarizeExamCompletion } from './examCompletion'

describe('summarizeExamCompletion', () => {
  it('considera ausentes concluídos, mas não prontos para receber nota', () => {
    const summary = summarizeExamCompletion([], [
      { id: 1, status: 'revisado', attendanceStatus: 'presente', classroomStudentId: 'student-1' },
      { id: 2, status: 'pendente', attendanceStatus: 'ausente', classroomStudentId: 'student-2' },
    ])

    expect(summary).toMatchObject({ expected: 2, completed: 2, reviewed: 1, absent: 1, pending: 0, ready: true, classroomReady: true })
  })

  it('mantém o lançamento bloqueado para aluno corrigido sem vínculo com o Classroom', () => {
    const summary = summarizeExamCompletion([], [
      { id: 1, status: 'revisado', attendanceStatus: 'presente', classroomStudentId: null },
    ])

    expect(summary).toMatchObject({ completed: 1, ready: true, withoutClassroomStudent: 1, classroomReady: false })
  })

  it('usa somente atribuições ativas quando o roster foi congelado', () => {
    const summary = summarizeExamCompletion([
      { examCorrectionId: 1, status: 'emitida' },
      { examCorrectionId: 2, status: 'anulada' },
    ], [
      { id: 1, status: 'revisado', attendanceStatus: 'presente', classroomStudentId: 'student-1' },
      { id: 2, status: 'pendente', attendanceStatus: 'presente', classroomStudentId: 'student-2' },
    ])

    expect(summary).toMatchObject({ expected: 1, completed: 1, pending: 0, ready: true })
  })

  it('bloqueia a prova enquanto ainda houver aluno pendente', () => {
    const summary = summarizeExamCompletion([], [
      { id: 1, status: 'revisado', attendanceStatus: 'presente', classroomStudentId: 'student-1' },
      { id: 2, status: 'pendente', attendanceStatus: 'presente', classroomStudentId: 'student-2' },
    ])

    expect(summary).toMatchObject({ completed: 1, pending: 1, ready: false, classroomReady: false })
  })
})
