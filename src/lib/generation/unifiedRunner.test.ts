import { describe, expect, it } from 'vitest'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { isEvidenceValidationFailure } from './unifiedRunner'

describe('isEvidenceValidationFailure', () => {
  it('reconhece o diagnóstico dos gates em português com acentos', () => {
    const error = new StructuredGenerationError(
      'Resposta rejeitada.',
      'generation/unified-4',
      3,
      ['[truth] A evidência citada não existe literalmente no material-fonte fornecido.'],
      'validation_rejected',
    )

    expect(isEvidenceValidationFailure(error)).toBe(true)
  })

  it('não trata outro erro de validação como falha de evidência', () => {
    const error = new StructuredGenerationError(
      'Resposta rejeitada.',
      'generation/unified-4',
      3,
      ['[statement] O enunciado ficou curto.'],
      'validation_rejected',
    )

    expect(isEvidenceValidationFailure(error)).toBe(false)
  })
})
