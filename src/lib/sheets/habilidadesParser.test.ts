import { describe, expect, it } from 'vitest'
import { parseHabilidades } from './habilidadesParser'

describe('parseHabilidades', () => {
  it('reconhece os códigos BNCC de Língua Portuguesa do Ensino Médio', () => {
    expect(parseHabilidades('EM13LP49 EM13LP48 EM13LP03', 'ensino-medio')).toEqual({
      status: 'mapeado',
      skills: [
        { code: 'EM13LP49', description: null },
        { code: 'EM13LP48', description: null },
        { code: 'EM13LP03', description: null },
      ],
    })
  })

  it('mantém a leitura de códigos de área com três algarismos', () => {
    expect(parseHabilidades('EM13LGG401', 'ensino-medio')).toEqual({
      status: 'mapeado',
      skills: [{ code: 'EM13LGG401', description: null }],
    })
  })
})
