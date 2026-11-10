import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
const mocks = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn() }))
vi.mock('./driveClient', () => ({ getDriveClient: () => ({ files: { get: mocks.get } }) }))
vi.mock('@/lib/images/questionImageService', () => ({ uploadToStaging: mocks.upload }))
import { prepareQuestionImages } from './questionImageCache'

const exam = (approved = true) => ({ questions: [{ number: 1, source: 'ia', image: { driveFileId: 'original', previewUrl: '/original', approved, source: 'gerada' } }] } as ExamGenerationResult)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({ data: new Uint8Array([1, 2]).buffer })
  mocks.upload.mockResolvedValue({ driveFileId: 'cropped', previewUrl: '/cropped', width: 600, height: 300 })
})
describe('imagens antigas na impressão', () => {
  it('prepara cópia com dimensões sem alterar a questão salva', async () => {
    const original = exam()
    const prepared = await prepareQuestionImages(original)
    expect(prepared.questions[0].image).toMatchObject({ driveFileId: 'cropped', width: 600, height: 300 })
    expect(original.questions[0].image?.driveFileId).toBe('original')
  })
  it('não busca imagens pendentes de aprovação nem reprocessa imagens já dimensionadas', async () => {
    await prepareQuestionImages(exam(false))
    const sized = exam()
    sized.questions[0].image!.width = 600
    sized.questions[0].image!.height = 300
    await prepareQuestionImages(sized)
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it('mantém o original se não for possível baixar ou normalizar a imagem', async () => {
    mocks.get.mockRejectedValue(new Error('Drive indisponível'))
    const original = exam()
    expect(await prepareQuestionImages(original)).toEqual(original)
  })
})
