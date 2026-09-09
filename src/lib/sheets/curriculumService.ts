import { getSheetsClient } from './sheetsClient'
import { resolveTabNames } from './tabResolver'
import { resolveColumnRoles } from './headerResolver'
import { parseCurriculumRows } from './rowParser'
import { getGradeSheetConfig } from '@/config/gradeSheets'
import { db } from '@/db/client'
import { curriculumEnrichment } from '@/db/schema'
import { and, eq, or, sql } from 'drizzle-orm'
import type { CurriculumSelection, Segment } from '@/types/exam'

export type GetCurriculumParams = {
  segment: Segment
  gradeYear: number
  subject: string
  bimester?: number
}

function matchesBimester(unitBimestre: string | null, bimester?: number): boolean {
  if (bimester === undefined) return true
  if (!unitBimestre) return false
  const digits = unitBimestre.match(/\d+/)
  if (!digits) return false
  return Number(digits[0]) === bimester
}

/**
 * Busca conteúdo enriquecido do banco para enriquecer as unidades curriculares.
 * Faz match pelo título do capítulo (removendo numeração) e disciplina.
 */
async function attachEnrichment(
  units: CurriculumSelection['units'],
  segment: Segment,
  gradeYear: number,
  subject: string,
  bimester?: number,
): Promise<CurriculumSelection['units']> {
  // Normaliza nome da disciplina: "Língua Portuguesa" -> "Português" etc.
  const subjectAliases: Record<string, string[]> = {
    'Língua Portuguesa': ['Português', 'Língua Portuguesa'],
    'Português': ['Português', 'Língua Portuguesa'],
  }
  const searchSubjects = subjectAliases[subject] ?? [subject]

  const conditions = searchSubjects.map((s) =>
    and(
      eq(curriculumEnrichment.segment, segment),
      eq(curriculumEnrichment.gradeYear, gradeYear),
      eq(curriculumEnrichment.subject, s),
      bimester ? eq(curriculumEnrichment.bimester, bimester) : undefined,
    ),
  )

  const enrichmentRows = await db
    .select()
    .from(curriculumEnrichment)
    .where(or(...conditions))

  if (!enrichmentRows.length) return units

  // Build lookup: chapter title (normalized) -> enrichment
  const lookup = new Map<string, typeof enrichmentRows[0]>()
  for (const row of enrichmentRows) {
    const normalized = row.chapterTitle.trim().toLowerCase()
    lookup.set(normalized, row)
  }

  return units.map((unit) => {
    const normalized = unit.tituloCapitulo
      .replace(/^\d+[\.\s]+/, '') // Remove "7. " prefix
      .trim()
      .toLowerCase()

    const match = lookup.get(normalized)
    if (!match) return unit

    return {
      ...unit,
      enrichedContent: match.enrichedContent,
      enrichedObjectives: match.detailedObjectives,
    }
  })
}

/**
 * Single orchestrator used by both /api/curriculum/preview and
 * /api/exams/generate — reads the sheet, resolves the tab, parses rows,
 * filters by bimester, attaches enrichment, and aggregates warnings.
 */
export async function getCurriculumForExam(params: GetCurriculumParams): Promise<CurriculumSelection> {
  const { segment, gradeYear, subject, bimester } = params
  const sheets = getSheetsClient()
  const config = getGradeSheetConfig(segment, gradeYear)

  // Normalmente 1 aba só — pode ser várias quando a disciplina é a união
  // de "frentes" (ver GradeSheetConfig.knownTabTitles, confirmado no 3º
  // ano EM). Cada aba é lida e parseada independente, e as unidades ficam
  // todas juntas na mesma seleção — a IA vê o conteúdo da disciplina
  // inteira, não só de uma frente.
  const tabNames = await resolveTabNames(sheets, segment, gradeYear, subject)

  // Cada aba é uma chamada de rede independente à API do Sheets — antes
  // era lida uma de cada vez (for..await), então uma disciplina com 3
  // "frentes" (ex: Matemática do 3º ano EM) pagava 3 idas-e-voltas em
  // série. Promise.all dispara todas juntas; a ordem do array (não a
  // ordem de chegada) é o que decide o offset de rowIndex e a ordem dos
  // avisos, então continua determinístico. Achado aplicando a skill
  // vercel-react-best-practices (regra async-parallel, CRITICAL).
  const tabResults = await Promise.all(
    tabNames.map(async (tabName, tabIdx) => {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: config.fileId,
        range: `'${tabName}'`,
      })

      const rows = data.values ?? []
      if (rows.length < 2) {
        return { units: [] as CurriculumSelection['units'], warnings: [`Aba "${tabName}" está vazia ou tem só o cabeçalho.`] }
      }

      const [headerRow, ...dataRows] = rows
      const roles = resolveColumnRoles(headerRow as string[])
      const tabUnits = parseCurriculumRows(dataRows as string[][], roles, segment)
        // rowIndex é relativo à própria aba — com múltiplas abas precisa de
        // um offset pra não colidir (usado como key no React).
        .map((u) => ({ ...u, rowIndex: tabIdx * 100000 + u.rowIndex }))

      const warnings: string[] = []
      if (roles.habilidadesIdx === null) {
        warnings.push(`Aba "${tabName}" não tem coluna "Habilidades" — BNCC ficará "não mapeado nesta aba" para todas as questões.`)
      }
      if (roles.objetivosIdx === null) {
        warnings.push(`Aba "${tabName}" não tem coluna "Objetivos" — nível de Bloom será estimado a partir do título/conteúdo do capítulo.`)
      }

      return { units: tabUnits, warnings }
    }),
  )

  const allUnits = tabResults.flatMap((r) => r.units)
  const unmappedWarnings = tabResults.flatMap((r) => r.warnings)

  let units = allUnits.filter((unit) => matchesBimester(unit.bimestre, bimester))

  // Attach enrichment from the database (silently — no error if none found)
  units = await attachEnrichment(units, segment, gradeYear, subject, bimester)

  for (const unit of units) {
    if (unit.habilidades.status === 'nao_mapeado') {
      unmappedWarnings.push(`"${unit.tituloCapitulo || `linha ${unit.rowIndex + 2}`}": habilidade BNCC não mapeada (${unit.habilidades.reason ?? 'motivo desconhecido'}).`)
    }
  }

  return { segment, gradeYear, subject, bimester, tabName: tabNames.join(' + '), units, unmappedWarnings }
}
