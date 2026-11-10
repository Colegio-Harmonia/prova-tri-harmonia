import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { questionInepLabel } from './questionInepLabel'
describe('tags INEP com códigos oficiais', () => {
  it('mostra só ENEM: H21 e mantém os dados completos no objeto original', () => {
    const question = { inepAssessment: { matrix: 'enem', skill: { code: 'H21', description: 'Descrição completa' }, area: { code: 'ciencias-natureza' } }, saeb: { source: 'enem', value: 'Descrição completa' } } as ExamQuestion
    expect(questionInepLabel(question)).toBe('ENEM: H21')
    expect(question.inepAssessment?.area?.code).toBe('ciencias-natureza')
  })
  it.each([
    ['enem', 'Ciências da Natureza › C6 — Descrição › H21 — Descrição', 'ENEM: H21'],
    ['enem', 'H4 — Descrição', 'ENEM: H4'],
    ['classica', 'D14 — Descrição', 'SAEB: D14'],
    ['novo_saeb', '2N1.1 — Descrição', 'SAEB: 2N1.1'],
    ['novo_saeb', 'H1.1 — Descrição', 'SAEB: H1.1'],
    ['novo_saeb', 'A3 — Descrição', 'SAEB: A3'],
  ])('lê códigos legados %s %s', (source, value, expected) => {
    expect(questionInepLabel({ saeb: { source, value } } as ExamQuestion)).toBe(expected)
  })

  it('mostra a habilidade planejada quando o Jev classificou outra', () => {
    const base = { saeb: { source: 'enem', value: null } }
    const jev = (competency: string, skill: string) => ({ matrix: 'enem', competency: { code: competency, description: '' }, skill: { code: skill, description: '' } })
    expect(questionInepLabel({ ...base, plannedEnemSkill: { code: 'C2:H5', description: null }, inepAssessment: jev('C2', 'H5') } as unknown as ExamQuestion)).toBe('ENEM: H5')
    expect(questionInepLabel({ ...base, plannedEnemSkill: { code: 'C1:H2', description: null }, inepAssessment: jev('C2', 'H6') } as unknown as ExamQuestion)).toBe('ENEM: H6 · planejado C1:H2')
    expect(questionInepLabel({ saeb: { source: null, value: null }, plannedEnemSkill: { code: 'C2:H7', description: null } } as unknown as ExamQuestion)).toBe('ENEM planejado: C2:H7')
  })
})
