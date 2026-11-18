// Fluxo da prova de recuperação contra Postgres real em memória (PGlite),
// aplicando a migration 0057 junto com as demais. Google Docs é simulado.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, pgliteInstalled } from '@/test/pgliteDb'

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))
const generateExamDocs = vi.fn(async () => ({
  driveFolderId: 'folder', prova: { docId: 'prova-doc', url: 'https://docs/prova' }, gabarito: { docId: 'gab-doc', url: 'https://docs/gab' }, mapa: { docId: 'mapa-doc', url: 'https://docs/mapa' },
}))
vi.mock('@/lib/docs/generateExamDocs', () => ({ generateExamDocs }))

// Gerar o PDF do cartão passa de 5 s no runner da CI com cobertura ligada
// (mesma observação de sheetPdf.test.ts).
describe.skipIf(!pgliteInstalled())('prova de recuperação (Postgres real)', { timeout: 30_000 }, () => {
  let pg: import('@electric-sql/pglite').PGlite
  let service: typeof import('./recoveryService')
  const coord = { id: 1, role: 'coordenacao' }
  const teacher = { id: 2, role: 'professor' }
  const otherTeacher = { id: 3, role: 'professor' }
  let roundId = 0

  const question = (number: number, code: string) => ({ number, type: 'objetiva', statement: `Q${number}`, bnccStatus: 'mapeado', bnccCodes: [code], bnccSummary: `Habilidade ${code}` })
  const answer = (questionNumber: number, isCorrect: boolean) => ({ questionNumber, type: 'objetiva', transcribedAnswer: 'A', correctLetter: 'A', isCorrect, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: null, finalFeedback: null })

  beforeAll(async () => {
    const created = await createTestDb()
    pg = created.pg
    await pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao'), (2, 'Prof', 'p@x', 'professor'), (3, 'Outra', 'o@x', 'professor')`)
    state.db = created.db
    const payload = { metadata: { questionCount: 5, objectiveCount: 5, discursiveCount: 0 }, questions: [question(1, 'EF07MA01'), question(2, 'EF07MA01'), question(3, 'EF07MA01'), question(4, 'EF07MA01'), question(5, 'EF07MA02')] }
    await pg.query(`insert into generated_exams (id, created_by, segment, grade_year, academic_year, subject, bimester, question_count, objective_count, discursive_count, exam_kind, status, generation_payload, assigned_to, classroom_course_id)
      values (10, 2, 'anos-finais', 7, 2026, 'Matemática', 1, 5, 5, 0, 'prova', 'corrigido', $1, 2, 'C1')`, [JSON.stringify(payload)])
    // S1: 1/4 em EF07MA01 (25%) e 0/1 em EF07MA02 (amostra pequena). S2: tudo certo.
    await pg.query(`insert into exam_corrections (exam_id, classroom_student_id, student_name, answers, status, created_by) values
      (10, 'S1', 'Ana', $1, 'revisado', 2), (10, 'S2', 'Bruno', $2, 'revisado', 2)`, [
      JSON.stringify([answer(1, true), answer(2, false), answer(3, false), answer(4, false), answer(5, false)]),
      JSON.stringify([1, 2, 3, 4, 5].map((n) => answer(n, true))),
    ])
    service = await import('./recoveryService')
  }, 60_000)

  it('a migration cria as tabelas com as travas de status', async () => {
    const tables = await pg.query(`select to_regclass('recovery_rounds') as rounds, to_regclass('recovery_students') as students`)
    expect(tables.rows[0]).toEqual({ rounds: 'recovery_rounds', students: 'recovery_students' })
    await expect(pg.query(`insert into recovery_rounds (classroom_course_id, class_label, academic_year, segment, grade_year, subject, status, created_by) values ('X', 'X', 2026, 'anos-finais', 7, 'Matemática', 'qualquer', 1)`)).rejects.toThrow()
  })

  it('abre um lote por turma/disciplina/período e só para quem tem prova da disciplina na turma', async () => {
    const round = await service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: 1 }, teacher)
    expect(round).toMatchObject({ segment: 'anos-finais', gradeYear: 7, academicYear: 2026, questionCount: 10, status: 'aberto' })
    roundId = round.id
    expect((await service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: 1 }, teacher)).id).toBe(roundId)
    expect((await service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: null }, teacher)).id).not.toBe(roundId)
    // Semestre é um escopo próprio, separado do bimestre e do ano todo (0058).
    const semester = await service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: null, semester: 1 }, teacher)
    expect(semester).toMatchObject({ bimester: null, semester: 1 })
    expect((await service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: null, semester: 1 }, teacher)).id).toBe(semester.id)
    expect((await service.diagnoseStudents(semester, teacher)).get('S1')?.weak.map((skill) => skill.code)).toEqual(['EF07MA01'])
    await expect(pg.query(`insert into recovery_rounds (classroom_course_id, class_label, academic_year, segment, grade_year, subject, bimester, semester, created_by) values ('X', 'X', 2026, 'anos-finais', 7, 'Matemática', 1, 1, 1)`)).rejects.toThrow()
    await expect(service.openRound({ classroomCourseId: 'C1', classLabel: '7º A', subject: 'Matemática', bimester: 1 }, otherTeacher)).rejects.toMatchObject({ status: 422 })
    await expect(service.getRound(roundId, otherTeacher)).rejects.toMatchObject({ status: 403 })
  })

  it('marca alunos: quem tem habilidade abaixo de 60% vai para a fila com a matriz BNCC', async () => {
    const round = await service.getRound(roundId, teacher)
    const outcome = await service.flagStudents(round, [{ classroomStudentId: 'S1', name: 'Ana', email: null }, { classroomStudentId: 'S2', name: 'Bruno', email: null }], teacher)
    expect(outcome).toEqual({ queued: 1, withoutSkills: 1, alreadyFlagged: 0 })
    const detail = await service.roundDetail(round)
    const ana = detail.students.find((student) => student.classroomStudentId === 'S1')!
    expect(ana).toMatchObject({ status: 'gerando', generation: 'na_fila', bnccPlan: [{ code: 'EF07MA01', questionCount: 10 }] })
    expect(ana.weakSkills).toEqual([expect.objectContaining({ code: 'EF07MA01', masteryPercent: 25, itemCount: 4 })])
    expect(ana.insufficientSkills.map((skill) => skill.code)).toEqual(['EF07MA02'])
    expect(detail.students.find((student) => student.classroomStudentId === 'S2')).toMatchObject({ status: 'sem_habilidades', bnccPlan: [] })
    const job = await pg.query<{ job_type: string; payload: { recoveryStudentId: number; pedagogicalIntent: string; bnccPlan: unknown } }>(`select job_type, payload from generation_jobs where id = $1`, [ana.jobId])
    expect(job.rows[0]).toMatchObject({ job_type: 'gerar_atividade', payload: { recoveryStudentId: ana.id, pedagogicalIntent: 'recuperacao', bnccPlan: [{ code: 'EF07MA01', questionCount: 10 }] } })
    expect((await service.flagStudents(round, [{ classroomStudentId: 'S1', name: 'Ana', email: null }], teacher)).alreadyFlagged).toBe(1)
  })

  it('só liga a prova do job vigente; job antigo arquiva a própria prova', async () => {
    const round = await service.getRound(roundId, teacher)
    const ana = (await service.roundDetail(round)).students.find((student) => student.classroomStudentId === 'S1')!
    await expect(service.submitRound(round, teacher)).rejects.toMatchObject({ status: 409 })
    const insertExam = async (id: number) => pg.query(`insert into generated_exams (id, created_by, segment, grade_year, academic_year, subject, bimester, question_count, objective_count, discursive_count, exam_kind, status, generation_payload, assigned_to) values ($1, 2, 'anos-finais', 7, 2026, 'Matemática', 1, 10, 6, 4, 'recuperacao', 'rascunho', '{"questions":[]}', 2)`, [id])
    await insertExam(20)
    await service.linkRecoveryExam(ana.id, ana.jobId! + 999, 20)
    expect((await pg.query(`select archived_at is not null as archived from generated_exams where id = 20`)).rows[0]).toEqual({ archived: true })
    await insertExam(21)
    await service.linkRecoveryExam(ana.id, ana.jobId!, 21)
    expect((await service.roundDetail(round)).students.find((student) => student.id === ana.id)).toMatchObject({ status: 'gerada', examId: 21, generation: null })
    // Retomada do mesmo job pelo worker não arquiva a prova vigente.
    await service.linkRecoveryExam(ana.id, ana.jobId!, 21)
    expect((await pg.query(`select archived_at is null as live from generated_exams where id = 21`)).rows[0]).toEqual({ live: true })
  })

  it('envio pelo professor, aprovação só pela coordenação, depois fila de impressão', async () => {
    let round = await service.getRound(roundId, teacher)
    await service.submitRound(round, teacher)
    round = await service.getRound(roundId, teacher)
    await expect(service.flagStudents(round, [{ classroomStudentId: 'S2', name: 'Bruno', email: null }], teacher)).rejects.toMatchObject({ status: 409 })
    await expect(service.approveRound(round, teacher)).rejects.toMatchObject({ status: 403 })
    await expect(service.printableExams(round)).rejects.toMatchObject({ status: 409 })

    expect(await service.approveRound(round, coord)).toEqual({ approved: true, failures: [] })
    expect(generateExamDocs).toHaveBeenCalledTimes(1)
    expect(generateExamDocs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ examKind: 'recuperacao', nameSuffix: 'nº 21' }))
    round = await service.getRound(roundId, coord)
    expect(round.status).toBe('aprovado')
    expect(await service.printableExams(round)).toEqual([{ studentName: 'Ana', classroomStudentId: 'S1', studentEmail: null, examId: 21, provaDocId: 'prova-doc', gabaritoDocId: 'gab-doc' }])

    // Cartão-resposta com QR: uma correção e uma ficha só para o aluno da prova,
    // emitida no primeiro download e reaproveitada (mesmo QR) nos seguintes.
    await pg.query(`update generated_exams set generation_payload = $1 where id = 21`, [JSON.stringify({ questions: [
      { number: 1, type: 'objetiva', alternatives: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }], correctLetter: 'B' },
      { number: 2, type: 'descritiva' },
    ] })])
    process.env.SHEET_QR_SIGNING_KEYS = `t1=${Buffer.alloc(32, 7).toString('base64url')}`
    const sheets = await import('./recoverySheets')
    const student = { examId: 21, classroomStudentId: 'S1', studentName: 'Ana', studentEmail: null }
    const first = await sheets.recoverySheetPdf(student, coord.id)
    expect(first.byteLength).toBeGreaterThan(1000)
    const afterFirst = await pg.query<{ status: string; public_id: string; page_count: number }>(`select status, public_id, page_count from exam_sheet_assignments where exam_id = 21`)
    expect(afterFirst.rows).toEqual([expect.objectContaining({ status: 'emitida', page_count: 2 })])
    await sheets.recoverySheetPdf(student, coord.id)
    const afterSecond = await pg.query<{ public_id: string }>(`select public_id from exam_sheet_assignments where exam_id = 21`)
    expect(afterSecond.rows).toEqual([{ public_id: afterFirst.rows[0]!.public_id }])
    expect((await pg.query(`select count(*)::int as n, min(status) as status from exam_corrections where exam_id = 21`)).rows[0]).toEqual({ n: 1, status: 'pendente' })

    const queue = await service.listRounds(coord, { statuses: ['aprovado', 'impresso'] })
    expect(queue.map((item) => item.id)).toEqual([roundId])
    await service.markPrinted(round, coord)
    expect((await service.getRound(roundId, coord)).status).toBe('impresso')
    expect((await pg.query(`select status from generated_exams where id = 21`)).rows[0]).toEqual({ status: 'impresso' })
  })
})
