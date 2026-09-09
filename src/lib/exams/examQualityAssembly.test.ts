import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { PlannedQuestionSlot } from './contentPlan'
import { assembleBestExamCandidates, validateExamAssembly } from './examQualityAssembly'

function question(number: number, statement: string, unit = 1): ExamQuestion {
  return {
    number, curriculumUnitRowIndex: unit, source: 'ia', type: 'objetiva', weight: 1, bloomLevel: 'aplicar', statement,
    alternatives: [{ letter: 'A', text: 'a' }, { letter: 'B', text: 'b' }, { letter: 'C', text: 'c' }, { letter: 'D', text: 'd' }, { letter: 'E', text: 'e' }], correctLetter: 'A',
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: statement }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: statement } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false,
  }
}

const slots: PlannedQuestionSlot[] = [
  { number: 1, unitRowIndex: 1, type: 'objetiva', visualAid: 'auto' },
  { number: 2, unitRowIndex: 1, type: 'objetiva', visualAid: 'auto' },
]

describe('montagem global da prova', () => {
  it('seleciona a candidata menos parecida com as questões já escolhidas', () => {
    const selected = assembleBestExamCandidates(slots, [
      { slotNumber: 1, candidateNumber: 1, question: question(1, 'Calcule a área de um terreno retangular.') },
      { slotNumber: 2, candidateNumber: 1, question: question(2, 'Calcule a área de um terreno retangular usando metros.') },
      { slotNumber: 2, candidateNumber: 2, question: question(2, 'Interprete os dados de consumo de água em uma residência.') },
    ])
    expect(selected[1].statement).toContain('consumo de água')
  })

  it('bloqueia enunciados praticamente repetidos na prova final', () => {
    const issues = validateExamAssembly([
      question(1, 'Calcule a área de um terreno retangular usando metros.'),
      question(2, 'Calcule a área de um terreno retangular usando metros.'),
    ], slots)
    expect(issues.some((issue) => issue.severity === 'bloqueante' && issue.questionNumbers.includes(1) && issue.questionNumbers.includes(2))).toBe(true)
  })
})
