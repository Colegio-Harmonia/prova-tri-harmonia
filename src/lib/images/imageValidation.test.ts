import { describe, expect, it } from 'vitest'

import { parseImageValidationResponse } from './imageValidation'

const verdict = {
  usable: true,
  layoutComplete: true,
  containsInstructionalText: false,
  textLegible: true,
  textMatchesExpected: false,
  reason: 'O diagrama está completo.',
}

describe('resposta do validador visual', () => {
  it('aceita JSON envelopado em bloco Markdown pelo provedor', () => {
    expect(parseImageValidationResponse(`\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``)).toEqual(verdict)
  })

  it('continua rejeitando texto que não seja um objeto JSON', () => {
    expect(() => parseImageValidationResponse('Parecer: imagem adequada.')).toThrow()
  })

  it('mantém todas as propriedades obrigatórias no contrato do parecer', () => {
    expect(Object.keys(verdict).sort()).toEqual([
      'containsInstructionalText',
      'layoutComplete',
      'reason',
      'textLegible',
      'textMatchesExpected',
      'usable',
    ])
  })
})
