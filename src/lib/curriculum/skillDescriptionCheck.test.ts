import { describe, expect, it, vi } from 'vitest'
import { checkSkillDescriptions, classifyDescriptionProbability, descriptionCheckKey } from './skillDescriptionCheck'

const official = new Map([
  ['EF05CI08', 'Organizar um cardápio equilibrado com base nas características dos grupos alimentares.'],
  ['EF05LP06', 'Flexionar, adequadamente, na escrita e na oralidade, os verbos em concordância com pronomes pessoais/nomes sujeitos da oração.'],
])
const resolveOfficial = async () => official

function jevResponse(answers: Record<string, number>) {
  return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: 'noul', noul }])) }), { status: 200 })
}

describe('classifyDescriptionProbability', () => {
  it('separa confere, revisar e diverge pelas faixas calibradas', () => {
    expect(classifyDescriptionProbability(0.99)).toBe('confere')
    expect(classifyDescriptionProbability(0.8)).toBe('confere')
    expect(classifyDescriptionProbability(0.5)).toBe('revisar')
    expect(classifyDescriptionProbability(0.2)).toBe('diverge')
    expect(classifyDescriptionProbability(0.01)).toBe('diverge')
  })
})

describe('checkSkillDescriptions', () => {
  it('não chama o Jev quando a planilha não traz descrição', async () => {
    const fetchImpl = vi.fn()
    const result = await checkSkillDescriptions([{ code: 'EF05LP06', description: null }], { apiKey: 'k', fetchImpl, resolveOfficial })
    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('classifica cada descrição com a probabilidade devolvida', async () => {
    const fetchImpl = vi.fn(async () => jevResponse({ q0: 0.99, q1: 0.02 }))
    const result = await checkSkillDescriptions([
      { code: 'ef05ci08', description: 'Organizar um cardápio equilibrado...' },
      { code: 'EF05LP06', description: 'Organizar um cardápio equilibrado com base nos grupos alimentares.' },
    ], { apiKey: 'k', fetchImpl, resolveOfficial })
    expect(result.map((item) => [item.code, item.status])).toEqual([['EF05CI08', 'confere'], ['EF05LP06', 'diverge']])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.questions.q1.instructions.descricao_oficial_bncc).toContain('Flexionar')
  })

  it('verifica uma vez só linhas repetidas com o mesmo texto', async () => {
    const fetchImpl = vi.fn(async () => jevResponse({ q0: 0.97 }))
    const row = { code: 'EF05CI08', description: 'Organizar um cardápio equilibrado.' }
    const result = await checkSkillDescriptions([row, { ...row }], { apiKey: 'k', fetchImpl, resolveOfficial })
    expect(result).toHaveLength(1)
    expect(descriptionCheckKey(row.code, row.description)).toBe('EF05CI08::Organizar um cardápio equilibrado.')
  })

  it('falha aberta sem chave ou com erro do provedor', async () => {
    const semChave = await checkSkillDescriptions([{ code: 'EF05CI08', description: 'Texto' }], { apiKey: '', resolveOfficial })
    expect(semChave[0].status).toBe('nao_verificado')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const comErro = await checkSkillDescriptions([{ code: 'EF05CI08', description: 'Texto' }], { apiKey: 'k', fetchImpl: vi.fn(async () => new Response('x', { status: 503 })), resolveOfficial })
    expect(comErro[0]).toMatchObject({ status: 'nao_verificado', probability: null, officialDescription: official.get('EF05CI08') })
    warn.mockRestore()
  })

  it('não verifica código sem texto oficial disponível', async () => {
    const fetchImpl = vi.fn()
    const result = await checkSkillDescriptions([{ code: 'EF99XX99', description: 'Texto' }], { apiKey: 'k', fetchImpl, resolveOfficial })
    expect(result[0]).toMatchObject({ status: 'nao_verificado', officialDescription: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
