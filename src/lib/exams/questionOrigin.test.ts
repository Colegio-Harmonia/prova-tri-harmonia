import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { isOriginalBankImage, isQuestionImageApproved, questionBoardLabel, questionPrintAttribution, questionProvenanceTags } from './questionOrigin'

function imported(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    source: 'acervo',
    acervoRef: { questionId: 1, origin: 'SAE', externalId: '1', portalUrl: null, importedAt: '', original: {} },
    image: { source: 'importado', driveFileId: 'original', previewUrl: '/image', approved: false, sourceUrl: 'http://acervo.local:5000/api/v1/questoes/aleatoria' },
    ...overrides,
  } as ExamQuestion
}

describe('aceite das imagens originais do banco', () => {
  it('aceita os originais legados do acervo e do ENEM sem novo aceite', () => {
    expect(isQuestionImageApproved(imported())).toBe(true)
    expect(isQuestionImageApproved(imported({ source: 'enem_bank', enemBankRef: { questionId: 2, year: 2020 }, image: { source: 'enem', driveFileId: 'enem', previewUrl: '/image', approved: false } }))).toBe(true)
  })

  it('aceita o marcador de procedência em novas importações', () => {
    expect(isQuestionImageApproved(imported({ image: { source: 'importado', driveFileId: 'original', previewUrl: '/image', originalBankMedia: true, approved: false } }))).toBe(true)
  })

  it.each(['gerada', 'busca', 'importado'] as const)('mantém revisão para uma imagem substituída: %s', (source) => {
    expect(isQuestionImageApproved(imported({ image: { source, driveFileId: 'replacement', previewUrl: '/image', sourceUrl: 'https://example.com/image.png', approved: false } }))).toBe(false)
  })

  it('não considera uma questão de IA original do banco nem inventa mídia ausente', () => {
    expect(isOriginalBankImage(imported({ source: 'ia' }))).toBe(false)
    expect(isQuestionImageApproved(imported({ image: null }))).toBe(false)
  })
})


describe('banca e crédito de importação', () => {
  it('distingue banca, origem editorial, acervo e plataforma nas tags', () => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, origin: 'ARCO', original: { origem: { banca: 'FUVEST', ano: 2024, criacao: 'STUDOS', acervo: 'ARCO', plataforma: 'sae' } } } })
    expect(questionProvenanceTags(question)).toEqual(['Banca: FUVEST — 2024', 'Origem: STUDOS', 'Acervo: ARCO', 'Banco: SAE'])
    expect(questionPrintAttribution(question)).toBe('FUVEST — 2024')
  })
  it('não inventa banca quando a questão só informa origem e acervo', () => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, original: { origem: { banca: null, criacao: 'STUDOS', acervo: 'ARCO' } } } })
    expect(questionProvenanceTags(question)).toEqual(['Origem: STUDOS', 'Acervo: ARCO'])
  })
  it.each(['UEFS - BA', { label: 'UEFS - BA', value: '356' }])('compartilha banca/ano entre tags e documento: %j', (banca) => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, original: { origem: { banca, ano: 2015 } } } })
    expect(questionBoardLabel(question)).toBe('UEFS - BA — 2015')
    expect(questionPrintAttribution(question)).toBe('UEFS - BA — 2015')
  })
  it.each([['TECHY', 'Importado do Techy'], ['SAE', 'Importado do SAE'], [' Techy ', 'Importado do Techy']])('credita original %s sem banca', (origin, expected) => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, origin, original: { origem: { banca: { label: '  ' } } } } })
    expect(questionBoardLabel(question)).toBeNull()
    expect(questionPrintAttribution(question)).toBe(expected)
  })
  it('prioriza a banca mesmo em questão do Techy', () => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, origin: 'TECHY', original: { origem: { banca: 'FUVEST' } } } })
    expect(questionPrintAttribution(question)).toBe('FUVEST')
  })
  it('não confunde acervo ARCO com a plataforma SAE', () => {
    const question = imported({ acervoRef: { ...imported().acervoRef!, origin: 'ARCO', original: { origem: { plataforma: 'SAE', acervo: 'ARCO' } } } })
    expect(questionPrintAttribution(question)).toBeNull()
  })
  it('preserva ENEM e não inventa banca para IA ou origem ausente', () => {
    expect(questionPrintAttribution(imported({ source: 'enem_bank', enemBankRef: { questionId: 2, year: 2020 } }))).toBe('ENEM 2020')
    expect(questionPrintAttribution(imported({ source: 'ia' }))).toBeNull()
    expect(questionPrintAttribution(imported({ acervoRef: null }))).toBeNull()
  })
})
