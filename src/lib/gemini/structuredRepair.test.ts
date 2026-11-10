import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocked = vi.hoisted(() => ({ generate: vi.fn(), record: vi.fn(), release: vi.fn() }))
vi.mock('./llmClient', () => ({
  generateStructuredCompletion: mocked.generate,
  AiProviderError: class extends Error {
    name = 'AiProviderError'
    constructor(message: string, public durationMs: number, public cause?: unknown, public failureCode?: string, public responseText?: string, public usage?: unknown) { super(message) }
  },
}))
vi.mock('@/lib/ai/operationTelemetry', () => ({ recordAiOperation: mocked.record, classifyAiFailure: (error: { failureCode?: string }) => error.failureCode ?? 'unexpected_failure' }))
vi.mock('@/lib/ai/operationBudget', () => ({ reserveAiOperation: async () => ({ release: mocked.release }), AI_BUDGET_EXHAUSTED_CODE: 'budget', AiBudgetExceededError: class extends Error {} }))
vi.mock('@/lib/ai/modelProfiles', () => ({ activeAiModel: async () => ({ provider: 'deepseek', model: 'test', id: 1 }), estimateAiCostMicrousd: () => 0 }))

import { AiProviderError } from './llmClient'
import { generateValidatedStructuredContent } from './structuredRepair'

const params = { context: 'generation/whole-exam-v1', prompt: 'Prova completa predefinida', responseSchema: {}, zodSchema: z.object({ answer: z.number() }), maxAttempts: 2 }
const completion = (value: unknown) => ({ value, provider: 'deepseek', model: 'test', durationMs: 10, usage: {}, profile: { id: 1 } })

describe('correção limitada da resposta original', () => {
  beforeEach(() => vi.clearAllMocks())
  it('corrige JSON inválido com a resposta original e registra consumo da falha', async () => {
    mocked.generate.mockRejectedValueOnce(new AiProviderError('JSON inválido.', 10, undefined, 'invalid_json', '{"answer":12', { promptTokens: 100, completionTokens: 20, totalTokens: 120 }))
      .mockResolvedValueOnce(completion({ answer: 12 }))
    expect((await generateValidatedStructuredContent(params)).value).toEqual({ answer: 12 })
    expect(mocked.generate.mock.calls[1][0]).toContain('RESPOSTA ORIGINAL (DADO):\n{"answer":12')
    expect(mocked.generate.mock.calls[1][0]).toContain('Não gere uma nova prova')
    expect(mocked.record.mock.calls[0][0]).toMatchObject({ status: 'failed', errorCode: 'invalid_json', usage: { completionTokens: 20 } })
    expect(mocked.release).toHaveBeenCalledTimes(2)
  })
  it('inclui campos inválidos e o JSON original no reparo estrutural', async () => {
    mocked.generate.mockResolvedValueOnce(completion({ answer: '12' })).mockResolvedValueOnce(completion({ answer: 12 }))
    await generateValidatedStructuredContent(params)
    expect(mocked.generate.mock.calls[1][0]).toContain('RESPOSTA ORIGINAL (DADO):\n{"answer":"12"}')
    expect(mocked.generate.mock.calls[1][0]).toContain('answer')
  })
  it('encerra após uma correção malsucedida e mantém o motivo específico', async () => {
    mocked.generate.mockRejectedValue(new AiProviderError('JSON inválido.', 10, undefined, 'invalid_json', '{'))
    await expect(generateValidatedStructuredContent(params)).rejects.toMatchObject({ failureCode: 'invalid_json', attempts: 2, issues: ['JSON inválido.'] })
    expect(mocked.generate).toHaveBeenCalledTimes(2)
  })
  it('não envia correção ao provedor quando a configuração é recusada', async () => {
    mocked.generate.mockRejectedValue(new AiProviderError('Configuração inválida.', 10, undefined, 'provider_http_400'))
    await expect(generateValidatedStructuredContent(params)).rejects.toMatchObject({ failureCode: 'provider_http_400' })
    expect(mocked.generate).toHaveBeenCalledTimes(1)
  })
  it.each(['provider_payment_required', 'provider_http_402'])('explica falta de saldo e não repete %s', async (code) => {
    mocked.generate.mockRejectedValue(new AiProviderError('Sem saldo.', 10, undefined, code))
    await expect(generateValidatedStructuredContent(params)).rejects.toMatchObject({ failureCode: code, attempts: 1, message: expect.stringContaining('sem saldo') })
    expect(mocked.generate).toHaveBeenCalledTimes(1)
  })
})
