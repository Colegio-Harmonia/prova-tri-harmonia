import { describe, expect, it } from 'vitest'

import { getEnemAreaForSubject } from './enemAreaMap'

describe('mapa de areas ENEM', () => {
  it('agrupa disciplinas escolares nas quatro areas oficiais usadas pelo banco importado', () => {
    expect(getEnemAreaForSubject('Língua Portuguesa')).toBe('linguagens')
    expect(getEnemAreaForSubject('Inglês')).toBe('linguagens')
    expect(getEnemAreaForSubject('Matemática')).toBe('matematica')
    expect(getEnemAreaForSubject('Biologia')).toBe('ciencias-natureza')
    expect(getEnemAreaForSubject('Geografia')).toBe('ciencias-humanas')
  })

  it('nao inventa area quando a disciplina nao faz parte do mapeamento', () => {
    expect(getEnemAreaForSubject('Redação')).toBeNull()
    expect(getEnemAreaForSubject('geografia')).toBeNull()
  })
})
