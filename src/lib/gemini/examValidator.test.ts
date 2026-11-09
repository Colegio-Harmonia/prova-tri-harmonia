import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from './examSchema'
import { correctSingleQuestion } from './examValidator'

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    number: 5, source: 'ia', type: 'objetiva', bloomLevel: 'compreender',
    statement: 'Qual estratégia representa o uso de mosaicos ecológicos?',
    supportText: 'Mosaicos ecológicos são conjuntos de unidades de conservação próximas.',
    alternatives: [{ letter: 'A', text: 'Uma unidade isolada.' }, { letter: 'B', text: 'Unidades próximas e interligadas.' }, { letter: 'C', text: 'Expansão urbana.' }, { letter: 'D', text: 'Caça controlada.' }, { letter: 'E', text: 'Plantações comerciais.' }],
    correctLetter: 'B', expectedAnswer: null, gradingCriteria: null, bnccCodes: [], bnccStatus: 'mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
    ...overrides,
  }
}

describe('correctSingleQuestion', () => {
  const curriculum = { segment: 'anos-finais' as const, gradeYear: 9, subject: 'Ciências' }
  it('remove texto de apoio que define o conceito cobrado', () => { const result = correctSingleQuestion(question(), curriculum); expect(result.question.supportText).toBeNull(); expect(result.warnings).toContain('Questão 5: texto de apoio definia o conceito cobrado e foi removido para não entregar a resposta.') })
  it('preserva evidência que não define o conceito da pergunta', () => { const result = correctSingleQuestion(question({ supportText: 'Em uma área fragmentada, foram registradas três populações isoladas de mamíferos.' }), curriculum); expect(result.question.supportText).toContain('três populações isoladas') })
  it('normaliza LaTeX solto para que seja renderizado', () => { const result = correctSingleQuestion(question({ statement: 'O ponto C é (1,\\sqrt{8}).' }), curriculum); expect(result.question.statement).toBe('O ponto C é (1,$\\sqrt{8}$).'); expect(result.issues).toEqual([]) })
  it('rejeita texto corrompido para acionar uma nova geração', () => { const result = correctSingleQuestion(question({ statement: 'A relev\u0002ncia é importante.' }), curriculum); expect(result.issues.join(' ')).toContain('caracteres de controle') })
  it('remove descritor SAEB do campo BNCC (D26 não é BNCC)', () => { const result = correctSingleQuestion(question({ bnccCodes: ['D26'], bnccStatus: 'mapeado' }), curriculum); expect(result.question.bnccCodes).toEqual([]); expect(result.question.bnccStatus).toBe('nao_mapeado'); expect(result.warnings.join(' ')).toContain('não são BNCC') })
  it('mantém código BNCC no formato oficial', () => { const result = correctSingleQuestion(question({ bnccCodes: ['EF09CI01'], bnccStatus: 'mapeado' }), curriculum); expect(result.question.bnccCodes).toEqual(['EF09CI01']); expect(result.question.bnccStatus).toBe('mapeado') })
  it('mantém ficha matemática incompleta como pendência de revisão no fluxo planejado', () => {
    const result = correctSingleQuestion(question({ statement: 'Resolva o sistema.', supportText: null, solutionBlueprint: { domain: 'linear_system', variables: [], equations: ['x + y = 3'], values: {}, calculationSteps: ['Resolver'], derivedAnswer: '1', visualSpec: 'none' } }), { segment: 'anos-finais', gradeYear: 8, subject: 'Matemática' }, { allowMathReviewFallback: true })
    expect(result.issues).toEqual([]); expect(result.warnings.join(' ')).toContain('revisão humana')
  })

  describe('resposta esperada obrigatória nas descritivas', () => {
    const discursive = (overrides: Partial<ExamQuestion> = {}) =>
      question({ type: 'descritiva', alternatives: null, correctLetter: null, supportText: null, ...overrides })

    it('rejeita descritiva sem expectedAnswer', () => {
      const result = correctSingleQuestion(discursive({ expectedAnswer: null }), curriculum)
      expect(result.issues.some((i) => i.includes('expectedAnswer ausente'))).toBe(true)
    })

    it('rejeita expectedAnswer em branco ou curta demais', () => {
      expect(correctSingleQuestion(discursive({ expectedAnswer: '   ' }), curriculum).issues).toHaveLength(1)
      expect(correctSingleQuestion(discursive({ expectedAnswer: 'varia' }), curriculum).issues).toHaveLength(1)
    })

    it('aceita descritiva com resposta esperada e avisa se faltar critério', () => {
      const ok = correctSingleQuestion(discursive({ expectedAnswer: 'A energia se transforma em calor por atrito.', gradingCriteria: '1 ponto: cita atrito.' }), curriculum)
      expect(ok.issues).toEqual([])
      const noCriteria = correctSingleQuestion(discursive({ expectedAnswer: 'A energia se transforma em calor por atrito.', gradingCriteria: null }), curriculum)
      expect(noCriteria.issues).toEqual([])
      expect(noCriteria.warnings.some((w) => w.includes('gradingCriteria'))).toBe(true)
    })

    it('não exige resposta esperada em objetiva', () => {
      expect(correctSingleQuestion(question({ expectedAnswer: null }), curriculum).issues).toEqual([])
    })
  })
})

describe('habilidade ENEM planejada (Ensino Médio)', () => {
  const units = [{
    rowIndex: 0, bimestre: '1', tituloCapitulo: 'Leading is changing', conteudo: null,
    habilidades: { status: 'nao_mapeado' as const, skills: [] },
    objetivos: [], objetivosColumnMissing: true,
    enemSkills: {
      invalid: [],
      skills: [
        { code: 'C2:H5', competency: 2, skill: 5, count: 8, sources: [], description: null },
        { code: 'C6:H18', competency: 6, skill: 18, count: 1, sources: [], description: null },
      ],
    },
  }]
  const curriculum = { segment: 'ensino-medio' as const, gradeYear: 1, subject: 'Inglês', units }
  const enem = (value: string) => question({ supportText: null, saeb: { applicable: true, source: 'enem', value, approximate: true } })

  it('código planejado vira valor canônico com descrição oficial e não aproximado', () => {
    const result = correctSingleQuestion(enem('C2-H5'), curriculum)
    expect(result.question.saeb).toMatchObject({ approximate: false })
    expect(result.question.saeb.value).toMatch(/^C2:H5 — Associar vocábulos/)
    expect(result.warnings).toEqual([])
  })

  it('código fora do planejamento fica aproximado e avisa o revisor', () => {
    const result = correctSingleQuestion(enem('C7:H24'), curriculum)
    expect(result.question.saeb.approximate).toBe(true)
    expect(result.warnings[0]).toMatch(/fora das habilidades ENEM planejadas/)
  })

  it('par inexistente na matriz é sinalizado, nunca corrigido por palpite', () => {
    const result = correctSingleQuestion(enem('C2:H14'), curriculum)
    expect(result.question.saeb).toMatchObject({ value: 'C2:H14', approximate: true })
    expect(result.warnings[0]).toMatch(/não existe na matriz ENEM/)
  })

  it('sem planejamento ENEM mantém o comportamento antigo', () => {
    const result = correctSingleQuestion(enem('C2-H7'), { ...curriculum, units: [] })
    expect(result.question.saeb).toEqual({ applicable: true, source: 'enem', value: 'C2-H7', approximate: true })
  })
})

describe('habilidade ENEM por capítulo (revisão Codex)', () => {
  const planned = {
    rowIndex: 0, bimestre: '1', tituloCapitulo: 'Leading is changing', conteudo: null,
    habilidades: { status: 'nao_mapeado' as const, skills: [] }, objetivos: [], objetivosColumnMissing: true,
    enemSkills: { invalid: [], skills: [{ code: 'C2:H5', competency: 2, skill: 5, count: 8, sources: [], description: null }] },
  }
  const unplanned = { ...planned, rowIndex: 1, tituloCapitulo: 'Sem ENEM', enemSkills: { invalid: [], skills: [] } }
  const invalid = { ...planned, rowIndex: 2, tituloCapitulo: 'Inválido', enemSkills: { invalid: ['C2:H14'], skills: [] } }
  const curriculum = { segment: 'ensino-medio' as const, gradeYear: 1, subject: 'Inglês', units: [planned, unplanned, invalid] }
  const q = (rowIndex: number, saeb: ExamQuestion['saeb']) => question({ supportText: null, curriculumUnitRowIndex: rowIndex, saeb })

  it('capítulo sem planejamento não recebe imposição dos códigos de outro capítulo', () => {
    const result = correctSingleQuestion(q(1, { applicable: true, source: 'enem', value: 'C7:H24', approximate: true }), curriculum)
    expect(result.question.saeb).toMatchObject({ value: 'C7:H24', approximate: true })
    expect(result.warnings).toEqual([])
  })

  it('capítulo planejado sem metadado ENEM gera aviso', () => {
    const result = correctSingleQuestion(q(0, { applicable: false, source: null, value: null, approximate: false }), curriculum)
    expect(result.warnings[0]).toMatch(/tem habilidades ENEM planejadas \(C2:H5\), mas a questão não registrou/)
  })

  it('planejamento inválido não é substituído por código inferido', () => {
    const result = correctSingleQuestion(q(2, { applicable: true, source: 'enem', value: 'C2:H5', approximate: false }), curriculum)
    expect(result.question.saeb.approximate).toBe(true)
    expect(result.warnings[0]).toMatch(/planejamento ENEM do capítulo é inválido/)
  })
})
