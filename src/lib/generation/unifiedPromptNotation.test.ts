import { describe, expect, it } from 'vitest'
import { buildMathNotationInstruction } from '@/lib/math/notationInstruction'
import { buildUnifiedPrompt } from './unifiedRunner'
import type { BlueprintSlot } from './blueprint'
import type { PipelineContext } from './types'

const ctx: PipelineContext = {
  questionNumber: 10,
  subject: 'Matemática',
  gradeYear: 8,
  segment: 'anos-finais',
  curriculumContent: 'Circunferências',
  questionType: 'objetiva',
}

const slot: BlueprintSlot = {
  slotNumber: 10,
  truthStrategy: 'fonte_ancorada',
  difficulty: 'media',
  coreTopic: 'Cordas e distância ao centro',
  curriculumContent: 'Circunferências',
  needsVisual: false,
  needsSupportText: true,
  questionType: 'objetiva',
  unitRowIndex: 4,
}

describe('notação matemática no pipeline unificado', () => {
  it('o prompt unificado manda delimitar fórmulas em LaTeX, como o prompt antigo', () => {
    const prompt = buildUnifiedPrompt(ctx, slot)
    expect(prompt).toContain(buildMathNotationInstruction())
    expect(prompt).toContain('$...$')
    expect(prompt).toContain('nunca em ASCII solto')
  })

  it('vale para a estratégia interpretativa e para a ancorada', () => {
    for (const truthStrategy of ['interpretativa', 'fonte_ancorada'] as const) {
      expect(buildUnifiedPrompt(ctx, { ...slot, truthStrategy })).toContain('NOTAÇÃO MATEMÁTICA (OBRIGATÓRIA)')
    }
  })

  it('a instrução cita o exemplo de fração e expoente que antes saía em ASCII', () => {
    const instruction = buildMathNotationInstruction()
    expect(instruction).toContain('\\\\frac')
    expect(instruction).toContain('2^{n-1}')
  })
})
