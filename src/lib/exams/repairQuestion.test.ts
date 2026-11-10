import { describe, expect, it } from 'vitest'
import { chooseRepairKind } from './repairQuestion'
import { shouldRegenerateQuestionFromDiagnostics, unauthorizedRepairChanges, type QualityDiagnostic } from './qualityDiagnostics'

function diagnostic(code: QualityDiagnostic['code'], fields: string[] = []): QualityDiagnostic {
  return { code, severity: 'bloqueante', repairAction: 'reparo_local', fields, protectedFields: [], message: code, blocksApproval: true }
}

describe('chooseRepairKind', () => {
  it('roteia resposta exposta para alterar apenas o enunciado', () => {
    expect(chooseRepairKind([diagnostic('ANSWER_EXPOSED_IN_STATEMENT', ['statement'])])).toBe('statement')
  })

  it('prioriza texto de apoio quando faltam informações', () => {
    expect(chooseRepairKind([diagnostic('ANSWER_EXPOSED_IN_STATEMENT'), diagnostic('MISSING_SUPPORT_TEXT')])).toBe('support_statement')
  })

  it('encaminha inadequação da turma para adaptação pedagógica localizada', () => {
    expect(chooseRepairKind([diagnostic('GRADE_LEVEL_MISMATCH', ['statement', 'alternatives'])])).toBe('grade_adaptation')
  })

  it('separa ausência de resposta correta de um reparo comum de distratores', () => {
    expect(chooseRepairKind([diagnostic('NO_CORRECT_ALTERNATIVE')])).toBe('alternatives_and_key')
    expect(chooseRepairKind([diagnostic('DUPLICATE_ALTERNATIVE')])).toBe('alternatives')
  })

  it('não chama reparo criativo para diagnóstico não local', () => {
    expect(chooseRepairKind([{ ...diagnostic('FACTUAL_INCONSISTENCY'), repairAction: 'regenerar_questao' }])).toBeNull()
  })
})

describe('roteamento da correção por diagnóstico', () => {
  it('mantém localizado um único problema de alternativa', () => {
    const item = { ...diagnostic('ALTERNATIVE_FORMAT_OUTLIER', ['alternatives.B']), location: 'alternatives.B', alternativeLetter: 'B' }
    expect(shouldRegenerateQuestionFromDiagnostics([item])).toBe(false)
  })

  it('regenera quando há problemas em grupos independentes', () => {
    const text = { ...diagnostic('ANSWER_CUE_EXPOSED', ['statement']), location: 'statement' }
    const options = { ...diagnostic('ALTERNATIVE_FORMAT_OUTLIER', ['alternatives.B']), location: 'alternatives.B', alternativeLetter: 'B' }
    expect(shouldRegenerateQuestionFromDiagnostics([text, options])).toBe(true)
  })

  it('regenera quando o Jev exige alinhamento pedagógico ou revisão humana', () => {
    expect(shouldRegenerateQuestionFromDiagnostics([{ ...diagnostic('GRADE_LEVEL_MISMATCH', ['statement']), location: 'statement' }])).toBe(true)
    expect(shouldRegenerateQuestionFromDiagnostics([{ ...diagnostic('FACTUAL_INCONSISTENCY'), repairAction: 'revisao_humana' }])).toBe(true)
  })
})

describe('proteção do escopo de reparo', () => {
  const base = {
    number: 1, source: 'ia', type: 'objetiva', statement: 'Enunciado original', supportText: null,
    alternatives: [{ letter: 'A', text: 'Correta' }, { letter: 'B', text: 'Distrator' }], correctLetter: 'A',
  } as unknown as import('@/lib/gemini/examSchema').ExamQuestion

  it('detecta campo protegido alterado em reparo localizado', () => {
    const item = { ...diagnostic('ANSWER_EXPOSED_IN_STATEMENT', ['statement']), location: 'statement' }
    expect(unauthorizedRepairChanges(base, { ...base, statement: 'Novo comando', correctLetter: 'B' }, [item], false)).toEqual(['correctLetter'])
  })

  it('restaura a detecção quando um reparo de alternativa muda letras não autorizadas', () => {
    const item = { ...diagnostic('ALTERNATIVE_FORMAT_OUTLIER', ['alternatives.B']), location: 'alternatives.B', alternativeLetter: 'B' }
    const after = { ...base, alternatives: [{ letter: 'A', text: 'Alterada' }, { letter: 'B', text: 'Corrigida' }] } as typeof base
    expect(unauthorizedRepairChanges(base, after, [item], false)).toEqual(['alternatives.A'])
  })

  it('permite mudanças amplas na regeneração da questão', () => {
    const item: QualityDiagnostic = { ...diagnostic('FACTUAL_INCONSISTENCY'), repairAction: 'regenerar_questao' }
    expect(unauthorizedRepairChanges(base, { ...base, statement: 'Novo', correctLetter: 'B' }, [item], true)).toEqual([])
  })
})
