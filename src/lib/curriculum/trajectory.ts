// Comparação e evolução ao longo do ano (Bloco 6). Funções puras sobre as
// evidências do Bloco 4, válidas para um aluno ou para a turma inteira.
//
// Princípios:
// - Aproveitamento sempre ponderado por pontos (peso da questão e nota
//   parcial), como no Bloco 4.
// - "Evolução real" só se mede no MESMO conjunto de habilidades avaliado nos
//   dois bimestres; a diferença para a variação total é efeito da troca de
//   conteúdo avaliado, não de aprendizagem.
// - Mudança de habilidade só é afirmada com evidência mínima dos dois lados
//   e diferença acima da margem; abaixo disso, "estável" ou "sem base".
// - Intervenções: comparação descritiva antes/depois da data de registro.
//   Não é prova de causa (outros fatores mudam no período).

export const TRAJECTORY_RULES = {
  /** Itens mínimos de cada lado para afirmar avanço/regressão de uma habilidade (por aluno). */
  minItemsPerSide: 2,
  /** Diferença mínima, em pontos percentuais, para chamar de avanço ou regressão. */
  minChangePoints: 10,
} as const

export type TrajectoryEvidence = {
  academicYear: number
  segment: string
  gradeYear: number
  subject: string
  bimester: number
  code: string
  examId: number
  questionNumber: number
  earnedPoints: number
  possiblePoints: number
  studentKey: string
  assessedAt: string
}

export type TrajectoryPlanned = { academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number; code: string }

export type TrajectoryIntervention = {
  id: number
  segment: string
  gradeYear: number
  subject: string
  academicYear: number | null
  action: string
  ownerName: string
  status: string
  dueDate: string | null
  createdAt: string
}

type Tally = { earned: number; possible: number; items: number; assessments: Set<number>; students: Set<string> }
function tally(): Tally { return { earned: 0, possible: 0, items: 0, assessments: new Set(), students: new Set() } }
function add(t: Tally, item: TrajectoryEvidence) {
  t.earned += Math.min(Math.max(item.earnedPoints, 0), item.possiblePoints)
  t.possible += item.possiblePoints
  t.items++
  t.assessments.add(item.examId)
  t.students.add(item.studentKey)
}
function pct(t: Tally | undefined) { return t && t.possible > 0 ? Math.round((t.earned / t.possible) * 1000) / 10 : null }
function round1(value: number) { return Math.round(value * 10) / 10 }
function subjectKey(subject: string) { return subject.toLocaleLowerCase('pt-BR') }

/** Remove repetições da mesma resposta (mesmo aluno, prova, questão e código). */
export function dedupeEvidence(evidence: TrajectoryEvidence[]) {
  const seen = new Set<string>()
  return evidence.filter((item) => {
    if (!(item.possiblePoints > 0)) return false
    const key = `${item.studentKey}:${item.examId}:${item.questionNumber}:${item.code}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type BimesterPoint = { bimester: number; percent: number | null; itemCount: number; assessmentCount: number; skillCount: number; studentCount: number }

export type SetDecomposition = {
  fromBimester: number
  toBimester: number
  totalChange: number | null
  /** Variação no conjunto de habilidades avaliado nos dois bimestres. */
  sameSetChange: number | null
  /** Parte da variação total explicada pela troca de habilidades avaliadas. */
  compositionEffect: number | null
  commonSkills: string[]
  addedSkills: string[]
  removedSkills: string[]
}

export type SkillChangeStatus = 'avancou' | 'estavel' | 'regrediu' | 'sem_base'
export type SkillChange = { code: string; fromBimester: number; toBimester: number; fromPercent: number | null; toPercent: number | null; change: number | null; fromItems: number; toItems: number; status: SkillChangeStatus }

export type CoveragePoint = { bimester: number; plannedCumulative: number; evaluatedCumulative: number; percent: number | null; notYetEvaluated: string[] }

export type InterventionOutcome = TrajectoryIntervention & {
  before: { percent: number | null; itemCount: number }
  after: { percent: number | null; itemCount: number }
  change: number | null
  reading: 'sem_avaliacao_posterior' | 'sem_base_anterior' | 'melhora_posterior' | 'queda_posterior' | 'sem_mudanca_relevante'
}

export type SubjectTrajectory = {
  academicYear: number
  segment: string
  gradeYear: number
  subject: string
  bimesters: BimesterPoint[]
  transitions: SetDecomposition[]
  skillChanges: SkillChange[]
  coverage: CoveragePoint[]
  interventions: InterventionOutcome[]
}

/** Itens mínimos por lado escalam com o número de alunos (turma). */
function minItemsFor(studentCount: number) {
  return TRAJECTORY_RULES.minItemsPerSide * Math.max(1, studentCount)
}

function classifyChange(from: Tally | undefined, to: Tally | undefined, studentCount: number): SkillChangeStatus {
  const min = minItemsFor(studentCount)
  if (!from || !to || from.items < min || to.items < min) return 'sem_base'
  const change = pct(to)! - pct(from)!
  if (change >= TRAJECTORY_RULES.minChangePoints) return 'avancou'
  if (change <= -TRAJECTORY_RULES.minChangePoints) return 'regrediu'
  return 'estavel'
}

function interventionReading(before: Tally, after: Tally, studentCount: number): InterventionOutcome['reading'] {
  const min = minItemsFor(studentCount)
  if (after.items === 0) return 'sem_avaliacao_posterior'
  if (before.items < min) return 'sem_base_anterior'
  if (after.items < min) return 'sem_avaliacao_posterior'
  const change = pct(after)! - pct(before)!
  if (change >= TRAJECTORY_RULES.minChangePoints) return 'melhora_posterior'
  if (change <= -TRAJECTORY_RULES.minChangePoints) return 'queda_posterior'
  return 'sem_mudanca_relevante'
}

export function buildTrajectory(evidenceInput: TrajectoryEvidence[], planned: TrajectoryPlanned[], interventions: TrajectoryIntervention[]): SubjectTrajectory[] {
  const evidence = dedupeEvidence(evidenceInput)
  const groups = new Map<string, { scope: Omit<SubjectTrajectory, 'bimesters' | 'transitions' | 'skillChanges' | 'coverage' | 'interventions'>; items: TrajectoryEvidence[] }>()
  const groupKey = (row: { academicYear: number; segment: string; gradeYear: number; subject: string }) => `${row.academicYear}:${row.segment}:${row.gradeYear}:${subjectKey(row.subject)}`
  for (const item of evidence) {
    const key = groupKey(item)
    const group = groups.get(key) ?? { scope: { academicYear: item.academicYear, segment: item.segment, gradeYear: item.gradeYear, subject: item.subject }, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }

  return [...groups.entries()].map(([key, { scope, items }]) => {
    const studentCount = new Set(items.map((item) => item.studentKey)).size
    const byBimester = new Map<number, Tally>()
    const bySkillBimester = new Map<string, Tally>()
    for (const item of items) {
      const b = byBimester.get(item.bimester) ?? tally(); add(b, item); byBimester.set(item.bimester, b)
      const sk = `${item.code}:${item.bimester}`
      const s = bySkillBimester.get(sk) ?? tally(); add(s, item); bySkillBimester.set(sk, s)
    }
    const bimesterList = [...byBimester.keys()].sort((a, b) => a - b)
    const skillsIn = (bimester: number) => new Set(items.filter((item) => item.bimester === bimester).map((item) => item.code))

    const bimesters: BimesterPoint[] = bimesterList.map((bimester) => {
      const t = byBimester.get(bimester)!
      return { bimester, percent: pct(t), itemCount: t.items, assessmentCount: t.assessments.size, skillCount: skillsIn(bimester).size, studentCount: t.students.size }
    })

    const transitions: SetDecomposition[] = []
    const skillChanges: SkillChange[] = []
    for (let index = 1; index < bimesterList.length; index++) {
      const from = bimesterList[index - 1]
      const to = bimesterList[index]
      const fromSkills = skillsIn(from)
      const toSkills = skillsIn(to)
      const common = [...fromSkills].filter((code) => toSkills.has(code)).sort()
      const sameSet = (bimester: number) => {
        const t = tally()
        for (const item of items) if (item.bimester === bimester && common.includes(item.code)) add(t, item)
        return pct(t)
      }
      const total = pct(byBimester.get(to)) !== null && pct(byBimester.get(from)) !== null ? round1(pct(byBimester.get(to))! - pct(byBimester.get(from))!) : null
      const sameSetChange = common.length ? round1(sameSet(to)! - sameSet(from)!) : null
      transitions.push({
        fromBimester: from, toBimester: to, totalChange: total, sameSetChange,
        compositionEffect: total !== null && sameSetChange !== null ? round1(total - sameSetChange) : null,
        commonSkills: common,
        addedSkills: [...toSkills].filter((code) => !fromSkills.has(code)).sort(),
        removedSkills: [...fromSkills].filter((code) => !toSkills.has(code)).sort(),
      })
      for (const code of common) {
        const a = bySkillBimester.get(`${code}:${from}`)
        const b = bySkillBimester.get(`${code}:${to}`)
        const fromPercent = pct(a)
        const toPercent = pct(b)
        skillChanges.push({ code, fromBimester: from, toBimester: to, fromPercent, toPercent, change: fromPercent !== null && toPercent !== null ? round1(toPercent - fromPercent) : null, fromItems: a?.items ?? 0, toItems: b?.items ?? 0, status: classifyChange(a, b, studentCount) })
      }
    }

    // Cobertura acumulada: habilidades planejadas até o bimestre × já avaliadas até ele.
    const plannedHere = planned.filter((plan) => groupKey(plan) === key)
    const coverageBimesters = [...new Set([...plannedHere.map((plan) => plan.bimester), ...bimesterList])].sort((a, b) => a - b)
    const coverage: CoveragePoint[] = coverageBimesters.map((bimester) => {
      const plannedCodes = new Set(plannedHere.filter((plan) => plan.bimester <= bimester).map((plan) => plan.code.trim().toUpperCase()))
      const evaluatedCodes = new Set(items.filter((item) => item.bimester <= bimester).map((item) => item.code))
      const evaluated = [...plannedCodes].filter((code) => evaluatedCodes.has(code))
      return {
        bimester,
        plannedCumulative: plannedCodes.size,
        evaluatedCumulative: evaluated.length,
        percent: plannedCodes.size ? Math.round((evaluated.length / plannedCodes.size) * 100) : null,
        notYetEvaluated: [...plannedCodes].filter((code) => !evaluatedCodes.has(code)).sort(),
      }
    })

    const outcomes: InterventionOutcome[] = interventions
      .filter((intervention) => intervention.segment === scope.segment && intervention.gradeYear === scope.gradeYear && subjectKey(intervention.subject) === subjectKey(scope.subject) && (intervention.academicYear === null || intervention.academicYear === scope.academicYear))
      .map((intervention) => {
        const before = tally()
        const after = tally()
        for (const item of items) add(item.assessedAt < intervention.createdAt ? before : after, item)
        const change = pct(before) !== null && pct(after) !== null ? round1(pct(after)! - pct(before)!) : null
        return { ...intervention, before: { percent: pct(before), itemCount: before.items }, after: { percent: pct(after), itemCount: after.items }, change, reading: interventionReading(before, after, studentCount) }
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    return { ...scope, bimesters, transitions, skillChanges, coverage, interventions: outcomes }
  }).sort((a, b) => a.academicYear - b.academicYear || a.subject.localeCompare(b.subject, 'pt-BR'))
}

export const SKILL_CHANGE_LABEL: Record<SkillChangeStatus, string> = {
  avancou: 'Avançou',
  estavel: 'Estável',
  regrediu: 'Regrediu',
  sem_base: 'Sem base para comparar',
}

export const INTERVENTION_READING_LABEL: Record<InterventionOutcome['reading'], string> = {
  melhora_posterior: 'Melhora nas avaliações posteriores',
  queda_posterior: 'Queda nas avaliações posteriores',
  sem_mudanca_relevante: 'Sem mudança relevante depois',
  sem_avaliacao_posterior: 'Ainda sem avaliação suficiente depois',
  sem_base_anterior: 'Sem base suficiente antes',
}
