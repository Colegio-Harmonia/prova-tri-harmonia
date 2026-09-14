import { describe, expect, it } from 'vitest'
import { extractSmilesLiteral, renderBlankCoordinatePlaneSvg, renderBlueprintVisual, renderChemistrySmiles, renderCoordinateSvg, renderJsxGraphCoordinateSvg } from './technicalVisualRender'

describe('renderização técnica determinística', () => {
  it('produz plano cartesiano para pontos e segmentos verificáveis', () => {
    const svg = renderCoordinateSvg(
      [{ label: 'A', x: -2, y: 1 }, { label: 'B', x: 3, y: 4 }],
      [{ from: 'A', to: 'B' }],
    )
    expect(svg).toContain('<svg')
    expect(svg).toContain('A (-2, 1)')
    expect(svg).toContain('<line')
  })

  it('recusa coordenadas fora dos limites seguros', () => {
    expect(renderCoordinateSvg([{ label: 'A', x: 101, y: 0 }], [])).toBeNull()
  })

  it('produz plano vazio sem antecipar a solução de uma questão gráfica', () => {
    const svg = renderBlankCoordinatePlaneSvg(50)
    expect(svg).toContain('<svg')
    expect(svg).toContain('>50<')
    expect(svg).not.toContain('<circle')
    expect(svg).not.toContain('<line')
  })

  it('prioriza o visual definido na ficha técnica já validada', async () => {
    const image = await renderBlueprintVisual({
      domain: 'linear_system', variables: [], equations: ['x+y=30', '2x+3y=60'], values: {}, calculationSteps: ['teste'], derivedAnswer: 'x=0; y=30', visualSpec: 'blank_coordinate_plane',
    })
    expect(image?.source).toBe('diagrama')
    expect(image?.buffer.subarray(1, 4).toString()).toBe('PNG')
  })

  it('gera uma estrutura química a partir de um SMILES válido', async () => {
    const image = await renderChemistrySmiles('CCO')
    expect(image?.subarray(1, 4).toString()).toBe('PNG')
  })

  it('usa JSXGraph para gerar o SVG de um plano cartesiano', async () => {
    const svg = await renderJsxGraphCoordinateSvg([{ label: 'A', x: 1, y: 2 }], [])
    expect(svg).toContain('<svg')
  })

  it('extrai o SMILES embutido pelo gerador no imageQuery', () => {
    expect(extractSmilesLiteral('estrutura do etanol (SMILES: CCO)')).toBe('CCO')
    expect(extractSmilesLiteral('grupo funcional do ácido acético — SMILES: CC(=O)O')).toBe('CC(=O)O')
    expect(extractSmilesLiteral('anel aromático do benzeno (SMILES: c1ccccc1).')).toBe('c1ccccc1')
    expect(extractSmilesLiteral('estrutura da cadeia carbônica do butano')).toBeNull()
  })

  it('renderiza a estrutura quando o SMILES vem embutido no texto', async () => {
    const smiles = extractSmilesLiteral('cadeia do etanol (SMILES: CCO)')
    const image = smiles ? await renderChemistrySmiles(smiles) : null
    expect(image?.subarray(1, 4).toString()).toBe('PNG')
  })
})
