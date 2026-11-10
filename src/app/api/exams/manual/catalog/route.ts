import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { ACERVO_BROWSER_ORIGIN, acervoBrowserPath } from '@/lib/exams/acervoBrowser'

export async function GET(req: NextRequest) {
  if (!(await auth())?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const path = acervoBrowserPath(req.nextUrl.searchParams.get('path') ?? '')
  if (!path) return NextResponse.json({ error: 'Consulta inválida.' }, { status: 400 })
  try {
    const response = await fetch(ACERVO_BROWSER_ORIGIN + path, { signal: AbortSignal.timeout(20000), cache: 'no-store', redirect: 'error' })
    const body: unknown = await response.json()
    return NextResponse.json(body, { status: response.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: { mensagem: 'Não foi possível consultar o banco. Tente novamente.' } }, { status: 502 })
  }
}
