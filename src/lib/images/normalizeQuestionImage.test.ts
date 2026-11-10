import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeQuestionImage } from './normalizeQuestionImage'

describe('margens das imagens de questões', () => {
  it('recorta margens externas sem remover o espaço entre partes do gráfico', async () => {
    const figure = await sharp({ create: { width: 200, height: 100, channels: 4, background: 'black' } }).png().toBuffer()
    const input = await sharp({ create: { width: 1000, height: 800, channels: 4, background: 'white' } }).composite([{ input: figure, left: 400, top: 350 }]).png().toBuffer()
    const result = await normalizeQuestionImage(input)
    expect(result.width).toBe(216)
    expect(result.height).toBe(116)
    const stats = await sharp(result.buffer).stats()
    expect(stats.channels[0].min).toBe(0)
    expect(stats.channels[0].max).toBe(255)
  })
  it('preserva bordas com conteúdo e limita a resolução mantendo proporção', async () => {
    const input = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#445566' } }).png().toBuffer()
    const result = await normalizeQuestionImage(input)
    expect(result.width).toBe(1616)
    expect(result.height).toBe(816)
  })
  it('aceita imagem totalmente branca sem falhar', async () => {
    const input = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer()
    await expect(normalizeQuestionImage(input)).resolves.toMatchObject({ width: 116, height: 116 })
  })
})
