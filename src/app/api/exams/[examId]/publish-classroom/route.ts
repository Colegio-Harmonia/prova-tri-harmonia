import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { activityClassroomSyncs, generatedExams, users } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { exportDocAsPdf } from '@/lib/docs/exportPdf'
import { createCourseWorkWithForm, createCourseWorkWithLinkMaterial, createCourseWorkWithMaterial, deleteCourseWork, isInsufficientScopeError, listMyCourses, summarizeClassroomApiError } from '@/lib/classroom/classroomClient'
import { activityFormEditUrl, createActivityForm, deleteActivityForm, shareActivityFormWithTeacher } from '@/lib/forms/activityForm'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

const PUBLISHABLE_STATUSES = ['aprovado', 'impresso', 'aplicado', 'corrigido']
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const bodySchema = z.object({ courseId: z.string().min(1).optional(), title: z.string().min(3).max(200).optional() })

function hasGoogleScope(scopes: string | undefined, scope: string): boolean {
  return scopes?.split(/\s+/).includes(scope) ?? false
}

async function fetchEnemSkillDescriptions(area: string, codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map()
  const rows = await db.execute(sql`SELECT s.code, s.description FROM enem_skills s JOIN enem_competencies ec ON ec.id = s.competency_id JOIN enem_areas ea ON ea.id = ec.area_id WHERE ea.code = ${area} AND s.code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)
  return new Map((rows as unknown as Array<{ code: string; description: string }>).map((row) => [row.code, row.description]))
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!session.googleAccessToken) return NextResponse.json({ error: 'google_not_connected' }, { status: 403 })
  const examId = Number((await props.params).examId)
  if (!Number.isInteger(examId) || examId <= 0) return NextResponse.json({ error: 'Prova inválida' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  const authz = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authz) return authz.error
  const { exam } = authz
  if (!['reforco_enem', 'atividade'].includes(exam.examKind)) return NextResponse.json({ error: 'Publicação no Classroom só está disponível para atividades e reforços ENEM.' }, { status: 422 })
  if (!PUBLISHABLE_STATUSES.includes(exam.status) || !exam.provaDocId) return NextResponse.json({ error: 'A atividade precisa estar aprovada (com documentos gerados) antes de publicar.' }, { status: 409 })
  const courseId = parsed.data.courseId ?? exam.classroomCourseId
  if (!courseId) return NextResponse.json({ error: 'Escolha a turma do Classroom pra publicar.' }, { status: 400 })
  if (exam.classroomCourseWorkId) {
    const sync = exam.examKind === 'atividade'
      ? await db.query.activityClassroomSyncs.findFirst({ where: eq(activityClassroomSyncs.examId, examId), columns: { formId: true } })
      : null
    return NextResponse.json({
      courseWorkId: exam.classroomCourseWorkId,
      formEditUrl: sync?.formId ? activityFormEditUrl(sync.formId) : null,
      alreadyPublished: true,
    })
  }

  const metadata = exam.generationPayload as { metadata?: { reinforcement?: { enemArea?: string; enemSkills?: string[] }; activity?: { bnccCodes?: string[]; bnccDescriptions?: Record<string, string> } } }
  const isActivity = exam.examKind === 'atividade'
  const responsibleTeacher = isActivity && exam.assignedTo && exam.assignedTo !== authz.currentUser.id
    ? await db.query.users.findFirst({ where: eq(users.id, exam.assignedTo), columns: { email: true } })
    : null
  const responsibleTeacherEmail = responsibleTeacher?.email ?? null
  if (responsibleTeacherEmail && !hasGoogleScope(session.googleScopes, DRIVE_FILE_SCOPE)) {
    return NextResponse.json({ error: 'reauth_required', stage: 'share_form_with_teacher' }, { status: 403 })
  }
  const codes = isActivity ? metadata.metadata?.activity?.bnccCodes ?? [] : metadata.metadata?.reinforcement?.enemSkills ?? []
  if (isActivity && !codes.length) return NextResponse.json({ error: 'Esta atividade não possui habilidades BNCC estruturadas; gere-a novamente antes de publicar.' }, { status: 409 })
  const descriptions = isActivity ? new Map(Object.entries(metadata.metadata?.activity?.bnccDescriptions ?? {})) : await fetchEnemSkillDescriptions(metadata.metadata?.reinforcement?.enemArea ?? '', codes)
  const codeLines = codes.map((code) => `• ${code}${descriptions.get(code) ? ` — ${descriptions.get(code)}` : ''}`)
  const title = parsed.data.title ?? (isActivity ? `[Atividade BNCC] ${exam.subject} — ${codes.join(', ')}` : `[Reforço ENEM] Treino Focado nas Habilidades: ${codes.join(', ')}`)
  const description = [
    `${isActivity ? 'Atividade formativa' : 'Atividade de reforço'} gerada pelo Prova TRI — Colégio Harmonia (${exam.subject}, ${exam.gradeYear}º ano).`,
    codeLines.length ? `${isActivity ? 'Habilidades BNCC' : 'Habilidades trabalhadas'}:\n${codeLines.join('\n')}` : null,
    isActivity ? 'Responda pelo Google Quiz anexado. As objetivas são corrigidas automaticamente; as discursivas serão corrigidas pela professora no Formulário.' : 'Resolva e entregue conforme orientação do professor.',
  ].filter(Boolean).join('\n\n')

  let createdCourseWorkId: string | null = null
  let createdFormId: string | null = null
  let stage: 'verify_course_teacher' | 'create_form' | 'share_form_with_teacher' | 'export_pdf' | 'create_coursework' | 'persist_sync' = 'verify_course_teacher'
  try {
    const isTeacherInCourse = (await listMyCourses(session.googleAccessToken)).some((course) => course.id === courseId)
    if (!isTeacherInCourse) return NextResponse.json({ error: 'classroom_not_course_teacher' }, { status: 403 })

    if (isActivity) {
      stage = 'create_form'
      const payload = exam.generationPayload as ExamGenerationResult
      const form = await createActivityForm(session.googleAccessToken, { title, description, questions: payload.questions })
      createdFormId = form.formId
      if (responsibleTeacherEmail) {
        stage = 'share_form_with_teacher'
        await shareActivityFormWithTeacher(session.googleAccessToken, form.formId, responsibleTeacherEmail)
      }
      stage = 'create_coursework'
      const courseWork = await createCourseWorkWithForm(session.googleAccessToken, courseId, {
        title,
        description,
        formUrl: form.responderUri,
        state: 'DRAFT',
      })
      createdCourseWorkId = courseWork.id
      stage = 'persist_sync'
      await db.insert(activityClassroomSyncs).values({ examId, courseId, courseWorkId: courseWork.id, formId: form.formId })
      await db.update(generatedExams).set({ classroomCourseWorkId: courseWork.id, classroomCourseId: courseId }).where(eq(generatedExams.id, examId))
      return NextResponse.json({
        courseWorkId: courseWork.id,
        alternateLink: `https://classroom.google.com/c/${courseId}/a/${courseWork.id}/details`,
        formEditUrl: form.editUrl,
        formEditorEmail: responsibleTeacherEmail,
        alreadyPublished: false,
        state: 'DRAFT',
      })
    }

    const domain = session.user.email.split('@')[1]
    const { pdfFileId } = await exportDocAsPdf({ docId: exam.provaDocId, pdfName: `${isActivity ? 'Atividade' : 'Atividade de Reforço'} - ${exam.subject} - ${codes.join(', ') || `#${exam.id}`}.pdf`, parentFolderId: exam.driveFolderId, shareWithDomain: domain })
    stage = 'create_coursework'
    const courseWorkParams = { title, description, maxPoints: 100, state: 'PUBLISHED' as const }
    const pdfTitle = `Atividade de Reforço — ${exam.subject}.pdf`
    let courseWork
    try {
      courseWork = await createCourseWorkWithMaterial(session.googleAccessToken, courseId, { ...courseWorkParams, driveFileId: pdfFileId, driveFileTitle: pdfTitle })
    } catch (err) {
      const nativeAttachmentFailure = summarizeClassroomApiError(err)
      if (nativeAttachmentFailure.httpStatus !== 403 || nativeAttachmentFailure.googleStatus !== 'PERMISSION_DENIED') throw err
      courseWork = await createCourseWorkWithLinkMaterial(session.googleAccessToken, courseId, { ...courseWorkParams, url: `https://drive.google.com/open?id=${pdfFileId}`, linkTitle: pdfTitle })
      console.info('[publish-classroom] publicou PDF como link compartilhado', { examId })
    }
    createdCourseWorkId = courseWork.id
    await db.update(generatedExams).set({ classroomCourseWorkId: courseWork.id, classroomCourseId: courseId }).where(eq(generatedExams.id, examId))
    return NextResponse.json({ courseWorkId: courseWork.id, alternateLink: courseWork.alternateLink, alreadyPublished: false })
  } catch (err) {
    if (createdCourseWorkId) await deleteCourseWork(session.googleAccessToken, courseId, createdCourseWorkId).catch(() => {})
    if (createdFormId) await deleteActivityForm(session.googleAccessToken, createdFormId).catch(() => {})
    const provider = summarizeClassroomApiError(err)
    if (isInsufficientScopeError(err)) return NextResponse.json({ error: 'reauth_required', stage }, { status: 403 })
    console.warn('[publish-classroom] falha', { examId, stage, provider })
    return NextResponse.json({ error: 'classroom_publish_failed', stage, provider }, { status: 502 })
  }
}
