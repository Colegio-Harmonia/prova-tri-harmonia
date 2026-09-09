import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { enqueueReforcoEnemJob } from '@/lib/queue/enqueue'
import { gerarReforcoEnemJobPayloadSchema } from '@/lib/queue/types'

// Módulo 3: enfileira uma atividade de reforço ENEM por habilidade INEP
// (job 'gerar_reforco_enem'). Execução no worker; acompanhamento na aba
// Histórico e Fila. Quando ficar pronta, o próprio professor revisa e
// finaliza a atividade; ela não entra na aprovação da coordenação.

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Fail-fast: a resolução comentada depende do provedor de texto.
  if (!await llmAvailable()) {
    return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })
  }

  const parsed = gerarReforcoEnemJobPayloadSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  if (!getEnemAreaForSubject(parsed.data.subject)) {
    return NextResponse.json({ error: `A disciplina "${parsed.data.subject}" não tem área ENEM correspondente.` }, { status: 422 })
  }

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  try {
    const jobId = await enqueueReforcoEnemJob(
      { ...parsed.data, enemSkills: parsed.data.enemSkills.map((s) => s.toUpperCase()) },
      currentUser.id,
    )
    return NextResponse.json({ jobId }, { status: 202 })
  } catch (err) {
    console.error('[reinforcement] erro ao enfileirar:', err)
    return NextResponse.json({ error: 'Erro ao enfileirar a atividade de reforço.' }, { status: 500 })
  }
}
