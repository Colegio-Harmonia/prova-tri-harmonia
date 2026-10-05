import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { curriculumPlans, curriculumPlanSkills, curriculumPlanStatusHistory, curriculumPlanUnits, curriculumPlanVersions, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { resolveBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { composePlanUnitTitle } from '@/lib/curriculum/planUnitTitle'
import { canReceiveNewDraft } from '@/lib/curriculum/planningPolicy'

const schema = z.object({
  academicYear: z.number().int().min(2020).max(2100),
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  subject: z.string().trim().min(1),
  bimester: z.number().int().min(1).max(4),
})

const BNCC_CODE = /^(EF\d{2}[A-Z]{2}\d{2}|EM13[A-Z]{3}\d{3}|EI\d{2}[A-Z]{2}\d{2})$/

async function requireManager() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

export async function POST(req: NextRequest) {
  const manager = await requireManager()
  if (!manager) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Recorte inválido.' }, { status: 400 })

  const input = parsed.data
  const selection = await getCurriculumForExam(input)
  if (!selection.units.length) return NextResponse.json({ error: 'A planilha não possui unidades para este recorte.' }, { status: 422 })

  const invalidCodes = new Set<string>()
  const duplicateCodes: string[] = []
  for (const unit of selection.units) {
    const seen = new Set<string>()
    for (const skill of unit.habilidades.skills) {
      const code = skill.code.trim().toUpperCase()
      if (!BNCC_CODE.test(code)) invalidCodes.add(code)
      if (seen.has(code)) duplicateCodes.push(`${unit.tituloCapitulo}: ${code}`)
      seen.add(code)
    }
  }
  if (invalidCodes.size || duplicateCodes.length) {
    return NextResponse.json({ error: 'Corrija os códigos BNCC antes de importar.', invalidCodes: [...invalidCodes], duplicateCodes }, { status: 422 })
  }

  const descriptions = await resolveBnccDescriptions(selection.units.flatMap((unit) => unit.habilidades.skills.filter((skill) => !skill.description).map((skill) => skill.code)))

  const snapshot = JSON.stringify(selection)
  const sourceHash = createHash('sha256').update(snapshot).digest('hex')
  const result = await db.transaction(async (tx) => {
    const [plan] = await tx.insert(curriculumPlans).values({ ...input, createdBy: manager.id })
      .onConflictDoUpdate({ target: [curriculumPlans.academicYear, curriculumPlans.segment, curriculumPlans.gradeYear, curriculumPlans.subject, curriculumPlans.bimester], set: { updatedAt: new Date() } })
      .returning()
    const previous = await tx.query.curriculumPlanVersions.findFirst({ where: eq(curriculumPlanVersions.planId, plan.id), orderBy: [desc(curriculumPlanVersions.versionNumber)] })
    if (previous?.sourceHash === sourceHash) return { planId: plan.id, versionId: previous.id, versionNumber: previous.versionNumber, unchanged: true }
    const allVersions = await tx.select({ id: curriculumPlanVersions.id, versionNumber: curriculumPlanVersions.versionNumber, status: curriculumPlanVersions.status }).from(curriculumPlanVersions).where(eq(curriculumPlanVersions.planId, plan.id))
    // Uma versão em trabalho por vez: importar não pode atropelar rascunho ou revisão em andamento.
    if (!canReceiveNewDraft(allVersions)) return { planId: plan.id, versionId: previous!.id, versionNumber: previous!.versionNumber, unchanged: true, blocked: true }
    const [version] = await tx.insert(curriculumPlanVersions).values({ planId: plan.id, versionNumber: (previous?.versionNumber ?? 0) + 1, status: 'rascunho', source: 'planilha', sourceReference: selection.tabName, sourceHash, createdBy: manager.id }).returning()
    for (const [position, unit] of selection.units.entries()) {
      const [savedUnit] = await tx.insert(curriculumPlanUnits).values({ versionId: version.id, position, title: composePlanUnitTitle(unit, `Unidade ${position + 1}`), content: unit.conteudo, objectives: unit.objetivos.map((objective) => objective.text).join('\n') || null }).returning()
      if (unit.habilidades.status === 'mapeado' && unit.habilidades.skills.length) {
        await tx.insert(curriculumPlanSkills).values(unit.habilidades.skills.map((skill, skillPosition) => ({ unitId: savedUnit.id, code: skill.code.trim().toUpperCase(), description: skill.description ?? descriptions.get(skill.code.trim().toUpperCase()) ?? null, position: skillPosition })))
      }
    }
    await tx.insert(curriculumPlanStatusHistory).values({ versionId: version.id, fromStatus: null, toStatus: 'rascunho', changedBy: manager.id, note: `Importado de ${selection.tabName}` })
    return { planId: plan.id, versionId: version.id, versionNumber: version.versionNumber, unchanged: false }
  })

  if ('blocked' in result) return NextResponse.json({ error: `Já existe a versão ${result.versionNumber} em rascunho ou revisão para este recorte. Conclua ou edite essa versão em Planejamento pedagógico antes de importar de novo.`, planId: result.planId }, { status: 409 })
  const skillCount = selection.units.reduce((sum, unit) => sum + unit.habilidades.skills.length, 0)
  return NextResponse.json({ ...result, unitCount: selection.units.length, skillCount, warningCount: selection.unmappedWarnings.length, sourceHash })
}
