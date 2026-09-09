import { NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { listMyCourses, isInsufficientScopeError } from '@/lib/classroom/classroomClient'

// Turmas do professor logado. Precisa ter entrado via Google (login por
// senha nunca tem access token do Google) e ter concedido o escopo do
// Classroom — ambos sinalizados por campos ausentes/erro na sessão, nunca
// por uma exceção não tratada.
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (session.googleError === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' }, { status: 401 })
  }

  if (!session.googleAccessToken) {
    return NextResponse.json({ error: 'google_not_connected', message: 'Entre com sua conta Google pra ver suas turmas do Classroom.' }, { status: 401 })
  }

  try {
    const courses = await listMyCourses(session.googleAccessToken)
    return NextResponse.json({ courses })
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return NextResponse.json(
        { error: 'reauth_required', message: 'Sua conta Google precisa autorizar de novo — entre com o Google outra vez.' },
        { status: 401 },
      )
    }
    console.error('[api/classroom/courses] falha ao buscar turmas:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui buscar suas turmas no Google Classroom.' }, { status: 502 })
  }
}
