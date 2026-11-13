import { describe, expect, it, vi } from 'vitest'
import { resolveColumnRoles } from '@/lib/sheets/headerResolver'
import { parseCurriculumRows } from '@/lib/sheets/rowParser'
import type { CurriculumSelection } from '@/types/exam'
import { analyzePlanning } from './analyzePlanning'
import { buildSuggestionPrompt, chaptersForSuggestion, normalizeEnemCode, recommendEnemSkills, sanitizeSuggestions } from './recommendations'

const HEADER = ['Bimestre', 'Título do capítulo', 'Conteúdos-foco', 'Habilidades ENEM', 'Objetivos']
const ROWS = [
  ['1', 'Termologia', 'Temperatura e calor', 'C6:H21', 'Analisar trocas de calor.'],
  ['1', 'Óptica', 'Reflexão e refração', '', 'Explicar a formação de imagens.'],
  ['2', 'Ondas', 'Fenômenos ondulatórios', '', 'Explicar a propagação de ondas.'],
]

function fixture(): { selection: CurriculumSelection; analysis: ReturnType<typeof analyzePlanning> } {
  const units = parseCurriculumRows(ROWS, resolveColumnRoles(HEADER), 'ensino-medio', 'Física')
  const selection: CurriculumSelection = { segment: 'ensino-medio', gradeYear: 2, subject: 'Física', tabName: 'Física', units, unmappedWarnings: [] }
  return { selection, analysis: analyzePlanning(selection) }
}

describe('normalizeEnemCode', () => {
  it('aceita só o par C:H exato', () => {
    expect(normalizeEnemCode(' c6-h21 ')).toBe('C6:H21')
    expect(normalizeEnemCode('C6:H21 — Utilizar leis físicas')).toBeNull()
    expect(normalizeEnemCode('H21')).toBeNull()
    expect(normalizeEnemCode('EM13CNT101')).toBeNull()
  })
})

describe('sanitizeSuggestions', () => {
  const { analysis } = fixture()

  it('descarta código inventado, fora do recorte, par errado, repetido e capítulo inexistente', () => {
    const result = sanitizeSuggestions({
      chapters: [
        { id: 1, suggestions: [
          { code: 'C1:H1', justification: 'Trata de fenômenos ondulatórios da luz.', confidence: 'media' },
          { code: 'C9:H40', justification: 'Não existe.', confidence: 'alta' },
          { code: 'C7:H24', justification: 'Química, fora do recorte de Física.', confidence: 'alta' },
          { code: 'C2:H21', justification: 'Par competência:habilidade errado.', confidence: 'alta' },
          { code: 'C1:H1', justification: 'Repetida.', confidence: 'alta' },
          { code: 'C5:H17', justification: '   ', confidence: 'alta' },
        ] },
        { id: 0, suggestions: [{ code: 'C6:H21', justification: 'Já está na planilha.', confidence: 'alta' }] },
        { id: 999, suggestions: [{ code: 'C1:H1', justification: 'Capítulo não existe.', confidence: 'alta' }] },
      ],
    }, analysis)

    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].suggestions.map((suggestion) => suggestion.code)).toEqual(['C1:H1'])
    expect(result.discardedCount).toBe(7)
  })

  it('usa o texto oficial e marca quando a sugestão preenche lacuna', () => {
    const result = sanitizeSuggestions({
      chapters: [{ id: 1, suggestions: [
        { code: 'C1:H1', justification: 'Luz como onda.', confidence: 'alta' },
        { code: 'c6 h21', justification: 'Refração e energia.', confidence: 'baixa' },
      ] }],
    }, analysis)
    const [h1, h21] = result.chapters[0].suggestions
    expect(h1.description).toMatch(/^Reconhecer características ou propriedades de fenômenos ondulatórios/)
    expect(h1.fillsGap).toBe(true)
    expect(h21.fillsGap).toBe(false) // já coberta por Termologia
  })

  it('limita a 3 sugestões por capítulo', () => {
    const result = sanitizeSuggestions({
      chapters: [{ id: 2, suggestions: ['C1:H1', 'C1:H2', 'C1:H3', 'C1:H4'].map((code) => ({ code, justification: 'Cabe no capítulo.', confidence: 'media' as const })) }],
    }, analysis)
    expect(result.chapters[0].suggestions).toHaveLength(3)
    expect(result.discardedCount).toBe(1)
  })
})

describe('buildSuggestionPrompt', () => {
  it('entrega a lista fechada do recorte, com lacunas marcadas, e os capítulos pelo id', () => {
    const { analysis, selection } = fixture()
    const prompt = buildSuggestionPrompt(analysis, selection, chaptersForSuggestion(analysis))
    expect(prompt).toContain('C6:H21 — Utilizar leis físicas')
    expect(prompt).not.toContain('C6:H21 — Utilizar leis físicas e (ou) químicas para interpretar processos naturais ou tecnológicos inseridos no contexto da termodinâmica e(ou) do eletromagnetismo. [SEM COBERTURA')
    expect(prompt).toContain('C1:H1 — Reconhecer características')
    expect(prompt).toContain('[SEM COBERTURA NO ANO]')
    expect(prompt).not.toContain('C7:H24')
    expect(prompt).toContain('id: 1\ntítulo: Óptica')
    expect(prompt).toContain('habilidades ENEM já planejadas: C6:H21')
  })
})

describe('recommendEnemSkills', () => {
  it('orquestra o gerador e devolve lacunas que continuam sem capítulo', async () => {
    const { analysis, selection } = fixture()
    const generate = vi.fn(async () => ({
      chapters: [
        { id: 1, suggestions: [{ code: 'C1:H1', justification: 'Luz como onda.', confidence: 'alta' }] },
        { id: 2, suggestions: [{ code: 'C9:H99', justification: 'Inventada.', confidence: 'alta' }] },
        { id: 0, suggestions: [] },
      ],
    }))
    const result = await recommendEnemSkills(analysis, selection, generate)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ok')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['Óptica'])
    expect(result.discardedCount).toBe(1)
    expect(result.remainingGaps).not.toContain('C1:H1')
    expect(result.remainingGaps).toContain('C1:H2')
  })

  it('mantém as lacunas quando o planejamento não tem capítulos', async () => {
    const selection: CurriculumSelection = { segment: 'ensino-medio', gradeYear: 2, subject: 'Física', tabName: 'Física', units: [], unmappedWarnings: [] }
    const generate = vi.fn()
    const result = await recommendEnemSkills(analyzePlanning(selection), selection, generate)
    expect(generate).not.toHaveBeenCalled()
    expect(result.message).toContain('não tem capítulos')
    expect(result.remainingGaps).toHaveLength(23)
  })

  it('descarta sugestão para capítulo de outro lote', async () => {
    const rows = Array.from({ length: 16 }, (_, index) => ['1', `Capítulo ${index}`, 'Ondas e luz', '', 'Explicar fenômenos.'])
    const units = parseCurriculumRows(rows, resolveColumnRoles(HEADER), 'ensino-medio', 'Física')
    const selection: CurriculumSelection = { segment: 'ensino-medio', gradeYear: 2, subject: 'Física', tabName: 'Física', units, unmappedWarnings: [] }
    // 1º lote = capítulos 0-14; 2º lote = capítulo 15. A IA responde sempre sobre o 15.
    const generate = vi.fn(async () => ({ chapters: [{ id: 15, suggestions: [{ code: 'C1:H1', justification: 'Ondas.', confidence: 'alta' }] }] }))
    const result = await recommendEnemSkills(analyzePlanning(selection), selection, generate)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.chapters.map((chapter) => chapter.rowIndex)).toEqual([15])
    expect(result.chapters[0].suggestions).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('não chama a IA fora do Ensino Médio', async () => {
    const units = parseCurriculumRows([['1', 'Frações', 'EF07MA05']], resolveColumnRoles(['Bimestre', 'Capítulos', 'Habilidades']), 'anos-finais', 'Matemática')
    const selection: CurriculumSelection = { segment: 'anos-finais', gradeYear: 7, subject: 'Matemática', tabName: 'Mat', units, unmappedWarnings: [] }
    const generate = vi.fn()
    const result = await recommendEnemSkills(analyzePlanning(selection), selection, generate)
    expect(result.status).toBe('nao_aplicavel')
    expect(generate).not.toHaveBeenCalled()
  })
})
