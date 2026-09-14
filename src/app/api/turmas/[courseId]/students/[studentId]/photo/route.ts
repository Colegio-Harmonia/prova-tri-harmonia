import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { isInsufficientScopeError, listMyCourses, listStudentsInCourse } from '@/lib/classroom/classroomClient'

// O Classroom entrega URLs de imagem que podem exigir autorização Google no
// navegador. Fazemos a leitura no servidor com o token do professor e
// devolvemos somente os bytes da foto ao navegador autenticado no Prova-TRI.
export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string; studentId: string }> }) {
  const { courseId, studentId } = await params
  const session = await auth()
  if (!session?.user?.email || !session.googleAccessToken) return new NextResponse(null, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
  if (!currentUser) return new NextResponse(null, { status: 401 })

  try {
    const [courses, proof] = await Promise.all([
      listMyCourses(session.googleAccessToken),
      db.query.generatedExams.findFirst({
        where: and(
          eq(generatedExams.examKind, 'prova'),
          eq(generatedExams.classroomCourseId, courseId),
          ...(!isStaffSuperuser(currentUser.role) ? [eq(generatedExams.assignedTo, currentUser.id)] : []),
        ),
        columns: { id: true },
      }),
    ])
    if (!proof || !courses.some((course) => course.id === courseId)) return new NextResponse(null, { status: 404 })

    const student = (await listStudentsInCourse(session.googleAccessToken, courseId)).find((item) => item.classroomStudentId === studentId)
    if (!student?.photoUrl) return new NextResponse(null, { status: 404 })
    const source = new URL(student.photoUrl)
    if (!source.hostname.endsWith('.googleusercontent.com')) return new NextResponse(null, { status: 404 })

    // URLs de foto do Classroom podem redirecionar para outro host do
    // Google. Alguns desses redirects removem o Authorization; tentar
    // primeiro a URL assinada sem header e depois com token cobre os dois
    // formatos devolvidos pela API.
    let photo = await fetch(source, { redirect: 'follow' })
    if (!photo.ok) photo = await fetch(source, { headers: { Authorization: `Bearer ${session.googleAccessToken}` }, redirect: 'follow' })
    if (!photo.ok || !photo.body) return new NextResponse(null, { status: photo.status === 401 || photo.status === 403 ? 404 : 502 })
    const contentType = photo.headers.get('content-type')
    if (!contentType?.startsWith('image/')) return new NextResponse(null, { status: 502 })

    return new NextResponse(photo.body, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (err) {
    if (!isInsufficientScopeError(err)) console.error('[api/turmas/photo] falha ao buscar foto:', err)
    return new NextResponse(null, { status: 502 })
  }
}
