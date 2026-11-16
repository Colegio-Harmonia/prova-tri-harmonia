import { describe, expect, it } from 'vitest'
import { buildSkillNetwork, NETWORK_RULES, networkNodeId, weaknessOf, type PeerEvidence } from './skillNetwork'
import type { StudentMasteryRow } from './studentMastery'

const base = { academicYear: 2026, segment: 'anos_finais', gradeYear: 7, subject: 'Matemática', targetMasteryPercent: 100, planned: true, description: null, limitedBySample: false }

function row(code: string, bimester: number, masteryPercent: number | null, level: StudentMasteryRow['level'], itemCount = masteryPercent === null ? 0 : 5): StudentMasteryRow {
  return { ...base, code, bimester, masteryPercent, level, itemCount, assessmentCount: itemCount ? 2 : 0, earnedPoints: 0, possiblePoints: 0 }
}

function peer(studentKey: string, code: string, bimester: number, earned: number, questionNumber = 1): PeerEvidence {
  return { academicYear: 2026, segment: 'anos_finais', gradeYear: 7, subject: 'Matemática', bimester, code, examId: bimester * 100, questionNumber, earnedPoints: earned, possiblePoints: 1, studentKey }
}

const id = (code: string, bimester: number) => networkNodeId({ ...base, code, bimester })

describe('weaknessOf', () => {
  it('só lê fraqueza quando a amostra permite leitura', () => {
    expect(weaknessOf({ level: 'em_desenvolvimento', masteryPercent: 40 })).toBeCloseTo(0.5)
    expect(weaknessOf({ level: 'dominio', masteryPercent: 90 })).toBe(0)
    expect(weaknessOf({ level: 'evidencia_insuficiente', masteryPercent: 0 })).toBe(0)
    expect(weaknessOf({ level: 'sem_evidencia', masteryPercent: null })).toBe(0)
  })
})

describe('buildSkillNetwork', () => {
  it('liga a retomada do mesmo código e propaga o risco para o bimestre seguinte', () => {
    const network = buildSkillNetwork([row('EF07MA08', 1, 30, 'em_desenvolvimento'), row('EF07MA08', 3, null, 'sem_evidencia')], [])
    expect(network.edges).toEqual([expect.objectContaining({ source: id('EF07MA08', 1), target: id('EF07MA08', 3), kind: 'retomada', directed: true })])
    const future = network.nodes.find((node) => node.id === id('EF07MA08', 3))!
    // fraqueza (80-30)/80 = 0,625 × peso 0,9 = 0,5625
    expect(future.risk).toBeCloseTo(0.56, 2)
    expect(future.state).toBe('risco_alto')
    expect(future.riskSources).toEqual([{ id: id('EF07MA08', 1), contribution: 0.56, kind: 'retomada' }])
    expect(network.roots).toEqual([{ id: id('EF07MA08', 1), affected: 1 }])
  })

  it('não propaga risco de habilidade com evidência insuficiente', () => {
    const network = buildSkillNetwork([row('EF07MA08', 1, 0, 'evidencia_insuficiente', 2), row('EF07MA08', 2, null, 'sem_evidencia')], [])
    const future = network.nodes.find((node) => node.bimester === 2)!
    expect(future.risk).toBe(0)
    expect(future.state).toBe('sem_evidencia')
  })

  it('não cria ligação quando o desempenho só acompanha o nível geral do aluno', () => {
    // Cada aluno vai igual nas duas habilidades: resíduo zero, sem correlação real entre conteúdos.
    const peers = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].flatMap((student, i) => [peer(student, 'EF07MA01', 1, i % 2), peer(student, 'EF07MA02', 2, i % 2)])
    const network = buildSkillNetwork([row('EF07MA01', 1, 30, 'em_desenvolvimento'), row('EF07MA02', 2, null, 'sem_evidencia')], peers)
    expect(network.edges.filter((edge) => edge.kind === 'correlacao')).toEqual([])
  })

  it('aprende ligação de correlação além do nível geral e com amostra mínima', () => {
    // Uma terceira habilidade estável (EF07MA03) dá o nível geral; MA01 e MA02 sobem e descem juntas.
    const pattern = [1, 0, 1, 0, 1, 0, 1]
    const peers = pattern.flatMap((hit, i) => {
      const student = `s${i}`
      return [peer(student, 'EF07MA01', 1, hit), peer(student, 'EF07MA02', 2, hit), peer(student, 'EF07MA03', 1, 1 - hit, 2)]
    })
    const rows = [row('EF07MA01', 1, 20, 'em_desenvolvimento'), row('EF07MA03', 1, 90, 'dominio'), row('EF07MA02', 2, null, 'sem_evidencia')]
    const network = buildSkillNetwork(rows, peers)
    const edge = network.edges.find((e) => e.kind === 'correlacao' && e.source === id('EF07MA01', 1) && e.target === id('EF07MA02', 2))
    expect(edge).toMatchObject({ directed: true, sharedStudents: 7 })
    expect(edge!.weight).toBeGreaterThanOrEqual(NETWORK_RULES.minCorrelation)
    expect(network.summary.peerStudentCount).toBe(7)
    const future = network.nodes.find((node) => node.id === id('EF07MA02', 2))!
    expect(future.risk).toBeGreaterThan(0)
  })

  it('exige o mínimo de alunos em comum', () => {
    const peers = [1, 0, 1].flatMap((hit, i) => [peer(`s${i}`, 'EF07MA01', 1, hit), peer(`s${i}`, 'EF07MA02', 2, hit), peer(`s${i}`, 'EF07MA03', 1, 1 - hit, 2)])
    const network = buildSkillNetwork([row('EF07MA01', 1, 20, 'em_desenvolvimento'), row('EF07MA02', 2, null, 'sem_evidencia'), row('EF07MA03', 1, 90, 'dominio')], peers)
    expect(network.summary.correlationEdgeCount).toBe(0)
  })

  it('pré-requisito aprovado liga a base mais recente à habilidade e propaga o risco', () => {
    const rows = [row('EF06MA07', 1, 30, 'em_desenvolvimento'), row('EF06MA07', 2, 50, 'em_desenvolvimento'), row('EF07MA10', 3, null, 'sem_evidencia'), row('EF07MA10', 1, 90, 'dominio')]
    const network = buildSkillNetwork(rows, [], [{ prerequisiteCode: 'ef06ma07', skillCode: 'EF07MA10', weight: 0.9 }])
    const prerequisites = network.edges.filter((edge) => edge.kind === 'prerequisito')
    // Para o 3º bimestre, a base mais recente é a do 2º; para o 1º, a do 1º (mesmo bimestre vale).
    expect(prerequisites.map((edge) => `${edge.source.split(':').slice(-2).join('@')}>${edge.target.split(':').slice(-2).join('@')}`).sort()).toEqual(['1@EF06MA07>1@EF07MA10', '2@EF06MA07>3@EF07MA10'])
    expect(network.summary.prerequisiteEdgeCount).toBe(2)
    const future = network.nodes.find((node) => node.id === id('EF07MA10', 3))!
    // fraqueza (80-50)/80 = 0,375 × 0,9 = 0,34 → moderado
    expect(future.state).toBe('risco_moderado')
    expect(future.riskSources).toContainEqual({ id: id('EF06MA07', 2), contribution: 0.34, kind: 'prerequisito' })
  })

  it('pré-requisito sem a base na teia do aluno não cria ligação', () => {
    const network = buildSkillNetwork([row('EF07MA10', 2, null, 'sem_evidencia')], [], [{ prerequisiteCode: 'EF06MA07', skillCode: 'EF07MA10', weight: 0.9 }])
    expect(network.edges).toEqual([])
  })

  it('pré-requisito no mesmo bimestre também define a raiz', () => {
    const network = buildSkillNetwork([row('EF07MA08', 1, 30, 'em_desenvolvimento'), row('EF07MA10', 1, 40, 'em_desenvolvimento')], [], [{ prerequisiteCode: 'EF07MA08', skillCode: 'EF07MA10', weight: 0.9 }])
    expect(network.roots.map((root) => root.id)).toEqual([id('EF07MA08', 1)])
  })

  it('raiz é o déficit sem déficit anterior ligado a ele', () => {
    const network = buildSkillNetwork([
      row('EF07MA08', 1, 30, 'em_desenvolvimento'),
      row('EF07MA08', 2, 40, 'em_desenvolvimento'),
      row('EF07MA08', 3, null, 'sem_evidencia'),
    ], [])
    expect(network.roots.map((root) => root.id)).toEqual([id('EF07MA08', 1)])
    expect(network.roots[0].affected).toBe(2)
  })
})
