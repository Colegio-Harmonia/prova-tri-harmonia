import { describe, expect, it } from 'vitest'
import { checkCourseExamFit, describeMismatch, gradeYearIn, sortCoursesForExam } from './courseExamFit'

const ciencias3 = { subject: 'Ciências', gradeYear: 3 }

describe('checkCourseExamFit', () => {
  it('aceita a turma da mesma disciplina e série', () => {
    expect(checkCourseExamFit({ name: 'Ciências - 3º Ano B - 26', section: '3º Ano B - 26' }, ciencias3)).toEqual({ kind: 'match' })
  })

  it('avisa quando a turma é de outra disciplina da mesma série (caso real das provas 743/744)', () => {
    const fit = checkCourseExamFit({ name: 'Artes - 3º Ano B - 26', section: '3º Ano B - 26' }, ciencias3)
    expect(fit.kind).toBe('mismatch')
    expect(describeMismatch(fit)).toBe('A turma parece ser de Artes, e a prova é de Ciências')
  })

  it('avisa quando a série não bate', () => {
    const fit = checkCourseExamFit({ name: 'Ciências - 5º Ano A - 26', section: null }, ciencias3)
    expect(fit).toEqual({ kind: 'mismatch', reasons: ['a turma parece ser do 5º ano/série, e a prova é do 3º ano/série'] })
  })

  it('não confunde Educação Física com Física', () => {
    expect(checkCourseExamFit({ name: 'Educação Física - 1ª Série' }, { subject: 'Física', gradeYear: 1 }).kind).toBe('mismatch')
    expect(checkCourseExamFit({ name: 'Ed. Física - 7º ano' }, { subject: 'Educação Física', gradeYear: 7 }).kind).toBe('match')
    expect(checkCourseExamFit({ name: 'Física - 1ª Série' }, { subject: 'Física', gradeYear: 1 }).kind).toBe('match')
  })

  it('trata Português e Língua Portuguesa como a mesma disciplina', () => {
    expect(checkCourseExamFit({ name: 'Língua Portuguesa - 8º Ano' }, { subject: 'Português', gradeYear: 8 }).kind).toBe('match')
    expect(checkCourseExamFit({ name: 'Português 2º ano' }, { subject: 'Língua Portuguesa', gradeYear: 2 }).kind).toBe('match')
  })

  it('aceita Arte no singular', () => {
    expect(checkCourseExamFit({ name: 'Arte - 6º Ano' }, { subject: 'Artes', gradeYear: 6 }).kind).toBe('match')
  })

  it('aceita turma que cita a disciplina da prova junto com outra', () => {
    expect(checkCourseExamFit({ name: 'Língua Portuguesa e Literatura - 2ª Série' }, { subject: 'Literatura', gradeYear: 2 }).kind).toBe('match')
  })

  it('não julga turma cujo nome não cita disciplina nem série', () => {
    expect(checkCourseExamFit({ name: 'Turma da Professora Marli' }, ciencias3)).toEqual({ kind: 'unknown' })
  })

  it('só a série reconhecida, sem disciplina, conta como desconhecida quando bate', () => {
    expect(checkCourseExamFit({ name: '3º Ano B - 26' }, ciencias3)).toEqual({ kind: 'unknown' })
  })
})

describe('gradeYearIn', () => {
  it('lê ano e série sem confundir com o ano letivo', () => {
    expect(gradeYearIn('Ciências - 3º Ano B - 26')).toBe(3)
    expect(gradeYearIn('Química - 2ª Série')).toBe(2)
    expect(gradeYearIn('9 ano')).toBe(9)
    expect(gradeYearIn('Turma 26')).toBeNull()
  })
})

describe('sortCoursesForExam', () => {
  it('põe as turmas compatíveis primeiro e as de outra disciplina por último', () => {
    const courses = [
      { id: 'a', name: 'Artes - 3º Ano B - 26' },
      { id: 'b', name: 'Sala dos Professores' },
      { id: 'c', name: 'Ciências - 3º Ano B - 26' },
      { id: 'd', name: 'Ciências - 3º Ano A - 26' },
    ]
    expect(sortCoursesForExam(courses, ciencias3).map((course) => course.id)).toEqual(['c', 'd', 'b', 'a'])
  })
})
