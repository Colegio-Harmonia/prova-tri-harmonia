import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import {
  curriculumPlans,
  curriculumPlanSkills,
  curriculumPlanUnits,
  curriculumPlanVersions,
  examCorrections,
  generatedExams,
  users,
} from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import { calculateStudentMastery, consolidateMastery, MASTERY_LEVELS, MASTERY_RULES, type MasteryEvidenceItem, type MasteryLevel, type PlannedMasterySkill } from '@/lib/curriculum/studentMastery'
import { enrichBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import type { CorrectionAnswer } from '@/types/correction'
import type { Segment } from '@/types/exam'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

function canonicalSubject(subject: string) {
  const normalized = subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
  return normalized === 'lingua portuguesa' ? 'portugues' : normalized
}

function scopeKey(scope: { academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number }) {
  return `${scope.academicYear}:${scope.segment}:${scope.gradeYear}:${canonicalSubject(scope.subject)}:${scope.bimester}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const studentName = params.get('student')?.trim()
  const classroomStudentId = params.get('studentId')?.trim()
  if (!studentName && !classroomStudentId) return NextResponse.json({ error: 'Informe o aluno.' }, { status: 400 })

  const isSuperuser = isStaffSuperuser(currentUser.role)
  const conditions = [
    eq(examCorrections.status, 'revisado'),
    eq(examCorrections.attendanceStatus, 'presente'),
    eq(generatedExams.examKind, 'prova'),
  ]
  if (!isSuperuser) conditions.push(eq(generatedExams.assignedTo, currentUser.id))
  else if (params.get('assignedTo')) conditions.push(eq(generatedExams.assignedTo, Number(params.get('assignedTo'))))

  const subject = params.get('subject')
  const gradeYear = params.get('gradeYear')
  const segment = params.get('segment')
  const academicYear = params.get('academicYear')
  const bimester = params.get('bimester')
  const classroomCourseId = params.get('classroomCourseId')
  const examId = params.get('examId')
  if (subject) conditions.push(eq(generatedExams.subject, subject))
  if (gradeYear) conditions.push(eq(generatedExams.gradeYear, Number(gradeYear)))
  if (segment) conditions.push(eq(generatedExams.segment, segment as Segment))
  if (academicYear) conditions.push(eq(generatedExams.academicYear, Number(academicYear)))
  if (bimester) conditions.push(eq(generatedExams.bimester, Number(bimester)))
  if (classroomCourseId) conditions.push(eq(generatedExams.classroomCourseId, classroomCourseId))
  if (examId) conditions.push(eq(generatedExams.id, Number(examId)))
  if (classroomStudentId) conditions.push(eq(examCorrections.classroomStudentId, classroomStudentId))
  else if (studentName) conditions.push(eq(examCorrections.studentName, studentName))

  const corrections = await db.select({
    examId: generatedExams.id,
    academicYear: generatedExams.academicYear,
    segment: generatedExams.segment,
    gradeYear: generatedExams.gradeYear,
    subject: generatedExams.subject,
    bimester: generatedExams.bimester,
    generationPayload: generatedExams.generationPayload,
    answers: examCorrections.answers,
  }).from(examCorrections).innerJoin(generatedExams, eq(examCorrections.examId, generatedExams.id)).where(and(...conditions))

  const evidence: MasteryEvidenceItem[] = []
  const observedScopes = new Map<string, { academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number }>()
  for (const correction of corrections) {
    if (!correction.bimester) continue
    const scope = { academicYear: correction.academicYear, segment: correction.segment, gradeYear: correction.gradeYear, subject: correction.subject, bimester: correction.bimester }
    observedScopes.set(scopeKey(scope), scope)
    const payload = correction.generationPayload as ExamGenerationResult
    const questions = new Map((payload.questions ?? []).map((question) => [question.number, question]))
    const answers = Array.isArray(correction.answers) ? correction.answers as CorrectionAnswer[] : []
    for (const answer of answers) {
      const question = questions.get(answer.questionNumber)
      if (!question || question.bnccStatus !== 'mapeado') continue
      // Resposta ainda sem correção não é evidência (nem acerto nem erro).
      const graded = answer.type === 'objetiva' ? answer.isCorrect !== null : answer.finalGrade !== null
      if (!graded) continue
      const possiblePoints = questionMaxGrade({ weight: answer.weight ?? question.weight })
      const earnedPoints = answer.type === 'objetiva' ? (answer.isCorrect ? possiblePoints : 0) : Math.min(Math.max(answer.finalGrade ?? 0, 0), possiblePoints)
      const codes = [...new Set((question.bnccCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))]
      for (const code of codes) evidence.push({ ...scope, code, description: question.bnccSummary ?? null, examId: correction.examId, questionNumber: answer.questionNumber, earnedPoints, possiblePoints })
    }
  }

  const plannedSkills: PlannedMasterySkill[] = []
  const years = [...new Set([...observedScopes.values()].map((scope) => scope.academicYear))]
  if (years.length > 0) {
    const planRows = await db.select({
      planId: curriculumPlans.id,
      academicYear: curriculumPlans.academicYear,
      segment: curriculumPlans.segment,
      gradeYear: curriculumPlans.gradeYear,
      subject: curriculumPlans.subject,
      bimester: curriculumPlans.bimester,
      versionNumber: curriculumPlanVersions.versionNumber,
      code: curriculumPlanSkills.code,
      description: curriculumPlanSkills.description,
      targetMasteryPercent: curriculumPlanSkills.targetMasteryPercent,
    }).from(curriculumPlans)
      .innerJoin(curriculumPlanVersions, eq(curriculumPlanVersions.planId, curriculumPlans.id))
      .innerJoin(curriculumPlanUnits, eq(curriculumPlanUnits.versionId, curriculumPlanVersions.id))
      .innerJoin(curriculumPlanSkills, eq(curriculumPlanSkills.unitId, curriculumPlanUnits.id))
      .where(inArray(curriculumPlans.academicYear, years))

    const latestVersion = new Map<number, number>()
    for (const row of planRows) latestVersion.set(row.planId, Math.max(latestVersion.get(row.planId) ?? 0, row.versionNumber))
    const unique = new Set<string>()
    for (const row of planRows) {
      if (row.versionNumber !== latestVersion.get(row.planId)) continue
      const matchingScope = observedScopes.get(scopeKey(row))
      if (!matchingScope) continue
      const skillKey = `${row.planId}:${row.code.trim().toUpperCase()}`
      if (unique.has(skillKey)) continue
      unique.add(skillKey)
      plannedSkills.push({ ...matchingScope, code: row.code, description: row.description, targetMasteryPercent: row.targetMasteryPercent })
    }
  }

  const rows = calculateStudentMastery(await enrichBnccDescriptions(plannedSkills), evidence)
  const levelCounts = Object.fromEntries(MASTERY_LEVELS.map((level) => [level, rows.filter((row) => row.level === level).length])) as Record<MasteryLevel, number>
  return NextResponse.json({
    rows,
    consolidated: consolidateMastery(rows, evidence),
    summary: {
      plannedSkillCount: rows.filter((row) => row.planned).length,
      observedSkillCount: rows.filter((row) => row.itemCount > 0).length,
      outsidePlanCount: rows.filter((row) => !row.planned).length,
      limitedBySampleCount: rows.filter((row) => row.limitedBySample).length,
      levelCounts,
    },
    rules: MASTERY_RULES,
  })
}
