import type { ColumnRoles } from '@/types/exam'

// Synonym table from the root CLAUDE.md — column role resolved by header
// text, never by position (confirmed real sheets vary column order).
const SYNONYMS = {
  // 'título'/'titulo' sozinho confirmado na planilha do 3º ano EM
  // (Controle Anuário 3º Médio) — só "Título", sem "do capítulo".
  tituloCapitulo: ['título do capítulo', 'capítulos', 'capitulo', 'título do capitulo', 'título', 'titulo'],
  // 'conteúdos foco' (com espaço, sem hífen) confirmado na mesma planilha.
  conteudo: ['conteúdos-foco', 'conteúdos', 'conteudos-foco', 'conteudos', 'conteúdos foco', 'conteudos foco'],
  habilidades: ['habilidades'],
  objetivos: ['objetivos'],
  bimestre: ['bimestre'],
  trimestre: ['trimestre'],
  unidade: ['unidade'],
} as const

// Insensível a acento (16/07/2026) — a lista de sinônimos acima já tinha 6
// variantes de "título/capítulo" catalogadas uma por uma (com/sem "do
// capítulo", com/sem hífen em conteúdos-foco etc.) e ainda assim uma aba
// real usava só "Capítulo" (COM acento, singular), que não batia com
// "capitulo" (sem acento) já cadastrado — toda questão saía "(sem
// título)". Removendo o acento dos dois lados da comparação (cabeçalho
// real E cada sinônimo) fecha essa classe inteira de variação, em vez de
// ficar catalogando uma variante de cada vez toda vez que aparece uma
// planilha nova.
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function findColumn(headerRow: string[], synonyms: readonly string[]): number | null {
  const normalizedSynonyms = synonyms.map(normalizeHeader)
  for (let i = 0; i < headerRow.length; i++) {
    const normalized = normalizeHeader(headerRow[i] ?? '')
    if (normalizedSynonyms.includes(normalized)) return i
  }
  return null
}

export function resolveColumnRoles(headerRow: string[]): ColumnRoles {
  return {
    tituloCapituloIdx: findColumn(headerRow, SYNONYMS.tituloCapitulo),
    conteudoIdx: findColumn(headerRow, SYNONYMS.conteudo),
    habilidadesIdx: findColumn(headerRow, SYNONYMS.habilidades),
    objetivosIdx: findColumn(headerRow, SYNONYMS.objetivos),
    bimestreIdx: findColumn(headerRow, SYNONYMS.bimestre),
    trimestreIdx: findColumn(headerRow, SYNONYMS.trimestre),
    unidadeIdx: findColumn(headerRow, SYNONYMS.unidade),
  }
}
