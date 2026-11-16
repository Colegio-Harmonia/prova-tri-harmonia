import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { PrerequisiteError, suggestPrerequisites } from '@/lib/curriculum/prerequisiteService'
import { PREREQUISITES_RESPONSE_SCHEMA, prerequisitesResultSchema } from '@/lib/curriculum/prerequisiteSuggestions'

const bodySchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  subject: z.string().min(1),
  onlyMissing: z.boolean().optional(),
})

// Uma chamada de IA a cada 6 habilidades da série.
export const maxDuration = 300

// Sugestão de pré-requisitos por IA para uma série. Só coordenação/direção.
// Grava como "sugerida"; nada entra na Teia sem aprovação.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user?.active) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })
  if (!isStaffSuperuser(user.role)) return NextResponse.json({ error: 'Só a coordenação ou a direção pode pedir sugestões.' }, { status: 403 })
  if (!(await llmAvailable())) return NextResponse.json({ error: 'A IA não está configurada neste ambiente.' }, { status: 503 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  try {
    const result = await suggestPrerequisites({
      viewer: user,
      ...parsed.data,
      generate: async (prompt) => (await generateValidatedStructuredContent({
        context: 'curriculum/prerequisites',
        prompt,
        responseSchema: PREREQUISITES_RESPONSE_SCHEMA,
        zodSchema: prerequisitesResultSchema,
        maxAttempts: 2,
      })).value,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PrerequisiteError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[curriculum/prerequisites/suggest] falha:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Não foi possível obter as sugestões agora. Tente de novo em instantes.' }, { status: 502 })
  }
}
