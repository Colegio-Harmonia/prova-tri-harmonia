// Carregamento de evidências BNCC a partir das correções revisadas, comum ao
// domínio individual (Bloco 4) e à trajetória do aluno/turma (Bloco 6).
// Mantém num lugar só o escopo de acesso: professor só vê provas atribuídas
// a ele; coordenação/direção veem tudo (ou filtram por professor).

import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans, curriculumPlanSkills, curriculumPlanUnits, curriculumPlanVersions, examCorrections, generatedExams } from '@/db/schema'
import { isStaffSuperuser, type UserRole } from '@/lib/auth/roles'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import type { Segment } from '@/types/exam'
import type { MasteryEvidenceItem, MasteryScope, PlannedMasterySkill } from './studentMastery'

export type EvidenceWithContext = MasteryEvidenceItem & {
  /** Identificador estável do aluno: id do Classroom quando existe, senão o nome. */
  studentKey: string
  /** Data de referência da avaliação (aplicação > correção > criação), ISO. */
  assessedAt: string
}

export function canonicalSubject(subject: string) {
  const normalized = subject.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase('pt-BR')
  return normalized === 'lingua portuguesa' ? 'portugues' : normalized
}

export function scopeKey(scope: MasteryScope) {
  return `${scope.academicYear}:${scope.segment}:${scope.gradeYear}:${canonicalSubject(scope.subject)}:${scope.bimester}`
}

type Viewer = { id: number; role: UserRole | string }

/** Filtros aceitos via query string; `studentId`/`student` restringem a um aluno. */
export function evidenceConditions(viewer: Viewer, params: URLSearchParams): SQL[] {
  const conditions: SQL[] = [
    eq(examCorrections.status, 'revisado'),
    eq(examCorrections.attendanceStatus, 'presente'),
    eq(generatedExams.examKind, 'prova'),
  ]
  if (!isStaffSuperuser(viewer.role as UserRole)) conditions.push(eq(generatedExams.assignedTo, viewer.id))
  else if (params.get('assignedTo')) conditions.push(eq(generatedExams.assignedTo, Number(params.get('assignedTo'))))

  const subject = params.get('subject')
  const gradeYear = params.get('gradeYear')
  const segment = params.get('segment')
  const academicYear = params.get('academicYear')
  const bimester = params.get('bimester')
  const classroomCourseId = params.get('classroomCourseId')
  const examId = params.get('examId')
  const classroomStudentId = params.get('studentId')?.trim()
  const studentName = params.get('student')?.trim()
  if (subject) conditions.push(eq(generatedExams.subject, subject))
  if (gradeYear) conditions.push(eq(generatedExams.gradeYear, Number(gradeYear)))
  if (segment) conditions.push(eq(generatedExams.segment, segment as Segment))
  if (academicYear) conditions.push(eq(generatedExams.academicYear, Number(academicYear)))
  if (bimester) conditions.push(eq(generatedExams.bimester, Number(bimester)))
  if (classroomCourseId) conditions.push(eq(generatedExams.classroomCourseId, classroomCourseId))
  if (examId) conditions.push(eq(generatedExams.id, Number(examId)))
  if (classroomStudentId) conditions.push(eq(examCorrections.classroomStudentId, classroomStudentId))
  else if (studentName) conditions.push(eq(examCorrections.studentName, studentName))
  return conditions
}

export async function loadEvidence(conditions: SQL[]): Promise<{ evidence: EvidenceWithContext[]; scopes: Map<string, MasteryScope> }> {
  const corrections = await db.select({
    examId: generatedExams.id,
    academicYear: generatedExams.academicYear,
    segment: generatedExams.segment,
    gradeYear: generatedExams.gradeYear,
    subject: generatedExams.subject,
    bimester: generatedExams.bimester,
    appliedAt: generatedExams.appliedAt,
    correctedAt: generatedExams.correctedAt,
    createdAt: generatedExams.createdAt,
    generationPayload: generatedExams.generationPayload,
    answers: examCorrections.answers,
    classroomStudentId: examCorrections.classroomStudentId,
    studentName: examCorrections.studentName,
  }).from(examCorrections).innerJoin(generatedExams, eq(examCorrections.examId, generatedExams.id)).where(and(...conditions))

  const evidence: EvidenceWithContext[] = []
  const scopes = new Map<string, MasteryScope>()
  for (const correction of corrections) {
    if (!correction.bimester) continue
    const scope = { academicYear: correction.academicYear, segment: correction.segment, gradeYear: correction.gradeYear, subject: correction.subject, bimester: correction.bimester }
    scopes.set(scopeKey(scope), scope)
    const studentKey = correction.classroomStudentId ? `classroom:${correction.classroomStudentId}` : `nome:${correction.studentName}`
    const assessedAt = (correction.appliedAt ?? correction.correctedAt ?? correction.createdAt).toISOString()
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
      for (const code of codes) evidence.push({ ...scope, code, description: question.bnccSummary ?? null, examId: correction.examId, questionNumber: answer.questionNumber, earnedPoints, possiblePoints, studentKey, assessedAt })
    }
  }
  return { evidence, scopes }
}

/**
 * Habilidades da versão mais recente de cada planejamento. `match` decide que
 * planos entram: por padrão, só os recortes (ano/segmento/série/disciplina/
 * bimestre) em que houve avaliação; a trajetória usa todos os bimestres das
 * disciplinas avaliadas no ano, para medir cobertura acumulada.
 */
export async function loadPlannedSkills(years: number[], match: (plan: MasteryScope) => MasteryScope | null): Promise<PlannedMasterySkill[]> {
  if (!years.length) return []
  const planRows = await db.select({
    planId: curriculumPlans.id,
    academicYear: curriculumPlans.academicYear,
    segment: curriculumPlans.segment,
    gradeYear: curriculumPlans.gradeYear,
    subject: curriculumPlans.subject,
    bimester: curriculumPlans.bimester,
    versionNumber: curriculumPlanVersions.versionNumber,
    status: curriculumPlanVersions.status,
    code: curriculumPlanSkills.code,
    description: curriculumPlanSkills.description,
    targetMasteryPercent: curriculumPlanSkills.targetMasteryPercent,
  }).from(curriculumPlans)
    .innerJoin(curriculumPlanVersions, eq(curriculumPlanVersions.planId, curriculumPlans.id))
    .innerJoin(curriculumPlanUnits, eq(curriculumPlanUnits.versionId, curriculumPlanVersions.id))
    .innerJoin(curriculumPlanSkills, eq(curriculumPlanSkills.unitId, curriculumPlanUnits.id))
    .where(inArray(curriculumPlans.academicYear, years))

  // Versão oficial (aprovada/encerrada mais recente) de cada planejamento; sem
  // nenhuma aprovada (ex.: fotografias de 2026 importadas), vale a mais recente.
  const latestVersion = new Map<number, number>()
  const officialNumber = new Map<number, number>()
  for (const row of planRows) {
    latestVersion.set(row.planId, Math.max(latestVersion.get(row.planId) ?? 0, row.versionNumber))
    if (row.status === 'aprovado' || row.status === 'encerrado') officialNumber.set(row.planId, Math.max(officialNumber.get(row.planId) ?? 0, row.versionNumber))
  }
  for (const [planId, versionNumber] of officialNumber) latestVersion.set(planId, versionNumber)
  const unique = new Set<string>()
  const planned: PlannedMasterySkill[] = []
  for (const row of planRows) {
    if (row.versionNumber !== latestVersion.get(row.planId)) continue
    const scope = match(row)
    if (!scope) continue
    const skillKey = `${row.planId}:${row.code.trim().toUpperCase()}`
    if (unique.has(skillKey)) continue
    unique.add(skillKey)
    planned.push({ ...scope, code: row.code, description: row.description, targetMasteryPercent: row.targetMasteryPercent })
  }
  return planned
}
