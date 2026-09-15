import { describe, expect, it } from 'vitest'
import { renderFunctionGraph } from './mathFunctionGraph'

describe('renderFunctionGraph', () => {
  it('renders a deterministic SVG for a valid function', () => {
    const result = renderFunctionGraph({ expression: 'x^2 - 4*x + 3', domain: [-2, 6] })
    expect(result.mimeType).toBe('image/svg+xml')
    expect(result.content.toString()).toContain('f(x) = x^2 - 4*x + 3')
  })

  it('rejects expressions outside the supported mathematical language', () => {
    expect(() => renderFunctionGraph({ expression: 'import("node:fs")', domain: [-2, 6] })).toThrow('Função não permitida')
    expect(() => renderFunctionGraph({ expression: 'y + 1', domain: [-2, 6] })).toThrow('Símbolo não permitido')
  })
})
