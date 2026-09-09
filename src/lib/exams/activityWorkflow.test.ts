import { describe, expect, it } from 'vitest'
import { canFinalizeOwnActivity, canManageOwnActivity, canMarkOwnActivityApplied } from './activityWorkflow'

const activity = { examKind: 'reforco_enem', createdBy: 17, status: 'rascunho' }

describe('activityWorkflow', () => {
  it('permite ao professor criador finalizar a própria atividade sem atribuição da coordenação', () => {
    expect(canManageOwnActivity(activity, 17, false)).toBe(true)
    expect(canFinalizeOwnActivity(activity, 17, false)).toBe(true)
  })

  it('aplica o mesmo fluxo direto às atividades BNCC comuns', () => {
    const commonActivity = { ...activity, examKind: 'atividade' }
    expect(canManageOwnActivity(commonActivity, 17, false)).toBe(true)
    expect(canFinalizeOwnActivity(commonActivity, 17, false)).toBe(true)
    expect(canMarkOwnActivityApplied({ ...commonActivity, status: 'aprovado' }, 17, false)).toBe(true)
  })

  it('não concede o fluxo direto a outro professor nem a uma prova formal', () => {
    expect(canManageOwnActivity(activity, 18, false)).toBe(false)
    expect(canManageOwnActivity({ ...activity, examKind: 'prova' }, 17, false)).toBe(false)
  })

  it('permite registrar a aplicação da atividade diretamente após gerar os documentos', () => {
    expect(canMarkOwnActivityApplied({ ...activity, status: 'aprovado' }, 17, false)).toBe(true)
    expect(canMarkOwnActivityApplied(activity, 17, false)).toBe(false)
  })
})
