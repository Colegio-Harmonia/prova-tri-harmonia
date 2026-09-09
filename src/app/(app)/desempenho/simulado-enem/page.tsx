import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { enemSaeImports } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import type { EnemSaeAnalysis } from '@/lib/analytics/enemSae'
import EnemSaeImport from './enem-sae-import'

export default async function EnemSimulatorPage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/desempenho')

  const academicYear = new Date().getFullYear()
  const rows = await db
    .select({ bimester: enemSaeImports.bimester, analysis: enemSaeImports.analysis })
    .from(enemSaeImports)
    .where(eq(enemSaeImports.academicYear, academicYear))
  const imports = Object.fromEntries(rows.map((row) => [String(row.bimester), row.analysis as EnemSaeAnalysis]))

  return <EnemSaeImport initialImports={imports} academicYear={academicYear} readOnly />
}
