import { describe, expect, it, vi } from 'vitest'
import { resolveColumnRoles } from '@/lib/sheets/headerResolver'
import { parseCurriculumRows } from '@/lib/sheets/rowParser'
import type { CurriculumSelection } from '@/types/exam'
import { analyzePlanning } from './analyzePlanning'
import { bloomFromLeadingVerb, buildObjectivePrompt, chaptersNeedingObjectives, recommendObjectives, sanitizeObjectives } from './objectiveSuggestions'

const HEADER = ['Bimestre', 'Capítulos', 'Conteúdos', 'Habilidades', 'Objetivos']
const ROWS = [
  ['1', 'Aprendendo a aprender', 'Verbete de wiki; mapa mental', 'EF04LP23 (EF35LP17) Buscar e selecionar informações', ''],
  ['1', 'Poemas em diversas formas', 'Poema visual; figuras de linguagem', 'EF35LP31', 'Respeitar a leitura dos colegas.'],
  ['2', 'Escrevendo notícias', 'Notícia; lide', 'EF04LP14', 'Identificar o lide de uma notícia.'],
]

function fixture() {
  const units = parseCurriculumRows(ROWS, resolveColumnRoles(HEADER), 'anos-iniciais', 'Língua Portuguesa')
  const selection: CurriculumSelection = { segment: 'anos-iniciais', gradeYear: 4, subject: 'Língua Portuguesa', tabName: 'Português- 4º ano', units, unmappedWarnings: [] }
  return { selection, analysis: analyzePlanning(selection) }
}

describe('bloomFromLeadingVerb', () => {
  it('lê o nível do verbo que abre a frase, sem depender de acento', () => {
    expect(bloomFromLeadingVerb('Identificar o lide de uma notícia')).toBe('lembrar')
    expect(bloomFromLeadingVerb('  comparar poemas visuais e poemas em versos')).toBe('analisar')
    expect(bloomFromLeadingVerb('Produzir um roteiro de tutorial')).toBe('criar')
  })
  it('recusa frase que não começa por verbo da tabela', () => {
    expect(bloomFromLeadingVerb('O aluno deve identificar o lide')).toBeNull()
    expect(bloomFromLeadingVerb('Identificação do lide')).toBeNull()
  })
})

describe('chaptersNeedingObjectives', () => {
  it('pega capítulo sem objetivo e capítulo só com objetivo atitudinal', () => {
    const { analysis } = fixture()
    expect(chaptersNeedingObjectives(analysis).map((chapter) => chapter.title)).toEqual(['Aprendendo a aprender', 'Poemas em diversas formas'])
  })
})

describe('sanitizeObjectives', () => {
  const { analysis } = fixture()
  const targets = chaptersNeedingObjectives(analysis)

  it('descarta atitudinal, sem verbo, repetido, longo demais e capítulo fora do alvo; Bloom vem do verbo', () => {
    const result = sanitizeObjectives({
      chapters: [
        { id: 0, objectives: [
          '1. Produzir um roteiro para tutorial multimodal.',
          'Identificar ditongos e encontros consonantais em palavras do verbete',
          'identificar ditongos e encontros consonantais em palavras do verbete.',
          'Valorizar as práticas de estudo',
          'O aluno compreende o que é um verbete',
          `Explicar ${'x'.repeat(260)}`,
        ] },
        { id: 2, objectives: ['Analisar a estrutura da notícia'] }, // já tem objetivo: fora do alvo
        { id: 99, objectives: ['Analisar algo'] },
      ],
    }, targets)
    expect(result.chapters).toEqual([{ rowIndex: 0, title: 'Aprendendo a aprender', objectives: [
      { text: 'Identificar ditongos e encontros consonantais em palavras do verbete', bloomLevel: 'lembrar' },
      { text: 'Produzir um roteiro para tutorial multimodal', bloomLevel: 'criar' },
    ] }])
    expect(result.discardedCount).toBe(6)
  })

  it('descarta objetivo com mais de 25 palavras, mesmo curto em caracteres', () => {
    const long = `Explicar ${Array.from({ length: 25 }, () => 'ab').join(' ')}` // 26 palavras, 83 caracteres
    const ok = `Explicar ${Array.from({ length: 24 }, () => 'ab').join(' ')}` // 25 palavras
    const result = sanitizeObjectives({ chapters: [{ id: 0, objectives: [long, ok] }] }, targets)
    expect(result.chapters[0].objectives).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('limita a 4 objetivos por capítulo', () => {
    const result = sanitizeObjectives({ chapters: [{ id: 1, objectives: ['Identificar a', 'Explicar b', 'Aplicar c', 'Comparar d', 'Criar e'] }] }, targets)
    expect(result.chapters[0].objectives).toHaveLength(4)
    expect(result.discardedCount).toBe(1)
  })
})

describe('buildObjectivePrompt', () => {
  it('leva título, conteúdos e o texto das habilidades, e a lista fechada de verbos', () => {
    const { analysis, selection } = fixture()
    const prompt = buildObjectivePrompt(analysis, selection, chaptersNeedingObjectives(analysis), new Map([['EF35LP31', 'Identificar, em textos versificados, efeitos de sentido']]))
    expect(prompt).toContain('id: 0\ntítulo: Aprendendo a aprender\nconteúdos: Verbete de wiki; mapa mental')
    expect(prompt).toContain('EF35LP17: Buscar e selecionar informações')
    expect(prompt).toContain('EF35LP31: Identificar, em textos versificados, efeitos de sentido')
    expect(prompt).toContain('analisar: ')
    expect(prompt).not.toContain('Escrevendo notícias')
  })
})

describe('recommendObjectives', () => {
  it('não chama a IA quando todo capítulo já tem objetivo', async () => {
    const units = parseCurriculumRows([ROWS[2]], resolveColumnRoles(HEADER), 'anos-iniciais', 'Língua Portuguesa')
    const selection: CurriculumSelection = { segment: 'anos-iniciais', gradeYear: 4, subject: 'Língua Portuguesa', tabName: 'x', units, unmappedWarnings: [] }
    const generate = vi.fn()
    expect(await recommendObjectives(analyzePlanning(selection), selection, new Map(), generate)).toMatchObject({ status: 'ok', chapters: [] })
    expect(generate).not.toHaveBeenCalled()
  })

  it('aceita só resposta sobre capítulo do próprio lote', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ['1', `Capítulo ${index}`, 'Conteúdo', '', ''])
    const units = parseCurriculumRows(rows, resolveColumnRoles(HEADER), 'anos-iniciais', 'Língua Portuguesa')
    const selection: CurriculumSelection = { segment: 'anos-iniciais', gradeYear: 4, subject: 'Língua Portuguesa', tabName: 'x', units, unmappedWarnings: [] }
    // Lotes de 8: capítulos 0-7 e depois o 8. A IA responde sempre sobre o 8.
    const generate = vi.fn(async () => ({ chapters: [{ id: 8, objectives: ['Explicar o conteúdo do capítulo'] }] }))
    const result = await recommendObjectives(analyzePlanning(selection), selection, new Map(), generate)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.chapters.map((chapter) => [chapter.rowIndex, chapter.objectives.length])).toEqual([[8, 1]])
    expect(result.discardedCount).toBe(1)
  })
})
