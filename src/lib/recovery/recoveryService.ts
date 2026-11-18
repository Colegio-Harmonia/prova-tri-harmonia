// Serviço da prova de recuperação individualizada (18/11/2026). Regras puras
// em ./recoveryPlan.ts; fluxo completo em docs/PROVA_RECUPERACAO.md.
//
// Fluxo: lote (turma + disciplina + período) → professor marca alunos → para
// cada um, as habilidades abaixo de 60% viram a matriz BNCC de um job
// 'gerar_atividade' com recoveryStudentId → o worker grava a prova como
// 'recuperacao' e a liga ao aluno → professor revisa e envia o lote →
// coordenação/direção aprova (gera os Docs) → fila de impressão por sala.

import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, generationJobs, recoveryRounds, recoveryStudents, type RecoveryRoundStatus, type RecoverySkill } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { calculateStudentMastery } from '@/lib/curriculum/studentMastery'
import { canonicalSubject, evidenceConditions, loadEvidence } from '@/lib/curriculum/masteryData'
import { enqueueAtividadeJob } from '@/lib/queue/enqueue'
import { generateExamDocs } from '@/lib/docs/generateExamDocs'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { distributeRecoveryQuestions, evidenceForPeriod, RECOVERY_RULES, selectRecoverySkills } from './recoveryPlan'

export class RecoveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type Viewer = { id: number; role: string }
export type RosterStudent = { classroomStudentId: string; name: string; email: string | null }
type Round = typeof recoveryRounds.$inferSelect

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

export async function openRound(input: { classroomCourseId: string; classLabel: string; subject: string; bimester: number | null; questionCount?: number }, viewer: Viewer): Promise<Round> {
  const scope = (await courseSubjects(input.classroomCourseId, viewer)).find((item) => item.subject === input.subject)
  if (!scope) throw new RecoveryError('Esta turma não tem prova da disciplina vinculada a você. A recuperação usa as correções dessas provas para achar as habilidades fracas.', 422)
  const questionCount = Math.min(RECOVERY_RULES.maxQuestions, Math.max(RECOVERY_RULES.minQuestions, input.questionCount ?? RECOVERY_RULES.defaultQuestions))
  const existing = await db.query.recoveryRounds.findFirst({ where: (table, { and, eq, isNull }) => and(
    eq(table.classroomCourseId, input.classroomCourseId), eq(table.academicYear, scope.academicYear), eq(table.subject, input.subject),
    input.bimester === null ? isNull(table.bimester) : eq(table.bimester, input.bimester),
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
    questionCount,
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
// Diagnóstico: habilidades fracas por aluno
// ---------------------------------------------------------------------------

/** Habilidades fracas e insuficientes de cada aluno, lidas das correções revisadas que o usuário pode ver. */
export async function diagnoseStudents(round: Round, viewer: Viewer) {
  const params = new URLSearchParams({ subject: round.subject, gradeYear: String(round.gradeYear), academicYear: String(round.academicYear), segment: round.segment })
  const { evidence } = await loadEvidence(evidenceConditions(viewer, params))
  const subject = canonicalSubject(round.subject)
  const scoped = evidenceForPeriod(evidence.filter((item) => canonicalSubject(item.subject) === subject), round.bimester)
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
// Marcação, geração e remoção
// ---------------------------------------------------------------------------

async function enqueueStudentExam(round: Round, recoveryStudentId: number, bnccPlan: Array<{ code: string; questionCount: number }>, requestedBy: number) {
  const questionCount = bnccPlan.reduce((sum, item) => sum + item.questionCount, 0)
  return enqueueAtividadeJob({
    segment: round.segment,
    gradeYear: round.gradeYear,
    academicYear: round.academicYear,
    subject: round.subject,
    ...(round.bimester ? { bimester: round.bimester } : {}),
    questionCount,
    pedagogicalIntent: 'recuperacao',
    bnccCodes: bnccPlan.map((item) => item.code),
    bnccPlan,
    classLabel: round.classLabel.slice(0, 120),
    classroomCourseId: round.classroomCourseId,
    recoveryStudentId,
  }, requestedBy)
}

/** Prova substituída ou de aluno removido sai das listas sem apagar histórico. */
async function archiveExam(examId: number | null) {
  if (examId) await db.update(generatedExams).set({ archivedAt: new Date() }).where(eq(generatedExams.id, examId))
}

export async function flagStudents(round: Round, students: RosterStudent[], viewer: Viewer) {
  assertEditable(round)
  if (!students.length) throw new RecoveryError('Selecione pelo menos um aluno.')
  const diagnosis = await diagnoseStudents(round, viewer)
  const existing = await db.select().from(recoveryStudents).where(eq(recoveryStudents.roundId, round.id))
  const outcome = { queued: 0, withoutSkills: 0, alreadyFlagged: 0 }

  for (const student of students) {
    const current = existing.find((row) => row.classroomStudentId === student.classroomStudentId)
    if (current && (current.status === 'gerando' || current.status === 'gerada')) { outcome.alreadyFlagged += 1; continue }
    const { weak, insufficient } = diagnosis.get(student.classroomStudentId) ?? { weak: [], insufficient: [] }
    const bnccPlan = distributeRecoveryQuestions(weak, round.questionCount)
    const values = {
      studentName: student.name, studentEmail: student.email, weakSkills: weak, insufficientSkills: insufficient, bnccPlan,
      status: bnccPlan.length ? 'gerando' as const : 'sem_habilidades' as const, examId: null, jobId: null,
      flaggedBy: viewer.id, flaggedAt: new Date(), updatedAt: new Date(),
    }
    const [row] = current
      ? await db.update(recoveryStudents).set(values).where(eq(recoveryStudents.id, current.id)).returning()
      : await db.insert(recoveryStudents).values({ roundId: round.id, classroomStudentId: student.classroomStudentId, ...values }).returning()
    if (!bnccPlan.length) { outcome.withoutSkills += 1; continue }
    const jobId = await enqueueStudentExam(round, row!.id, bnccPlan, viewer.id)
    await db.update(recoveryStudents).set({ jobId }).where(eq(recoveryStudents.id, row!.id))
    outcome.queued += 1
  }
  await db.update(recoveryRounds).set({ updatedAt: new Date() }).where(eq(recoveryRounds.id, round.id))
  return outcome
}

async function getStudent(round: Round, recoveryStudentId: number) {
  const student = await db.query.recoveryStudents.findFirst({ where: and(eq(recoveryStudents.id, recoveryStudentId), eq(recoveryStudents.roundId, round.id)) })
  if (!student) throw new RecoveryError('Aluno não encontrado neste lote.', 404)
  return student
}

/** Gera de novo a prova do aluno com a mesma matriz (ex.: job com erro ou prova descartada). */
export async function regenerateStudent(round: Round, recoveryStudentId: number, viewer: Viewer) {
  assertEditable(round)
  const student = await getStudent(round, recoveryStudentId)
  if (!student.bnccPlan.length) throw new RecoveryError('Este aluno não tem habilidade abaixo de 60% no período; não há prova a gerar.', 422)
  await archiveExam(student.examId)
  const jobId = await enqueueStudentExam(round, student.id, student.bnccPlan, viewer.id)
  await db.update(recoveryStudents).set({ status: 'gerando', examId: null, jobId, updatedAt: new Date() }).where(eq(recoveryStudents.id, student.id))
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
      const docs = await generateExamDocs(exam.generationPayload as ExamGenerationResult, { segment: exam.segment, gradeYear: exam.gradeYear, subject: exam.subject, bimester: exam.bimester, examKind: 'recuperacao', nameSuffix: `nº ${exam.id}` })
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
