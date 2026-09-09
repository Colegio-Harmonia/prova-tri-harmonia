import { eq, and } from 'drizzle-orm'
import { sheets_v4 } from 'googleapis'
import { db } from '@/db/client'
import { curriculumTabOverrides } from '@/db/schema'
import { getGradeSheetConfig, DISCIPLINE_ABBREVIATION_HINTS } from '@/config/gradeSheets'
import type { Segment } from '@/types/exam'

export class TabResolutionError extends Error {
  availableTabs: string[]

  constructor(message: string, availableTabs: string[]) {
    super(message)
    this.name = 'TabResolutionError'
    this.availableTabs = availableTabs
  }
}

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .trim()
}

async function getOverride(segment: Segment, gradeYear: number, subject: string): Promise<string | null> {
  const row = await db.query.curriculumTabOverrides.findFirst({
    where: and(
      eq(curriculumTabOverrides.segment, segment),
      eq(curriculumTabOverrides.gradeYear, gradeYear),
      eq(curriculumTabOverrides.subject, subject),
    ),
  })
  return row?.sheetTabName ?? null
}

/**
 * Resolves the real Google Sheets tab name(s) for a segment/grade/subject —
 * normalmente uma só, mas pode ser várias quando a disciplina é a união de
 * múltiplas abas (ver GradeSheetConfig.knownTabTitles). Never guesses
 * silently: throws TabResolutionError (with the real tab titles found)
 * when there's no override, no known mapping, and no unambiguous fuzzy
 * match.
 */
export async function resolveTabNames(
  sheets: sheets_v4.Sheets,
  segment: Segment,
  gradeYear: number,
  subject: string,
): Promise<string[]> {
  const override = await getOverride(segment, gradeYear, subject)
  if (override) return [override]

  const config = getGradeSheetConfig(segment, gradeYear)
  const known = config.knownTabTitles?.[subject]
  if (known) return Array.isArray(known) ? known : [known]

  const { data } = await sheets.spreadsheets.get({
    spreadsheetId: config.fileId,
    fields: 'sheets.properties.title',
  })
  const realTitles = (data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t))

  if (!realTitles.length) {
    throw new TabResolutionError(`Planilha ${config.fileId} não tem nenhuma aba visível para a service account.`, [])
  }

  const normalizedSubject = normalize(subject)
  const hints = (DISCIPLINE_ABBREVIATION_HINTS[subject] ?? []).map(normalize)
  const needles = [normalizedSubject, ...hints]

  const matches = realTitles.filter((title) => {
    const normalizedTitle = normalize(title)
    return needles.some((needle) => normalizedTitle.includes(needle))
  })

  if (matches.length === 1) return matches

  if (matches.length === 0) {
    throw new TabResolutionError(
      `Não foi possível identificar a aba de "${subject}" no ${gradeYear}º ano (segmento ${segment}). ` +
        `Abas disponíveis na planilha: ${realTitles.join(', ')}. ` +
        `Peça à coordenação para configurar manualmente (curriculum_tab_overrides).`,
      realTitles,
    )
  }

  throw new TabResolutionError(
    `Mais de uma aba corresponde a "${subject}" no ${gradeYear}º ano (segmento ${segment}): ${matches.join(', ')}. ` +
      `Se essa disciplina realmente tem várias "frentes"/abas nessa planilha, configure knownTabTitles com a lista explícita em vez de depender do casamento automático.`,
    realTitles,
  )
}
