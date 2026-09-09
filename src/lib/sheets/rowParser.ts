import type { ColumnRoles, CurricularUnit, Segment } from '@/types/exam'
import { parseHabilidades } from './habilidadesParser'
import { parseObjetivos, estimateObjectiveFromContent } from './objetivosParser'

function cell(row: string[], idx: number | null): string | null {
  if (idx === null) return null
  const value = row[idx]
  return value !== undefined && value !== null && value !== '' ? String(value) : null
}

function resolvePeriodo(row: string[], roles: ColumnRoles): string | null {
  return cell(row, roles.bimestreIdx) ?? cell(row, roles.trimestreIdx) ?? cell(row, roles.unidadeIdx)
}

/**
 * Parses data rows into CurricularUnit[]. Skips rows that are fully empty on
 * content columns (dates filled but no Ano/Bimestre/conteúdo) per the root
 * CLAUDE.md's "linhas vazias" rule — silently, not as an error.
 */
export function parseCurriculumRows(rows: string[][], roles: ColumnRoles, segment: Segment): CurricularUnit[] {
  const units: CurricularUnit[] = []

  rows.forEach((row, i) => {
    const tituloCapitulo = cell(row, roles.tituloCapituloIdx)
    const conteudo = cell(row, roles.conteudoIdx)
    const habilidadesRaw = cell(row, roles.habilidadesIdx)
    const objetivosRaw = cell(row, roles.objetivosIdx)

    if (!tituloCapitulo && !conteudo && !habilidadesRaw && !objetivosRaw) return

    const objetivosColumnMissing = roles.objetivosIdx === null
    const objetivos = objetivosColumnMissing
      ? [estimateObjectiveFromContent(tituloCapitulo ?? '', conteudo)]
      : parseObjetivos(objetivosRaw)

    units.push({
      rowIndex: i,
      bimestre: resolvePeriodo(row, roles),
      tituloCapitulo: tituloCapitulo ?? '',
      conteudo,
      habilidades: parseHabilidades(habilidadesRaw, segment),
      objetivos,
      objetivosColumnMissing,
    })
  })

  return units
}
