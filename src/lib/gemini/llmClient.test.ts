import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ active: vi.fn(), fallback: vi.fn(), post: vi.fn(), record: vi.fn() }))
vi.mock('axios', async (original) => {
  const actual = await original<typeof import('axios')>()
  return { ...actual, default: { ...actual.default, post: mocked.post } }
})
vi.mock('@/lib/ai/modelProfiles', () => ({ activeAiModel: mocked.active, estimateAiCostMicrousd: () => 0 }))
vi.mock('@/lib/ai/textFallback', () => ({ getTextFallbackModel: mocked.fallback }))
vi.mock('@/lib/ai/operationTelemetry', async (original) => ({ ...await original<typeof import('@/lib/ai/operationTelemetry')>(), recordAiOperation: mocked.record }))

import { generateStructuredCompletion } from './llmClient'

let id = 0
const reserve = { id: 6, provider: 'openai', model: 'gpt-4.1-mini' }
const success = { data: { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } } }
const refusal = (status: number) => new axios.AxiosError('private provider response', undefined, undefined, undefined, {
  status, statusText: '', headers: {}, config: { headers: new axios.AxiosHeaders() }, data: { error: { message: 'private content' } },
})

describe('reserva de texto após falha operacional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-primary')
    vi.stubEnv('OPENAI_API_KEY', 'test-reserve')
    mocked.active.mockResolvedValue({ id: ++id, provider: 'deepseek', model: 'deepseek-v4-flash' })
    mocked.fallback.mockResolvedValue(reserve)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('mantém o principal quando funciona', async () => {
    mocked.post.mockResolvedValue(success)
    expect((await generateStructuredCompletion('prompt', {})).provider).toBe('deepseek')
    expect(mocked.post).toHaveBeenCalledTimes(1)
  })
  it('completa a mesma solicitação pela reserva e registra o provedor real', async () => {
    mocked.post.mockRejectedValueOnce(refusal(402)).mockResolvedValueOnce(success)
    const result = await generateStructuredCompletion('prompt original', { type: 'object' })
    expect(result).toMatchObject({ provider: 'openai', model: reserve.model, value: { ok: true }, profile: reserve })
    expect(mocked.post.mock.calls[1][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(mocked.post.mock.calls[1][1].messages[0].content).toContain('prompt original')
    expect(mocked.post.mock.calls[1][1].messages[0].content).toContain('"type":"object"')
    expect(mocked.record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'deepseek', errorCode: 'provider_payment_required' }))
  })
  it('pula por cinco minutos o principal sem saldo e o testa novamente depois', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocked.post.mockRejectedValueOnce(refusal(402)).mockResolvedValue(success)
    await generateStructuredCompletion('primeira', {})
    await generateStructuredCompletion('segunda', {})
    expect(mocked.post.mock.calls.map(([url]) => url)).toEqual([
      'https://api.deepseek.com/chat/completions', 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/chat/completions',
    ])
    now += 5 * 60_000
    await generateStructuredCompletion('terceira', {})
    expect(mocked.post.mock.calls[3][0]).toBe('https://api.deepseek.com/chat/completions')
  })
  it('não usa modelos inativos se a gestão não escolheu reserva', async () => {
    mocked.fallback.mockResolvedValue(null)
    mocked.post.mockRejectedValue(refusal(402))
    await expect(generateStructuredCompletion('prompt', {})).rejects.toMatchObject({ failureCode: 'provider_payment_required', message: expect.stringContaining('sem saldo') })
    expect(mocked.post).toHaveBeenCalledTimes(1)
  })
  it('não tenta outra conta do mesmo provedor sem saldo', async () => {
    mocked.fallback.mockResolvedValue({ ...reserve, provider: 'deepseek' })
    mocked.post.mockRejectedValue(refusal(402))
    await expect(generateStructuredCompletion('prompt', {})).rejects.toMatchObject({ failureCode: 'provider_payment_required' })
    expect(mocked.post).toHaveBeenCalledTimes(1)
  })
  it('não troca de provedor para reparar um pedido malformado', async () => {
    mocked.post.mockRejectedValue(refusal(400))
    await expect(generateStructuredCompletion('prompt', {})).rejects.toMatchObject({ failureCode: 'provider_http_400' })
    expect(mocked.post).toHaveBeenCalledTimes(1)
  })
  it('preserva o diagnóstico da reserva quando os dois provedores falham', async () => {
    mocked.post.mockRejectedValueOnce(refusal(402)).mockRejectedValueOnce(refusal(401))
    await expect(generateStructuredCompletion('prompt', {})).rejects.toMatchObject({ failureCode: 'provider_auth', profile: reserve })
    expect(mocked.post).toHaveBeenCalledTimes(2)
  })
  it('continua pela reserva quando falta a chave do principal', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    mocked.post.mockResolvedValue(success)
    expect((await generateStructuredCompletion('prompt', {})).provider).toBe('openai')
    expect(mocked.post).toHaveBeenCalledTimes(1)
  })
})
