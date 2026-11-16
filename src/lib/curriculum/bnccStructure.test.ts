import { describe, expect, it } from 'vitest'
import { bnccComponentOf, bnccStructureLabel, codeBelongsToSubject, structuralLink } from './bnccStructure'

describe('bnccComponentOf', () => {
  it('lê o componente (EF) ou a área (EM) do dataset oficial', () => {
    expect(bnccComponentOf('EF15AR13')).toBe('ef-comp-ar')
    expect(bnccComponentOf('ef35lp05')).toBe('ef-comp-lp')
    expect(bnccComponentOf('EM13LP01')).toBe('em-area-lgg')
    expect(bnccComponentOf('EM13MAT101')).toBe('em-area-mat')
  })
  it('cai na sigla do código quando o dataset não conhece o código', () => {
    expect(bnccComponentOf('EF99AR99')).toBe('ef-comp-ar')
    expect(bnccComponentOf('XYZ')).toBeNull()
  })
})

describe('codeBelongsToSubject', () => {
  it('barra código de outra disciplina', () => {
    expect(codeBelongsToSubject('EF15AR13', 'Língua Portuguesa', 'anos-iniciais')).toBe(false)
    expect(codeBelongsToSubject('EF15AR13', 'Português', 'anos-iniciais')).toBe(false)
    expect(codeBelongsToSubject('EM13MAT101', 'Português', 'ensino-medio')).toBe(false)
  })
  it('aceita código da disciplina, nos dois segmentos', () => {
    expect(codeBelongsToSubject('EF15LP01', 'Português', 'anos-iniciais')).toBe(true)
    expect(codeBelongsToSubject('EM13LP01', 'Língua Portuguesa', 'ensino-medio')).toBe(true)
    expect(codeBelongsToSubject('EM13CNT201', 'Física', 'ensino-medio')).toBe(true)
  })
  it('não barra quando não dá para afirmar (disciplina ou código desconhecidos)', () => {
    expect(codeBelongsToSubject('EF15AR13', 'Projeto de Vida', 'anos-finais')).toBe(true)
    expect(codeBelongsToSubject('SAE+', 'Português', 'anos-finais')).toBe(true)
  })
})

describe('structuralLink', () => {
  it('prefere o vínculo mais específico', () => {
    expect(structuralLink('EF15LP02', 'EF15LP03')).toEqual({ status: 'linked', reason: 'mesmo objeto de conhecimento: Estratégia de leitura' })
    expect(structuralLink('EF06MA07', 'EF07MA08')).toEqual({ status: 'linked', reason: 'mesma unidade temática: Números' })
  })
  it('"Todos os campos de atuação" não conta como vínculo', () => {
    expect(structuralLink('EF35LP05', 'EF15AR13')).toEqual({ status: 'unrelated' })
  })
  it('código fora do dataset não é verificável', () => {
    expect(structuralLink('EF99LP99', 'EF15LP01')).toEqual({ status: 'unknown' })
  })
  it('descreve a organização oficial para o prompt', () => {
    expect(bnccStructureLabel('EF15LP01')).toBe('Reconstrução das condições de produção e recepção de textos · Leitura/escuta (compartilhada e autônoma)')
  })
})
