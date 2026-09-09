import type { Segment } from '@/types/exam'

export type GradeSheetConfig = {
  fileId: string
  /**
   * Known real tab titles per discipline, transcribed from confirmed
   * observations (gerador-de-prova/data/fundamental-1/sources.json) for 2º
   * and 3º ano — real tab names do NOT match the discipline name exactly
   * (e.g. "2° Mat", "Matemática- 3º ano " with a trailing space, a "6° Cie"
   * tab sitting inside the *2º ano* file). Where this map has an entry for a
   * subject, tabResolver uses it directly instead of fuzzy-matching.
   * Grades without a known map here (4º/5º ano and most disciplinas de
   * anos-finais/ensino-medio) fall back to fuzzy/alias matching or the
   * curriculum_tab_overrides table — do NOT assume they follow the same
   * "exact discipline name" pattern the CLAUDE.md docs claim, since that
   * claim is already contradicted for 2º/3º ano.
   */
  // Um array significa "a disciplina é a UNIÃO de várias abas" — confirmado
  // no 3º ano EM: a planilha organiza por "frente"/tópico dentro de cada
  // disciplina (ex: Matemática = Álgebra + Geometria + Trigonometria, cada
  // uma numa aba própria), não uma aba única por disciplina como as outras
  // planilhas já configuradas.
  knownTabTitles?: Record<string, string | string[]>
}

export const SEGMENT_GRADE_SHEETS: Record<Segment, Record<number, GradeSheetConfig>> = {
  'anos-iniciais': {
    2: {
      fileId: '1QDVd28cBuDOomnimjHH4YH3vOfwUuQuEKR7GgxacCu8',
      knownTabTitles: {
        'Educação Física': '2° Ed. Física',
        'Inglês': '2° Ing',
        'Matemática': '2° Mat',
        'Artes': '2° Artes',
        'História': '2° Hist',
        'Geografia': '2° Geo',
        'Filosofia': '2° Filo',
        'Ciências': '6° Cie',
        'Português': '6° Port',
      },
    },
    3: {
      fileId: '1762FMNfnl-C-bgw2KuHKsssVv1sU3IukiwD6MKabNxo',
      knownTabTitles: {
        'Educação Física': 'Educação Física- 3º Ano ',
        'Filosofia': 'Filosofia- 3º ano ',
        'Inglês': 'Inglês- 3º Ano ',
        'Português': 'Português- 3º Ano ',
        'Ciências': 'Ciências- 3º Ano ',
        'Matemática': 'Matemática- 3º ano ',
        'Geografia': 'Geografia- 3º ano ',
        'Artes': 'Arte- 3º Ano ',
        'História': 'História - 3º ano ',
      },
    },
    4: { fileId: '1OpDvU2RcmlOXLhM_clZBcDxTrv1H8lpBzmSpOe3uHGc' },
    5: { fileId: '1F4SRwMqVJd24-nc-KyTXI_dqMs1sIKA_BlIgHf-IrHg' },
  },
  'anos-finais': {
    6: { fileId: '1WwgvvjENMftX6YSRvJtan6kmONXWdzk6OxQ-gEyhkOQ' },
    7: { fileId: '16n_1w_UTavzecSiIXJnZJOBV9qhsd8EDZdotl_mBsOk' },
    8: { fileId: '1CAkM7FLj6_isqR7oKcAvVjFJENiCmHofvkHPG4Ac5ck' },
    9: { fileId: '1ModlIFPXBHFZZwnRj79-qBUav0PPhwA7Nt-KRvJmbrk' },
  },
  'ensino-medio': {
    1: {
      fileId: '1nUWSoyPRpHtsFFLUoAXR86oSVzGljRE-_poWPnekhas',
      knownTabTitles: { 'Língua Portuguesa': 'Língua Portuguesa' },
    },
    2: {
      fileId: '116b01sufK0meF-kDcQMYXLQqqYwFabOTqi9GYrSzqCg',
      knownTabTitles: { 'Língua Portuguesa': 'Língua Portuguesa' },
    },
    3: {
      fileId: '1iEO06pq1vRVl5YT5ZUfNv4RhKvhu1hFbncdrf6QSPrY',
      // "Controle Anuário 3º Médio" — organizada por frente/tópico dentro
      // de cada disciplina, não uma aba por disciplina (confirmado
      // 15/07/2026). Filosofia/Sociologia/Artes não têm aba identificável
      // nessa planilha — ficam de fora até a escola confirmar os nomes
      // reais (ou complementar a planilha), então caem no fuzzy-match
      // (que vai falhar com erro claro listando as abas reais, não
      // inventa uma correspondência).
      knownTabTitles: {
        // Título padronizado pela coordenação nas três planilhas do Médio.
        // Mantemos explícito para não depender de fuzzy-match e garantir a
        // mesma resolução para qualquer docente.
        'Língua Portuguesa': 'Língua Portuguesa',
        'Matemática': ['Matemática - Frente Algebra', 'Aprova Matemática - Geometria ', 'Aprova Matemática - Trigonometr'],
        'Física': ['Aprova Fisica Frente a Mecanica', 'Aprova Fisica - Eletromagnetism', 'Fisica - Ondulostia'],
        'Química': ['Quimica Frente a Matéria', 'Aprova Quimica - Moleculas', 'Aprova Quimica - Grandezas'],
        'Biologia': ['Aprova Bio - Seres Vivos', 'Aprova Bio - Ecologia', 'Citologia'],
        'História': ['Aprova - História', 'Aprova Historia - Frente a Hist'],
        'Geografia': ['Geografia', 'Aprova Geopolitica'],
        'Inglês': ['Aprova Lingua Inglesa'],
        'Literatura': ['Aprova Leitura', 'Aprova Lingua Portuguesa', 'Aprova Literatura 1'],
      },
    },
  },
}

// Generic abbreviation hints for the fuzzy-matching fallback, used only when
// there's no `knownTabTitles` entry and no curriculum_tab_override. Matched
// against normalized (lowercased, accent-stripped) tab titles as substrings.
export const DISCIPLINE_ABBREVIATION_HINTS: Record<string, string[]> = {
  'Matemática': ['mat'],
  'Português': ['port'],
  'Língua Portuguesa': ['port'],
  'Ciências': ['cie'],
  'Educação Física': ['ed fisica', 'ed. fisica', 'edfisica'],
  'História': ['hist'],
  'Geografia': ['geo'],
  'Filosofia': ['filo'],
  'Inglês': ['ing'],
  'Artes': ['arte'],
  // 'soc'/'fis'/'qui' confirmed against real tab names (e.g. "1°M Soc
  // Gabriel", "1° Fís Vitoria", "1° Qui") — the fuller abbreviations these
  // replaced ('socio'/'fisica'/'quim') never matched those real tabs.
  'Sociologia': ['soc'],
  'Física': ['fis'],
  'Química': ['qui'],
  'Biologia': ['bio'],
  'Literatura': ['lit'],
}

export class SheetNotConfiguredError extends Error {
  constructor(segment: Segment, gradeYear: number) {
    super(`Planilha de currículo ainda não configurada para ${gradeYear}º ano (${segment}). Peça à coordenação o link da planilha para liberar essa série.`)
    this.name = 'SheetNotConfiguredError'
  }
}

export function getGradeSheetConfig(segment: Segment, gradeYear: number): GradeSheetConfig {
  const config = SEGMENT_GRADE_SHEETS[segment]?.[gradeYear]
  if (!config) {
    throw new SheetNotConfiguredError(segment, gradeYear)
  }
  return config
}
