import { describe, expect, it } from 'vitest'

import { isStaffSuperuser, ROLE_LABELS } from './roles'

describe('politica de papeis', () => {
  it('mantem os rotulos institucionais para os tres papeis permitidos', () => {
    expect(ROLE_LABELS).toEqual({
      professor: 'Professor(a)',
      coordenacao: 'Coordenação',
      direcao: 'Direção',
    })
  })

  it('concede visao de superusuario somente para coordenacao e direcao', () => {
    expect(isStaffSuperuser('coordenacao')).toBe(true)
    expect(isStaffSuperuser('direcao')).toBe(true)
    expect(isStaffSuperuser('professor')).toBe(false)
    expect(isStaffSuperuser('Coordenacao')).toBe(false)
    expect(isStaffSuperuser('')).toBe(false)
  })
})
