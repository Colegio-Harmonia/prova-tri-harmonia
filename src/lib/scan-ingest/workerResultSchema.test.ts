import { describe, expect, it } from 'vitest'
import { workerScanResultSchema } from './workerResultSchema'

const base = {
  uploadSha256: 'a'.repeat(64),
  pages: [{
    pageIndex: 1,
    qrToken: 'PTR1.token',
    pageType: 'objective',
    qualityScore: 0.98,
    readings: [{ questionNumber: 1, kind: 'objective', suggestedLetter: 'A', confidence: 0.96 }],
  }],
}

describe('contrato de resultado estruturado do worker', () => {
  it('aceita somente dados estruturados, sem imagem ou URL', () => {
    expect(workerScanResultSchema.parse(base)).toMatchObject(base)
    expect(workerScanResultSchema.safeParse({ ...base, imageUrl: 'https://exemplo' }).success).toBe(false)
  })

  it('rejeita página e questão repetidas, e tipo de leitura incompatível', () => {
    expect(workerScanResultSchema.safeParse({ ...base, pages: [...base.pages, base.pages[0]] }).success).toBe(false)
    expect(workerScanResultSchema.safeParse({
      ...base,
      pages: [{ ...base.pages[0], readings: [{ questionNumber: 1, kind: 'discursive', suggestedLetter: 'A' }] }],
    }).success).toBe(false)
  })
})
