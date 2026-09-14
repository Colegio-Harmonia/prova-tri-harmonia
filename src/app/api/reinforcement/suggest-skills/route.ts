import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { getEnemAreaForSubject, getEnemCompetenciesForSubject } from '@/config/enemAreaMap'
import type { CorrectionAnswer } from '@/types/correction'

// Sugestão automática de habilidades pro reforço (Módulo 3, spec 3.3):
// ranqueia as habilidades INEP com PIOR desempenho real, cruzando as
// correções revisadas de provas do EM com a classificação oficial das
// questões do banco (enemBankRef → imported_question_classifications).
// A sugestão é pré-seleção editável — decisão final é sempre humana,
// mesmo princípio da nota sugerida por IA. Mínimo de 3 respostas por
// habilidade pra entrar (evita % instável, mesma regra do
// topMissedQuestions do /desempenho).

const MIN_ATTEMPTS = 3
const MAX_SUGGESTIONS = 10

type PayloadQuestion = {
  number: number
  type: string
  enemBankRef?: { questionId: number } | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const subject = req.nextUrl.searchParams.get('subject')
  const gradeYearParam = req.nextUrl.searchParams.get('gradeYear')
  const gradeYear = gradeYearParam ? Number(gradeYearParam) : null
  const area = subject ? getEnemAreaForSubject(subject) : null
  if (!area) {
    return NextResponse.json({ error: 'Informe uma disciplina do Ensino Médio com área ENEM correspondente.' }, { status: 400 })
  }
  const allowedCompetencies = getEnemCompetenciesForSubject(subject ?? '')

  // Professor só enxerga o desempenho das próprias provas — mesma regra
  // do /api/analytics/performance.
  const examConditions = [eq(generatedExams.segment, 'ensino-medio')]
  if (gradeYear && Number.isFinite(gradeYear)) examConditions.push(eq(generatedExams.gradeYear, gradeYear))
  if (!isStaffSuperuser(currentUser.role)) examConditions.push(eq(generatedExams.assignedTo, currentUser.id))

  const exams = await db.query.generatedExams.findMany({
    where: and(...examConditions),
    columns: { id: true, generationPayload: true },
  })
  if (!exams.length) return NextResponse.json({ suggestions: [], sampleNote: 'Sem provas do EM no recorte — selecione as habilidades manualmente.' })

  const corrections = await db.query.examCorrections.findMany({
    where: and(inArray(examCorrections.examId, exams.map((e) => e.id)), eq(examCorrections.status, 'revisado')),
    columns: { examId: true, answers: true },
  })

  // (examId, questionNumber) → questionId do banco ENEM
  const bankRefByExamQuestion = new Map<string, number>()
  for (const exam of exams) {
    const questions = ((exam.generationPayload as { questions?: PayloadQuestion[] })?.questions ?? [])
    for (const q of questions) {
      if (q.type === 'objetiva' && q.enemBankRef?.questionId) {
        bankRefByExamQuestion.set(`${exam.id}:${q.number}`, q.enemBankRef.questionId)
      }
    }
  }

  // questionId → { attempts, errors } agregado das respostas revisadas
  const statsByQuestionId = new Map<number, { attempts: number; errors: number }>()
  for (const correction of corrections) {
    for (const answer of (correction.answers ?? []) as CorrectionAnswer[]) {
      if (answer.type !== 'objetiva' || answer.isCorrect === null) continue
      const questionId = bankRefByExamQuestion.get(`${correction.examId}:${answer.questionNumber}`)
      if (!questionId) continue
      const stat = statsByQuestionId.get(questionId) ?? { attempts: 0, errors: 0 }
      stat.attempts++
      if (!answer.isCorrect) stat.errors++
      statsByQuestionId.set(questionId, stat)
    }
  }

  if (!statsByQuestionId.size) {
    return NextResponse.json({ suggestions: [], sampleNote: 'Nenhuma correção revisada com questões do banco ENEM ainda — selecione as habilidades manualmente.' })
  }

  // questionId → habilidade oficial, restrito à área pedida
  const questionIds = [...statsByQuestionId.keys()]
  const rows = await db.execute(sql`
    SELECT c.question_id, s.code, s.description, ec.number AS competency_number
    FROM imported_question_classifications c
    JOIN enem_skills s ON s.id = c.enem_skill_id
    JOIN enem_competencies ec ON ec.id = s.competency_id
    JOIN enem_areas ea ON ea.id = ec.area_id
    WHERE c.source = 'enem' AND ea.code = ${area}
      AND c.question_id IN (${sql.join(questionIds.map((id) => sql`${id}`), sql`, `)})
  `)

  const bySkill = new Map<string, { description: string | null; attempts: number; errors: number }>()
  for (const raw of rows as unknown as Array<Record<string, unknown>>) {
    if (allowedCompetencies?.length && !allowedCompetencies.includes(Number(raw.competency_number))) continue
    const stat = statsByQuestionId.get(Number(raw.question_id))
    if (!stat) continue
    const code = String(raw.code)
    const agg = bySkill.get(code) ?? { description: raw.description ? String(raw.description) : null, attempts: 0, errors: 0 }
    agg.attempts += stat.attempts
    agg.errors += stat.errors
    bySkill.set(code, agg)
  }

  const suggestions = [...bySkill.entries()]
    .filter(([, agg]) => agg.attempts >= MIN_ATTEMPTS && agg.errors > 0)
    .map(([code, agg]) => ({
      code,
      description: agg.description,
      attempts: agg.attempts,
      errorRatePercent: Math.round((agg.errors / agg.attempts) * 100),
    }))
    .sort((a, b) => b.errorRatePercent - a.errorRatePercent || b.attempts - a.attempts)
    .slice(0, MAX_SUGGESTIONS)

  return NextResponse.json({
    suggestions,
    sampleNote: suggestions.length
      ? null
      : `Há correções, mas nenhuma habilidade de ${subject} com pelo menos ${MIN_ATTEMPTS} respostas e erros — selecione manualmente.`,
  })
}
