import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { activityFormEditUrl, activityQuestionPoints, buildActivityFormRequests, createActivityForm, deleteActivityForm, shareActivityFormWithTeacher } from './activityForm'

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'objetiva', bloomLevel: 'compreender', statement: 'Qual alternativa está correta?', supportText: null,
    alternatives: [{ letter: 'A', text: 'Primeira' }, { letter: 'B', text: 'Segunda' }], correctLetter: 'A', expectedAnswer: null, gradingCriteria: null,
    bnccCodes: [], bnccStatus: 'mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
    ...overrides,
  }
}

describe('activity Form', () => {
  afterEach(() => vi.restoreAllMocks())

  it('converte questões em Quiz, com gabarito objetivo e pontuação total de 100', () => {
    const requests = buildActivityFormRequests('Instruções', [question({ supportText: 'Leia antes.' }), question({ number: 2, type: 'descritiva', alternatives: null, correctLetter: null })])
    expect(requests).toHaveLength(4)
    expect(requests[1]).toEqual({ updateSettings: { settings: { emailCollectionType: 'VERIFIED', quizSettings: { isQuiz: true } }, updateMask: 'emailCollectionType,quizSettings.isQuiz' } })
    expect(requests[2]).toMatchObject({
      createItem: {
        item: {
          questionItem: {
            question: {
              required: true,
              grading: { pointValue: 50, correctAnswers: { answers: [{ value: 'A) Primeira' }] } },
              choiceQuestion: { type: 'RADIO', options: [{ value: 'A) Primeira' }, { value: 'B) Segunda' }] },
            },
          },
        },
      },
    })
    expect(requests[3]).toMatchObject({
      createItem: { item: { questionItem: { question: { required: true, grading: { pointValue: 50, correctAnswers: { answers: [] } }, textQuestion: { paragraph: true } } } } },
    })
    expect(JSON.stringify(requests)).not.toContain('correctLetter')
  })

  it('divide 100 pontos sem casas decimais', () => {
    expect(activityQuestionPoints(Array.from({ length: 12 }, () => question()))).toEqual([9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8])
    expect(activityQuestionPoints(Array.from({ length: 7 }, () => question()))).toEqual([15, 15, 14, 14, 14, 14, 14])
  })

  it('usa o responderUri devolvido na criação', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { formId: 'form-123', responderUri: 'https://forms.gle/responder' } } as never).mockResolvedValueOnce({ data: {} } as never)
    await expect(createActivityForm('token', { title: 'Atividade', description: 'Instruções', questions: [question()] })).resolves.toMatchObject({ formId: 'form-123', responderUri: 'https://forms.gle/responder' })
    expect(post).toHaveBeenNthCalledWith(2, 'https://forms.googleapis.com/v1/forms/form-123:batchUpdate', expect.objectContaining({ requests: expect.any(Array) }), { headers: { Authorization: 'Bearer token' } })
  })

  it('compartilha o Form com a professora responsável como editora', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} } as never)
    await shareActivityFormWithTeacher('token', 'form-123', 'tamires@colegioharmonia.com.br')
    expect(post).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/form-123/permissions',
      { type: 'user', role: 'writer', emailAddress: 'tamires@colegioharmonia.com.br' },
      { headers: { Authorization: 'Bearer token' }, params: { sendNotificationEmail: true } },
    )
  })

  it('remove o Form criado se a publicação não puder prosseguir', async () => {
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ data: {} } as never)
    await deleteActivityForm('token', 'form-123')
    expect(del).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/files/form-123', { headers: { Authorization: 'Bearer token' } })
    expect(activityFormEditUrl('form-123')).toBe('https://docs.google.com/forms/d/form-123/edit')
  })
})
