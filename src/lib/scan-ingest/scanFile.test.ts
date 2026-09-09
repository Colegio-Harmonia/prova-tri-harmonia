import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { inspectPrivateImageArtifact, inspectScanFile, ScanFileValidationError, sniffScanMimeType } from './scanFile'

describe('validação da entrada privada de scans', () => {
  it('identifica somente os formatos aceitos sem confiar no nome do arquivo', async () => {
    const png = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#fff' } }).png().toBuffer()
    const result = await inspectScanFile(png)

    expect(result).toMatchObject({ mimeType: 'image/png', extension: 'png', byteSize: png.length })
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.technicalMetadata).toMatchObject({ width: 1200, height: 1600, source: 'image' })
  })

  it('rejeita HEIC e imagem pequena antes do staging', async () => {
    expect(sniffScanMimeType(Buffer.from('ftypheic'))).toBeNull()
    const small = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(inspectScanFile(small)).rejects.toThrow(ScanFileValidationError)
  })

  it('aceita a assinatura de PDF e mantém a inspeção técnica sem URL pública', async () => {
    const pdf = Buffer.from('%PDF-1.7\n% arquivo teste')
    const result = await inspectScanFile(pdf)

    expect(result).toMatchObject({ mimeType: 'application/pdf', extension: 'pdf', technicalMetadata: { source: 'pdf' } })
    expect(result).not.toHaveProperty('previewUrl')
  })

  it('aceita recorte pequeno do worker, mas nunca PDF', async () => {
    const crop = await sharp({ create: { width: 280, height: 90, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(inspectPrivateImageArtifact(crop)).resolves.toMatchObject({ mimeType: 'image/png', technicalMetadata: { source: 'worker_image' } })
    await expect(inspectPrivateImageArtifact(Buffer.from('%PDF-1.7'))).rejects.toThrow(ScanFileValidationError)
  })
})
