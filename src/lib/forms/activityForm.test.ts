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
      createItem: { item: { questionItem: { question: { required: true, grading: { pointValue: 50 }, textQuestion: { paragraph: true } } } } },
    })
    expect(JSON.stringify(requests[3])).not.toContain('correctAnswers')
    expect(JSON.stringify(requests)).not.toContain('correctLetter')
  })

  it.each(['\n', '\r\n', '\r', '\u0085', '\u2028', '\u2029'])('preserva enunciado com quebra %j na descrição, sem quebra no título', (newline) => {
    const statement = `Leia a situação.${newline}${newline}a) Explique.${newline}b) Justifique.`
    const source = question({ number: 10, statement, supportText: 'Texto de apoio.' })
    const requests = buildActivityFormRequests('', [source])
    expect(requests[2]).toMatchObject({ createItem: { item: {
      title: 'Questão 10', description: `Texto de apoio.\n\n${statement}`,
    } } })
    expect(source.statement).toBe(statement)
  })

  it('normaliza alternativas e gabarito com a mesma regra de linha única', () => {
    const source = question({ alternatives: [{ letter: 'A', text: 'Menos poluição.\nMelhor qualidade do ar.' }, { letter: 'B', text: 'Mais poluição.\r\nPior qualidade do ar.' }] })
    const requests = buildActivityFormRequests('', [source])
    expect(requests[2]).toMatchObject({ createItem: { item: { questionItem: { question: {
      choiceQuestion: { options: [{ value: 'A) Menos poluição. Melhor qualidade do ar.' }, { value: 'B) Mais poluição. Pior qualidade do ar.' }] },
      grading: { correctAnswers: { answers: [{ value: 'A) Menos poluição. Melhor qualidade do ar.' }] } },
    } } } } })
    expect(source.alternatives?.[0].text).toContain('\n')
  })

  it('divide 100 pontos sem casas decimais', () => {
    expect(activityQuestionPoints(Array.from({ length: 12 }, () => question()))).toEqual([9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8])
    expect(activityQuestionPoints(Array.from({ length: 7 }, () => question()))).toEqual([15, 15, 14, 14, 14, 14, 14])
  })

  it('usa o responderUri devolvido na criação', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { formId: 'form-123', responderUri: 'https://forms.gle/responder' } } as never).mockResolvedValueOnce({ data: {} } as never).mockResolvedValueOnce({ data: {} } as never)
    await expect(createActivityForm('token', { title: 'Atividade', description: 'Instruções', questions: [question()] })).resolves.toMatchObject({ formId: 'form-123', responderUri: 'https://forms.gle/responder' })
    const settings = post.mock.calls[1][1] as { requests: unknown[] }
    const items = post.mock.calls[2][1] as { requests: unknown[] }
    expect(settings.requests).toHaveLength(2)
    expect(JSON.stringify(settings)).not.toContain('createItem')
    expect(items.requests).toHaveLength(1)
    expect(items.requests[0]).toMatchObject({ createItem: { location: { index: 0 } } })
  })

  it('remove o arquivo incompleto e preserva a etapa e o erro original', async () => {
    const rejection = new Error('invalid question')
    vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { formId: 'form-123', responderUri: 'https://forms.gle/responder' } } as never)
      .mockResolvedValueOnce({ data: {} } as never).mockRejectedValueOnce(rejection)
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ data: {} } as never)
    await expect(createActivityForm('token', { title: 'Atividade', description: '', questions: [question()] }))
      .rejects.toMatchObject({ name: 'ActivityFormCreationError', stage: 'add_form_questions', cause: rejection })
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/files/form-123', expect.any(Object))
  })

  it('interrompe antes das questões se o Quiz não puder ser configurado', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { formId: 'form-123', responderUri: 'https://forms.gle/responder' } } as never)
      .mockRejectedValueOnce(new Error('settings rejected'))
    vi.spyOn(axios, 'delete').mockResolvedValue({ data: {} } as never)
    await expect(createActivityForm('token', { title: 'Atividade', description: '', questions: [question()] }))
      .rejects.toMatchObject({ stage: 'configure_form' })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('não cria arquivo quando o gabarito local é inválido', async () => {
    const post = vi.spyOn(axios, 'post')
    await expect(createActivityForm('token', { title: 'Atividade', description: '', questions: [question({ correctLetter: 'E' })] })).rejects.toThrow('alternativa correta válida')
    expect(post).not.toHaveBeenCalled()
  })

  it('leva a mídia original para o Form sem exigir um segundo aceite', () => {
    const requests = buildActivityFormRequests('', [question({ source: 'enem_bank', enemBankRef: { questionId: 1, year: 2020 }, image: { source: 'enem', driveFileId: 'original', previewUrl: '/image', approved: false } })])
    expect(requests[2]).toMatchObject({ createItem: { item: { questionItem: { image: { sourceUri: 'https://drive.google.com/uc?id=original' } } } } })
    const pending = buildActivityFormRequests('', [question({ image: { source: 'gerada', driveFileId: 'generated', previewUrl: '/image', approved: false } })])
    expect(JSON.stringify(pending)).not.toContain('sourceUri')
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
