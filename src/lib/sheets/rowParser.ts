import type { ColumnRoles, CurricularUnit, Segment } from '@/types/exam'
import { parseHabilidades } from './habilidadesParser'
import { parseObjetivos, estimateObjectiveFromContent } from './objetivosParser'
import { parseEnemSkills } from './enemSkillsParser'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { isEnemAreaCode } from '@/config/enemMatrix'

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
export function parseCurriculumRows(rows: string[][], roles: ColumnRoles, segment: Segment, subject?: string): CurricularUnit[] {
  const units: CurricularUnit[] = []
  const enemAreaRaw = subject ? getEnemAreaForSubject(subject) : null
  const enemArea = isEnemAreaCode(enemAreaRaw) ? enemAreaRaw : null

  rows.forEach((row, i) => {
    const tituloCapitulo = cell(row, roles.tituloCapituloIdx)
    const conteudo = cell(row, roles.conteudoIdx)
    const habilidadesRaw = cell(row, roles.habilidadesIdx)
    const objetivosRaw = cell(row, roles.objetivosIdx)
    const habilidadesEnemRaw = cell(row, roles.habilidadesEnemIdx)

    if (!tituloCapitulo && !conteudo && !habilidadesRaw && !objetivosRaw && !habilidadesEnemRaw) return

    const objetivosColumnMissing = roles.objetivosIdx === null
    const objetivos = objetivosColumnMissing
      ? [estimateObjectiveFromContent(tituloCapitulo ?? '', conteudo)]
      : parseObjetivos(objetivosRaw)

    units.push({
      rowIndex: i,
      bimestre: resolvePeriodo(row, roles),
      tituloCapitulo: tituloCapitulo ?? '',
      // Sem coluna de bimestre/trimestre, "Unidade" é a própria divisão do período (ver resolvePeriodo).
      unidade: roles.bimestreIdx !== null || roles.trimestreIdx !== null ? cell(row, roles.unidadeIdx) : null,
      conteudo,
      habilidades: parseHabilidades(habilidadesRaw, segment),
      objetivos,
      objetivosColumnMissing,
      // Só Ensino Médio: lê a coluna "Habilidades ENEM" e também códigos
      // C:H colados direto em "Habilidades" (quando a aba ainda não tem a
      // coluna própria). BNCC e ENEM convivem — um não substitui o outro.
      ...(segment === 'ensino-medio'
        ? { enemSkills: parseEnemSkills([habilidadesEnemRaw, habilidadesRaw].filter(Boolean).join('\n'), enemArea) }
        : {}),
    })
  })

  return units
}
