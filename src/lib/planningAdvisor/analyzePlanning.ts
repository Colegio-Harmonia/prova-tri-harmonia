/**
 * Assistente de Planejamento — análise DETERMINÍSTICA do plano de curso.
 *
 * Recebe o planejamento já lido (planilha ou plano interno) e devolve os
 * fatos: capítulos sem habilidade ENEM/BNCC, códigos inválidos, cobertura
 * da Matriz de Referência do ENEM no ano e distribuição de Bloom. Nada aqui
 * usa IA nem inventa código: as SUGESTÕES de habilidade por capítulo ficam
 * em `recommendations.ts` e sempre saem marcadas para o professor validar.
 *
 * `Status Cronograma` não participa (regra do CLAUDE.md raiz): o plano do
 * ano inteiro é analisado, concluído ou não.
 */
import type { BloomLevel } from '@/config/bloomVerbs'
import { getEnemAreaForSubject, getEnemCompetenciesForSubject } from '@/config/enemAreaMap'
import { isEnemAreaCode, type EnemAreaCode } from '@/config/enemMatrix'
import { ENEM_AREA_LABELS, getOfficialEnemCompetencyText, getOfficialEnemSkillText, listOfficialEnemSkills, type OfficialEnemSkill } from '@/config/enemMatrixOfficial'
import { getSaebApplicability } from '@/config/saebApplicability'
import { composePlanUnitTitle } from '@/lib/curriculum/planUnitTitle'
import { PLAN_ROW_OFFSET } from './rowOrigin'
import type { CurriculumSelection, CurricularUnit } from '@/types/exam'

export const BLOOM_ORDER: BloomLevel[] = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']
const HIGHER_ORDER: BloomLevel[] = ['analisar', 'avaliar', 'criar']
const LOWER_ORDER: BloomLevel[] = ['lembrar', 'compreender']
/** Acima disso, o plano do EM está concentrado em Lembrar/Compreender (ensino-medio/CLAUDE.md). */
const EM_LOWER_ORDER_LIMIT = 0.6

// Ciências da Natureza: a própria matriz reserva C6 à física, C7 à química
// e C8 à biologia ("Apropriar-se de conhecimentos da física/química/
// biologia..."). C1-C5 são comuns às três disciplinas.
const NATUREZA_OWN_COMPETENCY: Record<string, number> = { 'Física': 6, 'Química': 7, 'Biologia': 8 }

export type ChapterIssueCode =
  | 'sem_habilidade_enem'
  | 'codigo_enem_invalido'
  | 'enem_fora_do_recorte'
  | 'sem_bncc'
  | 'sem_objetivo_cognitivo'
  | 'bloom_estimado'
  | 'sem_conteudo'

export type ChapterIssue = { code: ChapterIssueCode; severity: 'alta' | 'media' | 'info'; message: string }

export type ChapterEnemSkill = { code: string; competency: number; skill: number; count: number; description: string | null }

export type ChapterAnalysis = {
  rowIndex: number
  title: string
  /** Título da unidade correspondente no planejamento interno (mesma regra da importação). */
  planTitle: string
  bimestre: string | null
  /** Bimestre 1-4 quando o período da planilha é um bimestre reconhecível; senão null. */
  bimesterNumber: number | null
  /** De onde o capítulo foi lido: Planejamento da Prova TRI ou planilha. */
  origin: 'planejamento' | 'planilha'
  conteudo: string | null
  bnccCodes: string[]
  enemSkills: ChapterEnemSkill[]
  invalidEnemCodes: string[]
  bloomLevels: BloomLevel[]
  bloomEstimated: boolean
  issues: ChapterIssue[]
}

export type EnemCoverageRow = OfficialEnemSkill & {
  competencyDescription: string | null
  covered: boolean
  /** Soma das ocorrências do código no ano (peso no planejamento). */
  occurrences: number
  chapters: Array<{ rowIndex: number; title: string }>
}

export type EnemScope = {
  area: EnemAreaCode
  areaLabel: string
  /** Competências da área que cabem à disciplina; todas quando não há recorte. */
  competencies: number[]
  /** true quando a disciplina divide a área com outras e a lacuna pode estar coberta por elas. */
  sharedArea: boolean
  note: string
}

export type EnemCoverage = {
  scope: EnemScope
  rows: EnemCoverageRow[]
  coveredCount: number
  gapCount: number
  chaptersWithoutEnem: number
  chaptersWithInvalidCodes: number
}

export type BloomSummary = {
  counts: Record<BloomLevel, number>
  total: number
  /** Calculado só com objetivos reais (não estimados). */
  lowerOrderShare: number | null
  /** Calculado só com objetivos reais (não estimados). */
  higherOrderCount: number
  /** Objetivos cujo nível foi estimado sem coluna "Objetivos"; não entram nas críticas. */
  estimatedCount: number
  /** true quando todo o Bloom do plano foi estimado sem coluna "Objetivos". */
  allEstimated: boolean
}

export type PlanningFinding = { severity: 'alta' | 'media' | 'info'; title: string; detail: string }

export type PlanningAnalysis = {
  segment: CurriculumSelection['segment']
  gradeYear: number
  subject: string
  tabName: string
  framework: 'enem' | 'bncc'
  chapters: ChapterAnalysis[]
  enem: EnemCoverage | null
  bloom: BloomSummary
  bncc: { chaptersWithoutBncc: number; distinctCodes: number }
  saeb: { applicable: boolean; note: string }
  findings: PlanningFinding[]
  sheetWarnings: string[]
}

function chapterTitle(unit: CurricularUnit): string {
  return unit.tituloCapitulo.trim() || unit.unidade?.trim() || `Linha ${unit.rowIndex + 2} (sem título)`
}

export function resolveEnemScope(subject: string): EnemScope | null {
  const area = getEnemAreaForSubject(subject)
  if (!isEnemAreaCode(area)) return null
  const areaLabel = ENEM_AREA_LABELS[area]
  const all = [...new Set(listOfficialEnemSkills(area).map((skill) => skill.competency))]

  const linguagens = getEnemCompetenciesForSubject(subject)
  if (linguagens) {
    return {
      area, areaLabel, competencies: [...linguagens], sharedArea: false,
      note: `Recorte de ${subject} dentro de ${areaLabel}: competências ${linguagens.map((c) => `C${c}`).join(', ')}. As demais pertencem a outros componentes da área.`,
    }
  }
  const own = NATUREZA_OWN_COMPETENCY[subject]
  if (area === 'ciencias-natureza' && own) {
    const others = Object.values(NATUREZA_OWN_COMPETENCY).filter((c) => c !== own)
    return {
      area, areaLabel, competencies: all.filter((c) => !others.includes(c)), sharedArea: true,
      note: `C${own} é específica de ${subject}; C1 a C5 são comuns a Física, Química e Biologia — uma lacuna nelas pode estar coberta pelo planejamento das outras duas disciplinas.`,
    }
  }
  const sharedArea = area === 'ciencias-humanas'
  return {
    area, areaLabel, competencies: all, sharedArea,
    note: sharedArea
      ? 'A matriz de Ciências Humanas não separa História, Geografia, Filosofia e Sociologia — uma lacuna aqui pode estar coberta pelo planejamento das outras disciplinas da área.'
      : `Todas as competências de ${areaLabel} cabem a ${subject}.`,
  }
}

function bimesterNumberOf(period: string | null): number | null {
  const digits = period?.match(/\d+/)
  const value = digits ? Number(digits[0]) : NaN
  return value >= 1 && value <= 4 ? value : null
}

function analyzeChapter(unit: CurricularUnit, scope: EnemScope | null, isEnsinoMedio: boolean, positionInBimester: number): ChapterAnalysis {
  const issues: ChapterIssue[] = []
  const enemSkills: ChapterEnemSkill[] = (unit.enemSkills?.skills ?? []).map((skill) => ({
    code: skill.code, competency: skill.competency, skill: skill.skill, count: skill.count,
    description: scope ? getOfficialEnemSkillText(scope.area, skill.skill) : skill.description,
  }))
  const invalidEnemCodes = unit.enemSkills?.invalid ?? []
  const bnccCodes = unit.habilidades.skills.map((skill) => skill.code)
  const cognitive = unit.objetivos.filter((objective) => objective.kind === 'cognitiva' && objective.bloomLevel)
  const bloomLevels = [...new Set(cognitive.map((objective) => objective.bloomLevel as BloomLevel))]
    .sort((a, b) => BLOOM_ORDER.indexOf(a) - BLOOM_ORDER.indexOf(b))
  const bloomEstimated = unit.objetivosColumnMissing || (cognitive.length > 0 && cognitive.every((objective) => objective.estimated))

  if (scope) {
    if (enemSkills.length === 0) {
      issues.push({ code: 'sem_habilidade_enem', severity: 'alta', message: 'Capítulo sem habilidade da Matriz do ENEM associada.' })
    }
    if (invalidEnemCodes.length) {
      issues.push({ code: 'codigo_enem_invalido', severity: 'alta', message: `Código(s) que não existem na matriz de ${scope.areaLabel}: ${invalidEnemCodes.join(', ')}. Corrija na origem — o par competência:habilidade não confere.` })
    }
    const outside = enemSkills.filter((skill) => !scope.competencies.includes(skill.competency))
    if (outside.length) {
      issues.push({ code: 'enem_fora_do_recorte', severity: 'info', message: `Habilidade(s) de competência que normalmente cabe a outro componente da área: ${outside.map((skill) => skill.code).join(', ')}. Confirme se é intencional.` })
    }
  }

  // No EM planejado pela Matriz do ENEM, capítulo com C:H e sem BNCC não é
  // lacuna (mesma regra de curriculumService) — só informa.
  if (unit.habilidades.status === 'nao_mapeado') {
    const mappedByEnem = isEnsinoMedio && enemSkills.length > 0
    issues.push({
      code: 'sem_bncc',
      severity: mappedByEnem ? 'info' : 'media',
      message: `Sem habilidade BNCC${unit.habilidades.reason ? ` (${unit.habilidades.reason})` : ''}.${mappedByEnem ? ' O capítulo já está mapeado pela Matriz do ENEM.' : ' O campo BNCC das provas deste capítulo sai como "não mapeado".'}`,
    })
  }

  if (unit.objetivosColumnMissing) {
    issues.push({ code: 'bloom_estimado', severity: 'info', message: 'Sem objetivos informados: o nível de Bloom deste capítulo é estimado pelo título/conteúdo.' })
  } else if (cognitive.length === 0) {
    issues.push({ code: 'sem_objetivo_cognitivo', severity: 'media', message: 'Nenhum objetivo com verbo cognitivo claro — não dá para inferir o nível de Bloom do capítulo.' })
  }

  if (!unit.conteudo?.trim()) {
    issues.push({ code: 'sem_conteudo', severity: 'info', message: 'Sem "Conteúdos-foco" preenchido — a análise se apoia só no título do capítulo.' })
  }

  return {
    rowIndex: unit.rowIndex, title: chapterTitle(unit), planTitle: composePlanUnitTitle(unit, `Unidade ${positionInBimester + 1}`), bimestre: unit.bimestre,
    bimesterNumber: bimesterNumberOf(unit.bimestre), origin: unit.rowIndex >= PLAN_ROW_OFFSET ? 'planejamento' : 'planilha', conteudo: unit.conteudo,
    bnccCodes, enemSkills, invalidEnemCodes, bloomLevels, bloomEstimated, issues,
  }
}

function buildEnemCoverage(chapters: ChapterAnalysis[], scope: EnemScope): EnemCoverage {
  const rows: EnemCoverageRow[] = listOfficialEnemSkills(scope.area)
    .filter((skill) => scope.competencies.includes(skill.competency))
    .map((skill) => {
      const using = chapters.filter((chapter) => chapter.enemSkills.some((planned) => planned.code === skill.code))
      const occurrences = using.reduce((sum, chapter) => sum + (chapter.enemSkills.find((planned) => planned.code === skill.code)?.count ?? 0), 0)
      return {
        ...skill,
        competencyDescription: getOfficialEnemCompetencyText(scope.area, skill.competency),
        covered: using.length > 0,
        occurrences,
        chapters: using.map((chapter) => ({ rowIndex: chapter.rowIndex, title: chapter.title })),
      }
    })
  const coveredCount = rows.filter((row) => row.covered).length
  return {
    scope, rows, coveredCount, gapCount: rows.length - coveredCount,
    chaptersWithoutEnem: chapters.filter((chapter) => chapter.enemSkills.length === 0).length,
    chaptersWithInvalidCodes: chapters.filter((chapter) => chapter.invalidEnemCodes.length > 0).length,
  }
}

function buildBloomSummary(units: CurricularUnit[]): BloomSummary {
  const counts: Record<BloomLevel, number> = { lembrar: 0, compreender: 0, aplicar: 0, analisar: 0, avaliar: 0, criar: 0 }
  // Objetivo estimado (aba sem "Objetivos") cai em Lembrar/Compreender por
  // padrão: aparece na contagem, mas não pode pesar na crítica ao plano.
  const real: Record<BloomLevel, number> = { lembrar: 0, compreender: 0, aplicar: 0, analisar: 0, avaliar: 0, criar: 0 }
  let estimated = 0
  for (const unit of units) {
    for (const objective of unit.objetivos) {
      if (objective.kind !== 'cognitiva' || !objective.bloomLevel) continue
      counts[objective.bloomLevel]++
      if (objective.estimated || unit.objetivosColumnMissing) estimated++
      else real[objective.bloomLevel]++
    }
  }
  const total = BLOOM_ORDER.reduce((sum, level) => sum + counts[level], 0)
  const realTotal = total - estimated
  const lower = LOWER_ORDER.reduce((sum, level) => sum + real[level], 0)
  return {
    counts, total,
    lowerOrderShare: realTotal ? lower / realTotal : null,
    higherOrderCount: HIGHER_ORDER.reduce((sum, level) => sum + real[level], 0),
    estimatedCount: estimated,
    allEstimated: total > 0 && estimated === total,
  }
}

function saebNote(selection: CurriculumSelection): PlanningAnalysis['saeb'] {
  const applicability = getSaebApplicability(selection.segment, selection.gradeYear, selection.subject)
  if (selection.segment === 'ensino-medio') return { applicable: false, note: 'Ensino Médio usa a Matriz de Referência do ENEM, não o SAEB.' }
  if (!applicability.applicable) return { applicable: false, note: `${selection.subject} não tem matriz SAEB oficial — a análise é BNCC × Bloom; nenhum descritor SAEB deve ser atribuído.` }
  const adapted = applicability.matrixType === 'saeb' && applicability.adapted
  return {
    applicable: true,
    note: adapted
      ? 'Há matriz SAEB para a disciplina, mas não para esta série: o cruzamento usa a série de referência mais próxima e é sempre APROXIMADO.'
      : 'Há matriz SAEB oficial para esta disciplina e série.',
  }
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function analyzePlanning(selection: CurriculumSelection): PlanningAnalysis {
  const isEnsinoMedio = selection.segment === 'ensino-medio'
  const scope = isEnsinoMedio ? resolveEnemScope(selection.subject) : null
  // A importação do bimestre nomeia linha sem título como "Unidade N", N = posição
  // dentro do bimestre; a análise precisa do mesmo nome para achar a unidade depois.
  const seenPerPeriod = new Map<string, number>()
  const chapters = selection.units.map((unit) => {
    const period = String(bimesterNumberOf(unit.bimestre) ?? unit.bimestre ?? '')
    const position = seenPerPeriod.get(period) ?? 0
    seenPerPeriod.set(period, position + 1)
    return analyzeChapter(unit, scope, isEnsinoMedio, position)
  })
  const enem = scope ? buildEnemCoverage(chapters, scope) : null
  const bloom = buildBloomSummary(selection.units)
  const chaptersWithoutBncc = selection.units.filter((unit) => unit.habilidades.status === 'nao_mapeado').length
  // No EM, capítulo já mapeado pela Matriz do ENEM não conta como lacuna de BNCC.
  const bnccGapCount = selection.units.filter((unit) => unit.habilidades.status === 'nao_mapeado' && !(isEnsinoMedio && unit.enemSkills?.skills.length)).length
  const distinctCodes = new Set(selection.units.flatMap((unit) => unit.habilidades.skills.map((skill) => skill.code.toUpperCase()))).size

  const findings: PlanningFinding[] = []
  if (chapters.length === 0) {
    findings.push({ severity: 'alta', title: 'Nenhum capítulo encontrado', detail: 'Não há unidades no Planejamento da Prova TRI nem linhas na planilha para esta disciplina.' })
  }
  if (isEnsinoMedio && !scope) {
    findings.push({ severity: 'info', title: 'Disciplina sem área do ENEM configurada', detail: `${selection.subject} não está associada a uma área da Matriz do ENEM no sistema; a análise ficou em BNCC × Bloom.` })
  }
  if (enem) {
    if (enem.chaptersWithoutEnem > 0) {
      const all = enem.chaptersWithoutEnem === chapters.length
      findings.push({
        severity: 'alta',
        title: all ? 'Planejamento ainda sem habilidades do ENEM' : `${plural(enem.chaptersWithoutEnem, 'capítulo', 'capítulos')} sem habilidade do ENEM`,
        detail: all
          ? `Nenhum dos ${chapters.length} capítulos traz código da Matriz do ENEM (formato C2:H5). Use as sugestões por capítulo e adicione ao planejamento de cada bimestre.`
          : `De ${chapters.length} capítulos, ${enem.chaptersWithoutEnem} não têm código da Matriz do ENEM (formato C2:H5).`,
      })
    }
    if (enem.chaptersWithInvalidCodes > 0) {
      findings.push({ severity: 'alta', title: 'Códigos ENEM que não existem na matriz', detail: `${plural(enem.chaptersWithInvalidCodes, 'capítulo traz', 'capítulos trazem')} par competência:habilidade inexistente em ${enem.scope.areaLabel}. Esses códigos são ignorados na geração de provas.` })
    }
    if (enem.gapCount > 0) {
      findings.push({
        severity: enem.scope.sharedArea ? 'media' : 'alta',
        title: `${plural(enem.gapCount, 'habilidade da matriz', 'habilidades da matriz')} sem cobertura no ano`,
        detail: `${enem.coveredCount} de ${enem.rows.length} habilidades do recorte da disciplina aparecem no planejamento. ${enem.scope.note}`,
      })
    }
  }
  if (bnccGapCount > 0) {
    findings.push({ severity: 'media', title: `${plural(bnccGapCount, 'capítulo', 'capítulos')} sem BNCC${isEnsinoMedio ? ' nem ENEM' : ''}`, detail: 'Esses capítulos estão sem código BNCC. O sistema não inventa código: as provas saem com BNCC "não mapeado" até o planejamento ser preenchido.' })
  }
  if (bloom.total > 0) {
    // As críticas usam só objetivos reais; os estimados ganham aviso próprio.
    if (bloom.allEstimated) {
      // só o aviso de estimativa, abaixo
    } else if (bloom.higherOrderCount === 0) {
      findings.push({ severity: 'media', title: 'Nenhum objetivo em Analisar, Avaliar ou Criar', detail: 'Os objetivos do ano ficam em Lembrar/Compreender/Aplicar. Inclua ao menos um objetivo de nível mais alto por bimestre, quando a habilidade permitir.' })
    } else if (isEnsinoMedio && bloom.lowerOrderShare !== null && bloom.lowerOrderShare > EM_LOWER_ORDER_LIMIT) {
      findings.push({ severity: 'media', title: 'Objetivos concentrados em Lembrar/Compreender', detail: `${Math.round(bloom.lowerOrderShare * 100)}% dos objetivos cognitivos estão nos dois níveis mais baixos. No Ensino Médio o plano deve pender para Aplicar/Analisar/Avaliar, coerente com o ENEM.` })
    }
    if (bloom.allEstimated) {
      findings.push({ severity: 'info', title: 'Bloom estimado', detail: 'O plano não traz objetivos: os níveis de Bloom foram estimados pelo título/conteúdo e servem só de indicação.' })
    } else if (bloom.estimatedCount > 0) {
      findings.push({ severity: 'info', title: 'Bloom parcialmente estimado', detail: `${plural(bloom.estimatedCount, 'objetivo teve', 'objetivos tiveram')} o nível estimado por falta de objetivos em parte do plano; eles não entram na avaliação da distribuição.` })
    }
  } else if (chapters.length > 0) {
    findings.push({ severity: 'media', title: 'Sem objetivos cognitivos', detail: 'Nenhum objetivo com verbo cognitivo foi encontrado; não é possível avaliar a distribuição de Bloom do plano.' })
  }

  return {
    segment: selection.segment, gradeYear: selection.gradeYear, subject: selection.subject, tabName: selection.tabName,
    framework: scope ? 'enem' : 'bncc',
    chapters, enem, bloom,
    bncc: { chaptersWithoutBncc, distinctCodes },
    saeb: saebNote(selection),
    findings,
    sheetWarnings: selection.unmappedWarnings,
  }
}
