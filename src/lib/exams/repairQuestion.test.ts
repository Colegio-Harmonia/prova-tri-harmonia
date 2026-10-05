import { describe, expect, it } from 'vitest'
import { chooseRepairKind } from './repairQuestion'
import type { QualityDiagnostic } from './qualityDiagnostics'

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

  it('separa ausência de resposta correta de um reparo comum de distratores', () => {
    expect(chooseRepairKind([diagnostic('NO_CORRECT_ALTERNATIVE')])).toBe('alternatives_and_key')
    expect(chooseRepairKind([diagnostic('DUPLICATE_ALTERNATIVE')])).toBe('alternatives')
  })

  it('não chama reparo criativo para diagnóstico não local', () => {
    expect(chooseRepairKind([{ ...diagnostic('FACTUAL_INCONSISTENCY'), repairAction: 'regenerar_questao' }])).toBeNull()
  })
})
