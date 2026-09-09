import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, pedagogicalClassifications, pedagogicalTaxonomies, users, importedQuestionClassifications, enemCognitiveAxes } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { Segment } from '@/types/exam'

const BLOOM_LEVELS = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const
const DOK_LEVELS = ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4'] as const
const INEP_COGNITIVE_AXES = ['DL', 'CF', 'SP', 'CA', 'EP'] as const
const SOLO_EXPECTED_LEVELS = ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] as const
const SOLO_OBSERVED_LEVELS = ['PRE_ESTRUTURAL', 'UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] as const
const BLOOM_LABELS_FOR_API: Record<string, string> = {
  lembrar: 'Lembrar',
  compreender: 'Compreender',
  aplicar: 'Aplicar',
  analisar: 'Analisar',
  avaliar: 'Avaliar',
  criar: 'Criar',
}
const BNCC_STATUS_ORDER = {
  intervencao: 0,
  desenvolvimento: 1,
  dominio: 2,
  amostra_insuficiente: 3,
} as const

type BnccDevelopmentStatus = keyof typeof BNCC_STATUS_ORDER
type ScoreCount = { scoreSum: number; count: number }
type BloomLevel = (typeof BLOOM_LEVELS)[number]
type DokLevel = (typeof DOK_LEVELS)[number]
type InepAxisCode = (typeof INEP_COGNITIVE_AXES)[number]
type SoloExpectedLevel = (typeof SOLO_EXPECTED_LEVELS)[number]
type SoloObservedLevel = (typeof SOLO_OBSERVED_LEVELS)[number]
type BnccSkillAccumulator = {
  code: string
  summary: string | null
  unitTheme: string | null
  scoreSum: number
  itemCount: number
  subjects: Record<string, number>
  gradeYears: Record<string, number>
  periods: Record<string, ScoreCount>
}

type InepAxisAccumulator = {
  scoreSum: number
  itemCount: number
  subjects: Record<string, number>
  periods: Record<string, ScoreCount>
}

type ProfileBnccAccumulator = ScoreCount & { summary: string | null }
type StudentProfileAccumulator = {
  studentName: string
  grades: number[]
  subjects: Record<string, number>
  periods: Record<string, number>
  itemScoreSum: number
  itemCount: number
  bloom: Record<string, ScoreCount>
  dok: Record<string, ScoreCount>
  bncc: Record<string, ProfileBnccAccumulator>
  inep: Record<string, ScoreCount>
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}

function confidenceLevel(sampleSize: number): 'baixa' | 'media' | 'alta' {
  if (sampleSize >= 15) return 'alta'
  if (sampleSize >= 6) return 'media'
  return 'baixa'
}

function periodLabel(row: { academicYear: number; bimester: number | null }) {
  return row.bimester ? `${row.academicYear}.${row.bimester}` : `${row.academicYear}`
}

function percentFromScoreSum(scoreSum: number, itemCount: number) {
  if (itemCount === 0) return null
  return Math.round((scoreSum / (itemCount * 10)) * 100)
}

function bnccDevelopmentStatus(accuracyPercent: number | null, sampleSize: number): BnccDevelopmentStatus {
  if (sampleSize < 3 || accuracyPercent === null) return 'amostra_insuficiente'
  if (accuracyPercent >= 80) return 'dominio'
  if (accuracyPercent >= 60) return 'desenvolvimento'
  return 'intervencao'
}

function pushScore(record: Record<string, number[]>, key: string, score: number) {
  ;(record[key] ??= []).push(score)
}

function bumpScoreCount(record: Record<string, ScoreCount>, key: string, score: number) {
  const stat = (record[key] ??= { scoreSum: 0, count: 0 })
  stat.scoreSum += score
  stat.count++
}

function bumpCount(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1
}

function bumpSubjectDistribution(record: Record<string, Record<string, number>>, level: string, subject: string) {
  const bySubject = (record[level] ??= {})
  bySubject[subject] = (bySubject[subject] ?? 0) + 1
}

function sortedCountDistribution(record: Record<string, number>) {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }))
}

function scoreSummaryEntries(record: Record<string, ScoreCount>) {
  return Object.entries(record)
    .map(([key, stat]) => ({
      key,
      itemCount: stat.count,
      accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
      averageScore: stat.count ? Math.round((stat.scoreSum / stat.count) * 10) / 10 : null,
    }))
    .sort((a, b) => (b.accuracyPercent ?? -1) - (a.accuracyPercent ?? -1) || b.itemCount - a.itemCount || a.key.localeCompare(b.key))
}

function performanceJson(payload: unknown, startedAt: number, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      ...init?.headers,
      'Server-Timing': `analytics;dur=${(performance.now() - startedAt).toFixed(1)}`,
    },
  })
}

// Calculado na hora a cada consulta, sem tabela pré-agregada — mesmo
// padrão já usado em /api/stats/dashboard e /api/stats/enem (decisão
// confirmada 17/07/2026: volume de provas da escola é pequeno o
// suficiente pra isso ser instantâneo, e evita todo o problema de
// "quando recalcular" de uma tabela materializada).
export async function GET(req: NextRequest) {
  const startedAt = performance.now()
  const session = await auth()
  if (!session?.user?.email) return performanceJson({ error: 'Não autenticado' }, startedAt, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return performanceJson({ error: 'Usuário não encontrado' }, startedAt, { status: 401 })

  const isSuperuser = isStaffSuperuser(currentUser.role)
  const params = req.nextUrl.searchParams

  // Professor NUNCA vê dado de terceiro, mesmo que force um `assignedTo`
  // diferente na query string — o parâmetro só é aceito de coordenação/
  // direção pra baixo (mesma regra da Subtarefa 6/7, exigida pela
  // Subtarefa 9: "TEACHER só recebe dado das turmas vinculadas a ele").
  // Reforço ENEM é formativo: sua correção pode apoiar o professor, mas não
  // compõe a média institucional de desempenho das provas avaliativas.
  const conditions = [eq(examCorrections.status, 'revisado'), eq(generatedExams.examKind, 'prova')]
  if (!isSuperuser) {
    conditions.push(eq(generatedExams.assignedTo, currentUser.id))
  } else {
    const assignedTo = params.get('assignedTo')
    const subject = params.get('subject')
    const gradeYear = params.get('gradeYear')
    const segment = params.get('segment')
    const classroomCourseId = params.get('classroomCourseId')
    if (assignedTo) conditions.push(eq(generatedExams.assignedTo, Number(assignedTo)))
    if (subject) conditions.push(eq(generatedExams.subject, subject))
    if (gradeYear) conditions.push(eq(generatedExams.gradeYear, Number(gradeYear)))
    if (segment) conditions.push(eq(generatedExams.segment, segment as Segment))
    if (classroomCourseId) conditions.push(eq(generatedExams.classroomCourseId, classroomCourseId))
  }
  const academicYearParam = params.get('academicYear')
  const bimesterParam = params.get('bimester')
  const studentName = params.get('student')?.trim()
  if (academicYearParam) {
    const academicYear = Number(academicYearParam)
    if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) {
      return performanceJson({ error: 'Ano letivo inválido.' }, startedAt, { status: 400 })
    }
    conditions.push(eq(generatedExams.academicYear, academicYear))
  }
  if (bimesterParam) {
    const bimester = Number(bimesterParam)
    if (!Number.isInteger(bimester) || bimester < 1 || bimester > 4) {
      return performanceJson({ error: 'Bimestre inválido.' }, startedAt, { status: 400 })
    }
    conditions.push(eq(generatedExams.bimester, bimester))
  }
  // O aluno não possui conta no sistema. O filtro ainda passa pelo escopo de
  // prova já aplicado acima, portanto não amplia a visão de um professor.
  if (studentName) conditions.push(eq(examCorrections.studentName, studentName))

  const rows = await db
    .select({
      examId: generatedExams.id,
      correctionId: examCorrections.id,
      subject: generatedExams.subject,
      gradeYear: generatedExams.gradeYear,
      academicYear: generatedExams.academicYear,
      bimester: generatedExams.bimester,
      segment: generatedExams.segment,
      assignedTo: generatedExams.assignedTo,
      generationPayload: generatedExams.generationPayload,
      studentName: examCorrections.studentName,
      answers: examCorrections.answers,
    })
    .from(examCorrections)
    .innerJoin(generatedExams, eq(examCorrections.examId, generatedExams.id))
    .where(and(...conditions))

  if (rows.length === 0) {
    return performanceJson({
      overall: null,
      bySubject: {},
      byGradeYear: {},
      byBloomLevel: {},
      bloomDashboard: {},
      dokDashboard: {},
      bnccDashboard: {
        summary: { mappedSkillCount: 0, mappedItemLinks: 0, unmappedItemCount: 0 },
        bySubject: [],
        byGradeYear: [],
        skills: [],
      },
      inepAxisDashboard: {
        summary: { classifiedItemCount: 0, unclassifiedEnemItemCount: 0 },
        axes: [],
      },
      bloomDokMatrix: {
        summary: { itemCount: 0 },
        rows: [],
      },
      soloDashboard: {
        expected: { summary: { classifiedItemCount: 0, unclassifiedItemCount: 0 }, levels: [] },
        observed: { summary: { classifiedAnswerCount: 0, unclassifiedDiscursiveAnswerCount: 0 }, levels: [] },
      },
      cognitiveProfiles: [],
      byProfessor: {},
      topMissedQuestions: [],
    }, startedAt)
  }

  const examIds = [...new Set(rows.map((r) => r.examId))]
  const enemBankQuestionIds = [
    ...new Set(
      rows.flatMap((row) => {
        const payload = row.generationPayload as ExamGenerationResult
        return payload.questions
          .map((question) => question.enemBankRef?.questionId)
          .filter((questionId): questionId is number => questionId != null)
      }),
    ),
  ]
  const [inepAxisRows, taxonomyRows] = await Promise.all([
    enemBankQuestionIds.length
      ? db
          .select({
            questionId: importedQuestionClassifications.questionId,
            code: enemCognitiveAxes.code,
            name: enemCognitiveAxes.name,
            description: enemCognitiveAxes.description,
            source: importedQuestionClassifications.enemClassificationSource,
          })
          .from(importedQuestionClassifications)
          .innerJoin(enemCognitiveAxes, eq(importedQuestionClassifications.enemCognitiveAxisId, enemCognitiveAxes.id))
          .where(and(eq(importedQuestionClassifications.source, 'enem'), inArray(importedQuestionClassifications.questionId, enemBankQuestionIds)))
      : Promise.resolve([]),
    db.query.pedagogicalTaxonomies.findMany({
      where: inArray(pedagogicalTaxonomies.code, ['DOK', 'SOLO_EXPECTED', 'SOLO_OBSERVED']),
      columns: { id: true, code: true },
    }),
  ])
  const inepAxisByQuestion = new Map(inepAxisRows.map((row) => [row.questionId, row]))
  const inepAxisInfo = new Map(inepAxisRows.map((row) => [row.code, { name: row.name, description: row.description }]))
  const taxonomyIdByCode = new Map(taxonomyRows.map((taxonomy) => [taxonomy.code, taxonomy.id]))
  const dokTaxonomyId = taxonomyIdByCode.get('DOK')
  const soloExpectedTaxonomyId = taxonomyIdByCode.get('SOLO_EXPECTED')
  const soloObservedTaxonomyId = taxonomyIdByCode.get('SOLO_OBSERVED')

  const correctionIds = [...new Set(rows.map((r) => r.correctionId))]
  const professorIds = [...new Set(rows.map((r) => r.assignedTo).filter((id): id is number => id != null))]
  const [dokClassifications, soloExpectedClassifications, soloObservedClassifications, professors] = await Promise.all([
    dokTaxonomyId
      ? db.query.pedagogicalClassifications.findMany({
        where: and(
          eq(pedagogicalClassifications.classifiableType, 'generated_exam_question'),
          eq(pedagogicalClassifications.taxonomyId, dokTaxonomyId),
          eq(pedagogicalClassifications.isCurrent, true),
          inArray(pedagogicalClassifications.classifiableId, examIds),
        ),
        columns: {
          classifiableId: true,
          classifiableSubId: true,
          classificationCode: true,
        },
      })
      : Promise.resolve([]),
    soloExpectedTaxonomyId
      ? db.query.pedagogicalClassifications.findMany({
        where: and(
          eq(pedagogicalClassifications.classifiableType, 'generated_exam_question'),
          eq(pedagogicalClassifications.taxonomyId, soloExpectedTaxonomyId),
          eq(pedagogicalClassifications.isCurrent, true),
          inArray(pedagogicalClassifications.classifiableId, examIds),
        ),
        columns: {
          classifiableId: true,
          classifiableSubId: true,
          classificationCode: true,
        },
      })
      : Promise.resolve([]),
    soloObservedTaxonomyId
      ? db.query.pedagogicalClassifications.findMany({
        where: and(
          eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'),
          eq(pedagogicalClassifications.taxonomyId, soloObservedTaxonomyId),
          eq(pedagogicalClassifications.isCurrent, true),
          inArray(pedagogicalClassifications.classifiableId, correctionIds),
        ),
        columns: {
          classifiableId: true,
          classifiableSubId: true,
          classificationCode: true,
        },
      })
      : Promise.resolve([]),
    professorIds.length
      ? db.query.users.findMany({ where: inArray(users.id, professorIds), columns: { id: true, name: true } })
      : Promise.resolve([]),
  ])
  const dokByQuestion = new Map(
    dokClassifications
      .filter((c) => c.classifiableSubId != null)
      .map((c) => [`${c.classifiableId}:${c.classifiableSubId}`, c.classificationCode]),
  )
  const soloExpectedByQuestion = new Map(
    soloExpectedClassifications
      .filter((c) => c.classifiableSubId != null)
      .map((c) => [`${c.classifiableId}:${c.classifiableSubId}`, c.classificationCode]),
  )

  const soloObservedByAnswer = new Map(
    soloObservedClassifications
      .filter((c) => c.classifiableSubId != null)
      .map((c) => [`${c.classifiableId}:${c.classifiableSubId}`, c.classificationCode]),
  )

  const professorNameById = new Map(professors.map((p) => [p.id, p.name]))

  const grades: number[] = []
  const bySubject: Record<string, number[]> = {}
  const byGradeYear: Record<string, number[]> = {}
  const byBloomLevel: Record<string, number[]> = {}
  const bloomScoreSum: Record<string, number> = {}
  const bloomItemCount: Record<string, number> = {}
  const bloomEvolution: Record<string, Record<string, { scoreSum: number; count: number }>> = {}
  const dokScoreSum: Record<string, number> = {}
  const dokItemCount: Record<string, number> = {}
  const dokEvolution: Record<string, Record<string, { scoreSum: number; count: number }>> = {}
  const dokSubjectDistribution: Record<string, Record<string, number>> = {}
  const bloomDokMatrixStats: Record<string, ScoreCount> = {}
  const soloExpectedStats: Record<string, ScoreCount> = {}
  const soloObservedStats: Record<string, ScoreCount> = {}
  let soloExpectedClassifiedItemCount = 0
  let soloExpectedUnclassifiedItemCount = 0
  let soloObservedClassifiedAnswerCount = 0
  let soloObservedUnclassifiedDiscursiveAnswerCount = 0
  const bnccSkills = new Map<string, BnccSkillAccumulator>()
  const bnccBySubject: Record<string, ScoreCount> = {}
  const bnccByGradeYear: Record<string, ScoreCount> = {}
  let bnccMappedItemLinks = 0
  let bnccUnmappedItemCount = 0
  const inepAxisStats: Partial<Record<InepAxisCode, InepAxisAccumulator>> = {}
  let inepClassifiedItemCount = 0
  let inepUnclassifiedEnemItemCount = 0
  const studentProfiles = new Map<string, StudentProfileAccumulator>()
  const byProfessor: Record<string, number[]> = {}
  // questionKey (examId:questionNumber) -> { subject, wrong, total }
  const questionStats = new Map<string, { subject: string; gradeYear: number; wrong: number; total: number }>()

  for (const row of rows) {
    const payload = row.generationPayload as ExamGenerationResult
    const answers = row.answers as CorrectionAnswer[]
    const questionsByNumber = new Map(payload.questions.map((question) => [question.number, question]))
    const grade = totalGrade(answers)
    if (grade === null) continue

    grades.push(grade)
    pushScore(bySubject, row.subject, grade)
    pushScore(byGradeYear, `${row.gradeYear}º ano`, grade)
    const studentProfile = studentProfiles.get(row.studentName) ?? {
      studentName: row.studentName,
      grades: [],
      subjects: {},
      periods: {},
      itemScoreSum: 0,
      itemCount: 0,
      bloom: {},
      dok: {},
      bncc: {},
      inep: {},
    }
    studentProfile.grades.push(grade)
    bumpCount(studentProfile.subjects, row.subject)
    bumpCount(studentProfile.periods, periodLabel(row))
    studentProfiles.set(row.studentName, studentProfile)

    if (row.assignedTo) {
      const name = professorNameById.get(row.assignedTo) ?? `#${row.assignedTo}`
      pushScore(byProfessor, name, grade)
    }

    for (const answer of answers) {
      const question = questionsByNumber.get(answer.questionNumber)
      if (!question) continue

      // Nota por nível de Bloom: usa isCorrect (objetiva, binário 0/10)
      // ou finalGrade (descritiva, 0-10) — sempre convertido pra escala
      // 0-10 antes de entrar na média, senão os dois tipos não são
      // comparáveis na mesma agregação.
      const questionScore = answer.type === 'objetiva' ? (answer.isCorrect ? 10 : 0) : answer.finalGrade
      if (questionScore !== null && questionScore !== undefined) {
        studentProfile.itemScoreSum += questionScore
        studentProfile.itemCount++
        bumpScoreCount(studentProfile.bloom, question.bloomLevel, questionScore)

        pushScore(byBloomLevel, question.bloomLevel, questionScore)
        bloomScoreSum[question.bloomLevel] = (bloomScoreSum[question.bloomLevel] ?? 0) + questionScore
        bloomItemCount[question.bloomLevel] = (bloomItemCount[question.bloomLevel] ?? 0) + 1

        const period = periodLabel(row)
        const byPeriod = (bloomEvolution[question.bloomLevel] ??= {})
        const periodStats = (byPeriod[period] ??= { scoreSum: 0, count: 0 })
        periodStats.scoreSum += questionScore
        periodStats.count++

        const soloExpectedLevel = soloExpectedByQuestion.get(`${row.examId}:${answer.questionNumber}`) ?? question.pedagogicalClassification?.soloExpected.categoryCode
        if (soloExpectedLevel && SOLO_EXPECTED_LEVELS.includes(soloExpectedLevel as SoloExpectedLevel)) {
          bumpScoreCount(soloExpectedStats, soloExpectedLevel, questionScore)
          soloExpectedClassifiedItemCount++
        } else {
          soloExpectedUnclassifiedItemCount++
        }

        if (answer.type === 'descritiva') {
          const soloObservedLevel = soloObservedByAnswer.get(`${row.correctionId}:${answer.questionNumber}`)
          if (soloObservedLevel && SOLO_OBSERVED_LEVELS.includes(soloObservedLevel as SoloObservedLevel)) {
            bumpScoreCount(soloObservedStats, soloObservedLevel, questionScore)
            soloObservedClassifiedAnswerCount++
          } else {
            soloObservedUnclassifiedDiscursiveAnswerCount++
          }
        }

        const dokLevel = dokByQuestion.get(`${row.examId}:${answer.questionNumber}`) ?? question.pedagogicalClassification?.dok.categoryCode
        if (dokLevel && DOK_LEVELS.includes(dokLevel as DokLevel)) {
          bumpScoreCount(studentProfile.dok, dokLevel, questionScore)
          dokScoreSum[dokLevel] = (dokScoreSum[dokLevel] ?? 0) + questionScore
          dokItemCount[dokLevel] = (dokItemCount[dokLevel] ?? 0) + 1
          bumpSubjectDistribution(dokSubjectDistribution, dokLevel, row.subject)
          if (BLOOM_LEVELS.includes(question.bloomLevel as BloomLevel)) {
            bumpScoreCount(bloomDokMatrixStats, `${question.bloomLevel}:${dokLevel}`, questionScore)
          }

          const dokByPeriod = (dokEvolution[dokLevel] ??= {})
          const dokPeriodStats = (dokByPeriod[period] ??= { scoreSum: 0, count: 0 })
          dokPeriodStats.scoreSum += questionScore
          dokPeriodStats.count++
        }

        const bnccCodes = Array.isArray(question.bnccCodes) ? question.bnccCodes.filter(Boolean) : []
        if (question.bnccStatus === 'mapeado' && bnccCodes.length > 0) {
          const gradeYearLabel = `${row.gradeYear}º ano`
          bumpScoreCount(bnccBySubject, row.subject, questionScore)
          bumpScoreCount(bnccByGradeYear, gradeYearLabel, questionScore)

          for (const code of bnccCodes) {
            const profileBncc = (studentProfile.bncc[code] ??= { scoreSum: 0, count: 0, summary: question.bnccSummary ?? null })
            if (!profileBncc.summary && question.bnccSummary) profileBncc.summary = question.bnccSummary
            profileBncc.scoreSum += questionScore
            profileBncc.count++

            const skill = bnccSkills.get(code) ?? {
              code,
              summary: question.bnccSummary ?? null,
              unitTheme: null,
              scoreSum: 0,
              itemCount: 0,
              subjects: {},
              gradeYears: {},
              periods: {},
            }
            if (!skill.summary && question.bnccSummary) skill.summary = question.bnccSummary
            skill.scoreSum += questionScore
            skill.itemCount++
            bumpCount(skill.subjects, row.subject)
            bumpCount(skill.gradeYears, gradeYearLabel)
            bumpScoreCount(skill.periods, period, questionScore)
            bnccSkills.set(code, skill)
            bnccMappedItemLinks++
          }
        } else {
          bnccUnmappedItemCount++
        }

        const enemQuestionId = question.enemBankRef?.questionId
        if (question.source === 'enem_bank' && enemQuestionId) {
          const axis = inepAxisByQuestion.get(enemQuestionId)
          if (axis && INEP_COGNITIVE_AXES.includes(axis.code as InepAxisCode)) {
            const axisCode = axis.code as InepAxisCode
            bumpScoreCount(studentProfile.inep, axisCode, questionScore)
            const stat = (inepAxisStats[axisCode] ??= {
              scoreSum: 0,
              itemCount: 0,
              subjects: {},
              periods: {},
            })
            stat.scoreSum += questionScore
            stat.itemCount++
            bumpCount(stat.subjects, row.subject)
            bumpScoreCount(stat.periods, period, questionScore)
            inepClassifiedItemCount++
          } else {
            inepUnclassifiedEnemItemCount++
          }
        }
      }

      if (answer.type === 'objetiva' && answer.transcribedAnswer) {
        const key = `${row.examId}:${answer.questionNumber}`
        const stat = questionStats.get(key) ?? { subject: row.subject, gradeYear: row.gradeYear, wrong: 0, total: 0 }
        stat.total++
        if (!answer.isCorrect) stat.wrong++
        questionStats.set(key, stat)
      }
    }
  }

  const topMissedQuestions = [...questionStats.entries()]
    .filter(([, s]) => s.total >= 3) // ignora quem teve poucas respostas — % de erro pouco confiável
    .map(([key, s]) => {
      const [examId, questionNumber] = key.split(':')
      return { examId: Number(examId), questionNumber: Number(questionNumber), subject: s.subject, gradeYear: s.gradeYear, errorRate: Math.round((s.wrong / s.total) * 100) }
    })
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10)

  const mapAvg = (record: Record<string, number[]>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, { avg: avg(v), count: v.length }]))
  const bloomDashboard = Object.fromEntries(
    BLOOM_LEVELS.map((level) => {
      const count = bloomItemCount[level] ?? 0
      const scoreSum = bloomScoreSum[level] ?? 0
      const evolution = Object.entries(bloomEvolution[level] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, stat]) => ({
          period,
          count: stat.count,
          accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
        }))

      return [
        level,
        {
          itemCount: count,
          equivalentCorrect: Math.round((scoreSum / 10) * 10) / 10,
          accuracyPercent: percentFromScoreSum(scoreSum, count),
          averageScore: avg(byBloomLevel[level] ?? []),
          confidence: confidenceLevel(count),
          sampleSize: count,
          insufficientSample: count < 6,
          evolution,
        },
      ]
    }),
  )
  const dokDashboard = Object.fromEntries(
    DOK_LEVELS.map((level) => {
      const count = dokItemCount[level] ?? 0
      const scoreSum = dokScoreSum[level] ?? 0
      const evolution = Object.entries(dokEvolution[level] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, stat]) => ({
          period,
          count: stat.count,
          accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
        }))
      const subjectDistribution = Object.entries(dokSubjectDistribution[level] ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([subject, countBySubject]) => ({ subject, count: countBySubject }))

      return [
        level,
        {
          itemCount: count,
          equivalentCorrect: Math.round((scoreSum / 10) * 10) / 10,
          accuracyPercent: percentFromScoreSum(scoreSum, count),
          confidence: confidenceLevel(count),
          sampleSize: count,
          insufficientSample: count < 6,
          evolution,
          subjectDistribution,
        },
      ]
    }),
  )
  const bnccSkillsList = [...bnccSkills.values()]
    .map((skill) => {
      const accuracyPercent = percentFromScoreSum(skill.scoreSum, skill.itemCount)
      const status = bnccDevelopmentStatus(accuracyPercent, skill.itemCount)
      const evolution = Object.entries(skill.periods)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, stat]) => ({
          period,
          count: stat.count,
          accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
        }))

      return {
        code: skill.code,
        summary: skill.summary,
        unitTheme: skill.unitTheme,
        itemCount: skill.itemCount,
        equivalentCorrect: Math.round((skill.scoreSum / 10) * 10) / 10,
        accuracyPercent,
        confidence: confidenceLevel(skill.itemCount),
        sampleSize: skill.itemCount,
        insufficientSample: skill.itemCount < 3,
        status,
        primarySubject: sortedCountDistribution(skill.subjects)[0]?.name ?? '—',
        primaryGradeYear: sortedCountDistribution(skill.gradeYears)[0]?.name ?? '—',
        subjects: sortedCountDistribution(skill.subjects),
        gradeYears: sortedCountDistribution(skill.gradeYears),
        evolution,
      }
    })
    .sort((a, b) => {
      const byStatus = BNCC_STATUS_ORDER[a.status] - BNCC_STATUS_ORDER[b.status]
      if (byStatus !== 0) return byStatus
      return (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) || b.itemCount - a.itemCount || a.code.localeCompare(b.code)
    })

  const mapBnccGroup = (record: Record<string, ScoreCount>) =>
    Object.entries(record)
      .map(([name, stat]) => {
        const accuracyPercent = percentFromScoreSum(stat.scoreSum, stat.count)
        return {
          name,
          itemCount: stat.count,
          accuracyPercent,
          confidence: confidenceLevel(stat.count),
          status: bnccDevelopmentStatus(accuracyPercent, stat.count),
        }
      })
      .sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) || b.itemCount - a.itemCount || a.name.localeCompare(b.name))

  const bnccDashboard = {
    summary: {
      mappedSkillCount: bnccSkills.size,
      mappedItemLinks: bnccMappedItemLinks,
      unmappedItemCount: bnccUnmappedItemCount,
    },
    bySubject: mapBnccGroup(bnccBySubject),
    byGradeYear: mapBnccGroup(bnccByGradeYear),
    skills: bnccSkillsList,
  }
  const inepAxisDashboard = {
    summary: {
      classifiedItemCount: inepClassifiedItemCount,
      unclassifiedEnemItemCount: inepUnclassifiedEnemItemCount,
    },
    axes: INEP_COGNITIVE_AXES.map((code) => {
      const stat = inepAxisStats[code] ?? { scoreSum: 0, itemCount: 0, subjects: {}, periods: {} }
      const info = inepAxisInfo.get(code)
      const evolution = Object.entries(stat.periods)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, periodStat]) => ({
          period,
          count: periodStat.count,
          accuracyPercent: percentFromScoreSum(periodStat.scoreSum, periodStat.count),
        }))

      return {
        code,
        name: info?.name ?? code,
        description: info?.description ?? null,
        itemCount: stat.itemCount,
        equivalentCorrect: Math.round((stat.scoreSum / 10) * 10) / 10,
        accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.itemCount),
        confidence: confidenceLevel(stat.itemCount),
        sampleSize: stat.itemCount,
        insufficientSample: stat.itemCount < 6,
        subjectDistribution: sortedCountDistribution(stat.subjects).map(({ name, count }) => ({ subject: name, count })),
        evolution,
      }
    }),
  }
  const bloomDokMatrix = {
    summary: {
      itemCount: Object.values(bloomDokMatrixStats).reduce((sum, stat) => sum + stat.count, 0),
    },
    rows: BLOOM_LEVELS.map((bloomLevel) => ({
      bloomLevel,
      cells: DOK_LEVELS.map((dokLevel) => {
        const stat = bloomDokMatrixStats[`${bloomLevel}:${dokLevel}`] ?? { scoreSum: 0, count: 0 }
        return {
          bloomLevel,
          dokLevel,
          itemCount: stat.count,
          equivalentCorrect: Math.round((stat.scoreSum / 10) * 10) / 10,
          accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
          sampleSize: stat.count,
          confidence: confidenceLevel(stat.count),
          insufficientSample: stat.count < 3,
        }
      }),
    })),
  }
  const mapSoloLevels = (levels: readonly string[], stats: Record<string, ScoreCount>) =>
    levels.map((level) => {
      const stat = stats[level] ?? { scoreSum: 0, count: 0 }
      return {
        level,
        itemCount: stat.count,
        equivalentCorrect: Math.round((stat.scoreSum / 10) * 10) / 10,
        accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
        averageScore: stat.count ? Math.round((stat.scoreSum / stat.count) * 10) / 10 : null,
        confidence: confidenceLevel(stat.count),
        sampleSize: stat.count,
        insufficientSample: stat.count < 3,
      }
    })

  const soloDashboard = {
    expected: {
      summary: {
        classifiedItemCount: soloExpectedClassifiedItemCount,
        unclassifiedItemCount: soloExpectedUnclassifiedItemCount,
      },
      levels: mapSoloLevels(SOLO_EXPECTED_LEVELS, soloExpectedStats),
    },
    observed: {
      summary: {
        classifiedAnswerCount: soloObservedClassifiedAnswerCount,
        unclassifiedDiscursiveAnswerCount: soloObservedUnclassifiedDiscursiveAnswerCount,
      },
      levels: mapSoloLevels(SOLO_OBSERVED_LEVELS, soloObservedStats),
    },
  }
  const cognitiveProfiles = [...studentProfiles.values()]
    .map((profile) => {
      const bloomEntries = scoreSummaryEntries(profile.bloom)
      const dokEntries = scoreSummaryEntries(profile.dok)
      const inepEntries = scoreSummaryEntries(profile.inep)
      const bnccEntries = Object.entries(profile.bncc)
        .map(([code, stat]) => ({
          code,
          summary: stat.summary,
          itemCount: stat.count,
          accuracyPercent: percentFromScoreSum(stat.scoreSum, stat.count),
        }))
        .sort((a, b) => (b.accuracyPercent ?? -1) - (a.accuracyPercent ?? -1) || b.itemCount - a.itemCount || a.code.localeCompare(b.code))

      const strengths = [
        ...bloomEntries
          .filter((entry) => entry.itemCount >= 2 && (entry.accuracyPercent ?? 0) >= 75)
          .slice(0, 2)
          .map((entry) => `Bom desempenho em ${BLOOM_LABELS_FOR_API[entry.key] ?? entry.key} (${entry.accuracyPercent}% em ${entry.itemCount} itens).`),
        ...dokEntries
          .filter((entry) => entry.itemCount >= 2 && (entry.accuracyPercent ?? 0) >= 75)
          .slice(0, 1)
          .map((entry) => `Sustenta desempenho em ${entry.key.replace('_', ' ')} (${entry.accuracyPercent}% em ${entry.itemCount} itens).`),
      ].slice(0, 3)

      const development = [
        ...bloomEntries
          .filter((entry) => entry.itemCount >= 2 && (entry.accuracyPercent ?? 100) < 60)
          .slice(-2)
          .map((entry) => `Menor desempenho em ${BLOOM_LABELS_FOR_API[entry.key] ?? entry.key} (${entry.accuracyPercent}% em ${entry.itemCount} itens).`),
        ...dokEntries
          .filter((entry) => entry.itemCount >= 2 && (entry.accuracyPercent ?? 100) < 60)
          .slice(-1)
          .map((entry) => `Queda em ${entry.key.replace('_', ' ')} (${entry.accuracyPercent}% em ${entry.itemCount} itens).`),
      ].slice(0, 3)

      const bnccStrengths = bnccEntries
        .filter((entry) => entry.itemCount >= 3 && (entry.accuracyPercent ?? 0) >= 80)
        .slice(0, 3)
      const bnccInterventions = bnccEntries
        .filter((entry) => entry.itemCount >= 3 && (entry.accuracyPercent ?? 100) < 60)
        .slice(-3)
      const sustainedDok = [...dokEntries]
        .filter((entry) => entry.itemCount >= 2 && (entry.accuracyPercent ?? 0) >= 70)
        .sort((a, b) => DOK_LEVELS.indexOf(b.key as DokLevel) - DOK_LEVELS.indexOf(a.key as DokLevel))[0] ?? null

      const limitations = [
        profile.itemCount < 15 ? `Amostra pequena: ${profile.itemCount} itens corrigidos.` : null,
        Object.keys(profile.subjects).length < 2 ? 'Perfil baseado em apenas uma disciplina.' : null,
        bnccEntries.every((entry) => entry.itemCount < 3) ? 'BNCC sem amostra mínima por habilidade.' : null,
        dokEntries.length === 0 ? 'Sem DOK disponível para esta amostra.' : null,
        inepEntries.length === 0 ? 'Sem questões ENEM com eixo INEP nesta amostra.' : null,
      ].filter((item): item is string => Boolean(item))

      return {
        studentName: profile.studentName,
        overallAverage: avg(profile.grades),
        itemAccuracyPercent: percentFromScoreSum(profile.itemScoreSum, profile.itemCount),
        sampleSize: profile.itemCount,
        confidence: confidenceLevel(profile.itemCount),
        periods: Object.keys(profile.periods).sort(),
        subjects: sortedCountDistribution(profile.subjects),
        strengths,
        development,
        bnccStrengths,
        bnccInterventions,
        sustainedDok: sustainedDok
          ? { level: sustainedDok.key, accuracyPercent: sustainedDok.accuracyPercent, itemCount: sustainedDok.itemCount }
          : null,
        inepHighlights: inepEntries.filter((entry) => entry.itemCount >= 2).slice(0, 2),
        limitations,
      }
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName))

  return performanceJson({
    overall: { avg: avg(grades), max: Math.max(...grades), min: Math.min(...grades), count: grades.length },
    bySubject: mapAvg(bySubject),
    byGradeYear: mapAvg(byGradeYear),
    byBloomLevel: mapAvg(byBloomLevel),
    bloomDashboard,
    dokDashboard,
    bnccDashboard,
    inepAxisDashboard,
    bloomDokMatrix,
    soloDashboard,
    cognitiveProfiles,
    byProfessor: isSuperuser ? mapAvg(byProfessor) : {},
    topMissedQuestions,
  }, startedAt)
}
