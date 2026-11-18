import { NextRequest, NextResponse } from 'next/server'
import { exportDocPdfBytes } from '@/lib/docs/exportPdf'
import { getRound, markPrinted, printableExams } from '@/lib/recovery/recoveryService'
import { periodLabel } from '@/lib/recovery/recoveryPlan'
import { buildRoomPdf } from '@/lib/recovery/roomPdf'
import { recoverySheetPdf } from '@/lib/recovery/recoverySheets'
import { parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

export const maxDuration = 300

// PDF único da sala: provas (ou gabaritos) de todos os alunos do lote, em
// ordem alfabética, com o nome carimbado em cada página. No PDF das provas,
// cada prova vem seguida do cartão-resposta com QR do aluno. Baixar as provas
// marca o lote como impresso.
export async function GET(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const doc = req.nextUrl.searchParams.get('doc') === 'gabarito' ? 'gabarito' : 'prova'
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    const exams = await printableExams(round)
    if (!exams.length) return NextResponse.json({ error: 'Nenhuma prova aprovada neste lote.' }, { status: 404 })
    const entries = []
    for (const exam of exams) {
      const docId = doc === 'prova' ? exam.provaDocId : exam.gabaritoDocId
      if (!docId) continue
      // A prova de cada aluno sai seguida do cartão-resposta dele (QR para o scanner).
      const appendix = doc === 'prova' ? await recoverySheetPdf({ examId: exam.examId, classroomStudentId: exam.classroomStudentId, studentName: exam.studentName, studentEmail: exam.studentEmail }, access.viewer.id) : undefined
      entries.push({ studentName: exam.studentName, pdf: await exportDocPdfBytes(docId), appendix })
    }
    const header = `${round.classLabel} · ${round.subject} · ${periodLabel(round.bimester, round.semester)}${doc === 'gabarito' ? ' · GABARITO' : ''}`
    const pdf = await buildRoomPdf(entries, { header })
    if (doc === 'prova') await markPrinted(round, access.viewer)
    const fileName = `recuperacao-${doc}-${round.classLabel}-${round.subject}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
    return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}.pdf"`, 'Cache-Control': 'no-store' } })
  } catch (error) {
    return recoveryErrorResponse(error, 'PDF da sala')
  }
}
