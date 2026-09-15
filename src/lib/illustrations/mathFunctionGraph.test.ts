import { describe, expect, it } from 'vitest'
import { renderFunctionGraph } from './mathFunctionGraph'

describe('renderFunctionGraph', () => {
  it('renders a deterministic SVG for a valid function', () => {
    const result = renderFunctionGraph({ expression: 'x^2 - 4*x + 3', domain: [-2, 6] })
    expect(result.mimeType).toBe('image/svg+xml')
    expect(result.content.toString()).toContain('f(x) = x^2 - 4*x + 3')
  })
})
