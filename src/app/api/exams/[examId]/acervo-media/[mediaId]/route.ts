import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { originalAcervoMedia } from '@/lib/exams/acervoMedia'
import { readAcervoImage } from '@/lib/exams/acervoMediaSource'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string; mediaId: string }> }): Promise<NextResponse> {
  const params = await props.params
  const examId = Number(params.examId)
  const mediaId = Number(params.mediaId)
  if (!Number.isSafeInteger(examId) || examId < 1 || !Number.isSafeInteger(mediaId) || mediaId < 1) {
    return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  }
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return access.error ?? NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  const payload = access.exam.generationPayload as ExamGenerationResult
  if (!payload.questions.some((question) => originalAcervoMedia(question).some((media) => media.id === mediaId))) {
    return NextResponse.json({ error: 'Imagem não pertence a esta prova.' }, { status: 404 })
  }
  try {
    const image = await readAcervoImage(mediaId)
    return new NextResponse(new Uint8Array(image.buffer), { headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    } })
  } catch {
    console.warn('[acervo/media] imagem indisponível', { examId, mediaId })
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 502 })
  }
}
