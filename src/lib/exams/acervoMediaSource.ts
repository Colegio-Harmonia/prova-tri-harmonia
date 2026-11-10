import sharp from 'sharp'
import { getAcervoApiUrl } from '@/lib/settings/acervoSettings'

/** Some legacy originals have an octet-stream header. Validate the bytes as an image. */
export async function readAcervoImage(mediaId: number, base?: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) throw new Error('invalid_media_id')
  const response = await fetch(new URL(`/api/media/${mediaId}`, base ?? await getAcervoApiUrl()), {
    signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error',
  })
  if (!response.ok) throw new Error('original_media_unavailable')
  if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('original_media_too_large')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 10 * 1024 * 1024) throw new Error('original_media_too_large')
  const png = await sharp(buffer, { limitInputPixels: 20_000_000 }).rotate().png().toBuffer({ resolveWithObject: true })
  return { buffer: png.data, width: png.info.width, height: png.info.height }
}
