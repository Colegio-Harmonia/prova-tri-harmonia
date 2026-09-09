import { describe, expect, it } from 'vitest'
import { findExcludedTopicsInQuestion, normalizeExcludedTopics, replacementStrategyInstruction } from './replacementPolicy'

describe('replacementPolicy', () => {
  it('normaliza termos excluídos sem duplicar variações de acento', () => {
    expect(normalizeExcludedTopics([' Aristóteles ', 'aristoteles', 'Ética   antiga'])).toEqual(['Aristóteles', 'Ética antiga'])
  })

  it('bloqueia termo excluído em qualquer campo que será salvo na questão', () => {
    expect(
      findExcludedTopicsInQuestion(
        {
          statement: 'Analise a contribuição de Sócrates.',
          alternatives: [{ text: 'A influência de ARISTÓTELES na lógica.' }],
        },
        ['aristoteles'],
      ),
    ).toEqual(['aristoteles'])
  })

  it('instrui outro tema como mudança de conteúdo, não apenas de redação', () => {
    expect(
      replacementStrategyInstruction({ strategy: 'outro_tema_planejamento', excludedTopics: ['Aristóteles'] }),
    ).toContain('OUTRO TEMA')
  })
})
