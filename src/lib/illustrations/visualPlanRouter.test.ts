import { describe, expect, it } from 'vitest'
import { routeVisualPlan } from './visualPlanRouter'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

const baseQuestion = (): ExamQuestion => ({
  number: 1, source: 'ia', type: 'descritiva', bloomLevel: 'aplicar', statement: 'Represente a relação.', supportText: null,
  alternatives: null, correctLetter: null, expectedAnswer: 'Resposta', gradingCriteria: 'Teste', solutionBlueprint: null,
  bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
  pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
  saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: true, imageQuery: 'Plano cartesiano', image: null, review: null,
})

describe('roteador de plano visual', () => {
  it('escolhe SVG de plano vazio sem desenhar a resposta do estudante', () => {
    const question = { ...baseQuestion(), visualPlan: { decision: 'recommended' as const, required: true, purpose: 'representar_relacao' as const, visualType: 'blank_coordinate_plane' as const, renderer: null, parameters: { axisRange: 12 }, rationale: 'O aluno deve construir o gráfico.' } }
    expect(routeVisualPlan('Matemática', question)).toEqual({ renderer: 'math.coordinate_plane.blank', parameters: { axisRange: 12 } })
  })

  it('recusa dados que não respeitam o contrato da biblioteca', () => {
    const question = { ...baseQuestion(), visualPlan: { decision: 'recommended' as const, required: true, purpose: 'representar_relacao' as const, visualType: 'function_graph' as const, renderer: null, parameters: { expression: 'x + 1' }, rationale: 'Ler a função.' } }
    expect(routeVisualPlan('Matemática', question)).toBeNull()
  })
})
