import { describe, expect, it } from 'vitest'
import { renderCoordinatePlane } from './deterministicRenderers'
import { analyzeIllustrations, deterministicIllustrationRecommendations, extractLiteralCoordinatePoints, hasMissingRequiredVisual } from './recommendations'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

function question(statement: string, imageQuery: string | null = null): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'descritiva', bloomLevel: 'aplicar', statement, supportText: null,
    alternatives: null, correctLetter: null, expectedAnswer: '5', gradingCriteria: 'Cálculo correto.',
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery, image: null, review: null,
  }
}

describe('recomendações determinísticas de ilustração', () => {
  it('extrai coordenadas literais sem inventar pontos', () => {
    expect(extractLiteralCoordinatePoints('Considere A(3,4) e B(7, 1).')).toEqual([
      { label: 'A', x: 3, y: 4 }, { label: 'B', x: 7, y: 1 },
    ])
  })

  it('recomenda plano cartesiano para a questão de distância entre dois pontos', () => {
    const recommendations = deterministicIllustrationRecommendations('Matemática', question('Considere os pontos A(3,4) e B(7,1) no plano cartesiano.'))
    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({ generator: 'math.coordinate_plane', parameters: { points: [{ label: 'A', x: 3, y: 4 }, { label: 'B', x: 7, y: 1 }] } })
  })

  it('recomenda a estrutura química apenas com SMILES explícito', () => {
    const recommendations = deterministicIllustrationRecommendations('Química', question('Identifique a estrutura.', 'Estrutura do etanol (SMILES: CCO)'))
    expect(recommendations[0]).toMatchObject({ generator: 'chemistry.structure', parameters: { smiles: 'CCO' } })
  })

  it('renderiza os pontos recomendados em um plano cartesiano', async () => {
    const rendered = await renderCoordinatePlane({ points: [{ label: 'A', x: 3, y: 4 }, { label: 'B', x: 7, y: 1 }], segments: [{ from: 'A', to: 'B' }] })
    expect(rendered.mimeType).toBe('image/svg+xml')
    expect(rendered.content.toString()).toContain('<svg')
  })

  it('bloqueia uma questão que cita figura inexistente', async () => {
    const item = question('Analise a figura apresentada e identifique o tipo de reflexão.')
    expect(hasMissingRequiredVisual(item)).toBe(true)
    await expect(analyzeIllustrations('Matemática', item)).resolves.toMatchObject({
      decision: 'missing_required_visual',
      recommendations: [],
    })
  })

  it('explica quando um gráfico poderia revelar a resposta algébrica', async () => {
    const item = question('Utilize a regra de Cramer e o determinante para resolver o sistema linear.')
    await expect(analyzeIllustrations('Matemática', item)).resolves.toMatchObject({
      decision: 'not_needed',
      recommendations: [],
    })
  })
})
