import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { originalAcervoMedia, inlineAcervoMediaIds } from '@/lib/exams/acervoMedia'
import { readAcervoImage } from '@/lib/exams/acervoMediaSource'
import { getAcervoApiUrl } from '@/lib/settings/acervoSettings'
import { uploadToStaging } from '@/lib/images/questionImageService'
import type { LatexImageInfo } from './latexImageCache'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 800

/** Erros que nunca melhoram com nova tentativa (id inválido, arquivo grande demais). */
function isPermanent(error: unknown): boolean {
  return error instanceof Error && /^(invalid_media_id|original_media_too_large)$/.test(error.message)
}

async function loadOriginalMedia(id: number, base: string): Promise<LatexImageInfo> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let step: 'download' | 'upload' = 'download'
    try {
      const image = await readAcervoImage(id, base)
      step = 'upload'
      const uploaded = await uploadToStaging(image.buffer, 'image/png', `formula-acervo-${id}.png`)
      const width = uploaded.width ?? image.width
      const height = uploaded.height ?? image.height
      const scale = Math.min(420 / width, 300 / height, 0.75)
      return { driveFileId: uploaded.driveFileId, widthPt: width * scale, heightPt: height * scale }
    } catch (error) {
      lastError = error
      // Falhas de rede com o Acervo/Drive são transitórias na prática (prova 775,
      // 13/11/2026): a mesma imagem baixou e subiu normalmente minutos depois.
      console.warn('[docs/acervo] falha ao importar imagem original', {
        mediaId: id, step, attempt, error: error instanceof Error ? error.message : String(error),
      })
      if (isPermanent(error) || attempt === MAX_ATTEMPTS) break
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
    }
  }
  throw new Error(`Não foi possível incluir a imagem original ${id} no documento.`, { cause: lastError })
}

/** Read only original media explicitly needed by this document. */
export async function buildAcervoImageCache(exam: ExamGenerationResult, scope: 'inline' | 'resolucao'): Promise<Map<number, LatexImageInfo>> {
  const ids = new Set(exam.questions.flatMap((question) => scope === 'inline' ? inlineAcervoMediaIds(question) : originalAcervoMedia(question, 'resolucao').map((media) => media.id)))
  const cache = new Map<number, LatexImageInfo>()
  if (!ids.size) return cache
  const base = await getAcervoApiUrl()
  await Promise.all([...ids].map(async (id) => {
    cache.set(id, await loadOriginalMedia(id, base))
  }))
  return cache
}
