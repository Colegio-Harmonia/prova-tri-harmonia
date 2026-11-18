// Cartão-resposta com QR da prova de recuperação (18/11/2026).
//
// Cada prova de recuperação tem um único aluno, então o cartão nasce dele (do
// lote), não do roster inteiro da turma como em snapshotSheetAssignments. O
// resto é o mesmo circuito do scanner: uma correção pendente por aluno, uma
// ficha (exam_sheet_assignments) com publicId aleatório e QR assinado por
// página. A primeira montagem emite; as seguintes regeneram os mesmos QR a
// partir do digest gravado, então baixar o PDF de novo não invalida o cartão.

import { randomBytes } from 'crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examSheetAssignments, generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import { CURRENT_SHEET_LAYOUT, planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { generateSheetPdf } from '@/lib/scan-sheets/sheetPdf'
import { createPageQrPayload, createSheetTokenDigest, issuedSheetTokens, readSheetQrSigningKeys, type SheetQrSigningKey } from '@/lib/scan-sheets/sheetQr'
import { RecoveryError } from './recoveryService'

export type RecoverySheetStudent = { examId: number; classroomStudentId: string; studentName: string; studentEmail: string | null }

function signingKeysOrThrow(): SheetQrSigningKey[] {
  try {
    return readSheetQrSigningKeys()
  } catch {
    throw new RecoveryError('A chave de assinatura dos QR dos cartões-resposta não está configurada neste servidor (SHEET_QR_SIGNING_KEYS).', 503)
  }
}

/** Correção pendente + ficha ativa do aluno nesta prova; cria o que faltar. */
async function ensureAssignment(student: RecoverySheetStudent, payload: ExamGenerationResult, pageCount: number, userId: number) {
  return db.transaction(async (tx) => {
    let correction = await tx.query.examCorrections.findFirst({ where: and(eq(examCorrections.examId, student.examId), eq(examCorrections.classroomStudentId, student.classroomStudentId)) })
    if (!correction) {
      ;[correction] = await tx.insert(examCorrections).values({
        examId: student.examId, classroomStudentId: student.classroomStudentId, studentName: student.studentName, studentEmail: student.studentEmail,
        answers: buildEmptyAnswers(payload), createdBy: userId,
      }).returning()
    }
    const active = await tx.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, student.examId), eq(examSheetAssignments.classroomStudentId, student.classroomStudentId), inArray(examSheetAssignments.status, ['pronta', 'emitida'])) })
    if (active) return active
    const [created] = await tx.insert(examSheetAssignments).values({
      examId: student.examId, examCorrectionId: correction!.id, classroomStudentId: student.classroomStudentId,
      studentNameSnapshot: student.studentName, studentEmailSnapshot: student.studentEmail,
      publicId: randomBytes(18).toString('base64url'), layoutVersion: CURRENT_SHEET_LAYOUT, pageCount, issuedBy: userId,
    }).returning()
    return created!
  })
}

/** PDF do cartão-resposta do aluno, emitindo a ficha na primeira vez. */
export async function recoverySheetPdf(student: RecoverySheetStudent, userId: number): Promise<Uint8Array> {
  const signingKeys = signingKeysOrThrow()
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, student.examId) })
  if (!exam) throw new RecoveryError(`Prova ${student.examId} não encontrada.`, 404)
  const payload = exam.generationPayload as ExamGenerationResult
  let pagePlan
  try {
    pagePlan = planSheetPages(payload.questions)
  } catch (error) {
    throw new RecoveryError(`Não foi possível montar o cartão-resposta de ${student.studentName}: ${error instanceof Error ? error.message : 'layout não suportado'}.`, 422)
  }
  const assignment = await ensureAssignment(student, payload, pagePlan.length, userId)
  if (assignment.pageCount !== pagePlan.length) throw new RecoveryError(`O cartão de ${student.studentName} não corresponde mais às páginas da prova; gere uma reimpressão controlada pela tela da prova.`, 409)

  const qrTokens = assignment.status === 'emitida'
    ? issuedSheetTokens({ publicId: assignment.publicId, pageCount: assignment.pageCount, layoutVersion: assignment.layoutVersion, tokenDigest: assignment.tokenDigest, signingKeys })
    : pagePlan.map((_, index) => createPageQrPayload({ publicId: assignment.publicId, pageNumber: index + 1, layoutVersion: assignment.layoutVersion }, signingKeys[0]!))
  if (!qrTokens) throw new RecoveryError(`Não foi possível recuperar a assinatura do cartão já emitido de ${student.studentName}. Gere uma reimpressão controlada pela tela da prova.`, 409)

  const pdf = await generateSheetPdf({
    examId: student.examId, studentName: assignment.studentNameSnapshot, subject: exam.subject, gradeYear: exam.gradeYear,
    academicYear: exam.academicYear, bimester: exam.bimester, publicId: assignment.publicId, layoutVersion: assignment.layoutVersion,
    qrTokens, questions: payload.questions,
  })

  if (assignment.status === 'pronta') {
    const now = new Date()
    await db.update(examSheetAssignments)
      .set({ status: 'emitida', tokenDigest: createSheetTokenDigest(qrTokens), emittedAt: now, emittedBy: userId, updatedAt: now })
      .where(and(eq(examSheetAssignments.id, assignment.id), eq(examSheetAssignments.status, 'pronta')))
  }
  return pdf
}
