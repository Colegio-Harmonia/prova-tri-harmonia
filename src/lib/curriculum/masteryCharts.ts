// Dados dos gráficos do relatório individual (Bloco 5). Funções puras: a
// tela só desenha o que sai daqui, para que o mesmo recorte valha na tela,
// na impressão e no PDF.

import type { MasteryConsolidation, MasteryLevel, StudentMasteryRow } from './studentMastery'

/** Três leituras visuais pedidas para o gráfico, derivadas dos cinco níveis do Bloco 4. */
export type SkillChartCategory = 'dominada' | 'em_desenvolvimento' | 'nao_avaliada'

export type RadarAxis = {
  key: string
  label: string
  /** Aproveitamento 0–100; null quando não há evidência no recorte. */
  value: number | null
  itemCount: number
  assessmentCount: number
  category: SkillChartCategory
  /** Leitura preliminar: há evidência, mas abaixo do mínimo para conclusão. */
  preliminary: boolean
  description?: string | null
  level?: MasteryLevel
}

export type PeriodFilter = { academicYear: number | null; bimester: number | null }

/** Acima disso a teia perde legibilidade e ganha tabela/mapa de calor complementar. */
export const RADAR_MAX_READABLE_AXES = 12
/** Uma teia precisa de ao menos 3 eixos para formar um polígono. */
export const RADAR_MIN_AXES = 3

export function formatPercentPt(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

export function chartCategory(level: MasteryLevel): SkillChartCategory {
  if (level === 'dominio') return 'dominada'
  if (level === 'sem_evidencia') return 'nao_avaliada'
  return 'em_desenvolvimento'
}

export function availablePeriods(rows: Pick<StudentMasteryRow, 'academicYear' | 'bimester'>[]) {
  const years = [...new Set(rows.map((row) => row.academicYear))].sort((a, b) => b - a)
  return years.map((academicYear) => ({
    academicYear,
    bimesters: [...new Set(rows.filter((row) => row.academicYear === academicYear).map((row) => row.bimester))].sort((a, b) => a - b),
  }))
}

/** Ano mais recente e todos os bimestres por padrão. */
export function defaultPeriod(rows: Pick<StudentMasteryRow, 'academicYear' | 'bimester'>[]): PeriodFilter {
  return { academicYear: availablePeriods(rows)[0]?.academicYear ?? null, bimester: null }
}

function inPeriod(row: { academicYear: number; bimester: number | null }, period: PeriodFilter) {
  if (period.academicYear !== null && row.academicYear !== period.academicYear) return false
  return period.bimester === null || row.bimester === period.bimester
}

/**
 * Teia geral: um eixo por disciplina. Usa a consolidação do servidor (que não
 * conta duas vezes a questão ligada a dois códigos): por bimestre quando um
 * bimestre é escolhido, anual quando "todos".
 */
export function subjectRadar(consolidated: { bySubjectBimester: MasteryConsolidation[]; bySubject: MasteryConsolidation[] }, period: PeriodFilter): RadarAxis[] {
  const source = period.bimester === null ? consolidated.bySubject : consolidated.bySubjectBimester
  return source.filter((group) => inPeriod({ academicYear: group.academicYear, bimester: period.bimester === null ? null : group.bimester }, period))
    .map((group) => {
      const evaluated = group.skillCount - group.levelCounts.sem_evidencia
      const dominated = group.levelCounts.dominio
      return {
        key: `${group.subject}:${group.academicYear}:${group.bimester ?? 'ano'}`,
        label: group.subject,
        value: group.masteryPercent,
        itemCount: group.itemCount,
        assessmentCount: group.assessmentCount,
        category: group.masteryPercent === null ? 'nao_avaliada' as const : evaluated > 0 && dominated === evaluated ? 'dominada' as const : 'em_desenvolvimento' as const,
        preliminary: group.itemCount > 0 && group.itemCount < 3,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Teia detalhada de uma disciplina: um eixo por habilidade. Com "todos os
 * bimestres", a mesma habilidade avaliada em bimestres diferentes vira um
 * eixo só, com aproveitamento ponderado pelos pontos e o nível mais forte
 * que a amostra sustenta naquele recorte (recalculado).
 */
export function skillRadar(rows: StudentMasteryRow[], subject: string, period: PeriodFilter, levelFor: (percent: number | null, items: number, assessments: number) => { level: MasteryLevel }): RadarAxis[] {
  const bySkill = new Map<string, { rows: StudentMasteryRow[] }>()
  for (const row of rows) {
    if (row.subject !== subject || !inPeriod(row, period)) continue
    const entry = bySkill.get(row.code) ?? { rows: [] }
    entry.rows.push(row)
    bySkill.set(row.code, entry)
  }
  return [...bySkill.entries()].map(([code, { rows: skillRows }]) => {
    const earned = skillRows.reduce((sum, row) => sum + row.earnedPoints, 0)
    const possible = skillRows.reduce((sum, row) => sum + row.possiblePoints, 0)
    const itemCount = skillRows.reduce((sum, row) => sum + row.itemCount, 0)
    const assessmentCount = skillRows.reduce((sum, row) => sum + row.assessmentCount, 0)
    const value = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null
    const { level } = skillRows.length === 1 ? { level: skillRows[0].level } : levelFor(value, itemCount, assessmentCount)
    return {
      key: code, label: code, value, itemCount, assessmentCount, level,
      category: chartCategory(level),
      preliminary: level === 'evidencia_insuficiente',
      description: skillRows.find((row) => row.description)?.description ?? null,
    }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

/** Mapa de calor habilidade × bimestre, complemento das teias extensas. */
export function skillHeatmap(rows: StudentMasteryRow[], subject: string, academicYear: number | null) {
  const scoped = rows.filter((row) => row.subject === subject && (academicYear === null || row.academicYear === academicYear))
  const bimesters = [...new Set(scoped.map((row) => row.bimester))].sort((a, b) => a - b)
  const codes = [...new Set(scoped.map((row) => row.code))].sort()
  const cell = new Map(scoped.map((row) => [`${row.code}:${row.bimester}`, row]))
  return {
    bimesters,
    rows: codes.map((code) => ({
      code,
      description: scoped.find((row) => row.code === code && row.description)?.description ?? null,
      cells: bimesters.map((bimester) => {
        const row = cell.get(`${code}:${bimester}`)
        return row ? { value: row.masteryPercent, level: row.level, itemCount: row.itemCount } : null
      }),
    })),
  }
}

/** Faixa de intensidade (0–4) do mapa de calor, para não depender só de cor. */
export function heatBand(value: number | null): 0 | 1 | 2 | 3 | 4 {
  if (value === null) return 0
  if (value >= 80) return 4
  if (value >= 60) return 3
  if (value >= 40) return 2
  return 1
}

/**
 * Interpretação pedagógica curta, só com o que a evidência sustenta: nunca
 * compara disciplinas com amostra preliminar nem chama de dificuldade o que
 * não foi avaliado.
 */
export function interpretSubjects(axes: RadarAxis[]): string[] {
  const solid = axes.filter((axis) => axis.value !== null && !axis.preliminary)
  const notes: string[] = []
  if (!axes.length) return ['Ainda não há avaliações revisadas neste recorte.']
  if (solid.length >= 2) {
    const best = solid.reduce((a, b) => (b.value! > a.value! ? b : a))
    const worst = solid.reduce((a, b) => (b.value! < a.value! ? b : a))
    if (best.value! - worst.value! >= 10) notes.push(`Maior aproveitamento em ${best.label} (${formatPercentPt(best.value)}) e menor em ${worst.label} (${formatPercentPt(worst.value)}), com evidência suficiente nas duas.`)
    else notes.push(`Aproveitamento equilibrado entre as disciplinas com evidência suficiente (diferença menor que 10 pontos).`)
  } else if (solid.length === 1) {
    notes.push(`Só ${solid[0].label} tem evidência suficiente para leitura (${formatPercentPt(solid[0].value)}).`)
  }
  const preliminary = axes.filter((axis) => axis.preliminary).map((axis) => axis.label)
  if (preliminary.length) notes.push(`Leitura preliminar (menos de 3 itens): ${preliminary.join(', ')}.`)
  const missing = axes.filter((axis) => axis.value === null).map((axis) => axis.label)
  if (missing.length) notes.push(`Sem avaliação revisada no recorte: ${missing.join(', ')}.`)
  return notes
}

export function interpretSkills(axes: RadarAxis[], scope: 'bimestre' | 'ano' = 'bimestre'): string[] {
  if (!axes.length) return ['Nenhuma habilidade desta disciplina no recorte.']
  const count = (category: SkillChartCategory) => axes.filter((axis) => axis.category === category).length
  const notes = [`${count('dominada')} com domínio no ${scope}, ${count('em_desenvolvimento')} em desenvolvimento e ${count('nao_avaliada')} ainda não avaliada(s), de ${axes.length} habilidade(s).`]
  const focus = axes.filter((axis) => axis.value !== null && !axis.preliminary && axis.value < 60).sort((a, b) => a.value! - b.value!).slice(0, 3)
  if (focus.length) notes.push(`Prioridade de retomada: ${focus.map((axis) => `${axis.label} (${formatPercentPt(axis.value)})`).join(', ')}.`)
  const preliminary = count('em_desenvolvimento') ? axes.filter((axis) => axis.preliminary).length : 0
  if (preliminary) notes.push(`${preliminary} habilidade(s) com leitura preliminar: aguardar mais evidência antes de concluir.`)
  return notes
}
