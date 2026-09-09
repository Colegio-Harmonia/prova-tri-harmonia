/**
 * Smoke test end-to-end da pontuação (Subtarefa 2) contra o banco local:
 * prova percentual, prova TRI com itens calibrados (fabricados) e prova
 * TRI sem calibração nenhuma (fallback honesto). Não chama IA — testa o
 * serviço scoreExamCorrections direto (o mesmo que o job 'pontuar_prova'
 * executa no worker).
 *
 * Rodar: npm run test:scoring (precisa do prova-tri-postgres up e das
 * migrations 0015/0016 aplicadas). Cria usuário/provas/correções
 * temporários e apaga tudo no fim, inclusive em caso de erro.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='))
  if (!line) return
  process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

function basePayload(questions: unknown[]) {
  return {
    metadata: { segment: 'ensino-medio', gradeYear: 3, subject: 'Matemática', bimester: null, questionCount: questions.length, objectiveCount: 2, discursiveCount: 1, alternativesCount: 5 },
    questions,
  }
}

function answers(obj1Correct: boolean, obj2Correct: boolean, descGrade: number) {
  return [
    { questionNumber: 1, type: 'objetiva', transcribedAnswer: obj1Correct ? 'A' : 'B', correctLetter: 'A', isCorrect: obj1Correct, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: obj1Correct ? 10 : 0, finalFeedback: null },
    { questionNumber: 2, type: 'objetiva', transcribedAnswer: obj2Correct ? 'B' : 'C', correctLetter: 'B', isCorrect: obj2Correct, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: obj2Correct ? 10 : 0, finalFeedback: null },
    { questionNumber: 3, type: 'descritiva', transcribedAnswer: 'resposta do aluno', correctLetter: null, isCorrect: null, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: descGrade, finalFeedback: null },
  ]
}

async function main() {
  loadDatabaseUrlFromLocalEnv()
  const { db } = await import('../src/db/client')
  const { examCorrections, generatedExams, users } = await import('../src/db/schema')
  const { scoreExamCorrections } = await import('../src/lib/scoring/scoreCorrections')

  const [tempUser] = await db.insert(users).values({ name: 'Smoke Test Scoring', email: `scoring-smoke-${Date.now()}@test.invalid`, role: 'professor' }).returning()

  const createdExamIds: number[] = []
  const fakeBankIds: number[] = []

  try {
    // Itens fabricados do "banco ENEM" com calibração conhecida — ano 1901
    // impossível de colidir com dado real; apagados no finally.
    const bankRows = (await db.execute(sql`
      INSERT INTO imported_questions (source, year, question_index, title, correct_alternative, alternatives, tri_param_a, tri_param_b, tri_param_c, tri_param_source)
      VALUES
        ('enem', 1901, 901, 'smoke tri 1', 'A', '[]'::jsonb, 1.2, -0.5, 0.2, 'inep_microdados'),
        ('enem', 1901, 902, 'smoke tri 2', 'B', '[]'::jsonb, 1.0, 0.8, 0.2, 'inep_microdados')
      RETURNING id
    `)) as unknown as Array<{ id: number }>
    fakeBankIds.push(...bankRows.map((r) => Number(r.id)))

    // ── Caso 1: prova padrão → percentual ──
    const [padraoExam] = await db.insert(generatedExams).values({
      createdBy: tempUser.id, segment: 'ensino-medio', gradeYear: 3, academicYear: 2026, subject: 'Matemática',
      questionCount: 3, objectiveCount: 2, discursiveCount: 1, status: 'corrigido',
      assessmentKind: 'padrao', scoringMethod: 'percentual',
      generationPayload: basePayload([
        { number: 1, type: 'objetiva' }, { number: 2, type: 'objetiva' }, { number: 3, type: 'descritiva' },
      ]),
    }).returning()
    createdExamIds.push(padraoExam.id)

    await db.insert(examCorrections).values({
      examId: padraoExam.id, studentName: 'Aluno Percentual', answers: answers(true, false, 7), status: 'revisado', createdBy: tempUser.id,
    })

    const r1 = await scoreExamCorrections(padraoExam.id)
    assert.equal(r1.method, 'percentual')
    assert.equal(r1.scored, 1)
    const [c1] = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, padraoExam.id) })
    const s1 = c1.scoreResult as { method: string; percent: number; decimal: number }
    assert.equal(s1.method, 'percentual')
    assert.equal(s1.percent, 56.7) // (10 + 0 + 7) / 30
    assert.equal(s1.decimal, 5.67)
    console.log(`✓ percentual: prova #${padraoExam.id} → ${s1.percent}% (${s1.decimal})`)

    // ── Caso 2: simulado ENEM com itens calibrados → TRI + percentual ao lado ──
    const [triExam] = await db.insert(generatedExams).values({
      createdBy: tempUser.id, segment: 'ensino-medio', gradeYear: 3, academicYear: 2026, subject: 'Matemática',
      questionCount: 3, objectiveCount: 2, discursiveCount: 1, status: 'corrigido',
      assessmentKind: 'enem', scoringMethod: 'tri',
      generationPayload: basePayload([
        { number: 1, type: 'objetiva', source: 'enem_bank', enemBankRef: { questionId: fakeBankIds[0], year: 1901 } },
        { number: 2, type: 'objetiva', source: 'enem_bank', enemBankRef: { questionId: fakeBankIds[1], year: 1901 } },
        { number: 3, type: 'descritiva' },
      ]),
    }).returning()
    createdExamIds.push(triExam.id)

    await db.insert(examCorrections).values({
      examId: triExam.id, studentName: 'Aluno TRI', answers: answers(true, false, 7), status: 'revisado', createdBy: tempUser.id,
    })

    const r2 = await scoreExamCorrections(triExam.id)
    assert.equal(r2.method, 'tri')
    assert.equal(r2.calibratedItems, 2)
    const [c2] = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, triExam.id) })
    const s2 = c2.scoreResult as { method: string; tri: { score: number; itemsUsed: number; itemsTotal: number; approximate: boolean } | null; percentual: { percent: number }; noTriReason: string | null }
    assert.equal(s2.method, 'tri')
    assert.ok(s2.tri, 'com itens calibrados o TRI deve existir')
    assert.equal(s2.tri!.itemsUsed, 2)
    assert.equal(s2.tri!.itemsTotal, 2)
    assert.equal(s2.tri!.approximate, false)
    assert.ok(s2.tri!.score >= 0 && s2.tri!.score <= 1000, 'score na escala 0-1000')
    assert.equal(s2.percentual.percent, 56.7, 'percentual sempre presente ao lado do TRI')
    assert.equal(s2.noTriReason, null)
    console.log(`✓ tri calibrada: prova #${triExam.id} → ${s2.tri!.score} pts (θ ok, ${s2.tri!.itemsUsed}/${s2.tri!.itemsTotal} itens), percentual ${s2.percentual.percent}%`)

    // Discursiva nunca entra na TRI: score de quem acerta as mesmas objetivas
    // não muda com a nota da descritiva.
    await db.insert(examCorrections).values({
      examId: triExam.id, studentName: 'Aluno TRI 2', answers: answers(true, false, 0), status: 'revisado', createdBy: tempUser.id,
    })
    await scoreExamCorrections(triExam.id)
    const cs = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, triExam.id) })
    const scores = cs.map((c) => (c.scoreResult as { tri: { score: number } }).tri.score)
    assert.equal(scores[0], scores[1], 'nota da descritiva não pode mexer no score TRI')
    console.log('✓ tri: discursiva fora do cálculo (mesmas objetivas ⇒ mesmo score)')

    // ── Caso 3: prova com item ENEM sem calibração → sem TRI, com aviso ──
    const [noTriExam] = await db.insert(generatedExams).values({
      createdBy: tempUser.id, segment: 'ensino-medio', gradeYear: 3, academicYear: 2026, subject: 'Matemática',
      questionCount: 3, objectiveCount: 2, discursiveCount: 1, status: 'corrigido',
      assessmentKind: 'padrao', scoringMethod: 'tri',
      generationPayload: basePayload([
        { number: 1, type: 'objetiva', source: 'enem_bank', enemBankRef: { questionId: -1, year: 1901 } }, { number: 2, type: 'objetiva', source: 'ia' }, { number: 3, type: 'descritiva' },
      ]),
    }).returning()
    createdExamIds.push(noTriExam.id)

    await db.insert(examCorrections).values({
      examId: noTriExam.id, studentName: 'Aluno Sem Calibração', answers: answers(true, true, 10), status: 'revisado', createdBy: tempUser.id,
    })

    await scoreExamCorrections(noTriExam.id)
    const [c3] = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, noTriExam.id) })
    const s3 = c3.scoreResult as { method: string; tri: unknown; noTriReason: string | null; percentual: { percent: number } }
    assert.equal(s3.method, 'tri')
    assert.equal(s3.tri, null, 'sem calibração oficial NÃO existe score TRI — nunca inventar')
    assert.ok(s3.noTriReason, 'motivo da ausência de TRI deve ser explícito')
    assert.equal(s3.percentual.percent, 100)
    console.log(`✓ tri sem calibração: prova #${noTriExam.id} → sem score TRI (motivo explícito), percentual ${s3.percentual.percent}%`)

    console.log('\nSmoke test de pontuação: TUDO OK ✅')
  } finally {
    for (const examId of createdExamIds) {
      await db.delete(examCorrections).where(eq(examCorrections.examId, examId))
      await db.delete(generatedExams).where(eq(generatedExams.id, examId))
    }
    if (fakeBankIds.length) {
      await db.execute(sql`DELETE FROM imported_questions WHERE id IN (${sql.join(fakeBankIds.map((id) => sql`${id}`), sql`, `)})`)
    }
    await db.delete(users).where(eq(users.id, tempUser.id))
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test de pontuação FALHOU:', err)
  process.exit(1)
})
