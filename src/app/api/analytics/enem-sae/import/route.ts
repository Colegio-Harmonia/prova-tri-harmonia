import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { enemSaeImports, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { parseEnemSaeWorkbook } from '@/lib/analytics/enemSae'

export const runtime = 'nodejs'

function periodFromFormData(formData: FormData) {
  const academicYear = Number(formData.get('academicYear'))
  const bimester = Number(formData.get('bimester'))
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) throw new Error('Ano letivo inválido.')
  if (!Number.isInteger(bimester) || bimester < 1 || bimester > 4) throw new Error('Bimestre inválido.')
  return { academicYear, bimester }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const formData = await request.formData()
  const responses = formData.get('responses')
  const questionMatrix = formData.get('questionMatrix')
  const validWorkbook = (file: FormDataEntryValue | null): file is File => file instanceof File && file.name.toLocaleLowerCase('pt-BR').endsWith('.xlsx') && file.size > 0 && file.size <= 5 * 1024 * 1024
  if (!validWorkbook(responses) || !validWorkbook(questionMatrix)) {
    return NextResponse.json({ error: 'Envie as duas planilhas .xlsx: respostas dos alunos e matriz de questões, com até 5 MB cada.' }, { status: 400 })
  }

  try {
    const { academicYear, bimester } = periodFromFormData(formData)
    // O XLSX é processado somente em memória. Apenas o diagnóstico validado é persistido.
    const analysis = await parseEnemSaeWorkbook(await responses.arrayBuffer(), await questionMatrix.arrayBuffer())
    const [saved] = await db
      .insert(enemSaeImports)
      .values({ academicYear, gradeYear: 3, bimester, analysis, importedBy: currentUser.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [enemSaeImports.academicYear, enemSaeImports.gradeYear, enemSaeImports.bimester],
        set: { analysis, importedBy: currentUser.id, updatedAt: new Date() },
      })
      .returning({ id: enemSaeImports.id, academicYear: enemSaeImports.academicYear, bimester: enemSaeImports.bimester, updatedAt: enemSaeImports.updatedAt })
    return NextResponse.json({ analysis, saved })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível ler a planilha ENEM-SAE.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
