import { describe, expect, it } from 'vitest'

import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

import { attachImagesToExam, isUploadedImageIntact } from './questionImageService'

const examWithMissingVisualQuery: ExamGenerationResult = {
  metadata: { segment: 'anos-finais', gradeYear: 7, subject: 'Ciências', questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 5 },
  questions: [{
    number: 1,
    source: 'ia',
    type: 'objetiva',
    bloomLevel: 'aplicar',
    statement: 'Observe o diagrama e responda.',
    supportText: null,
    alternatives: [{ letter: 'A', text: 'Resposta A' }, { letter: 'B', text: 'Resposta B' }, { letter: 'C', text: 'Resposta C' }, { letter: 'D', text: 'Resposta D' }, { letter: 'E', text: 'Resposta E' }],
    correctLetter: 'A',
    expectedAnswer: null,
    gradingCriteria: null,
    bnccCodes: [],
    bnccStatus: 'nao_mapeado',
    bnccSummary: null,
    pedagogicalClassification: {
      dok: { categoryCode: 'DOK_2', confidence: 0.8, justification: 'Aplica conceito.', evidence: 'diagrama' },
      soloExpected: { categoryCode: 'MULTIESTRUTURAL', confidence: 0.8, justification: 'Usa dados.', evidence: 'diagrama' },
      estimatedTimeMinutes: 2,
      difficulty: 'media',
    },
    saeb: { applicable: false, source: null, value: null, approximate: false },
    needsImage: true,
    imageQuery: null,
  }],
}

describe('resolução obrigatória de recursos visuais', () => {
  it('rejeita metadados de arquivo vazio ou não-imagem', () => {
    expect(isUploadedImageIntact({ mimeType: 'image/png', size: '45' }, 45)).toBe(true)
    expect(isUploadedImageIntact({ mimeType: 'image/png', size: '0' }, 45)).toBe(false)
    expect(isUploadedImageIntact({ mimeType: 'application/pdf', size: '45' }, 45)).toBe(false)
  })

  it('não deixa passar uma questão que pediu imagem sem imageQuery', async () => {
    await expect(attachImagesToExam(examWithMissingVisualQuery, { requireResolvedImages: true }))
      .rejects.toMatchObject({ questionNumbers: [1] })
  })

  it('preserva o comportamento legado quando o gate está desligado', async () => {
    const result = await attachImagesToExam(examWithMissingVisualQuery)
    expect(result.questions[0]?.needsImage).toBe(true)
    expect(result.questions[0]?.image).toBeUndefined()
  })
})
