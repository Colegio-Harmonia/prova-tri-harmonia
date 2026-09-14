import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { getDriveClient } from '@/lib/docs/driveClient'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

export const runtime = 'nodejs'

/**
 * Serves review images through the application rather than exposing the
 * browser to Drive's thumbnail redirect. The file ID must be present in the
 * authorized exam payload; possessing an arbitrary Drive ID is not enough.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string; fileId: string }> }) {
  const { examId: rawExamId, fileId } = await props.params
  const examId = Number(rawExamId)
  if (!Number.isSafeInteger(examId) || examId < 1 || !fileId) {
    return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  }

  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return access.error

  const payload = access.exam.generationPayload as ExamGenerationResult
  const imageBelongsToExam = payload.questions.some((question) => question.image?.driveFileId === fileId)
  if (!imageBelongsToExam) return NextResponse.json({ error: 'Imagem não pertence a esta prova.' }, { status: 404 })

  try {
    const drive = getDriveClient()
    const metadata = await drive.files.get({
      fileId,
      fields: 'mimeType',
      supportsAllDrives: true,
    })
    const mimeType = metadata.data.mimeType
    if (!mimeType?.startsWith('image/')) {
      return NextResponse.json({ error: 'O arquivo associado não é uma imagem.' }, { status: 415 })
    }

    const media = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    )
    return new NextResponse(media.data as unknown as BodyInit, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[exams/images] não foi possível obter imagem do Drive:', error)
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 502 })
  }
}
