import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { mergeAdaptationLibraries } from './mergeLibraries'
import { validateEquivalence, equivalenceApproved } from './equivalenceValidator'
import { buildAdaptationPrompt } from './adaptationPromptBuilder'
import type { AdaptedQuestion } from './adaptationSchema'

// Fixture mínima: o validador e o prompt só tocam campos de forma
// (number/type/statement/supportText/alternatives/correctLetter).
function objetiva(number: number): ExamQuestion {
  return {
    number,
    type: 'objetiva',
    statement: `Enunciado da questão ${number}`,
    supportText: null,
    alternatives: [
      { letter: 'A', text: 'alt A' },
      { letter: 'B', text: 'alt B' },
      { letter: 'C', text: 'alt C' },
      { letter: 'D', text: 'alt D' },
      { letter: 'E', text: 'alt E' },
    ],
    correctLetter: 'C',
  } as unknown as ExamQuestion
}

function descritiva(number: number): ExamQuestion {
  return {
    number,
    type: 'descritiva',
    statement: `Explique a questão ${number}`,
    supportText: null,
    alternatives: null,
    correctLetter: null,
  } as unknown as ExamQuestion
}

function adapted(number: number, overrides: Partial<AdaptedQuestion> = {}): AdaptedQuestion {
  return {
    number,
    adaptedStatement: `Enunciado adaptado ${number}`,
    adaptedSupportText: null,
    adaptedAlternatives: [
      { letter: 'A', text: 'alt A adaptada' },
      { letter: 'B', text: 'alt B adaptada' },
      { letter: 'C', text: 'alt C adaptada' },
      { letter: 'D', text: 'alt D adaptada' },
      { letter: 'E', text: 'alt E adaptada' },
    ],
    formulaSupport: null,
    visualSupportSuggestion: null,
    imageDescription: null,
    removedElements: [],
    adaptationNotes: 'linguagem simplificada',
    harmonizationNotes: null,
    ...overrides,
  }
}

describe('mergeAdaptationLibraries', () => {
  it('TEA + TDAH: conflito de suporte visual resolve pra essential_only, em código', () => {
    const merged = mergeAdaptationLibraries(['tdah', 'tea'])
    expect(merged.profiles).toEqual(['tea', 'tdah']) // ordenado por prioridade, TEA primeiro
    expect(merged.layout.visualSupports).toBe('essential_only')
    expect(merged.layout.boldCommandKeywords).toBe(true)
    expect(merged.layout.lineSpacing).toBe(1.5)
  })

  it('Baixa Visão + Discalculia: máximos numéricos e ORs booleanos', () => {
    const merged = mergeAdaptationLibraries(['discalculia', 'baixa_visao'])
    expect(merged.layout.minFontPt).toBe(18)
    expect(merged.layout.fontFamily).toBe('sans-serif')
    expect(merged.layout.extraAnswerSpace).toBe(true)
    expect(merged.layout.formulaSupportHeader).toBe(true)
    expect(merged.layout.highContrast).toBe(true)
  })

  it('grava a versão de cada biblioteca aplicada (auditoria)', () => {
    const merged = mergeAdaptationLibraries(['tea'])
    expect(merged.libraryVersions).toEqual({ tea: '1.0' })
  })

  it('deduplica perfis e rejeita perfil desconhecido (dado do banco é text[])', () => {
    expect(mergeAdaptationLibraries(['tea', 'tea']).profiles).toEqual(['tea'])
    expect(() => mergeAdaptationLibraries(['dislexia' as never])).toThrow()
  })
})

describe('validateEquivalence', () => {
  const original = [objetiva(1), objetiva(2), descritiva(3)]

  it('adaptação fiel passa limpa', () => {
    const report = validateEquivalence(original, [adapted(1), adapted(2), adapted(3, { adaptedAlternatives: null })])
    expect(report.issues).toEqual([])
    expect(equivalenceApproved(report)).toBe(true)
  })

  it('questão faltando ou sobrando reprova', () => {
    const missing = validateEquivalence(original, [adapted(1), adapted(3, { adaptedAlternatives: null })])
    expect(missing.questionCountMatch).toBe(false)
    expect(equivalenceApproved(missing)).toBe(false)

    const extra = validateEquivalence(original, [adapted(1), adapted(2), adapted(3, { adaptedAlternatives: null }), adapted(9)])
    expect(extra.questionCountMatch).toBe(false)
  })

  it('mudar a quantidade de alternativas reprova', () => {
    const report = validateEquivalence(original, [
      adapted(1, { adaptedAlternatives: [{ letter: 'A', text: 'a' }, { letter: 'B', text: 'b' }] }),
      adapted(2),
      adapted(3, { adaptedAlternatives: null }),
    ])
    expect(report.alternativesCountIntact).toBe(false)
    expect(equivalenceApproved(report)).toBe(false)
  })

  it('reordenar/remover a letra correta reprova (gabarito intocável)', () => {
    const shuffled = [
      { letter: 'B', text: 'b' },
      { letter: 'A', text: 'a' },
      { letter: 'C', text: 'c' },
      { letter: 'D', text: 'd' },
      { letter: 'E', text: 'e' },
    ]
    const report = validateEquivalence(original, [adapted(1, { adaptedAlternatives: shuffled }), adapted(2), adapted(3, { adaptedAlternatives: null })])
    expect(report.answerKeyIntact).toBe(false)
  })

  it('descritiva não pode ganhar alternativas', () => {
    const report = validateEquivalence(original, [adapted(1), adapted(2), adapted(3)])
    expect(report.issues.some((i) => i.includes('descritiva'))).toBe(true)
    expect(equivalenceApproved(report)).toBe(false)
  })
})

describe('buildAdaptationPrompt', () => {
  const questions = [objetiva(1), descritiva(2)]

  it('inclui as regras invioláveis e o bloco da biblioteca', () => {
    const prompt = buildAdaptationPrompt(questions, mergeAdaptationLibraries(['tea']))
    expect(prompt).toContain('REGRAS INVIOLÁVEIS')
    expect(prompt).toContain('NUNCA altere a resposta correta')
    expect(prompt).toContain('TEA (Transtorno do Espectro Autista) — biblioteca v1.0')
    expect(prompt).not.toContain('Harmonização de múltiplos perfis')
  })

  it('com 2+ perfis, adiciona o bloco de harmonização na ordem de prioridade', () => {
    const prompt = buildAdaptationPrompt(questions, mergeAdaptationLibraries(['tdah', 'tea']))
    expect(prompt).toContain('Harmonização de múltiplos perfis')
    expect(prompt.indexOf('TEA (Transtorno')).toBeLessThan(prompt.indexOf('TDAH ('))
  })

  it('nunca vaza gabarito/critérios pro prompt (a IA não pode alterá-los nem vê-los)', () => {
    const withAnswer = { ...objetiva(1), expectedAnswer: 'segredo-gabarito', gradingCriteria: 'criterio-secreto' } as ExamQuestion
    const prompt = buildAdaptationPrompt([withAnswer], mergeAdaptationLibraries(['tea']))
    expect(prompt).not.toContain('segredo-gabarito')
    expect(prompt).not.toContain('criterio-secreto')
    expect(prompt).not.toContain('correctLetter')
  })
})
