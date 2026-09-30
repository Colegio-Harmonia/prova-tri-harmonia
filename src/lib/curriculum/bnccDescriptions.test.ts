import { describe, expect, it } from 'vitest'
import { applyBnccDescriptions } from './bnccDescriptions'

describe('applyBnccDescriptions', () => {
  it('preenche descrição ausente pelo código normalizado', () => {
    const rows = applyBnccDescriptions(
      [{ code: 'ef05lp06', description: null }],
      new Map([['EF05LP06', 'Flexionar adequadamente os verbos.']]),
    )
    expect(rows[0].description).toBe('Flexionar adequadamente os verbos.')
  })

  it('preserva a descrição já informada na planilha', () => {
    const rows = applyBnccDescriptions(
      [{ code: 'EF05LP06', description: 'Descrição da escola' }],
      new Map([['EF05LP06', 'Descrição oficial']]),
    )
    expect(rows[0].description).toBe('Descrição da escola')
  })
})
