// Sinapse — teia de habilidades do aluno.
//
// Cada nó é uma habilidade BNCC num bimestre (a linha do domínio individual,
// `StudentMasteryRow`). As ligações vêm só de dado real, nunca de suposição:
//
// - **Retomada**: o mesmo código BNCC planejado de novo num bimestre seguinte.
//   Quem não dominou antes tende a chegar com dificuldade na retomada.
// - **Correlação observada**: entre alunos do mesmo recorte (ano, série,
//   disciplina), o desempenho numa habilidade acompanha o da outra *além do
//   nível geral do aluno*. Usa o resíduo (habilidade − média do aluno) para não
//   confundir "aluno bom vai bem em tudo" com ligação entre conteúdos. Exige
//   amostra mínima de alunos em comum.
//
// - **Pré-requisito aprovado**: "A é base para B", sugerido pela IA ou
//   cadastrado e sempre aprovado pela coordenação
//   (`curriculum_skill_prerequisites`). Liga a ocorrência mais recente de A
//   (até o bimestre de B) a B, inclusive de série anterior.
//
// O risco de uma habilidade ainda sem evidência é um OU-ruidoso das fontes
// fracas que chegam até ela, pesado pela força de cada ligação. Habilidade com
// evidência insuficiente não propaga nada: a amostra limita a conclusão.

import { MASTERY_RULES, type MasteryLevel, type StudentMasteryRow } from './studentMastery'

export const NETWORK_RULES = {
  /** Alunos com evidência nas duas habilidades para calcular uma correlação. */
  minSharedStudents: 6,
  /** Correlação mínima dos resíduos para virar ligação. */
  minCorrelation: 0.4,
  /** Ligações de correlação mantidas por habilidade (as mais fortes). */
  maxCorrelationsPerNode: 3,
  /** Peso da retomada do mesmo código. */
  recurrenceWeight: 0.9,
  /** Quanto do risco de um nó sem evidência segue adiante na cadeia. */
  chainDecay: 0.85,
  highRisk: 0.45,
  moderateRisk: 0.22,
} as const

export type NetworkNodeState = MasteryLevel | 'risco_alto' | 'risco_moderado'
export type NetworkEdgeKind = 'retomada' | 'correlacao' | 'prerequisito'

/** Pré-requisito aprovado, com o peso da força (essencial 0,9 · importante 0,7 · apoio 0,5). */
export type PrerequisiteLink = { prerequisiteCode: string; skillCode: string; weight: number }

export type NetworkEdge = {
  source: string
  target: string
  kind: NetworkEdgeKind
  weight: number
  /** Alunos usados na correlação; null na retomada. */
  sharedStudents: number | null
  /** Correlação no mesmo bimestre não tem sentido temporal. */
  directed: boolean
}

export type NetworkNode = Omit<StudentMasteryRow, 'earnedPoints' | 'possiblePoints' | 'targetMasteryPercent'> & {
  id: string
  state: NetworkNodeState
  /** 0–1: quanto falta para o domínio, só quando a amostra permite leitura. */
  weakness: number
  /** 0–1 para habilidade sem evidência; null quando já foi avaliada. */
  risk: number | null
  riskSources: Array<{ id: string; contribution: number; kind: NetworkEdgeKind }>
  /** Habilidades alcançadas a partir desta pelas ligações. */
  reach: number
}

export type NetworkRoot = { id: string; affected: number }

export type SkillNetwork = {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  roots: NetworkRoot[]
  summary: { peerStudentCount: number; correlationEdgeCount: number; recurrenceEdgeCount: number; prerequisiteEdgeCount: number; assessedNodeCount: number; atRiskNodeCount: number }
}

/** Evidência de qualquer aluno do recorte (mesmo formato de `loadEvidence`). */
export type PeerEvidence = {
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
}

type NodeScope = { academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number; code: string }

function subjectKey(subject: string) {
  const normalized = subject.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase('pt-BR')
  return normalized === 'lingua portuguesa' ? 'portugues' : normalized
}
function contextKey(scope: Omit<NodeScope, 'bimester' | 'code'>) { return `${scope.academicYear}:${scope.segment}:${scope.gradeYear}:${subjectKey(scope.subject)}` }
export function networkNodeId(scope: NodeScope) { return `${contextKey(scope)}:${scope.bimester}:${scope.code.trim().toUpperCase()}` }
function order(node: NodeScope) { return node.academicYear * 10 + node.bimester }

const READABLE: MasteryLevel[] = ['em_desenvolvimento', 'proximo_do_dominio', 'dominio']

export function weaknessOf(row: Pick<StudentMasteryRow, 'level' | 'masteryPercent'>) {
  if (!READABLE.includes(row.level) || row.masteryPercent === null) return 0
  return Math.max(0, (MASTERY_RULES.masteryPercent - row.masteryPercent) / MASTERY_RULES.masteryPercent)
}

function pearson(xs: number[], ys: number[]) {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

/** Ligações de correlação entre habilidades da mesma disciplina/série/ano, a partir dos resíduos por aluno. */
export function correlationEdges(nodeIds: Set<string>, peers: PeerEvidence[], nodesById: Map<string, NodeScope>): { edges: NetworkEdge[]; peerStudentCount: number } {
  // Percentual por aluno × habilidade, sem contar a mesma questão duas vezes.
  const acc = new Map<string, Map<string, { earned: number; possible: number; items: Set<string> }>>()
  const totals = new Map<string, { earned: number; possible: number }>()
  for (const item of peers) {
    if (!(item.possiblePoints > 0)) continue
    const id = networkNodeId(item)
    if (!nodeIds.has(id)) continue
    const byNode = acc.get(item.studentKey) ?? new Map()
    const cell = byNode.get(id) ?? { earned: 0, possible: 0, items: new Set<string>() }
    const itemKey = `${item.examId}:${item.questionNumber}`
    if (!cell.items.has(itemKey)) {
      cell.items.add(itemKey)
      const earned = Math.min(Math.max(item.earnedPoints, 0), item.possiblePoints)
      cell.earned += earned
      cell.possible += item.possiblePoints
      const total = totals.get(item.studentKey) ?? { earned: 0, possible: 0 }
      total.earned += earned
      total.possible += item.possiblePoints
      totals.set(item.studentKey, total)
    }
    byNode.set(id, cell)
    acc.set(item.studentKey, byNode)
  }

  // Resíduo: desempenho na habilidade menos o desempenho geral do aluno no recorte.
  const residuals = new Map<string, Map<string, number>>()
  for (const [student, byNode] of acc) {
    const total = totals.get(student)!
    const overall = total.earned / total.possible
    const map = new Map<string, number>()
    for (const [id, cell] of byNode) map.set(id, cell.earned / cell.possible - overall)
    residuals.set(student, map)
  }

  const ids = [...nodeIds]
  const candidates: NetworkEdge[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = nodesById.get(ids[i])!, b = nodesById.get(ids[j])!
      if (contextKey(a) !== contextKey(b) || a.code.toUpperCase() === b.code.toUpperCase()) continue
      const xs: number[] = [], ys: number[] = []
      for (const map of residuals.values()) {
        const x = map.get(ids[i]), y = map.get(ids[j])
        if (x !== undefined && y !== undefined) { xs.push(x); ys.push(y) }
      }
      if (xs.length < NETWORK_RULES.minSharedStudents) continue
      const r = pearson(xs, ys)
      if (r === null || r < NETWORK_RULES.minCorrelation) continue
      const [first, second] = order(a) <= order(b) ? [ids[i], ids[j]] : [ids[j], ids[i]]
      candidates.push({ source: first, target: second, kind: 'correlacao', weight: Math.round(r * 100) / 100, sharedStudents: xs.length, directed: order(a) !== order(b) })
    }
  }

  // Mantém só as mais fortes de cada habilidade, para a teia continuar legível.
  candidates.sort((x, y) => y.weight - x.weight)
  const degree = new Map<string, number>()
  const edges = candidates.filter((edge) => {
    const ok = (degree.get(edge.source) ?? 0) < NETWORK_RULES.maxCorrelationsPerNode && (degree.get(edge.target) ?? 0) < NETWORK_RULES.maxCorrelationsPerNode
    if (ok) { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1) }
    return ok
  })
  return { edges, peerStudentCount: acc.size }
}

/** Liga cada ocorrência de um código à próxima retomada do mesmo código no mesmo recorte. */
export function recurrenceEdges(nodes: NodeScope[]): NetworkEdge[] {
  const groups = new Map<string, NodeScope[]>()
  for (const node of nodes) {
    const key = `${contextKey(node)}:${node.code.toUpperCase()}`
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  const edges: NetworkEdge[] = []
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => order(a) - order(b))
    for (let i = 1; i < sorted.length; i++) {
      if (order(sorted[i - 1]) === order(sorted[i])) continue
      edges.push({ source: networkNodeId(sorted[i - 1]), target: networkNodeId(sorted[i]), kind: 'retomada', weight: NETWORK_RULES.recurrenceWeight, sharedStudents: null, directed: true })
    }
  }
  return edges
}

/** Liga cada habilidade à ocorrência mais recente do seu pré-requisito aprovado, na mesma disciplina. */
export function prerequisiteEdges(nodes: NodeScope[], links: PrerequisiteLink[]): NetworkEdge[] {
  const byCode = new Map<string, NodeScope[]>()
  for (const node of nodes) {
    const key = `${subjectKey(node.subject)}:${node.code.toUpperCase()}`
    byCode.set(key, [...(byCode.get(key) ?? []), node])
  }
  const edges: NetworkEdge[] = []
  const seen = new Set<string>()
  for (const link of links) {
    const skillCode = link.skillCode.toUpperCase(), baseCode = link.prerequisiteCode.toUpperCase()
    for (const target of nodes.filter((node) => node.code.toUpperCase() === skillCode)) {
      const source = (byCode.get(`${subjectKey(target.subject)}:${baseCode}`) ?? [])
        .filter((node) => order(node) <= order(target))
        .sort((a, b) => order(b) - order(a))[0]
      if (!source) continue
      const edge = { source: networkNodeId(source), target: networkNodeId(target) }
      const key = `${edge.source}>${edge.target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ ...edge, kind: 'prerequisito', weight: link.weight, sharedStudents: null, directed: true })
    }
  }
  return edges
}

function stateFor(row: StudentMasteryRow, risk: number | null): NetworkNodeState {
  if (row.level !== 'sem_evidencia' || risk === null) return row.level
  if (risk >= NETWORK_RULES.highRisk) return 'risco_alto'
  if (risk >= NETWORK_RULES.moderateRisk) return 'risco_moderado'
  return 'sem_evidencia'
}

export function buildSkillNetwork(rows: StudentMasteryRow[], peers: PeerEvidence[], prerequisites: PrerequisiteLink[] = []): SkillNetwork {
  const scoped = rows.map((row) => ({ row, id: networkNodeId(row) }))
  const nodesById = new Map(scoped.map(({ row, id }) => [id, row as NodeScope]))
  const nodeIds = new Set(nodesById.keys())

  const correlation = correlationEdges(nodeIds, peers, nodesById)
  const recurrence = recurrenceEdges([...nodesById.values()])
  const prerequisite = prerequisiteEdges([...nodesById.values()], prerequisites)
  const edges = [...prerequisite, ...recurrence, ...correlation.edges]

  // Quem alimenta quem: ligação temporal vai do anterior ao posterior; a do
  // mesmo bimestre vale nos dois sentidos.
  const incoming = new Map<string, NetworkEdge[]>()
  const outgoing = new Map<string, string[]>()
  const link = (from: string, to: string, edge: NetworkEdge) => {
    incoming.set(to, [...(incoming.get(to) ?? []), { ...edge, source: from, target: to }])
    outgoing.set(from, [...(outgoing.get(from) ?? []), to])
  }
  for (const edge of edges) {
    link(edge.source, edge.target, edge)
    if (!edge.directed) link(edge.target, edge.source, edge)
  }

  const state = new Map<string, { weakness: number; risk: number | null; riskSources: NetworkNode['riskSources'] }>()
  const chronological = [...scoped].sort((a, b) => order(a.row) - order(b.row))
  for (const { row, id } of chronological) state.set(id, { weakness: weaknessOf(row), risk: null, riskSources: [] })
  for (const { row, id } of chronological) {
    if (row.level !== 'sem_evidencia') continue
    let keep = 1
    const sources: NetworkNode['riskSources'] = []
    for (const edge of incoming.get(id) ?? []) {
      const source = state.get(edge.source)!
      const sourceRow = nodesById.get(edge.source) as StudentMasteryRow
      // Fonte sem evidência só repassa o risco que já recebeu (e só se vier antes).
      const strength = sourceRow.level === 'sem_evidencia'
        ? (order(sourceRow) < order(row) ? (source.risk ?? 0) * NETWORK_RULES.chainDecay : 0)
        : source.weakness
      const contribution = edge.weight * strength
      if (contribution <= 0) continue
      keep *= 1 - contribution
      sources.push({ id: edge.source, contribution: Math.round(contribution * 100) / 100, kind: edge.kind })
    }
    const current = state.get(id)!
    current.risk = Math.round((1 - keep) * 100) / 100
    current.riskSources = sources.sort((a, b) => b.contribution - a.contribution)
  }

  const reachOf = (id: string) => {
    const seen = new Set<string>([id]), stack = [id]
    while (stack.length) for (const next of outgoing.get(stack.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next) }
    seen.delete(id)
    return seen
  }

  const nodes: NetworkNode[] = scoped.map(({ row, id }) => {
    const s = state.get(id)!
    const { earnedPoints: _e, possiblePoints: _p, targetMasteryPercent: _t, ...rest } = row
    return { ...rest, id, weakness: Math.round(s.weakness * 100) / 100, risk: s.risk, riskSources: s.riskSources, state: stateFor(row, s.risk), reach: reachOf(id).size }
  })
  const nodeState = new Map(nodes.map((node) => [node.id, node.state]))

  // Raiz: habilidade em desenvolvimento sem nenhuma anterior também em desenvolvimento ligada a ela.
  const attention: NetworkNodeState[] = ['em_desenvolvimento', 'risco_alto', 'risco_moderado']
  const roots = nodes
    .filter((node) => node.state === 'em_desenvolvimento')
    // Pré-requisito explica a dificuldade mesmo no mesmo bimestre; as demais ligações só quando vêm antes.
    .filter((node) => !(incoming.get(node.id) ?? []).some((edge) => nodeState.get(edge.source) === 'em_desenvolvimento' && (edge.kind === 'prerequisito' || order(nodesById.get(edge.source)!) < order(node))))
    .map((node) => ({ id: node.id, affected: [...reachOf(node.id)].filter((id) => attention.includes(nodeState.get(id)!)).length }))
    .sort((a, b) => b.affected - a.affected)

  return {
    nodes,
    edges,
    roots,
    summary: {
      peerStudentCount: correlation.peerStudentCount,
      correlationEdgeCount: correlation.edges.length,
      recurrenceEdgeCount: recurrence.length,
      prerequisiteEdgeCount: prerequisite.length,
      assessedNodeCount: nodes.filter((node) => node.itemCount > 0).length,
      atRiskNodeCount: nodes.filter((node) => node.state === 'risco_alto' || node.state === 'risco_moderado').length,
    },
  }
}
