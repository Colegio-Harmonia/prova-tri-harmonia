import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { ACERVO_BROWSER_ORIGIN, acervoBrowserAllowsFrame, acervoBrowserDocument, acervoBrowserSubject } from '@/lib/exams/acervoBrowser'

export async function GET(req: NextRequest) {
  if (!(await auth())?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  try {
    const responses = await Promise.all(['/', '/panel.js'].map((path) => fetch(ACERVO_BROWSER_ORIGIN + path, { signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' })))
    if (responses.some((response) => !response.ok)) throw new Error('bank_unavailable')
    const [html, script] = await Promise.all(responses.map((response) => response.text()))
    if (!html.includes('id="results"') || !html.includes('id="detail"')) throw new Error('bank_panel_changed')
    const parentOrigin = req.nextUrl.searchParams.get('parentOrigin') ?? ''
    const origin = parentOrigin ? new URL(parentOrigin) : null
    if (script.includes('const pickerOrigin=') && origin && ['http:', 'https:'].includes(origin.protocol) && origin.origin === parentOrigin && acervoBrowserAllowsFrame(responses[0].headers, parentOrigin)) {
      const url = new URL('/', ACERVO_BROWSER_ORIGIN)
      url.searchParams.set('selecionar', '1')
      url.searchParams.set('parent_origin', parentOrigin)
      url.searchParams.set('disciplina', acervoBrowserSubject((req.nextUrl.searchParams.get('subject') ?? '').slice(0, 120)))
      return NextResponse.json({ url: url.href }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ html: acervoBrowserDocument(html, script, (req.nextUrl.searchParams.get('subject') ?? '').slice(0, 120)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'O banco de questões está indisponível. Tente abrir novamente.' }, { status: 502 })
  }
}
