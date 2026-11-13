import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAcervoSearchSession, findAcervoQuestion, mapAcervoQuestion, importAcervoQuestionById } from './acervoQuestions'
const upload = vi.hoisted(() => vi.fn().mockResolvedValue({ driveFileId: 'original-media', previewUrl: '/media.png' }))
vi.mock('@/lib/images/questionImageService', () => ({ uploadToStaging: upload }))
vi.mock('@/lib/settings/acervoSettings', () => ({ getAcervoApiUrl: vi.fn().mockResolvedValue('http://192.168.1.77:5050') }))
import { acervoIdentity, questionOriginLabel } from './questionOrigin'
import { examGenerationResultSchema } from '@/lib/gemini/examSchema'

const original = (id = 1, statement = 'Qual é o dobro de três?') => ({
  id, tipo: 'multipla_escolha', enunciado: { texto: statement, html: '<p>Enunciado</p>' },
  alternativas: [
    { posicao: 0, rotulo: 'A', texto: '3', html: '3', correta: false },
    { posicao: 1, rotulo: 'B', texto: '6', html: '6', correta: true },
    { posicao: 2, rotulo: 'C', texto: '9', html: '9', correta: false },
    { posicao: 3, rotulo: 'D', texto: '5', html: '5', correta: false },
  ],
  gabarito: { alternativas_corretas: [{ posicao: 1, rotulo: 'B' }], resposta_discursiva: null },
  resolucao: { texto: '3 + 3 = 6', html: '3 + 3 = 6' }, bncc: ['EF03MA01'],
  origem: { plataforma: 'sae', acervo: 'SAE', id_externo: `external-${id}`, url_portal: 'https://app.sae.digital/' },
  midias: [], pendencias: [], midias_pendentes: 0,
})
const params = { codes: ['EF03MA01'], number: 1, type: 'objetiva' as const }
const discursive = (id = 1) => ({ ...original(id, `Explique a estratégia ${id}.`), tipo: 'discursiva', alternativas: [], gabarito: { alternativas_corretas: [], resposta_discursiva: 'Somar três duas vezes.' } })
const json = (value: unknown) => new Response(JSON.stringify(value))
function mockApi(ids: number[], detail = (id: number): unknown => original(id)) {
  const fetch = vi.fn(async (input: URL) => {
    if (input.pathname === '/api/v1/questoes') return json({ bncc_solicitada: input.searchParams.get('bncc'), total_elegiveis: new Set(ids).size, questoes: ids.map((id) => ({ id })) })
    return json({ questao: detail(Number(input.pathname.split('/').at(-1))) })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
beforeEach(() => {
  upload.mockReset().mockResolvedValue({ driveFileId: 'original-media', previewUrl: '/media.png' })
  vi.spyOn(Math, 'random').mockReturnValue(0.999999)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('questões do acervo', () => {
  it('planejamento sem BNCC busca por conteúdo e disciplina, confere aderência e preserva a classificação original', async () => {
    const raw = { ...original(9, 'Read the passage and identify its theme.'), bncc: ['EM13LGG403'] }
    const fetch = vi.fn(async (url: URL) => url.pathname === '/api/painel/questions' ? json({ items: [{ id: 9 }] }) : json({ questao: raw }))
    vi.stubGlobal('fetch', fetch)
    const acceptCandidate = vi.fn().mockResolvedValue(true)
    const result = await findAcervoQuestion({ ...params, codes: [], planningSearch: { subject: 'Inglês', title: 'Leadership', content: 'Vocabulary and theme' }, acceptCandidate })
    expect(result.question).toMatchObject({ source: 'acervo', bnccCodes: ['EM13LGG403'], correctLetter: 'B', acervoRef: { questionId: 9 } })
    expect(acceptCandidate).toHaveBeenCalledTimes(1)
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls.some((url) => url.pathname === '/api/v1/questoes')).toBe(false)
    expect(urls[0].searchParams.get('disciplina')).toBe('Língua Inglesa')
    expect(urls[0].searchParams.get('segmento')).toBe('Ensino Médio')
  })
  it('no EM descarta antes do Jev itens de outra disciplina declarada pelo acervo', async () => {
    const withDiscipline = (id: number, disciplina: string | null) => ({ ...original(id), bncc: ['EM13CNT301'], classificacoes: disciplina ? [{ kind: 'disciplina', label: 'Disciplina', value: disciplina }] : [] })
    const disciplines: Record<number, string | null> = { 1: 'Física', 2: 'Química', 3: 'Biologia', 4: null }
    mockApi([1, 2, 3, 4], (id) => withDiscipline(id, disciplines[id] ?? null))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const seen: number[] = []
    const acceptCandidate = vi.fn(async (question: { acervoRef?: { questionId: number } | null }) => { seen.push(question.acervoRef!.questionId); return false })
    await findAcervoQuestion({ ...params, codes: ['EM13CNT301'], planningSearch: { subject: 'Biologia', title: 'Genética', content: 'Herança' }, acceptCandidate })
    // Física e Química nunca chegam à conferência; sem disciplina declarada segue para o Jev.
    expect(seen.filter((id) => id <= 4).sort()).toEqual([3, 4])
  })
  it('no EM limita as conferências de aderência por questão e segue para o fallback', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => index + 1)
    mockApi(ids, (id) => ({ ...original(id, `Questão ${id}`), bncc: ['EM13CNT201'] }))
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: url.searchParams.get('bncc'), total_elegiveis: ids.length, questoes: ids.map((id) => ({ id })) })
      if (url.pathname === '/api/painel/questions') return json({ items: [] })
      return json({ questao: { ...original(Number(url.pathname.split('/').at(-1)), `Questão ${url.pathname}`), bncc: ['EM13CNT201'] } })
    }))
    const acceptCandidate = vi.fn().mockResolvedValue(false)
    const result = await findAcervoQuestion({ ...params, codes: ['EM13CNT201'], planningSearch: { subject: 'Biologia', title: 'x', content: 'y' }, acceptCandidate })
    expect(result.question).toBeNull()
    // O teto vale para os dois tipos tentados na busca por BNCC juntos.
    expect(acceptCandidate).toHaveBeenCalledTimes(24)
    expect(console.info).toHaveBeenCalledWith('[acervo/search] teto de conferências por questão atingido', expect.objectContaining({ alignmentChecks: 24 }))
  })
  it('sem conferência de aderência (fundamental) a busca continua sem teto', async () => {
    const ids = Array.from({ length: 60 }, (_, index) => index + 1)
    mockApi(ids, (id) => id === 60 ? original(id) : discursive(id))
    const found = await findAcervoQuestion(params)
    expect(found.question).toMatchObject({ type: 'objetiva', acervoRef: { questionId: 60 } })
  })
  it('candidato com BNCC correta mas incompatível não é consumido', async () => {
    mockApi([1, 2])
    const acceptCandidate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const result = await findAcervoQuestion({ ...params, acceptCandidate })
    expect(result.question?.acervoRef?.questionId).toBe(2)
    const retry = await findAcervoQuestion({ ...params, session: createAcervoSearchSession(), acceptCandidate: async () => true })
    expect(retry.question?.acervoRef?.questionId).toBe(1)
  })
  it('importa seleção manual sem BNCC e sem resolução, preservando gabarito e pendências originais', async () => {
    const raw = { ...original(7), bncc: [], pendencias: ['bncc_ausente', 'resolucao_ausente'], resolucao: { texto: '', html: '' } }
    mockApi([], () => raw)
    const imported = await importAcervoQuestionById(7, 1)
    expect(imported).toMatchObject({ bnccCodes: [], bnccStatus: 'nao_mapeado', correctLetter: 'B', acervoRef: { questionId: 7, original: { pendencias: raw.pendencias } } })
    expect(mapAcervoQuestion(raw, params)).toBeNull()
  })
  it('não importa manualmente uma questão sem gabarito ou com ID divergente', async () => {
    mockApi([], () => ({ ...original(7), gabarito: { alternativas_corretas: [], resposta_discursiva: null } }))
    await expect(importAcervoQuestionById(7, 1)).rejects.toThrow('gabarito desta questão no acervo é inconsistente')
    mockApi([], () => original(8))
    await expect(importAcervoQuestionById(7, 1)).rejects.toThrow('Não foi possível importar')
  })
  it('explica por que recusa formatos sem suporte, sem sugerir tentar de novo', async () => {
    const columns = { ...original(7), tipo: 'relacionar_colunas', alternativas: [], gabarito: { alternativas_corretas: [], resposta_discursiva: null } }
    mockApi([], () => columns)
    await expect(importAcervoQuestionById(7, 1)).rejects.toMatchObject({ name: 'Error', rejection: { code: 'unsupported_type', tipo: 'relacionar_colunas' }, message: expect.stringContaining('ligar/relacionar colunas') })
    const three = { ...original(7), alternativas: original(7).alternativas.slice(0, 3) }
    mockApi([], () => three)
    await expect(importAcervoQuestionById(7, 1)).rejects.toThrow('tem 3 alternativas; o cartão-resposta exige 4 ou 5')
    const pending = { ...discursive(7), pendencias: ['gabarito_estruturado_nao_disponivel_no_dom'] }
    mockApi([], () => pending)
    await expect(importAcervoQuestionById(7, 1)).rejects.toThrow('o gabarito não está disponível na fonte')
    mockApi([], () => ({ ...original(7), midias_pendentes: 1 }))
    const processing = await importAcervoQuestionById(7, 1).catch((error: unknown) => error)
    expect(processing).toBeInstanceOf(Error)
    expect(processing).not.toHaveProperty('rejection')
    expect((processing as Error).message).toContain('ainda estão sendo processadas')
    for (const raw of [columns, three, pending]) {
      mockApi([], () => raw)
      await expect(importAcervoQuestionById(7, 1)).rejects.not.toThrow('tente novamente')
    }
  })
  it('usa dissertativa somente após esgotar as objetivas e preserva o original', async () => {
    const fetch = mockApi([1], discursive)
    const found = await findAcervoQuestion(params)
    expect(found.question).toMatchObject({ source: 'acervo', type: 'descritiva', alternatives: null, correctLetter: null, expectedAnswer: 'Somar três duas vezes.', bnccCodes: ['EF03MA01'] })
    expect(found.question?.acervoRef?.original).toMatchObject(discursive())
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(console.info).toHaveBeenCalledWith('[acervo/search] tipo alternativo usado antes da IA', expect.objectContaining({ questionId: 1, requestedType: 'objetiva', importedType: 'descritiva' }))
  })
  it('prioriza uma objetiva posterior em vez de aceitar a primeira dissertativa', async () => {
    mockApi([1, 2], (id) => id === 1 ? discursive(id) : original(id))
    const found = await findAcervoQuestion(params)
    expect(found.question).toMatchObject({ type: 'objetiva', acervoRef: { questionId: 2 } })
  })
  it('busca objetivas em todas as habilidades antes de tentar dissertativa', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') {
        const code = url.searchParams.get('bncc')!
        return json({ bncc_solicitada: code, total_elegiveis: 1, questoes: [{ id: code === 'EF03MA01' ? 1 : 2 }] })
      }
      return json({ questao: url.pathname.endsWith('/1') ? discursive(1) : { ...original(2), bncc: ['EF03MA02'] } })
    }))
    expect((await findAcervoQuestion({ ...params, codes: ['EF03MA01', 'EF03MA02'] })).question).toMatchObject({ type: 'objetiva', bnccCodes: ['EF03MA02'] })
  })
  it('aproveita as 46 objetivas quando o tipo dissertativo não existe no catálogo', async () => {
    const fetch = mockApi(Array.from({ length: 46 }, (_, index) => index + 1))
    const found = await findAcervoQuestion({ ...params, type: 'descritiva' })
    expect(found.question).toMatchObject({ source: 'acervo', type: 'objetiva', correctLetter: 'B', expectedAnswer: null, acervoRef: { questionId: 1 } })
    expect(found.question?.acervoRef?.original.gabarito).toEqual(original().gabarito)
    expect(fetch).toHaveBeenCalledTimes(47)
    expect(console.info).toHaveBeenCalledWith('[acervo/search] tipo alternativo usado antes da IA', expect.objectContaining({ requestedType: 'descritiva', importedType: 'objetiva' }))
  })
  it('continua priorizando dissertativa quando ela estiver disponível', async () => {
    mockApi([1, 2], (id) => id === 1 ? original(id) : discursive(id))
    expect((await findAcervoQuestion({ ...params, type: 'descritiva' })).question).toMatchObject({ type: 'descritiva', acervoRef: { questionId: 2 } })
  })
  it('não aceita dissertativa incompleta como alternativa ao item objetivo', async () => {
    mockApi([1], () => ({ ...discursive(), gabarito: { alternativas_corretas: [], resposta_discursiva: null }, resolucao: { texto: '', html: '' } }))
    expect((await findAcervoQuestion(params)).question).toBeNull()
  })
  it('respeita o histórico também ao procurar dissertativas de reserva', async () => {
    const fetch = mockApi([1], discursive)
    expect((await findAcervoQuestion({ ...params, history: [{ key: 'SAE:external-1', statement: 'Já usada', questionId: 1 }] })).question).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('não repete a mesma dissertativa entre posições concorrentes', async () => {
    mockApi([1, 2], discursive)
    const session = createAcervoSearchSession()
    const results = await Promise.all([1, 2].map((number) => findAcervoQuestion({ ...params, number, session })))
    expect(results.every((result) => result.question?.type === 'descritiva')).toBe(true)
    expect(new Set(results.map((result) => result.question?.acervoRef?.questionId)).size).toBe(2)
  })
  it('importa imagens simultaneamente com limite e preserva questões diferentes', async () => {
    const session = createAcervoSearchSession()
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toBuffer()
    // Resolve the Vitest dynamic-import mock before concurrent imports.
    await import('@/lib/images/questionImageService')
    const releases: Array<() => void> = []
    upload.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve({ driveFileId: 'media', previewUrl: '/media.png' }))))
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 5, questoes: [1, 2, 3, 4, 5].map((id) => ({ id })) })
      if (url.pathname === '/api/media/123') return new Response(new Uint8Array(png).buffer, { headers: { 'Content-Type': 'image/png' } })
      const id = Number(url.pathname.split('/').at(-1))
      return json({ questao: { ...original(id, `Questão distinta ${id}`), midias: [{ id: 123, local: 'enunciado', alternativa_posicao: -1, posicao: 0, status: 'baixada', url: '/api/media/123' }] } })
    }))
    const pending = Promise.all([1, 2, 3, 4, 5].map((number) => findAcervoQuestion({ ...params, number, session })))
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4), { timeout: 2000 })
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(5), { timeout: 2000 })
    releases.splice(0).forEach((release) => release())
    const result = await pending
    expect(result.every((r) => r.question?.image)).toBe(true)
    expect(new Set(result.map((r) => r.question?.acervoRef?.questionId)).size).toBe(5)
  })
  it('busca slots em paralelo sem repetir IDs e compartilha catálogo e detalhes', async () => {
    const session = createAcervoSearchSession()
    const fetch = mockApi([1, 2, 3, 4], (id) => original(id, `Enunciado exclusivo ${id}`))
    const result = await Promise.all([1, 2, 3, 4].map((number) => findAcervoQuestion({ ...params, number, session })))
    expect(new Set(result.map((r) => r.question?.acervoRef?.questionId)).size).toBe(4)
    expect(result.every((r) => r.question)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(session.stats.cacheHits).toBeGreaterThan(0)
  })
  it('impede conteúdo repetido mesmo quando os IDs concorrentes são diferentes', async () => {
    const session = createAcervoSearchSession()
    mockApi([1, 2])
    const result = await Promise.all([1, 2].map((number) => findAcervoQuestion({ ...params, number, session })))
    expect(result.filter((r) => r.question)).toHaveLength(1)
  })
  it('limita requisições simultâneas e percorre todo o catálogo sem baixar cada ID de novo', async () => {
    const session = createAcervoSearchSession()
    let active = 0
    let peak = 0
    const fetch = vi.fn(async (url: URL) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 40, questoes: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })) })
      return json({ questao: { ...original(Number(url.pathname.split('/').at(-1))), tipo: 'somatoria' } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await Promise.all([1, 2, 3].map((number) => findAcervoQuestion({ ...params, number, session })))
    expect(result.every((r) => !r.question)).toBe(true)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    expect(fetch).toHaveBeenCalledTimes(41)
  })
  it('repete uma consulta que falhou na mesma sessão sem consumir o ID', async () => {
    const session = createAcervoSearchSession()
    const history: Array<{ key: string; statement: string; questionId: number }> = []
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 1, questoes: [{ id: 1 }] })
      return ++attempts === 1 ? new Response('{}', { status: 503 }) : json({ questao: original() })
    }))
    expect((await findAcervoQuestion({ ...params, session, history })).question).toBeNull()
    expect((await findAcervoQuestion({ ...params, session, history })).question?.acervoRef?.questionId).toBe(1)
    expect(history).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ questionId: 1, bnccCode: 'EF03MA01', stage: 'detail_request', httpStatus: 503 }))
  })
  it('libera a reserva após falha ao importar a imagem e permite tentar o mesmo ID de novo', async () => {
    const session = createAcervoSearchSession()
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 1, questoes: [{ id: 1 }] })
      if (url.pathname === '/api/media/123') return new Response(new Uint8Array(png).buffer, { headers: { 'Content-Type': 'image/png' } })
      return json({ questao: { ...original(), midias: [{ id: 123, local: 'enunciado', alternativa_posicao: -1, posicao: 0, status: 'baixada', url: '/api/media/123' }] } })
    }))
    upload.mockRejectedValueOnce(new Error('upload unavailable'))
    expect((await findAcervoQuestion({ ...params, session })).question).toBeNull()
    expect((await findAcervoQuestion({ ...params, session })).question?.image?.driveFileId).toBe('original-media')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ questionId: 1, stage: 'media_import' }))
  })
  it('preserva enunciado, resolução e origem sem inventar classificação', () => {
    const question = mapAcervoQuestion(original(), params)!
    expect(question.statement).toBe(original().enunciado.texto)
    expect(question.correctLetter).toBe('B')
    expect(question.acervoRef?.original.gabarito).toEqual(original().gabarito)
    expect(question.commentedResolution).toBe('3 + 3 = 6')
    expect(question.pedagogicalClassification.dok.confidence).toBe(0)
    expect(questionOriginLabel(question)).toBe('IMPORTADA DO SAE')
  })
  it('preserva resposta discursiva original', () => {
    const raw = { ...original(), tipo: 'discursiva', alternativas: [], gabarito: { alternativas_corretas: [], resposta_discursiva: 'Seis.' } }
    expect(mapAcervoQuestion(raw, { ...params, type: 'descritiva' })?.expectedAnswer).toBe('Seis.')
    expect(mapAcervoQuestion({ ...raw, gabarito: { ...raw.gabarito, resposta_discursiva: null }, resolucao: { texto: '', html: '' } }, { ...params, type: 'descritiva' })).toBeNull()
  })
  it('importa a resposta e resolução com as fórmulas completas do HTML original', () => {
    const formula = String.raw`f'_1 = \frac{1}{2L}\sqrt{\frac{4T}{\mu}} = 40\text{ Hz}`
    const raw = { ...original(), tipo: 'discursiva', alternativas: [],
      gabarito: { alternativas_corretas: [], resposta_discursiva: formula },
      resolucao: { texto: formula, html: `<p><math><semantics><annotation>${formula}</annotation></semantics></math></p>` },
    }
    const imported = mapAcervoQuestion(raw, { ...params, type: 'descritiva' })!
    expect(imported.expectedAnswer).toBe(`$${formula}$`)
    expect(imported.commentedResolution).toBe(`$${formula}$`)
    expect(imported.gradingCriteria).toContain(`$${formula}$`)
    expect(imported.acervoRef!.original.gabarito).toEqual(raw.gabarito)
  })
  it.each([
    { tipo: 'somatoria' }, { tipo: 'certo_errado' }, { pendencias: ['Conteúdo incompleto'] }, { midias_pendentes: 1 },
    { gabarito: { alternativas_corretas: [], resposta_discursiva: null } },
    { gabarito: { alternativas_corretas: [{ posicao: 0, rotulo: 'A' }, { posicao: 1, rotulo: 'B' }], resposta_discursiva: null } },
  ])('não importa item incompatível ou incompleto: %j', (patch) => {
    expect(mapAcervoQuestion({ ...original(), ...patch }, params)).toBeNull()
  })
  it.each([2, 3, 6])('não importa objetiva com %i alternativas (cartão-resposta aceita só 4 ou 5)', (count) => {
    const alternativas = Array.from({ length: count }, (_, i) => ({ posicao: i, rotulo: String.fromCharCode(65 + i), texto: String(i), html: String(i), correta: i === 1 }))
    expect(mapAcervoQuestion({ ...original(), alternativas }, params)).toBeNull()
    expect(mapAcervoQuestion({ ...original(), alternativas }, { ...params, manualSelection: true })).toBeNull()
  })
  it('importa objetiva com 5 alternativas', () => {
    const alternativas = Array.from({ length: 5 }, (_, i) => ({ posicao: i, rotulo: String.fromCharCode(65 + i), texto: String(i), html: String(i), correta: i === 1 }))
    expect(mapAcervoQuestion({ ...original(), alternativas }, params)?.alternatives).toHaveLength(5)
  })
  it.each(['image/png', 'binary/octet-stream'])('copia mídias originais (%s) e registra a URL da questão completa', async (contentType) => {
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toBuffer()
    const raw = { ...original(), midias: [{ id: 123, local: 'enunciado', alternativa_posicao: -1, posicao: 0, status: 'baixada', url: '/api/media/123' }] }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 1, questoes: [{ id: 1 }] }))
      .mockResolvedValueOnce(json({ questao: raw }))
      .mockResolvedValueOnce(new Response(new Uint8Array(png).buffer, { headers: { 'Content-Type': contentType } })))
    const found = await findAcervoQuestion(params)
    expect(found.question?.image).toMatchObject({ driveFileId: 'original-media', source: 'importado', approved: true, originalBankMedia: true, sourceUrl: 'http://192.168.1.77:5050/api/v1/questoes/1' })
    expect(upload).toHaveBeenCalled()
  })
  it('lista os IDs por BNCC e busca o conteúdo pelo ID, incluindo IDs grandes', async () => {
    const id = 1000000004013
    const fetch = mockApi([id])
    const found = await findAcervoQuestion(params)
    expect(found.question?.acervoRef?.questionId).toBe(id)
    const list = fetch.mock.calls[0]![0]
    expect(list.origin).toBe('http://192.168.1.77:5050')
    expect(list.pathname).toBe('/api/v1/questoes')
    expect([...list.searchParams]).toEqual([['bncc', 'EF03MA01']])
    expect(fetch.mock.calls[1]![0].pathname).toBe(`/api/v1/questoes/${id}`)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('exclui IDs da prova antes de baixar o conteúdo', async () => {
    const fetch = mockApi([1, 2], (id) => original(id, 'Qual é o triplo de dois?'))
    const found = await findAcervoQuestion({ ...params, excludedQuestions: [mapAcervoQuestion(original(), params)!] })
    expect(found.question?.acervoRef?.questionId).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('evita repetição de conteúdo mesmo com IDs diferentes', async () => {
    mockApi([2])
    const found = await findAcervoQuestion({ ...params, excludedQuestions: [mapAcervoQuestion(original(), params)!] })
    expect(found.question).toBeNull()
    expect(found.reason).toContain('Nenhuma questão compatível')
  })
  it('exclui IDs persistidos no histórico sem buscar o conteúdo novamente', async () => {
    const fetch = mockApi([1])
    const found = await findAcervoQuestion({ ...params, history: [{ key: 'SAE:external-1', statement: 'Texto antigo', questionId: 1 }] })
    expect(found.question).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('mantém compatibilidade com o histórico antigo sem ID numérico', async () => {
    mockApi([1])
    const existing = mapAcervoQuestion(original(), params)!
    expect((await findAcervoQuestion({ ...params, history: [{ key: acervoIdentity(existing)!, statement: existing.statement }] })).question).toBeNull()
  })
  it('preserva IDs numéricos grandes ao validar o histórico salvo', () => {
    const history = [{ key: 'SAE:abc', statement: 'Questão usada', questionId: 1000000004013 }]
    expect(examGenerationResultSchema.shape.metadata.shape.acervoHistory.parse(history)).toEqual(history)
  })
  it('exclui do próximo pedido somente a questão importada com sucesso', async () => {
    const history: Array<{ key: string; statement: string; questionId: number }> = []
    mockApi([1, 2], (id) => original(id, `Enunciado diferente ${id}`))
    const first = (await findAcervoQuestion({ ...params, history })).question!
    history.push({ key: acervoIdentity(first)!, statement: first.statement, questionId: first.acervoRef!.questionId })
    const fetch = mockApi([1, 2], (id) => original(id, `Enunciado diferente ${id}`))
    const next = (await findAcervoQuestion({ ...params, history, excludedQuestions: [first] })).question!
    expect(next.acervoRef!.questionId).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('não perde uma questão compatível após os primeiros 126 IDs', async () => {
    const fetch = mockApi(Array.from({ length: 127 }, (_, i) => i + 1), (id) => ({ ...original(id), tipo: id === 127 ? 'multipla_escolha' : 'somatoria' }))
    expect((await findAcervoQuestion(params)).question?.acervoRef?.questionId).toBe(127)
    expect(fetch).toHaveBeenCalledTimes(128)
    expect(new Set(fetch.mock.calls.slice(1).map(([url]) => url.pathname)).size).toBe(127)
  })
  it('embaralha a lista sem repetir IDs recebidos em duplicidade', async () => {
    vi.mocked(Math.random).mockReturnValue(0)
    const fetch = mockApi([1, 2, 2, 3], (id) => ({ ...original(id), tipo: 'somatoria' }))
    const found = await findAcervoQuestion(params)
    expect(found.question).toBeNull()
    const paths = fetch.mock.calls.slice(1).map(([url]) => url.pathname)
    expect(paths).not.toEqual(['/api/v1/questoes/1', '/api/v1/questoes/2', '/api/v1/questoes/3'])
    expect(new Set(paths).size).toBe(3)
  })
  it('não marca falha de download como uso e tenta o mesmo ID numa nova busca', async () => {
    const history = [{ key: 'SAE:external-9', statement: 'Outra questão', questionId: 9 }]
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 1, questoes: [{ id: 1 }] }))
      .mockRejectedValueOnce(new Error('timeout')))
    const failed = await findAcervoQuestion({ ...params, history })
    expect(failed.question).toBeNull()
    expect(failed.reason).toContain('gerada por IA')
    mockApi([1])
    expect((await findAcervoQuestion({ ...params, history })).question?.acervoRef?.questionId).toBe(1)
    expect(history).toHaveLength(1)
  })
  it('continua para outro ID quando o detalhe foi removido ou falhou', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 2, questoes: [{ id: 1 }, { id: 2 }] }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(json({ questao: original(2) })))
    expect((await findAcervoQuestion(params)).question?.acervoRef?.questionId).toBe(2)
  })
  it('continua para outro ID quando as mídias do primeiro estão indisponíveis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/api/v1/questoes') return json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 2, questoes: [{ id: 1 }, { id: 2 }] })
      if (url.pathname === '/api/media/123') return new Response('{}', { status: 503 })
      const id = Number(url.pathname.split('/').at(-1))
      return json({ questao: id === 1 ? { ...original(1), midias: [{ id: 123, local: 'enunciado', alternativa_posicao: -1, posicao: 0, status: 'baixada', url: '/api/media/123' }] } : original(2) })
    }))
    expect((await findAcervoQuestion(params)).question?.acervoRef?.questionId).toBe(2)
  })
  it.each([404, 200])('indica ausência real para lista vazia (HTTP %s)', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status === 404 ? new Response('{}', { status }) : json({ bncc_solicitada: 'EF03MA01', total_elegiveis: 0, questoes: [] })))
    expect((await findAcervoQuestion(params)).reason).toContain('Nenhuma questão compatível')
  })
  it.each([503, 400])('falha HTTP %s da listagem não vira esgotamento', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    expect((await findAcervoQuestion(params)).reason).toContain('gerada por IA')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'catalog_request', httpStatus: status }))
  })
  it.each([
    { bncc_solicitada: 'EF05LP01', total_elegiveis: 1, questoes: [{ id: 1 }] },
    { bncc_solicitada: 'EF03MA01', total_elegiveis: 127, questoes: [{ id: 1 }] },
  ])('recusa listagem inconsistente ou incompleta', async (catalog) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(catalog)))
    expect((await findAcervoQuestion(params)).reason).toContain('gerada por IA')
  })
  it.each([
    { ...original(), id: 2 }, { ...original(), bncc: ['EF05LP01'] },
  ])('recusa detalhe com ID ou BNCC inconsistente', async (raw) => {
    mockApi([1], () => raw)
    expect((await findAcervoQuestion(params)).question).toBeNull()
  })
  it('converte falha de rede da lista em motivo explícito para IA', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect((await findAcervoQuestion(params)).reason).toContain('gerada por IA')
  })
  it('não esconde falha de detalhe quando o mesmo ID aparece em outra BNCC', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.searchParams.has('bncc')
      ? json({ bncc_solicitada: url.searchParams.get('bncc'), total_elegiveis: 1, questoes: [{ id: 1 }] })
      : new Response('{}', { status: 503 })))
    const found = await findAcervoQuestion({ ...params, codes: ['EF03MA01', 'EF03MA02'] })
    expect(found.question).toBeNull()
    expect(found.reason).toContain('gerada por IA')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ questionId: 1, httpStatus: 503 }))
  })
})
