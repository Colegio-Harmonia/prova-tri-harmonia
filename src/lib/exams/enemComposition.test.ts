import { describe, expect, it } from 'vitest'
import { composeWithEnem, selectEnemCount } from './enemComposition'

describe('ENEM como parte do total da prova', () => {
  it('mantém 12 no total ao importar quatro do ENEM', () => {
    expect(composeWithEnem(12, [1, 2, 3, 4])).toEqual({ bankIds: [1, 2, 3, 4], questionCount: 8 })
  })
  it('permite prova só do banco e retirar todos os itens do ENEM', () => {
    expect(composeWithEnem(10, Array.from({ length: 10 }, (_, i) => i + 1)).questionCount).toBe(0)
    expect(composeWithEnem(12, []).questionCount).toBe(12)
  })
  it('limita a seleção ao reduzir o total e não envia IDs repetidos', () => {
    const composition = composeWithEnem(10, [1, 1, ...Array.from({ length: 15 }, (_, i) => i + 1)])
    expect(composition.bankIds).toHaveLength(10)
    expect(composition.questionCount).toBe(0)
  })
  it('mantém escolhas de outra página ou filtro antes de completar a quantidade', () => {
    expect(selectEnemCount([90, 91], [1, 2, 2, 3], 4)).toEqual([90, 91, 1, 2])
    expect(selectEnemCount([90, 91, 1, 2], [], 2)).toEqual([90, 91])
  })
  it('permite detectar candidatos insuficientes sem inventar IDs', () => {
    expect(selectEnemCount([90], [1, 1], 4)).toEqual([90, 1])
  })
})
