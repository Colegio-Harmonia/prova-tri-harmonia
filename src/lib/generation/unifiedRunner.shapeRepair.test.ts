import { beforeEach, describe, expect, it, vi } from 'vitest'

const generate = vi.hoisted(() => vi.fn())
const judge = vi.hoisted(() => vi.fn())

vi.mock('@/lib/gemini/structuredRepair', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini/structuredRepair')>()),
  generateValidatedStructuredContent: generate,
}))
vi.mock('@/lib/ai/questionQualityDecision', () => ({ judgeQuestionQuality: judge }))

import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { generateUnifiedQuestion } from './unifiedRunner'
import type { BlueprintSlot } from './blueprint'
import type { PipelineContext } from './types'

const ctx: PipelineContext = {
  questionNumber: 2,
  subject: 'Matemática',
  gradeYear: 8,
  segment: 'anos-finais',
  curriculumContent: 'Porcentagem',
  questionType: 'objetiva',
}

const slot: BlueprintSlot = {
  slotNumber: 2,
  truthStrategy: 'calculavel',
  domain: 'percentage',
  difficulty: 'media',
  coreTopic: 'porcentagem de uma quantidade',
  needsVisual: false,
  needsSupportText: false,
  questionType: 'objetiva',
  unitRowIndex: 1,
  curriculumContent: 'Porcentagem',
}

// Resposta correta curta ("30") com distratores em frase: o gate de formato reprova.
const parsed = {
  values: { base: 150, percent: 20 },
  claim: '30',
  derivation: '20% de 150',
  supportText: null,
  statement: 'Uma loja vendeu 150 camisetas e 20% delas eram do tamanho G. Quantas camisetas do tamanho G foram vendidas?',
  visualPlan: { required: false, purpose: 'nenhum', visualType: 'none', rationale: 'sem visual', whatIfImage: null },
  distractors: [
    'Foram vendidas muito menos camisetas do que o total informado',
    'O resultado é o dobro do valor da porcentagem aplicada',
    'Basta somar os dois valores informados no problema',
    'Metade das camisetas foi vendida nesse tamanho específico',
  ],
  bloomLevel: 'aplicar',
  bnccCodes: ['EF08MA04'],
  bnccStatus: 'mapeado',
  bnccSummary: null,
  dok: { categoryCode: 'DOK_2', confidence: 0.8, justification: 'aplica a regra', evidence: 'Quantas camisetas' },
  soloExpected: { categoryCode: 'MULTIESTRUTURAL', confidence: 0.8, justification: 'uma etapa', evidence: '20% delas' },
  difficulty: 'media',
  selfConfidence: 0.8,
}

const completion = (value: unknown) => ({ value, warnings: [], attempts: 1, repaired: false })

describe('generateUnifiedQuestion — gate de formato das alternativas', () => {
  beforeEach(() => {
    generate.mockReset()
    judge.mockReset()
    judge.mockResolvedValue({ available: true, source: 'provider', scores: {}, answerKey: null, issues: [], blocked: false })
  })

  it('encaminha o desvio de formato ao Jev sem reprovar ou corrigir localmente', async () => {
    generate.mockImplementation(async ({ context }: { context: string }) =>
      context.includes('distractor-repair') ? completion({ distractors: ['45', '120', '170', '15'] }) : completion(parsed))

    const result = await generateUnifiedQuestion(ctx, slot, { shuffle: (items) => items })

    const repairCalls = generate.mock.calls.filter(([params]) => String(params.context).includes('distractor-repair'))
    expect(repairCalls).toHaveLength(0)
    expect(result.question.alternatives?.map((alternative) => alternative.text)).toEqual([
      parsed.claim,
      ...parsed.distractors,
    ])
    const correct = result.question.alternatives?.find((alternative) => alternative.letter === result.question.correctLetter)
    expect(correct?.text).toBe('30')
    expect(result.issues.some((issue) => issue.severity === 'bloqueante' && issue.reason.includes('alternativas não têm o mesmo formato'))).toBe(true)
    expect(result.needsAudit).toBe(true)
  })

  it('não tenta corrigir localmente um desvio que cabe ao parecer exclusivo do Jev', async () => {
    generate.mockImplementation(async ({ context }: { context: string }) => {
      if (context.includes('distractor-repair')) throw new StructuredGenerationError('inválida', context, 2, ['x'], 'validation_rejected')
      return completion(parsed)
    })

    const result = await generateUnifiedQuestion(ctx, slot, { shuffle: (items) => items })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.issues.some((issue) => issue.severity === 'bloqueante')).toBe(true)
    expect(result.needsAudit).toBe(true)
  })
})
