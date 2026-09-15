import { describe, expect, it } from 'vitest'
import {
  CANONICAL_DOMAIN_IDS,
  canonicalDomainsForSubject,
  computeCanonicalDomain,
  hasCanonicalDomain,
  isCanonicalDomainId,
} from './domains'

describe('motor de domínios canônicos', () => {
  it('cobre os domínios exigidos, sem buraco para `other`', () => {
    const required = [
      'linear_system', 'percentage', 'ratio_proportion', 'simple_interest', 'compound_interest',
      'arithmetic_progression', 'geometric_progression', 'linear_recurrence', 'linear_function',
      'quadratic_function', 'point_distance', 'circle_relative_position', 'sphere_point_position',
      'rectangular_prism_volume', 'average_speed',
      // fase 3
      'kinematics_uniform', 'kinematics_accelerated', 'newton_second_law', 'weight_force', 'kinetic_energy',
      'ohms_law', 'electric_power', 'density', 'mole_calculation', 'molar_concentration', 'solution_dilution',
    ]
    for (const id of required) expect(CANONICAL_DOMAIN_IDS).toContain(id)
    expect(hasCanonicalDomain('other')).toBe(false)
    expect(isCanonicalDomainId('ratio_proportion')).toBe(true)
  })

  it('resolve domínios de Física (fase 3)', () => {
    expect(computeCanonicalDomain('kinematics_uniform', { velocity: 20, time: 3 }).answer.numeric).toBe(60)
    expect(computeCanonicalDomain('kinematics_accelerated', { initialVelocity: 2, acceleration: 3, time: 4 }).answer.numeric).toBe(14)
    expect(computeCanonicalDomain('newton_second_law', { mass: 2, acceleration: 5 }).answer.numeric).toBe(10)
    expect(computeCanonicalDomain('weight_force', { mass: 3, gravity: 10 }).answer.numeric).toBe(30)
    expect(computeCanonicalDomain('kinetic_energy', { mass: 2, velocity: 3 }).answer.numeric).toBe(9)
    expect(computeCanonicalDomain('ohms_law', { resistance: 10, current: 2 }).answer.numeric).toBe(20)
    expect(computeCanonicalDomain('electric_power', { voltage: 12, current: 2 }).answer.numeric).toBe(24)
    expect(computeCanonicalDomain('density', { mass: 30, volume: 10 }).answer.numeric).toBe(3)
  })

  it('resolve domínios de Química (fase 3)', () => {
    expect(computeCanonicalDomain('mole_calculation', { mass: 36, molarMass: 18 }).answer.numeric).toBe(2)
    expect(computeCanonicalDomain('molar_concentration', { moles: 0.5, volume: 2 }).answer.numeric).toBe(0.25)
    expect(computeCanonicalDomain('solution_dilution', { initialConcentration: 2, initialVolume: 0.5, finalVolume: 1 }).answer.numeric).toBe(1)
  })

  it('resolve sistema linear 2x2', () => {
    const result = computeCanonicalDomain('linear_system', { a1: 1, b1: 1, c1: 30, a2: 2, b2: 3, c2: 60 })
    expect(result.answer.numeric).toBe(30)
    expect(result.answer.display).toContain('x = 30')
  })

  it('resolve porcentagem', () => {
    expect(computeCanonicalDomain('percentage', { base: 240, percent: 25 }).answer.numeric).toBe(60)
  })

  it('resolve regra de três', () => {
    expect(computeCanonicalDomain('ratio_proportion', { a: 4, b: 10, c: 6 }).answer.numeric).toBe(15)
  })

  it('resolve juros simples e compostos sem confundir os dois', () => {
    const simple = computeCanonicalDomain('simple_interest', { principal: 1000, rate: 10, time: 2 })
    expect(simple.answer.numeric).toBe(200)
    const compound = computeCanonicalDomain('compound_interest', { principal: 1000, rate: 10, time: 2 })
    expect(compound.answer.numeric).toBeCloseTo(1210, 2)
    expect(compound.answer.display).toContain('1.210')
  })

  it('resolve PA e PG', () => {
    expect(computeCanonicalDomain('arithmetic_progression', { a1: 2, d: 3, n: 10 }).answer.numeric).toBe(29)
    expect(computeCanonicalDomain('geometric_progression', { a1: 1, q: 2, n: 8 }).answer.numeric).toBe(128)
  })

  it('resolve a recorrência linear que falhou na prova 331', () => {
    // x0 = 5; x_{k+1} = 2·x_k + 1  =>  x4 = 95
    const result = computeCanonicalDomain('linear_recurrence', { a0: 5, a: 2, b: 1, n: 4 })
    expect(result.answer.numeric).toBe(95)
    expect(result.distractorHints.length).toBeGreaterThan(0)
    expect(result.distractorHints.some((hint) => hint.includes('95'))).toBe(false)
  })

  it('resolve função afim e quadrática', () => {
    expect(computeCanonicalDomain('linear_function', { a: 2, b: -3, x: 5 }).answer.numeric).toBe(7)
    expect(computeCanonicalDomain('quadratic_function', { a: 1, b: -4, c: 3, x: 5 }).answer.numeric).toBe(8)
  })

  it('resolve distância entre pontos', () => {
    expect(computeCanonicalDomain('point_distance', { x1: 0, y1: 0, x2: 3, y2: 4 }).answer.numeric).toBe(5)
  })

  it('impede estruturalmente o erro de interseção da prova 331 (d > r1 + r2)', () => {
    const result = computeCanonicalDomain('circle_relative_position', { r1: 2, r2: 3, distance: 10 })
    expect(result.answer.numeric).toBe(0)
    expect(result.answer.display).toContain('externas')
    const secant = computeCanonicalDomain('circle_relative_position', { r1: 2, r2: 3, distance: 4 })
    expect(secant.answer.numeric).toBe(2)
  })

  it('classifica ponto em relação à esfera', () => {
    expect(computeCanonicalDomain('sphere_point_position', { radius: 5, distance: 3 }).answer.display).toContain('interno')
    expect(computeCanonicalDomain('sphere_point_position', { radius: 5, distance: 5 }).answer.numeric).toBe(0)
    expect(computeCanonicalDomain('sphere_point_position', { radius: 5, distance: 9 }).answer.display).toContain('externo')
  })

  it('resolve volume de prisma com fator de conversão', () => {
    expect(computeCanonicalDomain('rectangular_prism_volume', { length: 2.5, width: 1.2, height: 0.8, unitFactor: 1000 }).answer.numeric).toBeCloseTo(2400, 6)
  })

  it('resolve velocidade média', () => {
    expect(computeCanonicalDomain('average_speed', { distance: 180, time: 2 }).answer.numeric).toBe(90)
  })

  it('lança quando as entradas não formam o modelo (nada de resultado inventado)', () => {
    expect(() => computeCanonicalDomain('linear_system', { a1: 1, b1: 2, c1: 3, a2: 2, b2: 4, c2: 6 })).toThrow()
    expect(() => computeCanonicalDomain('linear_recurrence', { a0: 1, a: 2, b: 1, n: -1 })).toThrow()
  })

  it('expõe os domínios de Matemática para o filtro por disciplina', () => {
    const ids = canonicalDomainsForSubject('Matemática').map((domain) => domain.id)
    expect(ids).toContain('linear_recurrence')
    expect(ids).toContain('circle_relative_position')
  })
})
