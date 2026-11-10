import { describe, expect, it, vi } from 'vitest'
vi.mock('@/db/client', () => ({ db: { execute: vi.fn() } }))
import { db } from '@/db/client'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadPlannedEnemCandidates, buildEnemPlanningSlots, candidateLanguageMatches, matchEnemAssignments, selectPlannedEnemQuestions, type EnemCandidate, type EnemPlanningSlot } from './plannedEnemSelection'
import type { CurriculumSelection } from '@/types/exam'

const aligned = { status: 'aligned' as const, evidence: 'conteúdo e operação compatíveis', model: 'test', checkedAt: '2026-11-09T00:00:00Z' }
const candidate = (id: number, overrides: Partial<EnemCandidate> = {}): EnemCandidate => ({
  id, year: 2024, question_index: id, language: 'ingles', context: `Leadership passage ${id}`,
  alternatives_introduction: 'What is the main idea?', alternatives: 'ABCDE'.split('').map((letter) => ({ letter, text: `${letter} meaning` })),
  correct_alternative: 'A', skill_code: 'H5', competency_number: 2, classification_source: 'oficial', files: [], ...overrides,
})
const slot = (number: number, row = 0): EnemPlanningSlot => ({ number, unitRowIndex: row, type: 'objetiva', visualAid: 'auto', target: {
  subject: 'Inglês', gradeYear: 1, unitTitle: 'Leadership', curriculumContent: 'Reading and vocabulary', objectives: [],
  targetEnemSkill: { code: 'C2:H5', description: 'Associar vocábulos ao tema.' },
} })

describe('seleção ENEM orientada pelo planejamento', () => {
  it('desconhecido não equivale a inglês, e espanhol não entra em inglês', () => {
    expect(candidateLanguageMatches(candidate(1, { language: '' }), 'Inglês')).toBe(false)
    expect(candidateLanguageMatches(candidate(1, { language: 'espanhol' }), 'Inglês')).toBe(false)
    expect(candidateLanguageMatches(candidate(1), 'Inglês')).toBe(true)
    expect(candidateLanguageMatches(candidate(1), 'Língua Portuguesa')).toBe(false)
  })
  it('seleção explícita e modo legado não permitem Português sem idioma em Inglês', async () => {
    const assess = vi.fn().mockResolvedValue(aligned)
    for (const options of [{ preferredIds: [1] }, { strictLanguage: false }]) {
      const result = await selectPlannedEnemQuestions({ candidates: [candidate(1, { language: null })], slots: [slot(1)], count: 1, assess, ...options })
      expect(result.assignments).toEqual([])
    }
    expect(assess).not.toHaveBeenCalled()
  })
  it('preserva os filtros na consulta dos candidatos antes de conferir o planejamento', async () => {
    vi.mocked(db.execute).mockResolvedValue([] as never)
    await loadPlannedEnemCandidates('Inglês', undefined, { year: 2024, questionIndex: 2, q: 'leadership', bloomLevel: 'analisar', skillCode: 'H5', cognitiveAxis: 'DL' })
    const calls = vi.mocked(db.execute).mock.calls
    const query = new PgDialect().sqlToQuery(calls[calls.length - 1][0] as never)
    expect(query.params).toEqual(['linguagens', 2024, 2, '%leadership%', 'analisar', 'H5', 'DL'])
    expect(query.sql).toContain('ax.code=')
  })
  it('não confunde H5 de outra competência nem outro idioma com o alvo', async () => {
    const assess = vi.fn().mockResolvedValue(aligned)
    const result = await selectPlannedEnemQuestions({ candidates: [candidate(1, { competency_number: 3 }), candidate(2, { language: 'espanhol' })], slots: [slot(1)], count: 1, assess })
    expect(result.assignments).toEqual([])
    expect(assess).not.toHaveBeenCalled()
    expect(result.warnings.join(' ')).toContain('Nenhuma habilidade foi substituída')
  })
  it('código igual não basta quando o conteúdo ou a operação divergem', async () => {
    const assess = vi.fn().mockResolvedValue({ ...aligned, status: 'misaligned' })
    expect((await selectPlannedEnemQuestions({ candidates: [candidate(1)], slots: [slot(1)], count: 1, assess })).assignments).toEqual([])
  })
  it('relação parcial não recebe aprovação automática', async () => {
    const assess = vi.fn().mockResolvedValue({ ...aligned, status: 'partial' })
    expect((await selectPlannedEnemQuestions({ candidates: [candidate(1)], slots: [slot(1)], count: 1, assess })).assignments).toEqual([])
  })
  it('falha do avaliador não vira esgotamento do banco nem compatibilidade', async () => {
    const assess = vi.fn().mockResolvedValue({ ...aligned, status: 'unavailable' })
    await expect(selectPlannedEnemQuestions({ candidates: [candidate(1)], slots: [slot(1)], count: 1, assess })).rejects.toThrow('indisponível')
  })
  it('encontra um item compatível depois dos primeiros 12 candidatos', async () => {
    const assess = vi.fn(async (question) => ({ ...aligned, status: question.supportText === 'Leadership passage 27' ? 'aligned' as const : 'misaligned' as const }))
    const result = await selectPlannedEnemQuestions({ candidates: Array.from({ length: 40 }, (_, index) => candidate(index + 1)), slots: [slot(1)], count: 1, assess })
    expect(result.assignments.map((assignment) => assignment.questionId)).toEqual([27])
    expect(assess.mock.calls.length).toBeGreaterThan(12)
    expect(assess.mock.calls.length).toBeLessThan(40)
  })
  it('avança por itens novos quando várias posições compartilham o mesmo alvo', async () => {
    const assess = vi.fn(async (question) => ({ ...aligned, status: Number(question.supportText?.split(' ').at(-1)) > 12 ? 'aligned' as const : 'misaligned' as const }))
    const result = await selectPlannedEnemQuestions({ candidates: Array.from({ length: 30 }, (_, index) => candidate(index + 1)), slots: Array.from({ length: 8 }, (_, index) => slot(index + 1)), count: 8, assess })
    expect(result.assignments).toHaveLength(8)
    expect(new Set(assess.mock.calls.map(([question]) => question.supportText)).size).toBe(assess.mock.calls.length)
    expect(result.assignments.every((assignment) => assignment.questionId > 12)).toBe(true)
  })
  it('busca alternativas em alvos já preenchidos para liberar um item compartilhado', async () => {
    const assess = vi.fn(async (question, target) => {
      const id = Number(question.supportText?.split(' ').at(-1))
      return { ...aligned, status: id === 1 || target.unitTitle === 'Leadership' && id === 10 ? 'aligned' as const : 'misaligned' as const }
    })
    const other = slot(2, 1)
    other.target = { ...other.target, unitTitle: 'Other unit' }
    const result = await selectPlannedEnemQuestions({ candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)), slots: [slot(1), other], count: 2, assess })
    expect(result.assignments.map((assignment) => [assignment.questionId, assignment.slotNumber])).toEqual([[10, 1], [1, 2]])
  })
  it('só informa insuficiência depois de avaliar todos os candidatos elegíveis', async () => {
    const assess = vi.fn().mockResolvedValue({ ...aligned, status: 'misaligned' })
    const result = await selectPlannedEnemQuestions({ candidates: Array.from({ length: 35 }, (_, index) => candidate(index + 1)), slots: [slot(1), slot(2)], count: 2, assess })
    expect(assess).toHaveBeenCalledTimes(35)
    expect(result.assignments).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('todos os candidatos elegíveis')
    expect(result.warnings[0]).not.toContain('até 12')
  })
  it('mantém quantidade e não repete o mesmo item em duas posições', async () => {
    const result = await selectPlannedEnemQuestions({ candidates: [candidate(1)], slots: [slot(1), slot(2)], count: 2, assess: vi.fn().mockResolvedValue(aligned) })
    expect(result.assignments).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('encontradas 1')
  })
  it('distribui a origem entre unidades e reutiliza a conferência na mesma unidade e alvo', async () => {
    const assess = vi.fn().mockResolvedValue(aligned)
    const result = await selectPlannedEnemQuestions({ candidates: [candidate(1), candidate(2)], slots: [slot(1, 0), slot(2, 0), slot(3, 1)], count: 2, assess })
    expect(result.assignments.map((a) => a.slotNumber)).toEqual([1, 3])
    expect(new Set(result.assignments.map((a) => a.questionId)).size).toBe(2)
  })
  it('rearranja o item flexível para não perder a única posição de outro item', () => {
    const assignments = matchEnemAssignments([
      { questionId: 1, slotNumber: 1, alignment: aligned }, { questionId: 2, slotNumber: 1, alignment: aligned },
      { questionId: 1, slotNumber: 2, alignment: aligned },
    ], 2)
    expect(assignments.map((a) => [a.questionId, a.slotNumber])).toEqual([[2, 1], [1, 2]])
  })
  it('não usa uma posição dissertativa para preencher a cota ENEM', async () => {
    const assess = vi.fn().mockResolvedValue(aligned)
    const result = await selectPlannedEnemQuestions({ candidates: [candidate(1)], slots: [{ ...slot(1), type: 'descritiva' }], count: 1, assess })
    expect(result.assignments).toEqual([])
    expect(assess).not.toHaveBeenCalled()
  })
  it('conserva o total por capítulo e os alvos ENEM mesmo sem BNCC', () => {
    const curriculum: CurriculumSelection = { subject: 'Inglês', segment: 'ensino-medio', gradeYear: 1, tabName: 'Plano', unmappedWarnings: [], units: [0, 1].map((rowIndex) => ({ rowIndex, tituloCapitulo: `Unidade ${rowIndex}`, bimestre: '4', conteudo: 'Reading', objetivos: [], objetivosColumnMissing: true, habilidades: { status: 'nao_mapeado', skills: [] }, enemSkills: { invalid: [], skills: [{ code: 'C2:H5', description: 'Vocabulário', skill: 5, competency: 2, count: 1, sources: [] }] } })) }
    const plan = [0, 1].map((unitRowIndex) => ({ unitRowIndex, questionCount: 6, priority: 'media' as const, visualAid: 'auto' as const }))
    const slots = buildEnemPlanningSlots(curriculum, plan, 12, 70)
    expect(slots).toHaveLength(12)
    expect(slots.filter((s) => s.unitRowIndex === 0)).toHaveLength(6)
    expect(slots.every((s) => s.target.targetEnemSkill?.code === 'C2:H5')).toBe(true)
    expect(() => buildEnemPlanningSlots(curriculum, plan, 8, 70)).toThrow('soma 12')
  })
})
