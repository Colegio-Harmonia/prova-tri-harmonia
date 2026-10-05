import { describe, expect, it } from 'vitest'
import { BLOOM_LEVEL_ORDER, BLOOM_VERB_TABLE, inferBloomFromVerb, inferBloomLevels } from './bloomVerbs'

describe('inferBloomLevels — decisões da coordenação (05/10/2026)', () => {
  it('elaborar é Criar e resolver é Aplicar, cada verbo no próprio nível', () => {
    expect(inferBloomLevels('Elaborar problemas de contagem').level).toBe('criar')
    expect(inferBloomLevels('Resolver problemas de contagem').level).toBe('aplicar')
  })

  it('"Resolver e elaborar" guarda os dois níveis e usa Criar como principal', () => {
    const result = inferBloomLevels('Resolver e elaborar problemas simples de contagem envolvendo o princípio multiplicativo')
    expect(result.levels).toEqual(['aplicar', 'criar'])
    expect(result.level).toBe('criar')
    expect(result.verbs).toEqual(['resolver', 'elaborar'])
    expect(result.via).toBe('lider')
  })

  it('discutir é Analisar; só a frase "discutir a importância de" continua Avaliar', () => {
    expect(inferBloomLevels('Discutir o papel das culturas letradas na produção do conhecimento').level).toBe('analisar')
    expect(inferBloomLevels('Discutir a importância de preservar o patrimônio').level).toBe('avaliar')
  })
})

describe('inferBloomLevels — verbo líder, não o mais longo da frase', () => {
  it.each([
    ['Utilizar o presente contínuo para descrever ações em progresso.', 'aplicar'],
    ['Comparar e identificar os elementos constitutivos comuns e diferentes.', 'analisar'],
    ['Analisar a construção composicional dos textos, identificando título e introdução.', 'analisar'],
    ['Produzir e publicar notícias, fotodenúncias e reportagens.', 'criar'],
    ['Ler e compreender, com autonomia, textos literários.', 'compreender'],
    ['Identificar e associar progressões geométricas a funções exponenciais.', 'compreender'],
  ])('%s → %s', (sentence, level) => {
    expect(inferBloomLevels(sentence)).toMatchObject({ level, via: 'lider' })
  })

  it('ignora o código BNCC entre parênteses na frente', () => {
    expect(inferBloomLevels('(EF05MA07) Resolver e elaborar problemas de adição').levels).toEqual(['aplicar', 'criar'])
  })

  it('frase fixa mais longa ganha do verbo isolado', () => {
    expect(inferBloomLevels('Planejar e utilizar estratégias de cálculo mental').level).toBe('analisar')
    expect(inferBloomLevels('Planejar e produzir, em colaboração, texto sobre tema de interesse').level).toBe('criar')
  })

  it('é insensível a acento e caixa', () => {
    expect(inferBloomLevels('DANÇAR em grupo').level).toBe('aplicar')
    expect(inferBloomLevels('Dançar em grupo').level).toBe('aplicar')
  })
})

describe('inferBloomLevels — palavra inteira', () => {
  it('"reproduzir" não vira "produzir" (Criar)', () => {
    expect(inferBloomLevels('Identificar e reproduzir, em textos de resenha, a formatação própria').level).toBe('lembrar')
  })

  it('"recriar" só vale como verbo próprio, não por conter "criar"', () => {
    expect(inferBloomLevels('Experimentar, fruir e recriar danças populares').level).toBe('aplicar')
  })
})

describe('inferBloomLevels — atitudinal, fallback e vazio', () => {
  it('verbo líder atitudinal fica sem nível', () => {
    expect(inferBloomLevels('Engajar-se ativamente nos processos de planejamento e revisão')).toMatchObject({ level: null, via: 'atitudinal' })
    expect(inferBloomLevels('Apreciar poemas e outros textos versificados')).toMatchObject({ level: null, via: 'atitudinal' })
  })

  it('verbo líder desconhecido cai pro 1º verbo conhecido e marca fallback', () => {
    expect(inferBloomLevels('Opinar e defender ponto de vista sobre tema polêmico')).toMatchObject({ level: 'avaliar', via: 'lider' })
    expect(inferBloomLevels('Zzzzar o texto para comparar versões')).toMatchObject({ level: 'analisar', via: 'fallback' })
  })

  it('sem verbo reconhecido ou vazio → null', () => {
    expect(inferBloomLevels('Zzzzar coisas variadas')).toMatchObject({ level: null, via: 'nenhum' })
    expect(inferBloomLevels('   ')).toMatchObject({ level: null, levels: [], via: 'nenhum' })
  })
})

describe('inferBloomFromVerb (compatibilidade)', () => {
  it('devolve só o nível principal', () => {
    expect(inferBloomFromVerb('Resolver e elaborar problemas')).toBe('criar')
    expect(inferBloomFromVerb('Analisar mapas')).toBe('analisar')
    expect(inferBloomFromVerb('')).toBeNull()
  })
})

describe('BLOOM_VERB_TABLE', () => {
  it('nenhum verbo aparece em dois níveis (cada verbo tem um nível só)', () => {
    const seen = new Map<string, string>()
    for (const level of BLOOM_LEVEL_ORDER) {
      for (const verb of BLOOM_VERB_TABLE[level]) {
        expect(seen.has(verb), `"${verb}" em ${seen.get(verb)} e ${level}`).toBe(false)
        seen.set(verb, level)
      }
    }
  })
})
