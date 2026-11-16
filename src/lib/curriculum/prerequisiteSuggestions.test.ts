import { describe, expect, it } from 'vitest'
import { buildPrerequisitePrompt, buildSuggestionGroups, candidatesForTarget, composeRationale, levelOf, sanitizePrerequisites, suggestPrerequisitesForGroups, type CatalogSkill } from './prerequisiteSuggestions'

const skill = (code: string, gradeYear: number, bimester: number, segment = 'anos-finais'): CatalogSkill => ({ code, description: `Descrição de ${code}`, segment, gradeYear, subject: 'Matemática', bimester })

const catalog = [
  skill('EF05MA03', 5, 2, 'anos-iniciais'),
  skill('EF06MA07', 6, 1), skill('EF06MA08', 6, 3),
  skill('EF07MA08', 7, 1), skill('EF07MA09', 7, 1),
  skill('EF07MA10', 7, 2), skill('EF07MA08', 7, 3),
]

describe('levelOf', () => {
  it('põe o Ensino Médio depois do 9º ano', () => {
    expect(levelOf('anos-finais', 9)).toBe(9)
    expect(levelOf('ensino-medio', 1)).toBe(10)
  })
})

describe('buildSuggestionGroups', () => {
  it('só oferece como candidato o que foi planejado antes da alvo', () => {
    const groups = buildSuggestionGroups(catalog, { segment: 'anos-finais', gradeYear: 7 })
    expect(groups.map((group) => group.bimester)).toEqual([1, 2])
    const [first, second] = groups
    expect(first.targets.map((s) => s.code)).toEqual(['EF07MA08', 'EF07MA09'])
    // 5º e 6º ano entram (até 2 séries atrás), nada do próprio 7º no 1º bimestre.
    expect(first.candidates.map((s) => s.code)).toEqual(['EF05MA03', 'EF06MA07', 'EF06MA08'])
    // No 2º bimestre entram também as do 1º bimestre do 7º ano.
    expect(second.targets.map((s) => s.code)).toEqual(['EF07MA10'])
    expect(second.candidates.map((s) => s.code)).toEqual(['EF05MA03', 'EF06MA07', 'EF06MA08', 'EF07MA08', 'EF07MA09'])
  })

  it('não repete como alvo o código retomado em bimestre posterior', () => {
    const groups = buildSuggestionGroups(catalog, { segment: 'anos-finais', gradeYear: 7 })
    expect(groups.flatMap((group) => group.targets.map((s) => s.code))).toEqual(['EF07MA08', 'EF07MA09', 'EF07MA10'])
  })

  it('sem nada anterior não há grupo', () => {
    expect(buildSuggestionGroups([skill('EF06MA07', 6, 1)], { segment: 'anos-finais', gradeYear: 6 })).toEqual([])
  })
})

describe('sanitizePrerequisites', () => {
  const group = { targets: [skill('EF07MA10', 7, 2)], candidates: [skill('EF06MA07', 6, 1), skill('EF07MA08', 7, 1)] }
  const why = 'Usa a comparação de frações para montar razões entre grandezas.'

  it('descarta código inventado, alvo usada como base, força inválida e justificativa curta', () => {
    const result = sanitizePrerequisites({ habilidades: [{ codigo: 'ef07ma10', prerequisitos: [
      { codigo: 'EF06MA07', forca: 'Essencial', justificativa: why },
      { codigo: 'EF06MA99', forca: 'essencial', justificativa: why },
      { codigo: 'EF07MA10', forca: 'apoio', justificativa: why },
      { codigo: 'EF07MA08', forca: 'fundamental', justificativa: why },
      { codigo: 'EF07MA08', forca: 'apoio', justificativa: 'curta' },
      { codigo: 'EF06MA07', forca: 'apoio', justificativa: why },
    ] }, { codigo: 'EF09MA01', prerequisitos: [{ codigo: 'EF06MA07', forca: 'apoio', justificativa: why }] }] }, group)
    expect(result.suggestions).toEqual([{ prerequisite: group.candidates[0], skill: group.targets[0], strength: 'essencial', rationale: why, officialBasis: 'mesma unidade temática: Números' }])
    expect(result.discardedCount).toBe(6)
  })
})

describe('suggestPrerequisitesForGroups', () => {
  it('manda só os candidatos permitidos e junta o resultado dos lotes', async () => {
    const groups = buildSuggestionGroups(catalog, { segment: 'anos-finais', gradeYear: 7 })
    const prompts: string[] = []
    const result = await suggestPrerequisitesForGroups('Matemática', groups, async (prompt) => {
      prompts.push(prompt)
      return prompt.includes('EF07MA10 (7º ano, 2º bim.;')
        ? { habilidades: [{ codigo: 'EF07MA10', prerequisitos: [{ codigo: 'EF07MA08', forca: 'importante', justificativa: 'Retoma a resolução de problemas com números racionais do bimestre anterior.' }] }] }
        : { habilidades: [] }
    })
    expect(result.callCount).toBe(2)
    expect(result.suggestions.map((s) => `${s.prerequisite.code}->${s.skill.code}:${s.strength}`)).toEqual(['EF07MA08->EF07MA10:importante'])
    expect(prompts[0]).not.toContain('EF07MA10 (')
  })

  it('o prompt deixa claro que só vale código da lista', () => {
    const prompt = buildPrerequisitePrompt('Matemática', [skill('EF07MA10', 7, 2)], [skill('EF06MA07', 6, 1)])
    expect(prompt).toContain('Use SOMENTE códigos da lista de CANDIDATOS PERMITIDOS')
    expect(prompt).toContain('EF06MA07 (6º ano, 1º bim.; BNCC: ')
    expect(prompt).toContain('Números): Descrição de EF06MA07')
    expect(prompt).toContain('EF07MA10: EF06MA07')
  })
})

describe('vínculo oficial da BNCC', () => {
  const lp = (code: string, gradeYear: number, bimester: number): CatalogSkill => ({ code, description: null, segment: 'anos-iniciais', gradeYear, subject: 'Língua Portuguesa', bimester })
  const why = 'Inferir sentido de palavras ajuda a interpretar letras de música.'

  it('descarta par sem vínculo na organização oficial', () => {
    // EF15AR13 é de Arte (Música); EF35LP05 é Leitura/escuta: nada em comum na BNCC.
    const result = sanitizePrerequisites({ habilidades: [{ codigo: 'EF15AR13', prerequisitos: [{ codigo: 'EF35LP05', forca: 'apoio', justificativa: why }] }] }, { targets: [lp('EF15AR13', 5, 4)], candidates: [lp('EF35LP05', 4, 1)] })
    expect(result.suggestions).toEqual([])
    expect(result.discardedCount).toBe(1)
  })

  it('só lista como permitido o candidato com vínculo e explica o vínculo', () => {
    const target = lp('EF15LP01', 4, 1)
    expect(candidatesForTarget(target, [lp('EF12LP02', 2, 1), lp('EF15AR13', 2, 1)]).map((skill) => skill.code)).toEqual(['EF12LP02'])
    const prompt = buildPrerequisitePrompt('Língua Portuguesa', [target], [lp('EF12LP02', 2, 1)])
    expect(prompt).toContain('EF15LP01: EF12LP02')
  })

  it('grava o vínculo oficial antes da justificativa da IA', () => {
    expect(composeRationale({ rationale: why, officialBasis: 'mesmo objeto de conhecimento: Estratégia de leitura' })).toBe(`Base oficial BNCC: Mesmo objeto de conhecimento: Estratégia de leitura. ${why}`)
    expect(composeRationale({ rationale: why, officialBasis: null })).toBe(why)
  })

  it('não chama a IA para lote sem nenhum candidato com vínculo', async () => {
    const groups = [{ bimester: 4, targets: [lp('EF15AR13', 5, 4)], candidates: [lp('EF35LP05', 4, 1)] }]
    let calls = 0
    const result = await suggestPrerequisitesForGroups('Língua Portuguesa', groups, async () => { calls++; return { habilidades: [] } })
    expect(calls).toBe(0)
    expect(result.callCount).toBe(0)
  })
})
