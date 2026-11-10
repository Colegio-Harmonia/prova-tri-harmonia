import axios from 'axios'
import { isQuestionImageApproved } from '@/lib/exams/questionOrigin'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

type FormItemRequest = {
  createItem: {
    item: Record<string, unknown>
    location: { index: number }
  }
}

type FormBatchRequest =
  | FormItemRequest
  | { updateFormInfo: { info: { description: string }; updateMask: string } }
  | { updateSettings: { settings: { emailCollectionType: 'VERIFIED'; quizSettings: { isQuiz: true } }; updateMask: string } }

const TOTAL_ACTIVITY_POINTS = 100

export function activityFormEditUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${formId}/edit`
}

const DISPLAYED_TEXT_LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]/

function singleLineDisplayedText(text: string): string {
  return text.replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' ').trim()
}

function choiceValue(alternative: { letter: string; text: string }): string {
  // Options and answer keys must use exactly the same normalized value.
  return singleLineDisplayedText(`${alternative.letter}) ${alternative.text}`)
}

function questionDisplay(question: ExamQuestion): { title: string; description?: string } {
  const multiline = DISPLAYED_TEXT_LINE_BREAKS.test(question.statement)
  // Keep paragraphs and subquestions intact in the field that accepts newlines.
  const description = [question.supportText, multiline ? question.statement : null].filter(Boolean).join('\n\n')
  return {
    title: multiline ? `Questão ${question.number}` : `Questão ${question.number}. ${question.statement}`,
    ...(description ? { description } : {}),
  }
}

/** Distributes the 0–100 scale without fractions, always totaling 100. */
export function activityQuestionPoints(questions: ExamQuestion[]): number[] {
  if (!questions.length) return []
  const base = Math.floor(TOTAL_ACTIVITY_POINTS / questions.length)
  const remainder = TOTAL_ACTIVITY_POINTS % questions.length
  return questions.map((_, index) => base + (index < remainder ? 1 : 0))
}

function objectiveGrading(question: ExamQuestion, pointValue: number) {
  const correct = question.alternatives?.find((alternative) => alternative.letter === question.correctLetter)
  if (!correct) throw new Error(`A questão ${question.number} não tem uma alternativa correta válida para o Quiz.`)
  return {
    pointValue,
    correctAnswers: { answers: [{ value: choiceValue(correct) }] },
  }
}

function discursiveGrading(pointValue: number) {
  // Paragraph questions are graded manually: do not send an automatic answer key.
  return { pointValue }
}

export function buildActivityFormRequests(description: string, questions: ExamQuestion[]): FormBatchRequest[] {
  const requests: FormBatchRequest[] = [
    { updateFormInfo: { info: { description }, updateMask: 'description' } },
    {
      updateSettings: {
        settings: { emailCollectionType: 'VERIFIED', quizSettings: { isQuiz: true } },
        updateMask: 'emailCollectionType,quizSettings.isQuiz',
      },
    },
  ]
  const points = activityQuestionPoints(questions)

  for (const [index, question] of questions.entries()) {
    const pointValue = points[index]
    const item = {
      ...questionDisplay(question),
      questionItem: {
        ...(isQuestionImageApproved(question) ? { image: { sourceUri: `https://drive.google.com/uc?id=${encodeURIComponent(question.image.driveFileId)}`, altText: `Imagem da questão ${question.number}` } } : {}),
        question: {
          required: true,
          ...(question.type === 'objetiva'
            ? {
                grading: objectiveGrading(question, pointValue),
                choiceQuestion: {
                  type: 'RADIO',
                  shuffle: false,
                  options: (question.alternatives ?? []).map((alternative) => ({ value: choiceValue(alternative) })),
                },
              }
            : { grading: discursiveGrading(pointValue), textQuestion: { paragraph: true } }),
        },
      },
    }
    requests.push({ createItem: { item, location: { index: requests.length - 2 } } })
  }

  return requests
}

export type ActivityFormStage = 'create_form' | 'configure_form' | 'add_form_questions'

export class ActivityFormCreationError extends Error {
  constructor(public readonly stage: ActivityFormStage, cause: unknown) {
    super(`Falha na etapa ${stage} do Google Forms.`, { cause })
    this.name = 'ActivityFormCreationError'
  }
}

export async function createActivityForm(
  accessToken: string,
  params: { title: string; description: string; questions: ExamQuestion[] },
): Promise<{ formId: string; responderUri: string; editUrl: string }> {
  // Validate/assemble before creating a file, so bad local data leaves no orphan.
  const requests = buildActivityFormRequests(params.description, params.questions)
  const headers = { Authorization: `Bearer ${accessToken}` }
  let formId: string | undefined
  let stage: ActivityFormStage = 'create_form'
  try {
    const { data: created } = await axios.post<{ formId: string; responderUri?: string }>(
      'https://forms.googleapis.com/v1/forms',
      { info: { title: params.title, documentTitle: params.title } },
      { headers },
    )
    formId = created.formId
    if (!formId || !created.responderUri) throw new Error('O Google Forms não devolveu os dados necessários do formulário.')

    // Enable Quiz first. Graded items are submitted only after this is confirmed.
    const batchUrl = `https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`
    stage = 'configure_form'
    await axios.post(batchUrl, { requests: requests.slice(0, 2) }, { headers })
    stage = 'add_form_questions'
    await axios.post(batchUrl, { requests: requests.slice(2) }, { headers })

    return { formId, responderUri: created.responderUri, editUrl: activityFormEditUrl(formId) }
  } catch (cause) {
    // Log only Google's error message, never the Axios request/config (OAuth token).
    if (axios.isAxiosError(cause)) {
      const message = cause.response?.data?.error?.message
      console.warn('[activity-form] Google recusou a requisição.', {
        stage,
        httpStatus: cause.response?.status ?? null,
        googleMessage: typeof message === 'string' ? message.slice(0, 600) : null,
      })
    }
    if (formId) await deleteActivityForm(accessToken, formId).catch(() => {
      console.warn('[activity-form] Não foi possível remover o formulário incompleto.', { stage, formId })
    })
    throw new ActivityFormCreationError(stage, cause)
  }
}

/** Dá à professora responsável edição do Quiz, sem transferir a propriedade. */
export async function shareActivityFormWithTeacher(accessToken: string, formId: string, teacherEmail: string): Promise<void> {
  await axios.post(
    `https://www.googleapis.com/drive/v3/files/${formId}/permissions`,
    { type: 'user', role: 'writer', emailAddress: teacherEmail },
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { sendNotificationEmail: true } },
  )
}

/** Usado somente para compensar uma publicação que falhou antes de criar o CourseWork. */
export async function deleteActivityForm(accessToken: string, formId: string): Promise<void> {
  await axios.delete(`https://www.googleapis.com/drive/v3/files/${formId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
