import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { aiModelProfiles, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { getTextFallbackModel, saveTextFallbackModel } from '@/lib/ai/textFallback'

const bodySchema = z.object({
  id: z.number().int().positive().optional(),
  purpose: z.enum(['text_generation', 'image_generation', 'image_validation', 'scan_transcription']),
  provider: z.enum(['deepseek', 'gemini', 'anthropic', 'openai']),
  model: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  inputCostMicrousdPerMillion: z.number().int().min(0).nullable(),
  outputCostMicrousdPerMillion: z.number().int().min(0).nullable(),
  imageCostMicrousd: z.number().int().min(0).nullable(),
})

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const profiles = await db.query.aiModelProfiles.findMany({ orderBy: (table, { asc }) => [asc(table.purpose), asc(table.provider), asc(table.model)] })
  const fallback = await getTextFallbackModel()
  return NextResponse.json({ profiles, textFallbackProfileId: fallback?.id ?? null })
}

export async function PATCH(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = z.object({ textFallbackProfileId: z.number().int().positive().nullable() }).safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Reserva inválida.' }, { status: 400 })
  const id = parsed.data.textFallbackProfileId
  if (id !== null) {
    const profile = await db.query.aiModelProfiles.findFirst({ where: eq(aiModelProfiles.id, id) })
    if (!profile || profile.purpose !== 'text_generation' || !['deepseek', 'gemini', 'openai'].includes(profile.provider)) {
      return NextResponse.json({ error: 'Escolha um modelo de texto compatível.' }, { status: 400 })
    }
    const profiles = await db.query.aiModelProfiles.findMany({ where: eq(aiModelProfiles.purpose, 'text_generation') })
    if (profiles.some((primary) => primary.enabled && primary.provider === profile.provider)) {
      return NextResponse.json({ error: 'Escolha uma reserva de outro provedor para proteger contra falta de saldo.' }, { status: 400 })
    }
    const key = profile.provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : profile.provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY
    if (!key) return NextResponse.json({ error: 'A credencial deste provedor ainda não está configurada no servidor.' }, { status: 400 })
  }
  await saveTextFallbackModel(id, user.id)
  return NextResponse.json({ textFallbackProfileId: id })
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Perfil inválido.' }, { status: 400 })
  const profile = parsed.data

  if (profile.enabled) await db.update(aiModelProfiles).set({ enabled: false, updatedAt: new Date() }).where(eq(aiModelProfiles.purpose, profile.purpose))
  if (profile.id) {
    const { id, ...values } = profile
    const [updated] = await db.update(aiModelProfiles).set({ ...values, updatedAt: new Date() }).where(eq(aiModelProfiles.id, id)).returning()
    return NextResponse.json({ profile: updated })
  }
  const [created] = await db.insert(aiModelProfiles).values(profile).returning()
  return NextResponse.json({ profile: created }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const purpose = z.enum(['text_generation', 'image_generation', 'image_validation', 'scan_transcription']).safeParse(new URL(req.url).searchParams.get('purpose'))
  if (!purpose.success) return NextResponse.json({ error: 'Finalidade inválida.' }, { status: 400 })
  await db.update(aiModelProfiles).set({ enabled: false, updatedAt: new Date() }).where(eq(aiModelProfiles.purpose, purpose.data))
  return NextResponse.json({ ok: true })
}
