import { describe, expect, it } from 'vitest'
import { resolveColumnRoles } from '@/lib/sheets/headerResolver'
import { parseCurriculumRows } from '@/lib/sheets/rowParser'
import { listOfficialEnemSkills } from '@/config/enemMatrixOfficial'
import type { CurriculumSelection, Segment } from '@/types/exam'
import { analyzePlanning, resolveEnemScope } from './analyzePlanning'

function selectionFrom(segment: Segment, gradeYear: number, subject: string, header: string[], rows: string[][]): CurriculumSelection {
  const units = parseCurriculumRows(rows, resolveColumnRoles(header), segment, subject)
  return { segment, gradeYear, subject, tabName: subject, units, unmappedWarnings: [] }
}

const EM_HEADER = ['Bimestre', 'Título do capítulo', 'Conteúdos-foco', 'Habilidades', 'Habilidades ENEM', 'Objetivos']

describe('matriz oficial do ENEM', () => {
  it('tem as 30 habilidades com texto nas 4 áreas', () => {
    for (const area of ['linguagens', 'matematica', 'ciencias-natureza', 'ciencias-humanas'] as const) {
      const skills = listOfficialEnemSkills(area)
      expect(skills).toHaveLength(30)
      expect(skills.every((skill) => skill.description.length > 20)).toBe(true)
      expect(new Set(skills.map((skill) => skill.description)).size).toBe(30)
    }
  })

  it('usa o par competência:habilidade oficial', () => {
    expect(listOfficialEnemSkills('ciencias-humanas').find((skill) => skill.skill === 20)?.code).toBe('C4:H20')
    expect(listOfficialEnemSkills('ciencias-natureza').find((skill) => skill.skill === 21)?.code).toBe('C6:H21')
  })
})

describe('resolveEnemScope', () => {
  it('reserva C6/C7/C8 de Natureza à disciplina correspondente', () => {
    expect(resolveEnemScope('Física')?.competencies).toEqual([1, 2, 3, 4, 5, 6])
    expect(resolveEnemScope('Química')?.competencies).toEqual([1, 2, 3, 4, 5, 7])
    expect(resolveEnemScope('Biologia')?.competencies).toEqual([1, 2, 3, 4, 5, 8])
  })

  it('respeita o recorte de Linguagens e devolve null sem área', () => {
    expect(resolveEnemScope('Inglês')?.competencies).toEqual([2])
    expect(resolveEnemScope('Matemática')?.competencies).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(resolveEnemScope('Educação Física')).toBeNull()
  })
})

describe('analyzePlanning — Ensino Médio', () => {
  const selection = selectionFrom('ensino-medio', 2, 'Física', EM_HEADER, [
    ['1', 'Termologia', 'Temperatura, calor e dilatação', 'EM13CNT102', 'C6:H21 (Enem-2019)\nC6:H21 (Unesp-2020)', 'Analisar trocas de calor em sistemas reais.'],
    ['1', 'Óptica geométrica', 'Reflexão e refração da luz', '', '', 'Identificar os princípios da óptica geométrica.'],
    ['2', 'Ondas', 'Fenômenos ondulatórios', '', 'C1:H1\nC7:H24\nC9:H3', 'Explicar a propagação de ondas.'],
  ])
  const analysis = analyzePlanning(selection)

  it('expõe bimestre e título da unidade para levar ao planejamento interno', () => {
    expect(analysis.chapters.map((chapter) => [chapter.bimesterNumber, chapter.planTitle])).toEqual([[1, 'Termologia'], [1, 'Óptica geométrica'], [2, 'Ondas']])
  })

  it('aponta capítulo sem habilidade ENEM', () => {
    const optica = analysis.chapters[1]
    expect(optica.issues.map((issue) => issue.code)).toContain('sem_habilidade_enem')
    expect(analysis.enem?.chaptersWithoutEnem).toBe(1)
    expect(analysis.findings.some((finding) => finding.title.includes('1 capítulo sem habilidade do ENEM'))).toBe(true)
  })

  it('separa código inexistente de código fora do recorte da disciplina', () => {
    const ondas = analysis.chapters[2]
    expect(ondas.invalidEnemCodes).toEqual(['C9:H3'])
    const codes = ondas.issues.map((issue) => issue.code)
    expect(codes).toContain('codigo_enem_invalido')
    expect(codes).toContain('enem_fora_do_recorte')
    expect(ondas.issues.find((issue) => issue.code === 'enem_fora_do_recorte')?.message).toContain('C7:H24')
  })

  it('calcula cobertura e lacunas só dentro do recorte, com peso por ocorrência', () => {
    const enem = analysis.enem!
    expect(enem.rows).toHaveLength(23) // C1-C6 de Natureza = H1-H23
    expect(enem.rows.some((row) => row.competency === 7 || row.competency === 8)).toBe(false)
    expect(enem.rows.filter((row) => row.covered).map((row) => row.code)).toEqual(['C1:H1', 'C6:H21'])
    expect(enem.rows.find((row) => row.code === 'C6:H21')?.occurrences).toBe(2)
    expect(enem.gapCount).toBe(21)
    expect(enem.scope.sharedArea).toBe(true)
  })

  it('usa o texto oficial do INEP também fora de Linguagens', () => {
    expect(analysis.chapters[0].enemSkills[0].description).toContain('termodinâmica')
  })

  it('não trata falta de BNCC como lacuna quando o capítulo tem C:H', () => {
    const ondas = analysis.chapters[2].issues.find((issue) => issue.code === 'sem_bncc')
    const optica = analysis.chapters[1].issues.find((issue) => issue.code === 'sem_bncc')
    expect(ondas?.severity).toBe('info')
    expect(optica?.severity).toBe('media')
  })

  it('resume Bloom a partir dos objetivos', () => {
    expect(analysis.bloom.counts).toMatchObject({ lembrar: 1, compreender: 1, analisar: 1 })
    expect(analysis.bloom.higherOrderCount).toBe(1)
    expect(analysis.framework).toBe('enem')
  })
})

describe('analyzePlanning — Ensino Médio sem coluna ENEM', () => {
  it('avisa que o planejamento inteiro está sem habilidades do ENEM', () => {
    const analysis = analyzePlanning(selectionFrom('ensino-medio', 1, 'História', ['Bimestre', 'Capítulo', 'Conteúdos', 'Habilidades'], [
      ['1', 'Brasil Colônia', 'Economia açucareira', 'EM13CHS101'],
      ['2', 'Iluminismo', 'Razão e política', 'EM13CHS102'],
    ]))
    expect(analysis.enem?.chaptersWithoutEnem).toBe(2)
    expect(analysis.enem?.gapCount).toBe(30)
    expect(analysis.findings[0].title).toBe('Planejamento ainda sem habilidades do ENEM')
    expect(analysis.bloom.allEstimated).toBe(true)
    // Bloom estimado não vira crítica à distribuição do plano.
    expect(analysis.findings.some((finding) => finding.title.includes('Analisar'))).toBe(false)
    expect(analysis.findings.some((finding) => finding.title === 'Bloom estimado')).toBe(true)
  })
})

describe('analyzePlanning — Fundamental', () => {
  it('fica em BNCC × Bloom e nunca atribui ENEM', () => {
    const analysis = analyzePlanning(selectionFrom('anos-finais', 8, 'Inglês', ['Unidade', 'Capítulos', 'Conteúdos', 'Habilidades'], [
      ['1', 'Daily routines', 'Simple present', ''],
      ['2', 'Travel', 'Past simple', 'EF08LI01'],
    ]))
    expect(analysis.framework).toBe('bncc')
    expect(analysis.enem).toBeNull()
    expect(analysis.chapters.flatMap((chapter) => chapter.issues.map((issue) => issue.code))).not.toContain('sem_habilidade_enem')
    expect(analysis.bncc.chaptersWithoutBncc).toBe(1)
    expect(analysis.saeb.applicable).toBe(false)
    expect(analysis.saeb.note).toContain('não tem matriz SAEB oficial')
  })

  it('marca SAEB como aproximado fora da série de referência', () => {
    const analysis = analyzePlanning(selectionFrom('anos-finais', 7, 'Matemática', ['Bimestre', 'Capítulos', 'Habilidades', 'Objetivos'], [
      ['1', 'Frações', 'EF07MA05', 'Identificar frações equivalentes. Listar múltiplos.'],
    ]))
    expect(analysis.saeb).toMatchObject({ applicable: true })
    expect(analysis.saeb.note).toContain('APROXIMADO')
    expect(analysis.findings.some((finding) => finding.title.includes('Nenhum objetivo em Analisar'))).toBe(true)
  })
})

describe('analyzePlanning — apontamentos de revisão', () => {
  it('conta como lacuna de BNCC só o capítulo sem BNCC e sem ENEM', () => {
    const analysis = analyzePlanning(selectionFrom('ensino-medio', 2, 'Física', EM_HEADER, [
      ['1', 'Termologia', 'Calor', '', 'C6:H21', 'Analisar trocas de calor.'],
      ['1', 'Ondas', 'Fenômenos ondulatórios', '', 'C1:H1', 'Explicar a propagação de ondas.'],
      ['2', 'Óptica', 'Reflexão', '', '', 'Explicar a formação de imagens.'],
    ]))
    expect(analysis.bncc.chaptersWithoutBncc).toBe(3)
    expect(analysis.findings.some((finding) => finding.title === '1 capítulo sem BNCC nem ENEM')).toBe(true)
  })

  it('não usa objetivos estimados para criticar a distribuição de Bloom', () => {
    const real = parseCurriculumRows([
      ['1', 'Termologia', 'Calor', '', 'C6:H21', 'Analisar trocas de calor. Avaliar o uso de energia. Aplicar a lei de Fourier.'],
    ], resolveColumnRoles(EM_HEADER), 'ensino-medio', 'Física')
    const estimated = parseCurriculumRows(
      Array.from({ length: 6 }, (_, index) => ['2', `Capítulo ${index}`, 'Conteúdo', '']),
      resolveColumnRoles(['Bimestre', 'Capítulo', 'Conteúdos', 'Habilidades']), 'ensino-medio', 'Física',
    ).map((unit) => ({ ...unit, rowIndex: 100 + unit.rowIndex }))
    const analysis = analyzePlanning({ segment: 'ensino-medio', gradeYear: 2, subject: 'Física', tabName: 'A + B', units: [...real, ...estimated], unmappedWarnings: [] })
    expect(analysis.bloom.estimatedCount).toBe(6)
    expect(analysis.bloom.lowerOrderShare).toBe(0)
    expect(analysis.bloom.higherOrderCount).toBe(2)
    expect(analysis.findings.some((finding) => finding.title.includes('concentrados'))).toBe(false)
    expect(analysis.findings.some((finding) => finding.title === 'Bloom parcialmente estimado')).toBe(true)
  })
})

describe('título de unidade igual ao da importação', () => {
  it('linha sem título vira "Unidade N" pela posição dentro do bimestre', () => {
    const analysis = analyzePlanning(selectionFrom('ensino-medio', 1, 'História', ['Bimestre', 'Capítulo', 'Conteúdos'], [
      ['1', 'Brasil Colônia', 'Açúcar'],
      ['1', '', 'Mineração'],
      ['2', '', 'Iluminismo'],
      ['2', 'Revolução Francesa', 'Jacobinos'],
    ]))
    expect(analysis.chapters.map((chapter) => chapter.planTitle)).toEqual(['Brasil Colônia', 'Unidade 2', 'Unidade 1', 'Revolução Francesa'])
  })
})
