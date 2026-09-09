import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { enqueueAtividadeJob } from '@/lib/queue/enqueue'
import { gerarAtividadeJobPayloadSchema } from '@/lib/queue/types'

// Entrada assíncrona para Atividades. O worker faz a leitura do
// currículo e a geração; a rota só valida, autentica e coloca o pedido na
// fila, mantendo a resposta rápida para o professor.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!await llmAvailable()) return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })

  const parsed = gerarAtividadeJobPayloadSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true } })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  try {
    const jobId = await enqueueAtividadeJob({ ...parsed.data, bnccCodes: [...new Set(parsed.data.bnccCodes.map((code) => code.trim().toUpperCase()))] }, currentUser.id)
    return NextResponse.json({ jobId }, { status: 202 })
  } catch (err) {
    console.error('[activities] erro ao enfileirar:', err)
    return NextResponse.json({ error: 'Erro ao enfileirar a atividade.' }, { status: 500 })
  }
}
