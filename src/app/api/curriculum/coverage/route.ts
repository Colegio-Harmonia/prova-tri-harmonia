import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import {
  curriculumPlans,
  curriculumPlanSkills,
  curriculumPlanUnits,
  curriculumPlanVersions,
  examCorrections,
  generatedExams,
} from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { calculateCurriculumCoverage, type CoverageQuestion } from '@/lib/curriculum/coverage'
import { enrichBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { officialVersion } from '@/lib/curriculum/planningPolicy'
import { answerGradeOnTen } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import type { Segment } from '@/types/exam'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

function integerParam(request: NextRequest, name: string) {
  const value = Number(request.nextUrl.searchParams.get(name))
  return Number.isInteger(value) ? value : null
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) return NextResponse.json({ error: 'Acesso restrito à gestão.' }, { status: 403 })

  const academicYear = integerParam(request, 'academicYear')
  const gradeYear = integerParam(request, 'gradeYear')
  const bimester = integerParam(request, 'bimester')
  const segment = request.nextUrl.searchParams.get('segment') as Segment | null
  const subject = request.nextUrl.searchParams.get('subject')?.trim()
  if (!academicYear || !gradeYear || !bimester || !segment || !subject) {
    return NextResponse.json({ error: 'Informe ano letivo, segmento, série, disciplina e bimestre.' }, { status: 400 })
  }

  const [plan] = await db.select().from(curriculumPlans).where(and(
    eq(curriculumPlans.academicYear, academicYear),
    eq(curriculumPlans.segment, segment),
    eq(curriculumPlans.gradeYear, gradeYear),
    eq(curriculumPlans.subject, subject),
    eq(curriculumPlans.bimester, bimester),
  )).limit(1)

  if (!plan) return NextResponse.json({ planFound: false, error: 'Ainda não há fotografia do planejamento para este recorte.' }, { status: 404 })

  // Versão oficial (aprovada/encerrada) quando existe; senão a mais recente.
  const versions = await db.select().from(curriculumPlanVersions)
    .where(eq(curriculumPlanVersions.planId, plan.id))
    .orderBy(desc(curriculumPlanVersions.versionNumber))
  const version = officialVersion(versions) ?? versions[0]

  if (!version) return NextResponse.json({ planFound: false, error: 'O planejamento existe, mas ainda não possui versão.' }, { status: 404 })

  const storedPlannedSkills = await db.select({ code: curriculumPlanSkills.code, description: curriculumPlanSkills.description })
    .from(curriculumPlanSkills)
    .innerJoin(curriculumPlanUnits, eq(curriculumPlanSkills.unitId, curriculumPlanUnits.id))
    .where(eq(curriculumPlanUnits.versionId, version.id))
  const plannedSkills = await enrichBnccDescriptions(storedPlannedSkills)

  const exams = await db.select({ id: generatedExams.id, generationPayload: generatedExams.generationPayload })
    .from(generatedExams)
    .where(and(
      eq(generatedExams.academicYear, academicYear),
      eq(generatedExams.segment, segment),
      eq(generatedExams.gradeYear, gradeYear),
      eq(generatedExams.subject, subject),
      eq(generatedExams.bimester, bimester),
      eq(generatedExams.examKind, 'prova'),
    ))

  const answersByQuestion = new Map<string, number>()
  if (exams.length > 0) {
    const corrections = await db.select({ examId: examCorrections.examId, answers: examCorrections.answers })
      .from(examCorrections)
      .where(and(
        inArray(examCorrections.examId, exams.map((exam) => exam.id)),
        eq(examCorrections.status, 'revisado'),
        eq(examCorrections.attendanceStatus, 'presente'),
      ))
    for (const correction of corrections) {
      const answers = Array.isArray(correction.answers) ? correction.answers as CorrectionAnswer[] : []
      for (const answer of answers) {
        if (answerGradeOnTen(answer) === null) continue
        const key = `${correction.examId}:${answer.questionNumber}`
        answersByQuestion.set(key, (answersByQuestion.get(key) ?? 0) + 1)
      }
    }
  }

  const questions: CoverageQuestion[] = []
  for (const exam of exams) {
    const payload = exam.generationPayload as ExamGenerationResult
    for (const question of payload.questions ?? []) {
      const key = `${exam.id}:${question.number}`
      questions.push({
        key,
        codes: question.bnccStatus === 'mapeado' && Array.isArray(question.bnccCodes) ? question.bnccCodes : [],
        evaluatedAnswerCount: answersByQuestion.get(key) ?? 0,
      })
    }
  }

  return NextResponse.json({
    planFound: true,
    plan: { id: plan.id, versionId: version.id, versionNumber: version.versionNumber, status: version.status },
    scope: { academicYear, segment, gradeYear, subject, bimester },
    examCount: exams.length,
    ...calculateCurriculumCoverage(plannedSkills, questions),
  })
}
