// Integração contra Postgres real (PGlite): as colunas de aluno ficam cifradas
// no banco, o sistema continua lendo linhas antigas em texto puro, os filtros
// por aluno funcionam nos dois casos e a conversão é idempotente.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { createTestDb, pgliteInstalled } from '@/test/pgliteDb'

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))

const KEY = Buffer.alloc(32, 5).toString('base64')
const previousKey = process.env.STUDENT_DATA_KEY

describe.skipIf(!pgliteInstalled())('dados de aluno cifrados (Postgres real)', () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>['pg']
  let db: Awaited<ReturnType<typeof createTestDb>>['db']
  let schema: typeof import('@/db/schema')
  let crypto: typeof import('./fieldCrypto')
  let identity: typeof import('./studentIdentity')
  let backfill: typeof import('./studentDataBackfill')
  let examId: number

  const raw = async (query: string) => (await pg.query<Record<string, unknown>>(query)).rows
  const useKey = (key: string | undefined) => {
    if (key === undefined) delete process.env.STUDENT_DATA_KEY
    else process.env.STUDENT_DATA_KEY = key
    crypto.resetFieldCryptoCache()
  }

  beforeAll(async () => {
    const created = await createTestDb()
    pg = created.pg; db = created.db; state.db = created.db
    schema = await import('@/db/schema')
    crypto = await import('./fieldCrypto')
    identity = await import('./studentIdentity')
    backfill = await import('./studentDataBackfill')
    await pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao')`)
    const [exam] = await raw(`insert into generated_exams (created_by, segment, grade_year, subject, academic_year, bimester, exam_kind, question_count, objective_count, discursive_count, generation_payload) values (1, 'ensino-medio', 2, 'Matemática', 2026, 1, 'prova', 12, 7, 5, '{}') returning id`)
    examId = exam.id as number

    // Linhas "antigas", gravadas sem chave: texto puro + índice SHA-256 (como a migration deixa).
    useKey(undefined)
    await db.insert(schema.examCorrections).values([
      { examId, classroomStudentId: 'g-111', classroomStudentHash: identity.hashOrNull('g-111'), studentName: 'Bruno Lima', studentNameHash: identity.hashOrNull('Bruno Lima'), studentEmail: 'bruno@x', answers: [], createdBy: 1 },
      { examId, studentName: 'Ana Souza', studentNameHash: identity.hashOrNull('Ana Souza'), answers: [], createdBy: 1 },
    ])
    await db.insert(schema.enemSaeImports).values({ academicYear: 2026, gradeYear: 3, bimester: 1, analysis: { students: [{ name: 'Bruno Lima', correct: 30 }] }, importedBy: 1 })
  }, 60_000)

  afterAll(() => useKey(previousKey))

  it('sem chave, grava em texto puro e o índice é o mesmo SHA-256 da migration', async () => {
    const [row] = await raw(`select student_name, classroom_student_hash, encode(sha256(convert_to(classroom_student_id, 'UTF8')), 'hex') as sql_hash from exam_corrections where classroom_student_id = 'g-111'`)
    expect(row.student_name).toBe('Bruno Lima')
    expect(row.classroom_student_hash).toBe(row.sql_hash)
  })

  it('com chave, o que é gravado fica ilegível no banco e volta legível pela aplicação', async () => {
    useKey(KEY)
    await db.insert(schema.examCorrections).values({ examId, classroomStudentId: 'g-222', classroomStudentHash: identity.hashOrNull('g-222'), studentName: 'Carla Dias', studentNameHash: identity.hashOrNull('Carla Dias'), studentEmail: 'carla@x', answers: [], createdBy: 1 })
    const stored = await raw(`select classroom_student_id, student_name, student_email from exam_corrections where classroom_student_hash = '${identity.hashOrNull('g-222')}'`)
    expect(stored).toHaveLength(1)
    for (const value of Object.values(stored[0])) expect(String(value)).toMatch(/^enc:v1:/)
    expect(JSON.stringify(stored)).not.toMatch(/Carla|carla@x|g-222/)

    const all = await db.query.examCorrections.findMany({ where: eq(schema.examCorrections.examId, examId) })
    expect(all.map((row) => row.studentName).sort()).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Dias'])
    expect(all.find((row) => row.studentName === 'Carla Dias')).toMatchObject({ classroomStudentId: 'g-222', studentEmail: 'carla@x' })
  })

  it('filtro por aluno acha linha cifrada (pelo índice) e linha antiga em texto puro', async () => {
    const find = (column: 'id' | 'name', value: string) => db.select({ name: schema.examCorrections.studentName }).from(schema.examCorrections).where(and(
      eq(schema.examCorrections.examId, examId),
      column === 'id'
        ? identity.matchesEncrypted(schema.examCorrections.classroomStudentId, schema.examCorrections.classroomStudentHash, value)
        : identity.matchesEncrypted(schema.examCorrections.studentName, schema.examCorrections.studentNameHash, value),
    ))
    expect(await find('id', 'g-222')).toEqual([{ name: 'Carla Dias' }])
    expect(await find('id', 'g-111')).toEqual([{ name: 'Bruno Lima' }]) // antiga: índice SHA-256 não casa com o HMAC, casa pelo texto
    expect(await find('name', 'Ana Souza')).toEqual([{ name: 'Ana Souza' }])
    expect(await find('name', 'Carla Dias')).toEqual([{ name: 'Carla Dias' }])
    expect(await find('id', 'g-999')).toEqual([])
  })

  it('ordenação por nome é feita na aplicação', async () => {
    const rows = await db.query.examCorrections.findMany({ where: eq(schema.examCorrections.examId, examId) })
    expect(rows.sort(identity.byStudentName((row) => row.studentName)).map((row) => row.studentName)).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Dias'])
  })

  it('o ensaio da conversão conta e não grava nada', async () => {
    const before = await raw('select id, classroom_student_id, student_name, student_email, classroom_student_hash, student_name_hash from exam_corrections order by id')
    const report = await backfill.backfillStudentData(db, { apply: false })
    expect(report.applied).toBe(false)
    const corrections = report.tables.find((table) => table.table === 'exam_corrections')!
    expect(corrections).toMatchObject({ rows: 3, valuesEncrypted: 4, valuesAlreadyEncrypted: 3, hashesUpdated: 3 })
    expect(report.plaintextRemaining).toBe(5) // 4 valores + o JSON do SAE
    expect(await raw('select id, classroom_student_id, student_name, student_email, classroom_student_hash, student_name_hash from exam_corrections order by id')).toEqual(before)
  })

  it('a conversão cifra tudo, troca os índices e pode ser repetida sem efeito', async () => {
    const report = await backfill.backfillStudentData(db, { apply: true })
    expect(report.plaintextRemaining).toBe(0)
    const stored = await raw('select classroom_student_id, student_name, student_email from exam_corrections')
    expect(JSON.stringify(stored)).not.toMatch(/Bruno|Ana Souza|Carla|bruno@x|g-111/)
    expect(JSON.stringify(await raw('select analysis from enem_sae_imports'))).not.toMatch(/Bruno/)

    const bruno = await db.select({ name: schema.examCorrections.studentName, hash: schema.examCorrections.classroomStudentHash }).from(schema.examCorrections)
      .where(sql`${schema.examCorrections.classroomStudentHash} = ${identity.hashOrNull('g-111')}`)
    expect(bruno).toEqual([{ name: 'Bruno Lima', hash: identity.hashOrNull('g-111') }])
    const [sae] = await db.select({ analysis: schema.enemSaeImports.analysis }).from(schema.enemSaeImports)
    expect(sae.analysis).toEqual({ students: [{ name: 'Bruno Lima', correct: 30 }] })

    const again = await backfill.backfillStudentData(db, { apply: true })
    expect(again.tables.every((table) => table.valuesEncrypted === 0 && table.hashesUpdated === 0)).toBe(true)
  })

  it('unicidade por aluno passa a valer pelo índice cego', async () => {
    const values = { examId, classroomStudentId: 'g-333', classroomStudentHash: identity.hashOrNull('g-333'), classroomSubmissionId: 's1', studentName: 'Davi' }
    await db.insert(schema.activityClassroomResults).values(values)
    await expect(db.insert(schema.activityClassroomResults).values({ ...values, classroomSubmissionId: 's2' })).rejects.toThrow()
  })

  it('sem a chave, o sistema recusa ler em vez de mostrar dado errado; com outra chave também', async () => {
    useKey(undefined)
    await expect(db.query.examCorrections.findMany({ where: eq(schema.examCorrections.examId, examId) })).rejects.toThrow(/STUDENT_DATA_KEY/)
    useKey(Buffer.alloc(32, 6).toString('base64'))
    await expect(db.query.examCorrections.findMany({ where: eq(schema.examCorrections.examId, examId) })).rejects.toThrow(/chave configurada/)
    await expect(backfill.backfillStudentData(db, { apply: false })).rejects.toThrow(/chave configurada/)
    useKey(KEY)
  })
})
