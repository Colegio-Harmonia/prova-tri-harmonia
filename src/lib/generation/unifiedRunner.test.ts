import { describe, expect, it } from 'vitest'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { buildSkillBlock, isEvidenceValidationFailure } from './unifiedRunner'

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

describe('buildSkillBlock', () => {
  const ctx = { questionNumber: 1, subject: 'Ciências', gradeYear: 7, segment: 'anos-finais', curriculumContent: 'x', questionType: 'objetiva' as const }

  it('entrega código, descrição, nível de Bloom do verbo e objetivos ao gerador', () => {
    const block = buildSkillBlock({ ...ctx, targetSkills: [{ code: 'EF07CI05', description: 'Discutir o uso de combustíveis para avaliar avanços.' }], objectives: ['Avaliar impactos socioambientais.'] })
    expect(block).toContain('EF07CI05')
    expect(block).toContain('Discutir o uso de combustíveis')
    expect(block).toContain('Objetivos de aprendizagem do capítulo: Avaliar impactos')
    expect(block).toMatch(/Bloom esperado/)
  })

  it('não gera bloco quando o capítulo não tem habilidade BNCC', () => {
    expect(buildSkillBlock(ctx)).toBe('')
  })
})
