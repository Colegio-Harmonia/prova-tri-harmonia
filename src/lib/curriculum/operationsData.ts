// Dados da operação institucional (Bloco 8): provas, correções e
// intervenções de um recorte (ano, segmento, série, disciplina, bimestre).

import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans, curriculumPlanSkills, curriculumPlanUnits, curriculumPlanVersions, examCorrections, generatedExams, pedagogicalInterventions } from '@/db/schema'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import { calculateCurriculumCoverage, type CoverageQuestion } from './coverage'
import { canonicalSubject } from './masteryData'
import type { SkillSignal } from './operations'
import { officialVersion } from './planningPolicy'

export type Scope = { academicYear: number; segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'; gradeYear: number; subject: string; bimester: number }

/** Habilidades da versão oficial (ou mais recente, se nenhuma aprovada) de cada planejamento. */
export async function plannedSkillsByPlan(planIds: number[]) {
  const result = new Map<number, Array<{ code: string; description: string | null }>>()
  if (!planIds.length) return result
  const versions = await db.select({ id: curriculumPlanVersions.id, planId: curriculumPlanVersions.planId, versionNumber: curriculumPlanVersions.versionNumber, status: curriculumPlanVersions.status })
    .from(curriculumPlanVersions).where(inArray(curriculumPlanVersions.planId, planIds))
  const chosen = new Map<number, number>()
  for (const planId of planIds) {
    const planVersions = versions.filter((version) => version.planId === planId)
    const version = officialVersion(planVersions) ?? planVersions.sort((a, b) => b.versionNumber - a.versionNumber)[0]
    if (version) chosen.set(version.id, planId)
  }
  if (!chosen.size) return result
  const skills = await db.select({ versionId: curriculumPlanUnits.versionId, code: curriculumPlanSkills.code, description: curriculumPlanSkills.description })
    .from(curriculumPlanSkills).innerJoin(curriculumPlanUnits, eq(curriculumPlanUnits.id, curriculumPlanSkills.unitId))
    .where(inArray(curriculumPlanUnits.versionId, [...chosen.keys()])).orderBy(asc(curriculumPlanUnits.position), asc(curriculumPlanSkills.position))
  for (const skill of skills) {
    const planId = chosen.get(skill.versionId)!
    const list = result.get(planId) ?? []
    if (!list.some((item) => item.code === skill.code)) list.push({ code: skill.code, description: skill.description })
    result.set(planId, list)
  }
  return result
}

/** Planejamento do recorte de uma prova (disciplina comparada de forma canônica). */
export async function findPlanForScope(scope: Scope) {
  const candidates = await db.select().from(curriculumPlans).where(and(
    eq(curriculumPlans.academicYear, scope.academicYear), eq(curriculumPlans.segment, scope.segment),
    eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.bimester, scope.bimester),
  ))
  return candidates.find((plan) => canonicalSubject(plan.subject) === canonicalSubject(scope.subject)) ?? null
}

type ExamFilter = { academicYear: number; segment?: Scope['segment']; gradeYear?: number; bimester?: number }

/** Provas + correções revisadas do recorte, já com cobertura por questão e evidência por habilidade. */
export async function loadScopeEvidence(filter: ExamFilter, subjectMatch?: string) {
  const conditions: SQL[] = [eq(generatedExams.academicYear, filter.academicYear), eq(generatedExams.examKind, 'prova')]
  if (filter.segment) conditions.push(eq(generatedExams.segment, filter.segment))
  if (filter.gradeYear) conditions.push(eq(generatedExams.gradeYear, filter.gradeYear))
  if (filter.bimester) conditions.push(eq(generatedExams.bimester, filter.bimester))
  const exams = (await db.select({ id: generatedExams.id, segment: generatedExams.segment, gradeYear: generatedExams.gradeYear, subject: generatedExams.subject, bimester: generatedExams.bimester, payload: generatedExams.generationPayload })
    .from(generatedExams).where(and(...conditions)))
    .filter((exam) => !subjectMatch || canonicalSubject(exam.subject) === canonicalSubject(subjectMatch))
  const corrections = exams.length ? await db.select({ examId: examCorrections.examId, answers: examCorrections.answers, studentKey: examCorrections.classroomStudentId, studentName: examCorrections.studentName })
    .from(examCorrections).where(and(inArray(examCorrections.examId, exams.map((exam) => exam.id)), eq(examCorrections.status, 'revisado'), eq(examCorrections.attendanceStatus, 'presente'))) : []

  const answered = new Map<string, number>()
  const perCode = new Map<string, { earned: number; possible: number; items: number; students: Set<string> }>()
  const byExam = new Map(exams.map((exam) => [exam.id, exam]))
  for (const correction of corrections) {
    const exam = byExam.get(correction.examId)!
    const questions = new Map(((exam.payload as ExamGenerationResult).questions ?? []).map((question) => [question.number, question]))
    const student = correction.studentKey ? `c:${correction.studentKey}` : `n:${correction.studentName}`
    for (const answer of Array.isArray(correction.answers) ? correction.answers as CorrectionAnswer[] : []) {
      const graded = answer.type === 'objetiva' ? answer.isCorrect !== null : answer.finalGrade !== null
      if (!graded) continue
      const key = `${exam.id}:${answer.questionNumber}`
      answered.set(key, (answered.get(key) ?? 0) + 1)
      const question = questions.get(answer.questionNumber)
      if (!question || question.bnccStatus !== 'mapeado') continue
      const possible = questionMaxGrade({ weight: answer.weight ?? question.weight })
      const earned = answer.type === 'objetiva' ? (answer.isCorrect ? possible : 0) : Math.min(Math.max(answer.finalGrade ?? 0, 0), possible)
      for (const code of new Set((question.bnccCodes ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean))) {
        const entry = perCode.get(code) ?? { earned: 0, possible: 0, items: 0, students: new Set<string>() }
        entry.earned += earned; entry.possible += possible; entry.items++; entry.students.add(student)
        perCode.set(code, entry)
      }
    }
  }
  const questions = (scopeExams: typeof exams): CoverageQuestion[] => scopeExams.flatMap((exam) => ((exam.payload as ExamGenerationResult).questions ?? []).map((question) => ({
    key: `${exam.id}:${question.number}`,
    codes: question.bnccStatus === 'mapeado' && Array.isArray(question.bnccCodes) ? question.bnccCodes : [],
    evaluatedAnswerCount: answered.get(`${exam.id}:${question.number}`) ?? 0,
  })))
  return { exams, questions, perCode }
}

/** Sinais por habilidade (planejada ou avaliada) para sugestões e painel. */
export function skillSignals(planned: Array<{ code: string; description: string | null }>, evidence: Awaited<ReturnType<typeof loadScopeEvidence>>): SkillSignal[] {
  const coverage = calculateCurriculumCoverage(planned, evidence.questions(evidence.exams))
  return coverage.rows.map((row) => {
    const stats = evidence.perCode.get(row.code)
    return {
      code: row.code, description: row.description, planned: row.planned,
      evaluated: row.evaluatedAnswerCount > 0,
      percent: stats && stats.possible > 0 ? Math.round((stats.earned / stats.possible) * 1000) / 10 : null,
      itemCount: stats?.items ?? 0,
      studentCount: stats?.students.size ?? 0,
    }
  })
}

export async function interventionsForScope(scope: Pick<Scope, 'academicYear' | 'segment' | 'gradeYear' | 'subject'> & { bimester?: number }) {
  const rows = await db.select().from(pedagogicalInterventions).where(and(
    eq(pedagogicalInterventions.segment, scope.segment), eq(pedagogicalInterventions.gradeYear, scope.gradeYear),
  ))
  return rows.filter((row) => canonicalSubject(row.subject) === canonicalSubject(scope.subject)
    && (row.academicYear === null || row.academicYear === scope.academicYear)
    && (scope.bimester === undefined || row.bimester === null || row.bimester === scope.bimester))
}
