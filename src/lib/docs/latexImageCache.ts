import { splitLatexSegments, renderLatexToBuffer } from '@/lib/math/latexRender'
import { uploadToStaging } from '@/lib/images/questionImageService'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

// dpi de renderização das fórmulas pro documento final — escolhido pra sair
// num tamanho próximo do corpo de texto normal (72/200 = 0.36pt por pixel;
// uma fórmula simples como "3 · 2^(n-1)" nesse dpi sai com ~10-11pt de
// altura, parecido com o texto ao redor, sem precisar escalar depois).
const DOC_RENDER_DPI = 200
const PT_PER_PX = 72 / DOC_RENDER_DPI

export type LatexImageInfo = { driveFileId: string; widthPt: number; heightPt: number }
export type LatexImageCache = Map<string, LatexImageInfo>

function getPngDimensions(buffer: Buffer): { width: number; height: number } {
  // PNG: assinatura de 8 bytes + chunk IHDR (4 bytes de tamanho + "IHDR" +
  // 4 bytes width + 4 bytes height, big-endian) — largura/altura sempre
  // nos offsets 16 e 20, sem precisar de biblioteca de imagem.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export function collectTexts(exam: ExamGenerationResult): string[] {
  const texts: (string | null | undefined)[] = []
  for (const q of exam.questions) {
    texts.push(q.statement)
    if (q.supportText) texts.push(q.supportText)
    if (q.alternatives) texts.push(...q.alternatives.map((a) => a.text))
    if (q.expectedAnswer) texts.push(q.expectedAnswer)
    if (q.gradingCriteria) texts.push(q.gradingCriteria)
  }
  // Alternativas do banco ENEM podem vir com `text: null` (alternativa-imagem);
  // filtra antes de renderizar fórmula pra não passar null adiante.
  return texts.filter((t): t is string => typeof t === 'string' && t.length > 0)
}

/**
 * Pré-resolve toda fórmula LaTeX ($...$) da prova em imagens no Drive, uma
 * vez por fórmula DISTINTA — a mesma expressão pode se repetir em mais de
 * uma alternativa/questão, sem subir a imagem duplicada. Nunca lança: uma
 * fórmula que falhar (serviço de renderização fora do ar) só fica de fora
 * do cache, e quem monta o documento cai pro texto LaTeX cru como
 * fallback em vez de perder o conteúdo da questão inteira.
 */
export async function buildLatexImageCache(exam: ExamGenerationResult): Promise<LatexImageCache> {
  const distinctLatex = new Set<string>()
  for (const text of collectTexts(exam)) {
    for (const seg of splitLatexSegments(text)) {
      if (seg.type === 'math') distinctLatex.add(seg.latex)
    }
  }

  const cache: LatexImageCache = new Map()
  await Promise.all(
    [...distinctLatex].map(async (latex) => {
      try {
        const buffer = await renderLatexToBuffer(latex, DOC_RENDER_DPI)
        const { width, height } = getPngDimensions(buffer)
        const { driveFileId } = await uploadToStaging(buffer, 'image/png', `formula-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
        cache.set(latex, { driveFileId, widthPt: width * PT_PER_PX, heightPt: height * PT_PER_PX })
      } catch (err) {
        console.warn(`[latexImageCache] falha ao renderizar "${latex}":`, err instanceof Error ? err.message : err)
      }
    }),
  )
  return cache
}
