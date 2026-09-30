import { describe, expect, it } from 'vitest'
import { planAutomaticVisuals } from './automaticVisualPlan'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

function question(statement: string, needsImage = true): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'descritiva', bloomLevel: 'aplicar', statement, supportText: null,
    alternatives: null, correctLetter: null, expectedAnswer: '5', gradingCriteria: 'Teste',
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage, imageQuery: null, image: null, review: null,
  }
}

describe('estágio automático de planejamento visual', () => {
  it('persiste o renderer e os parâmetros de um plano cartesiano verificável', async () => {
    const result = await planAutomaticVisuals('Matemática', [question('Calcule a distância entre A(3, 4) e B(7, 1).')])
    expect(result.blockedQuestionNumbers).toEqual([])
    expect(result.questions[0].visualPlan).toMatchObject({
      decision: 'recommended', required: true, renderer: 'math.coordinate_plane',
      parameters: { points: [{ label: 'A', x: 3, y: 4 }, { label: 'B', x: 7, y: 1 }] },
    })
  })

  it('bloqueia a questão que depende de figura inexistente', async () => {
    const result = await planAutomaticVisuals('Matemática', [question('Analise a figura apresentada e identifique a reflexão.', false)])
    expect(result.blockedQuestionNumbers).toEqual([1])
  })

  it('mantém a figura planejada elegível para geração antes de considerá-la ausente', async () => {
    const planned = { ...question('Analise a figura apresentada e identifique a reflexão.'), whatIfImage: 'Dois polígonos em lados opostos de uma reta de simetria.', visualPlan: { decision: 'recommended' as const, required: true, purpose: 'comparar_elementos' as const, visualType: 'geometric_diagram' as const, renderer: null, parameters: null, rationale: 'Comparar uma reflexão geométrica.' } }
    const result = await planAutomaticVisuals('Matemática', [planned])
    expect(result.blockedQuestionNumbers).toEqual([])
    expect(result.questions[0].imageQuery).toBe(planned.whatIfImage)
  })
})
