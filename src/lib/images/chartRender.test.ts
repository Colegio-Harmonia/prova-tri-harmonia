import { describe, expect, it } from 'vitest'
import { renderVegaDataChart } from './chartRender'

describe('gráfico vetorial Vega', () => {
  it('gera PNG local a partir de dados explícitos', async () => {
    const image = await renderVegaDataChart({
      chartType: 'line',
      title: 'Crescimento',
      labels: ['1', '2', '3'],
      values: [2, 4, 8],
    })
    expect(image.subarray(1, 4).toString()).toBe('PNG')
  })
})
