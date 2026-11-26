// Serviço da prova de recuperação individualizada (18/11/2026). Regras puras
// em ./recoveryPlan.ts; fluxo completo em docs/PROVA_RECUPERACAO.md.
//
// Fluxo (o mesmo da tela Gerar prova, por aluno): lote (turma + disciplina +
// período) com a Composição (origem, total, proporção de alternativas) →
// professor marca alunos → cada um ganha a Matriz por capítulo montada das
// habilidades abaixo de 60% (status 'planejado') → Conferência: o professor
// ajusta a matriz de cada aluno → "Gerar provas" enfileira um job
// 'gerar_prova' por aluno, a partir do Planejamento aprovado do período, com
// as questões de cada capítulo restritas às habilidades fracas → o worker
// grava a prova como 'recuperacao' e a liga ao aluno → professor revisa e
// envia o lote → coordenação/direção aprova (gera os Docs) → fila de
// impressão por sala.

import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans, curriculumPlanVersions, generatedExams, generationJobs, recoveryRounds, recoveryStudents, type RecoveryContentPlanItem, type RecoveryRoundStatus, type RecoverySkill } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { calculateStudentMastery } from '@/lib/curriculum/studentMastery'
import { canonicalSubject, evidenceConditions, loadEvidence } from '@/lib/curriculum/masteryData'
import { PLAN_VERSION_STATUS_FOR_GENERATION } from '@/lib/curriculum/planCurriculum'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { gerarProvaJobPayloadSchema } from '@/lib/queue/types'
import { generateExamDocs } from '@/lib/docs/generateExamDocs'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { buildRecoveryContentPlan, evidenceForPeriod, periodBimesters, periodLabel, RECOVERY_RULES, selectRecoverySkills, validateRecoveryContentPlan, type RecoveryUnit } from './recoveryPlan'

export class RecoveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type Viewer = { id: number; role: string }
export type RosterStudent = { classroomStudentId: string; name: string; email: string | null }
type Round = typeof recoveryRounds.$inferSelect
export type RecoveryComposition = { questionSource: 'acervo' | 'ia'; objectivePercentage: number; questionCount: number }

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

/** Disciplinas da turma e o recorte (segmento/série/ano letivo) de cada uma, a partir das provas vinculadas. */
export async function courseSubjects(classroomCourseId: string, viewer: Viewer) {
  const exams = await db.select({ subject: generatedExams.subject, segment: generatedExams.segment, gradeYear: generatedExams.gradeYear, academicYear: generatedExams.academicYear, createdAt: generatedExams.createdAt })
    .from(generatedExams)
    .where(and(
      eq(generatedExams.examKind, 'prova'),
      eq(generatedExams.classroomCourseId, classroomCourseId),
      ...(!isStaffSuperuser(viewer.role) ? [eq(generatedExams.assignedTo, viewer.id)] : []),
    ))
    .orderBy(desc(generatedExams.createdAt))
  const bySubject = new Map<string, { subject: string; segment: Round['segment']; gradeYear: number; academicYear: number }>()
  for (const exam of exams) if (!bySubject.has(exam.subject)) bySubject.set(exam.subject, { subject: exam.subject, segment: exam.segment, gradeYear: exam.gradeYear, academicYear: exam.academicYear })
  return [...bySubject.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'))
}

function clampComposition(input: Partial<RecoveryComposition>): RecoveryComposition {
  return {
    questionSource: input.questionSource ?? 'acervo',
    objectivePercentage: Math.min(100, Math.max(0, Math.round(input.objectivePercentage ?? RECOVERY_RULES.defaultObjectivePercentage))),
    questionCount: Math.min(RECOVERY_RULES.maxQuestions, Math.max(RECOVERY_RULES.minQuestions, input.questionCount ?? RECOVERY_RULES.defaultQuestions)),
  }
}

export async function openRound(input: { classroomCourseId: string; classLabel: string; subject: string; bimester: number | null; semester?: number | null } & Partial<RecoveryComposition>, viewer: Viewer): Promise<Round> {
  const semester = input.bimester ? null : (input.semester ?? null)
  const scope = (await courseSubjects(input.classroomCourseId, viewer)).find((item) => item.subject === input.subject)
  if (!scope) throw new RecoveryError('Esta turma não tem prova da disciplina vinculada a você. A recuperação usa as correções dessas provas para achar as habilidades fracas.', 422)
  const existing = await db.query.recoveryRounds.findFirst({ where: (table, { and, eq, isNull }) => and(
    eq(table.classroomCourseId, input.classroomCourseId), eq(table.academicYear, scope.academicYear), eq(table.subject, input.subject),
    input.bimester === null ? isNull(table.bimester) : eq(table.bimester, input.bimester),
    semester === null ? isNull(table.semester) : eq(table.semester, semester),
  ) })
  if (existing) {
    assertRoundAccess(existing, viewer)
    return existing
  }
  const [created] = await db.insert(recoveryRounds).values({
    classroomCourseId: input.classroomCourseId,
    classLabel: input.classLabel.trim().slice(0, 160) || input.classroomCourseId,
    academicYear: scope.academicYear,
    segment: scope.segment,
    gradeYear: scope.gradeYear,
    subject: input.subject,
    bimester: input.bimester,
    semester,
    ...clampComposition(input),
    createdBy: viewer.id,
  }).returning()
  return created!
}

export function assertRoundAccess(round: Round, viewer: Viewer) {
  if (!isStaffSuperuser(viewer.role) && round.createdBy !== viewer.id) throw new RecoveryError('Você não tem permissão para acessar este lote de recuperação.', 403)
}

export async function getRound(roundId: number, viewer: Viewer): Promise<Round> {
  const round = await db.query.recoveryRounds.findFirst({ where: eq(recoveryRounds.id, roundId) })
  if (!round) throw new RecoveryError('Lote de recuperação não encontrado.', 404)
  assertRoundAccess(round, viewer)
  return round
}

function assertEditable(round: Round) {
  if (round.status !== 'aberto') throw new RecoveryError('O lote já foi enviado para aprovação. Peça à coordenação para devolvê-lo antes de mudar os alunos.', 409)
}

export async function listRounds(viewer: Viewer, filters: { classroomCourseId?: string; statuses?: RecoveryRoundStatus[] } = {}) {
  const rounds = await db.select().from(recoveryRounds).where(and(
    ...(filters.classroomCourseId ? [eq(recoveryRounds.classroomCourseId, filters.classroomCourseId)] : []),
    ...(filters.statuses?.length ? [inArray(recoveryRounds.status, filters.statuses)] : []),
    ...(!isStaffSuperuser(viewer.role) ? [eq(recoveryRounds.createdBy, viewer.id)] : []),
  )).orderBy(asc(recoveryRounds.classLabel), asc(recoveryRounds.subject), desc(recoveryRounds.createdAt))
  if (!rounds.length) return []
  const students = await db.select({ roundId: recoveryStudents.roundId, status: recoveryStudents.status }).from(recoveryStudents).where(inArray(recoveryStudents.roundId, rounds.map((round) => round.id)))
  return rounds.map((round) => {
    const mine = students.filter((student) => student.roundId === round.id && student.status !== 'removido')
    return { ...round, studentCount: mine.length, readyCount: mine.filter((student) => student.status === 'gerada').length, generatingCount: mine.filter((student) => student.status === 'gerando').length }
  })
}

// ---------------------------------------------------------------------------
// Planejamento do período (capítulos)
// ---------------------------------------------------------------------------

export type RecoveryChapter = RecoveryUnit & { title: string; content: string | null; bimester: number | null }

/**
 * Capítulos do Planejamento aprovado do período (um planejamento por
 * bimestre; semestre e ano juntam vários). É a mesma seleção que a geração
 * usa, então o rowIndex da matriz é o mesmo nos dois lados.
 */
export async function roundCurriculum(round: Round) {
  const bimesters = periodBimesters(round)
  const plans = await db.select({ id: curriculumPlans.id, bimester: curriculumPlans.bimester })
    .from(curriculumPlans)
    .innerJoin(curriculumPlanVersions, eq(curriculumPlanVersions.planId, curriculumPlans.id))
    .where(and(
      eq(curriculumPlans.academicYear, round.academicYear), eq(curriculumPlans.segment, round.segment),
      eq(curriculumPlans.gradeYear, round.gradeYear), eq(curriculumPlans.subject, round.subject),
      eq(curriculumPlanVersions.status, PLAN_VERSION_STATUS_FOR_GENERATION),
      ...(bimesters ? [inArray(curriculumPlans.bimester, bimesters)] : []),
    ))
  const planIds = [...new Set(plans.sort((a, b) => a.bimester - b.bimester || a.id - b.id).map((plan) => plan.id))]
  if (!planIds.length) throw new RecoveryError(`Não há planejamento aprovado de ${round.subject} (${round.gradeYear}º ano) em ${periodLabel(round.bimester, round.semester).toLowerCase()}. A recuperação gera a partir do Planejamento, como a prova bimestral.`, 422)
  const selection = await getCurriculumForExam({
    segment: round.segment, gradeYear: round.gradeYear, subject: round.subject, academicYear: round.academicYear,
    ...(planIds.length === 1 ? { curriculumPlanId: planIds[0], ...(round.bimester ? { bimester: round.bimester } : {}) } : { curriculumPlanIds: planIds }),
  })
  const chapters: RecoveryChapter[] = selection.units.map((unit) => ({
    rowIndex: unit.rowIndex,
    title: unit.tituloCapitulo || 'Capítulo sem título',
    content: unit.conteudo || null,
    bimester: unit.bimestre ? Number(unit.bimestre) || null : null,
    codes: unit.habilidades.status === 'mapeado' ? unit.habilidades.skills.map((skill) => skill.code.toUpperCase()) : [],
  }))
  return { planIds, chapters }
}

// ---------------------------------------------------------------------------
// Diagnóstico: habilidades fracas por aluno
// ---------------------------------------------------------------------------

/** Habilidades fracas e insuficientes de cada aluno, lidas das correções revisadas que o usuário pode ver. */
export async function diagnoseStudents(round: Round, viewer: Viewer) {
  const params = new URLSearchParams({ subject: round.subject, gradeYear: String(round.gradeYear), academicYear: String(round.academicYear), segment: round.segment })
  const { evidence } = await loadEvidence(evidenceConditions(viewer, params))
  const subject = canonicalSubject(round.subject)
  const scoped = evidenceForPeriod(evidence.filter((item) => canonicalSubject(item.subject) === subject), round)
  const byStudent = new Map<string, typeof scoped>()
  for (const item of scoped) {
    if (!item.studentKey.startsWith('classroom:')) continue
    const id = item.studentKey.slice('classroom:'.length)
    byStudent.set(id, [...(byStudent.get(id) ?? []), item])
  }
  const result = new Map<string, { weak: RecoverySkill[]; insufficient: RecoverySkill[] }>()
  for (const [studentId, items] of byStudent) result.set(studentId, selectRecoverySkills(calculateStudentMastery([], items)))
  return result
}

// ---------------------------------------------------------------------------
// Marcação, matriz, geração e remoção
// ---------------------------------------------------------------------------

async function enqueueStudentExam(round: Round, recoveryStudentId: number, contentPlan: RecoveryContentPlanItem[], focusCodes: string[], requestedBy: number) {
  const { planIds, chapters } = await roundCurriculum(round)
  const problem = validateRecoveryContentPlan(contentPlan, chapters.map((chapter) => chapter.rowIndex), round.questionCount)
  if (problem) throw new RecoveryError(`${problem} Ajuste a matriz do aluno na Conferência (o planejamento pode ter mudado).`, 409)
  const parsed = gerarProvaJobPayloadSchema.safeParse({
    segment: round.segment,
    gradeYear: round.gradeYear,
    academicYear: round.academicYear,
    subject: round.subject,
    generationEngine: 'whole-exam-v1',
    ...(round.bimester ? { bimester: round.bimester } : {}),
    questionCount: round.questionCount,
    questionSource: round.questionSource,
    objectivePercentage: round.objectivePercentage,
    classLabel: round.classLabel.slice(0, 120),
    contentPlan: contentPlan.filter((item) => item.questionCount > 0),
    ...(planIds.length === 1 ? { curriculumPlanId: planIds[0] } : { curriculumPlanIds: planIds }),
    focusBnccCodes: focusCodes,
    recoveryStudentId,
  })
  if (!parsed.success) throw new RecoveryError(parsed.error.issues.map((issue) => issue.message).join(' '), 422)
  const [job] = await db.insert(generationJobs).values({ jobType: 'gerar_prova', payload: parsed.data, requestedBy }).returning({ id: generationJobs.id })
  return job!.id
}

/** Prova substituída ou de aluno removido sai das listas sem apagar histórico. */
async function archiveExam(examId: number | null) {
  if (examId) await db.update(generatedExams).set({ archivedAt: new Date() }).where(eq(generatedExams.id, examId))
}

/**
 * Marca alunos: lê as habilidades fracas de cada um e monta a matriz por
 * capítulo. Nada vai para a fila aqui; a geração começa na Conferência.
 */
export async function flagStudents(round: Round, students: RosterStudent[], viewer: Viewer) {
  assertEditable(round)
  if (!students.length) throw new RecoveryError('Selecione pelo menos um aluno.')
  const [diagnosis, { chapters }] = await Promise.all([diagnoseStudents(round, viewer), roundCurriculum(round)])
  const existing = await db.select().from(recoveryStudents).where(eq(recoveryStudents.roundId, round.id))
  const outcome = { planned: 0, withoutSkills: 0, alreadyFlagged: 0 }

  for (const student of students) {
    const current = existing.find((row) => row.classroomStudentId === student.classroomStudentId)
    if (current && current.status !== 'removido' && current.status !== 'sem_habilidades') { outcome.alreadyFlagged += 1; continue }
    const { weak, insufficient } = diagnosis.get(student.classroomStudentId) ?? { weak: [], insufficient: [] }
    const { contentPlan } = buildRecoveryContentPlan(chapters, weak, round.questionCount)
    const values = {
      studentName: student.name, studentEmail: student.email, weakSkills: weak, insufficientSkills: insufficient, bnccPlan: [], contentPlan,
      status: contentPlan.length ? 'planejado' as const : 'sem_habilidades' as const, examId: null, jobId: null,
      flaggedBy: viewer.id, flaggedAt: new Date(), updatedAt: new Date(),
    }
    if (current) await db.update(recoveryStudents).set(values).where(eq(recoveryStudents.id, current.id))
    else await db.insert(recoveryStudents).values({ roundId: round.id, classroomStudentId: student.classroomStudentId, ...values })
    if (contentPlan.length) outcome.planned += 1
    else outcome.withoutSkills += 1
  }
  await db.update(recoveryRounds).set({ updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
  return outcome
}

/**
 * Composição do lote (origem, total, proporção). Mudar o total refaz a
 * matriz automática de quem ainda não foi para a fila.
 */
export async function updateComposition(round: Round, input: Partial<RecoveryComposition>) {
  assertEditable(round)
  const composition = clampComposition({ questionSource: round.questionSource, objectivePercentage: round.objectivePercentage, questionCount: round.questionCount, ...input })
  await db.update(recoveryRounds).set({ ...composition, updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
  if (composition.questionCount === round.questionCount) return { replanned: 0 }
  const planned = (await activeStudents(round.id)).filter((student) => student.status === 'planejado')
  if (!planned.length) return { replanned: 0 }
  const { chapters } = await roundCurriculum(round)
  for (const student of planned) {
    const { contentPlan } = buildRecoveryContentPlan(chapters, student.weakSkills, composition.questionCount)
    await db.update(recoveryStudents).set({ contentPlan, updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
  }
  return { replanned: planned.length }
}

async function getStudent(round: Round, recoveryStudentId: number) {
  const student = await db.query.recoveryStudents.findFirst({ where: and(eq(recoveryStudents.id, recoveryStudentId), eq(recoveryStudents.roundId, round.id)) })
  if (!student) throw new RecoveryError('Aluno não encontrado neste lote.', 404)
  return student
}

/** Matriz do aluno ajustada pelo professor na Conferência. */
export async function updateStudentPlan(round: Round, recoveryStudentId: number, contentPlan: RecoveryContentPlanItem[]) {
  assertEditable(round)
  const student = await getStudent(round, recoveryStudentId)
  if (student.status !== 'planejado') throw new RecoveryError('A matriz só pode ser ajustada antes de gerar. Para refazer uma prova já gerada, use "Gerar de novo".', 409)
  const { chapters } = await roundCurriculum(round)
  const problem = validateRecoveryContentPlan(contentPlan, chapters.map((chapter) => chapter.rowIndex), round.questionCount)
  if (problem) throw new RecoveryError(problem, 422)
  await db.update(recoveryStudents).set({ contentPlan: contentPlan.filter((item) => item.questionCount > 0), updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
}

/**
 * Envia para a fila todos os alunos com matriz conferida ('planejado').
 * O job sai em nome do professor dono do lote, não de quem clicou: o worker
 * usa job.requestedBy como createdBy/assignedTo da prova, e com a direção
 * clicando o professor recebia 403 na revisão (lote 7, provas 853-856,
 * 26/11/2026).
 */
export async function generatePlanned(round: Round) {
  assertEditable(round)
  const planned = (await activeStudents(round.id)).filter((student) => student.status === 'planejado')
  if (!planned.length) throw new RecoveryError('Nenhum aluno com matriz pronta para gerar.', 409)
  for (const student of planned) {
    const jobId = await enqueueStudentExam(round, student.id, student.contentPlan, student.weakSkills.map((skill) => skill.code), round.createdBy)
    await db.update(recoveryStudents).set({ status: 'gerando', jobId, examId: null, updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
  }
  return { queued: planned.length }
}

/**
 * Volta o aluno para a Conferência (matriz editável) e arquiva a prova atual.
 * Lote antigo sem matriz por capítulo ganha a matriz automática.
 */
export async function regenerateStudent(round: Round, recoveryStudentId: number) {
  assertEditable(round)
  const student = await getStudent(round, recoveryStudentId)
  if (!student.weakSkills.length) throw new RecoveryError('Este aluno não tem habilidade abaixo de 60% no período; não há prova a gerar.', 422)
  let contentPlan = student.contentPlan
  if (!contentPlan.length) contentPlan = buildRecoveryContentPlan((await roundCurriculum(round)).chapters, student.weakSkills, round.questionCount).contentPlan
  await archiveExam(student.examId)
  await db.update(recoveryStudents).set({ status: contentPlan.length ? 'planejado' : 'sem_habilidades', contentPlan, examId: null, jobId: null, updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
}

export async function removeStudent(round: Round, recoveryStudentId: number) {
  assertEditable(round)
  const student = await getStudent(round, recoveryStudentId)
  await archiveExam(student.examId)
  await db.update(recoveryStudents).set({ status: 'removido', examId: null, updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
}

/**
 * Chamado pelo worker ao concluir o job. Só liga a prova se o job ainda é o
 * vigente do aluno: um job antigo (aluno regenerado ou removido) arquiva a
 * própria prova em vez de sobrescrever a atual.
 */
export async function linkRecoveryExam(recoveryStudentId: number, jobId: number, examId: number) {
  const updated = await db.update(recoveryStudents)
    .set({ examId, status: 'gerada', updatedAt: new Date() })
    .where(and(eq(recoveryStudents.id, recoveryStudentId), eq(recoveryStudents.jobId, jobId), eq(recoveryStudents.status, 'gerando')))
    .returning({ id: recoveryStudents.id })
  if (updated.length) return
  // Retomada do mesmo job (a prova já estava ligada): nada a fazer.
  const current = await db.query.recoveryStudents.findFirst({ where: eq(recoveryStudents.id, recoveryStudentId), columns: { examId: true } })
  if (current?.examId !== examId) await archiveExam(examId)
}

// ---------------------------------------------------------------------------
// Leitura do lote
// ---------------------------------------------------------------------------

export async function roundDetail(round: Round) {
  const students = await db.select({
    student: recoveryStudents,
    jobStatus: generationJobs.status,
    jobError: generationJobs.errorMessage,
    examStatus: generatedExams.status,
    examQuestionCount: generatedExams.questionCount,
    provaDocUrl: generatedExams.provaDocUrl,
    gabaritoDocUrl: generatedExams.gabaritoDocUrl,
  }).from(recoveryStudents)
    .leftJoin(generationJobs, eq(generationJobs.id, recoveryStudents.jobId))
    .leftJoin(generatedExams, eq(generatedExams.id, recoveryStudents.examId))
    .where(eq(recoveryStudents.roundId, round.id))
    .orderBy(asc(recoveryStudents.studentName))
  return {
    round,
    students: students.filter((row) => row.student.status !== 'removido').map((row) => ({
      ...row.student,
      // O estado de geração vem da fila: um job com erro definitivo aparece como erro.
      generation: row.student.status === 'gerando' ? (row.jobStatus === 'erro' || row.jobStatus === 'cancelado' ? 'erro' : 'na_fila') : null,
      jobError: row.student.status === 'gerando' && row.jobStatus === 'erro' ? row.jobError : null,
      examStatus: row.examStatus,
      examQuestionCount: row.examQuestionCount,
      provaDocUrl: row.provaDocUrl,
      gabaritoDocUrl: row.gabaritoDocUrl,
    })),
  }
}

// ---------------------------------------------------------------------------
// Envio, devolução e aprovação
// ---------------------------------------------------------------------------

async function activeStudents(roundId: number) {
  return (await db.select().from(recoveryStudents).where(eq(recoveryStudents.roundId, roundId))).filter((student) => student.status !== 'removido')
}

export async function submitRound(round: Round, viewer: Viewer) {
  assertEditable(round)
  const students = await activeStudents(round.id)
  if (students.some((student) => student.status === 'planejado')) throw new RecoveryError('Há alunos com matriz conferida que ainda não foram gerados. Clique em "Gerar provas" ou remova esses alunos antes de enviar.', 409)
  if (students.some((student) => student.status === 'gerando')) throw new RecoveryError('Ainda há provas sendo geradas ou com erro. Gere de novo ou remova esses alunos antes de enviar.', 409)
  if (!students.some((student) => student.status === 'gerada')) throw new RecoveryError('Nenhuma prova gerada neste lote.', 409)
  await db.update(recoveryRounds).set({ status: 'em_aprovacao', submittedBy: viewer.id, submittedAt: new Date(), updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
}

export async function returnRound(round: Round, viewer: Viewer) {
  if (!isStaffSuperuser(viewer.role)) throw new RecoveryError('Só a coordenação ou a direção devolve um lote.', 403)
  if (round.status !== 'em_aprovacao') throw new RecoveryError('Só um lote aguardando aprovação pode ser devolvido.', 409)
  await db.update(recoveryRounds).set({ status: 'aberto', updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
}

/**
 * Aprova o lote e gera os Docs de cada prova. Idempotente: prova que já tem
 * Doc é pulada, então uma falha no meio pode ser retomada aprovando de novo.
 */
export async function approveRound(round: Round, viewer: Viewer) {
  if (!isStaffSuperuser(viewer.role)) throw new RecoveryError('Só a coordenação ou a direção aprova o lote de recuperação.', 403)
  if (round.status !== 'em_aprovacao') throw new RecoveryError('O lote precisa estar aguardando aprovação.', 409)
  const students = (await activeStudents(round.id)).filter((student) => student.status === 'gerada' && student.examId)
  const exams = await db.select().from(generatedExams).where(inArray(generatedExams.id, students.map((student) => student.examId!)))
  const failures: string[] = []
  for (const exam of exams) {
    if (exam.provaDocId && exam.gabaritoDocId) continue
    try {
      const docs = await generateExamDocs(exam.generationPayload as ExamGenerationResult, { segment: exam.segment, gradeYear: exam.gradeYear, subject: exam.subject, bimester: exam.bimester, examKind: 'recuperacao', nameSuffix: `nº ${exam.id}`, periodLabel: periodLabel(round.bimester, round.semester) })
      await db.update(generatedExams).set({
        status: 'aprovado', reviewedAt: new Date(), finalizedAt: new Date(),
        driveFolderId: docs.driveFolderId, provaDocId: docs.prova.docId, provaDocUrl: docs.prova.url,
        gabaritoDocId: docs.gabarito.docId, gabaritoDocUrl: docs.gabarito.url, mapaDocId: docs.mapa.docId, mapaDocUrl: docs.mapa.url,
      }).where(eq(generatedExams.id, exam.id))
    } catch (error) {
      console.error(`[recovery] falha ao gerar documentos da prova ${exam.id}:`, error)
      const student = students.find((item) => item.examId === exam.id)
      failures.push(`${student?.studentName ?? `prova ${exam.id}`}: ${error instanceof Error ? error.message : 'erro no Google Docs'}`)
    }
  }
  if (failures.length) return { approved: false, failures }
  await db.update(recoveryRounds).set({ status: 'aprovado', approvedBy: viewer.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
  return { approved: true, failures }
}

// ---------------------------------------------------------------------------
// Fila de impressão
// ---------------------------------------------------------------------------

/** Provas aprovadas do lote, em ordem alfabética, com o Doc de cada documento. */
export async function printableExams(round: Round) {
  if (round.status !== 'aprovado' && round.status !== 'impresso') throw new RecoveryError('O lote ainda não foi aprovado pela coordenação.', 409)
  return db.select({ studentName: recoveryStudents.studentName, classroomStudentId: recoveryStudents.classroomStudentId, studentEmail: recoveryStudents.studentEmail, examId: generatedExams.id, provaDocId: generatedExams.provaDocId, gabaritoDocId: generatedExams.gabaritoDocId })
    .from(recoveryStudents)
    .innerJoin(generatedExams, eq(generatedExams.id, recoveryStudents.examId))
    .where(and(eq(recoveryStudents.roundId, round.id), eq(recoveryStudents.status, 'gerada'), isNotNull(generatedExams.provaDocId)))
    .orderBy(asc(recoveryStudents.studentName))
}

export async function markPrinted(round: Round, viewer: Viewer) {
  if (round.status !== 'aprovado') return
  await db.update(recoveryRounds).set({ status: 'impresso', printedBy: viewer.id, printedAt: new Date(), updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
  const exams = await printableExams(round)
  if (exams.length) await db.update(generatedExams).set({ status: 'impresso', printedAt: new Date() }).where(inArray(generatedExams.id, exams.map((exam) => exam.examId)))
}
