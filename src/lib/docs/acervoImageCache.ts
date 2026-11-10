import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { originalAcervoMedia, inlineAcervoMediaIds } from '@/lib/exams/acervoMedia'
import { readAcervoImage } from '@/lib/exams/acervoMediaSource'
import { getAcervoApiUrl } from '@/lib/settings/acervoSettings'
import { uploadToStaging } from '@/lib/images/questionImageService'
import type { LatexImageInfo } from './latexImageCache'

/** Read only original media explicitly needed by this document. */
export async function buildAcervoImageCache(exam: ExamGenerationResult, scope: 'inline' | 'resolucao'): Promise<Map<number, LatexImageInfo>> {
  const ids = new Set(exam.questions.flatMap((question) => scope === 'inline' ? inlineAcervoMediaIds(question) : originalAcervoMedia(question, 'resolucao').map((media) => media.id)))
  const cache = new Map<number, LatexImageInfo>()
  if (!ids.size) return cache
  const base = await getAcervoApiUrl()
  await Promise.all([...ids].map(async (id) => {
    try {
      const image = await readAcervoImage(id, base)
      const uploaded = await uploadToStaging(image.buffer, 'image/png', `formula-acervo-${id}.png`)
      const width = uploaded.width ?? image.width
      const height = uploaded.height ?? image.height
      const scale = Math.min(420 / width, 300 / height, 0.75)
      cache.set(id, { driveFileId: uploaded.driveFileId, widthPt: width * scale, heightPt: height * scale })
    } catch {
      console.warn('[docs/acervo] falha ao importar imagem original', { mediaId: id })
      throw new Error(`Não foi possível incluir a imagem original ${id} no documento.`)
    }
  }))
  return cache
}
