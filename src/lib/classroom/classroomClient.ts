import axios from 'axios'
import https from 'node:https'

// O servidor possui IPv6 publicado, mas não tem rota IPv6 funcional até o
// Google. OAuth já usa IPv4 por esse motivo (google-oauth-fetch.ts); as
// chamadas REST do Classroom também precisam fixar a família, ou a emissão
// dos cartões pode expirar antes mesmo de receber o roster.
const classroomApi = axios.create({
  baseURL: 'https://classroom.googleapis.com/v1',
  httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
  timeout: 10_000,
})

// Um access token válido (não expirado) pode mesmo assim não ter o escopo
// que a chamada precisa — acontece quando o token da sessão foi renovado
// via refresh_token depois de um deploy que adicionou escopo novo (refresh
// nunca amplia escopo, só reemite o que já tinha sido concedido). Detecta
// esse caso específico pra pedir reconexão em vez de um erro genérico —
// confirmado batendo direto na API: 403 PERMISSION_DENIED com
// reason=ACCESS_TOKEN_SCOPE_INSUFFICIENT (16/07/2026).
export function isInsufficientScopeError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  const details = err.response?.data?.error?.details
  if (!Array.isArray(details)) return false
  return details.some((d) => d?.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
}

export type ClassroomApiErrorSummary = {
  httpStatus: number | null
  googleStatus: string | null
  reason: string | null
}

// A resposta da API pode trazer detalhes úteis para operação, mas nunca deve
// atravessar o limite do servidor inteira: ela pode conter texto/contexto que
// não é necessário para o professor. Mantemos só os identificadores públicos
// do Google para indicar a etapa recusada sem vazar token ou payload.
export function summarizeClassroomApiError(err: unknown): ClassroomApiErrorSummary {
  if (!axios.isAxiosError(err)) return { httpStatus: null, googleStatus: null, reason: null }

  const payload = err.response?.data
  const error = payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object'
    ? payload.error as { status?: unknown; details?: unknown }
    : null
  const reason = Array.isArray(error?.details)
    ? error.details.find((detail): detail is { reason: string } => Boolean(detail && typeof detail === 'object' && 'reason' in detail && typeof detail.reason === 'string'))?.reason ?? null
    : null

  return {
    httpStatus: typeof err.response?.status === 'number' ? err.response.status : null,
    googleStatus: typeof error?.status === 'string' ? error.status : null,
    reason: reason && /^[A-Z0-9_]{1,100}$/.test(reason) ? reason : null,
  }
}

export type ClassroomCourse = {
  id: string
  name: string
  section: string | null
  room: string | null
  courseState: string
  alternateLink: string
}

type CoursesListResponse = {
  courses?: Array<{
    id: string
    name: string
    section?: string
    room?: string
    courseState: string
    alternateLink: string
  }>
  nextPageToken?: string
}

/**
 * Turmas do professor logado, via o access token dele (não a service
 * account — cursos do Classroom pertencem à conta individual do
 * professor). Pagina até esgotar (`nextPageToken`) e ignora cursos
 * arquivados/excluídos (só ACTIVE/PROVISIONED).
 */
export async function listMyCourses(accessToken: string): Promise<ClassroomCourse[]> {
  const courses: ClassroomCourse[] = []
  let pageToken: string | undefined

  do {
    const { data } = await classroomApi.get<CoursesListResponse>('/courses', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        teacherId: 'me',
        courseStates: ['ACTIVE', 'PROVISIONED'],
        pageSize: 100,
        pageToken,
      },
      paramsSerializer: { indexes: null },
    })

    for (const c of data.courses ?? []) {
      courses.push({
        id: c.id,
        name: c.name,
        section: c.section ?? null,
        room: c.room ?? null,
        courseState: c.courseState,
        alternateLink: c.alternateLink,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return courses
}

export type ClassroomStudent = {
  classroomStudentId: string
  name: string
  email: string | null
}

type StudentsListResponse = {
  students?: Array<{
    userId: string
    profile?: { name?: { fullName?: string }; emailAddress?: string }
  }>
  nextPageToken?: string
}

/**
 * Roster de uma turma específica — precisa do escopo
 * classroom.rosters.readonly (separado de classroom.courses.readonly).
 */
export async function listStudentsInCourse(accessToken: string, courseId: string): Promise<ClassroomStudent[]> {
  const students: ClassroomStudent[] = []
  let pageToken: string | undefined

  do {
    const { data } = await classroomApi.get<StudentsListResponse>(`/courses/${courseId}/students`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { pageSize: 100, pageToken },
    })

    for (const s of data.students ?? []) {
      students.push({
        classroomStudentId: s.userId,
        name: s.profile?.name?.fullName ?? '(sem nome)',
        email: s.profile?.emailAddress ?? null,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return students
}

/**
 * Cria a atividade no Classroom que serve de "container" pra nota — a
 * prova em si foi aplicada em papel, isso aqui é só o registro no
 * caderno de notas do Classroom. `state: PUBLISHED` é obrigatório pra
 * existir 1 StudentSubmission por aluno matriculado (rascunho/DRAFT não
 * gera submissão nenhuma, então não teria onde lançar a nota depois).
 */
export async function createCourseWork(
  accessToken: string,
  courseId: string,
  params: { title: string; description: string; maxPoints: number },
): Promise<{ id: string }> {
  const { data } = await classroomApi.post(
    `/courses/${courseId}/courseWork`,
    {
      title: params.title,
      description: params.description,
      workType: 'ASSIGNMENT',
      maxPoints: params.maxPoints,
      state: 'PUBLISHED',
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return { id: data.id }
}

// Variante com anexo do Drive (Módulo 3 — Reforço ENEM): cria a Atividade
// já com o PDF anexado em modo VIEW (aluno lê, não edita; STUDENT_COPY só
// faz sentido pra Docs editáveis). O arquivo precisa estar compartilhado
// com o domínio ANTES (ver exportDocAsPdf), senão o anexo quebra pro aluno.
export async function createCourseWorkWithMaterial(
  accessToken: string,
  courseId: string,
  params: { title: string; description: string; maxPoints: number; driveFileId: string; driveFileTitle: string; state?: 'DRAFT' | 'PUBLISHED' },
): Promise<{ id: string; alternateLink: string | null }> {
  const { data } = await classroomApi.post(
    `/courses/${courseId}/courseWork`,
    {
      title: params.title,
      description: params.description,
      workType: 'ASSIGNMENT',
      maxPoints: params.maxPoints,
      state: params.state ?? 'PUBLISHED',
      materials: [
        {
          driveFile: {
            driveFile: { id: params.driveFileId, title: params.driveFileTitle },
            shareMode: 'VIEW',
          },
        },
      ],
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return { id: data.id, alternateLink: data.alternateLink ?? null }
}

// Alguns domínios restringem que um arquivo criado pela conta técnica seja
// anexado nativamente por outro professor, ainda que o PDF tenha permissão de
// leitura no domínio. O link preserva o mesmo PDF compartilhado e permite que
// o Classroom faça a publicação sem tentar assumir o compartilhamento do
// arquivo em nome da professora.
export async function createCourseWorkWithLinkMaterial(
  accessToken: string,
  courseId: string,
  params: { title: string; description: string; maxPoints: number; url: string; linkTitle: string; state?: 'DRAFT' | 'PUBLISHED' },
): Promise<{ id: string; alternateLink: string | null }> {
  const { data } = await axios.post(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`,
    {
      title: params.title,
      description: params.description,
      workType: 'ASSIGNMENT',
      maxPoints: params.maxPoints,
      state: params.state ?? 'PUBLISHED',
      materials: [{ link: { url: params.url, title: params.linkTitle } }],
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return { id: data.id, alternateLink: data.alternateLink ?? null }
}

export async function createCourseWorkWithForm(
  accessToken: string,
  courseId: string,
  params: { title: string; description: string; formUrl: string; state: 'DRAFT' | 'PUBLISHED' },
): Promise<{ id: string; alternateLink: string | null }> {
  const { data } = await axios.post(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`,
    {
      title: params.title,
      description: params.description,
      workType: 'ASSIGNMENT',
      maxPoints: 100,
      state: params.state,
      assigneeMode: 'ALL_STUDENTS',
      materials: [{ link: { url: params.formUrl, title: 'Responder atividade' } }],
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return { id: data.id, alternateLink: data.alternateLink ?? null }
}

export async function publishCourseWork(accessToken: string, courseId: string, courseWorkId: string): Promise<void> {
  await axios.patch(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}`,
    { state: 'PUBLISHED' },
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { updateMask: 'state' } },
  )
}

export async function deleteCourseWork(accessToken: string, courseId: string, courseWorkId: string): Promise<void> {
  await axios.delete(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
}

export type ClassroomSubmission = { submissionId: string; userId: string; state: string | null; assignedGrade: number | null; assignedRubricGrades: unknown | null }

type SubmissionsListResponse = {
  studentSubmissions?: Array<{ id: string; userId: string; state?: string; assignedGrade?: number; assignedRubricGrades?: unknown }>
  nextPageToken?: string
}

export async function listSubmissions(accessToken: string, courseId: string, courseWorkId: string): Promise<ClassroomSubmission[]> {
  const submissions: ClassroomSubmission[] = []
  let pageToken: string | undefined

  do {
    const { data } = await classroomApi.get<SubmissionsListResponse>(
      `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { pageSize: 100, pageToken } },
    )
    for (const s of data.studentSubmissions ?? []) {
      submissions.push({ submissionId: s.id, userId: s.userId, state: s.state ?? null, assignedGrade: typeof s.assignedGrade === 'number' ? s.assignedGrade : null, assignedRubricGrades: s.assignedRubricGrades ?? null })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return submissions
}

/**
 * Preenche a nota e tenta devolver pro aluno em seguida — não existe um
 * "salvar rascunho de nota" separado nesse fluxo, por decisão confirmada
 * com o usuário: 1 clique lança tudo.
 *
 * `:return` FALHA com 400 FAILED_PRECONDITION quando a submissão nunca foi
 * "entregue" digitalmente (fica parada em `state: CREATED`) — é
 * exatamente o caso de toda prova em papel corrigida aqui, já que o aluno
 * nunca interagiu com essa atividade no Classroom (confirmado batendo
 * direto na API, 17/07/2026: `assignedGrade` grava certinho via patch, só
 * o `:return` rejeita). Isso não é falha real — a nota já está visível no
 * caderno do professor, que é o efeito que importa — então esse erro
 * específico é engolido aqui, não propagado como erro pro chamador.
 */
export async function patchAndReturnGrade(
  accessToken: string,
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  grade: number,
): Promise<void> {
  await classroomApi.patch(
    `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}`,
    { assignedGrade: grade, draftGrade: grade },
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { updateMask: 'assignedGrade,draftGrade' } },
  )

  try {
    await classroomApi.post(
      `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}:return`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
  } catch (err) {
    const isUnsubmittedPrecondition = axios.isAxiosError(err) && err.response?.data?.error?.status === 'FAILED_PRECONDITION'
    if (!isUnsubmittedPrecondition) throw err
  }
}
