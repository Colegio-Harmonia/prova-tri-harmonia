import sharp from 'sharp'

/** Remove apenas bordas brancas/transparentes externas, mantendo margem e proporção. */
export async function normalizeQuestionImage(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const input = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: '#ffffff' })
  const original = await input.clone().png().toBuffer()
  let cropped: Buffer
  try {
    cropped = await sharp(original).trim({ background: '#ffffff', threshold: 8, lineArt: true }).png().toBuffer()
  } catch {
    // Imagens inteiramente brancas não têm caixa de conteúdo para recortar.
    cropped = original
  }
  const { data, info } = await sharp(cropped)
    .resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: '#ffffff' })
    .png().toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height }
}
