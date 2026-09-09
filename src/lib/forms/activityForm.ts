import axios from 'axios'
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

function questionTitle(question: ExamQuestion): string {
  return `Questão ${question.number}. ${question.statement}`
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
    correctAnswers: { answers: [{ value: `${correct.letter}) ${correct.text}` }] },
  }
}

function discursiveGrading(pointValue: number) {
  // Forms exige um answer key no payload de grading. Uma lista vazia mantém
  // a resposta discursiva sem autocorreção e deixa a pontuação para a docente.
  return { pointValue, correctAnswers: { answers: [] } }
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
      title: questionTitle(question),
      ...(question.supportText ? { description: question.supportText } : {}),
      questionItem: {
        question: {
          required: true,
          ...(question.type === 'objetiva'
            ? {
                grading: objectiveGrading(question, pointValue),
                choiceQuestion: {
                  type: 'RADIO',
                  shuffle: false,
                  options: (question.alternatives ?? []).map((alternative) => ({ value: `${alternative.letter}) ${alternative.text}` })),
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

export async function createActivityForm(
  accessToken: string,
  params: { title: string; description: string; questions: ExamQuestion[] },
): Promise<{ formId: string; responderUri: string; editUrl: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const { data: created } = await axios.post<{ formId: string; responderUri?: string }>(
    'https://forms.googleapis.com/v1/forms',
    { info: { title: params.title, documentTitle: params.title } },
    { headers },
  )
  if (!created.formId || !created.responderUri) throw new Error('O Google Forms não devolveu os dados necessários do formulário.')

  await axios.post(
    `https://forms.googleapis.com/v1/forms/${created.formId}:batchUpdate`,
    { requests: buildActivityFormRequests(params.description, params.questions) },
    { headers },
  )

  return { formId: created.formId, responderUri: created.responderUri, editUrl: activityFormEditUrl(created.formId) }
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
