import type { Segment } from '@/types/exam'

export const SEGMENT_LABELS: Record<Segment, string> = {
  'anos-iniciais': 'Anos Iniciais (2º-5º ano)',
  'anos-finais': 'Anos Finais (6º-9º ano)',
  'ensino-medio': 'Ensino Médio (1º-3º ano)',
}

export const SEGMENT_GRADES: Record<Segment, number[]> = {
  'anos-iniciais': [2, 3, 4, 5],
  'anos-finais': [6, 7, 8, 9],
  // 3º ano liberado na UI mesmo sem planilha ainda configurada (ver
  // config/gradeSheets.ts SheetNotConfiguredError) — a coordenação vê a
  // opção e recebe um aviso claro em vez de um erro genérico.
  'ensino-medio': [1, 2, 3],
}

// Confirmed against real tab names across all 10 spreadsheets (not just the
// CLAUDE.md's own list, which undercounted anos-finais Filosofia and missed
// Literatura entirely as a separate EM subject from Língua Portuguesa).
export const SEGMENT_SUBJECTS: Record<Segment, string[]> = {
  'anos-iniciais': ['Língua Portuguesa', 'Português', 'Matemática', 'Ciências', 'História', 'Geografia', 'Inglês', 'Artes', 'Educação Física', 'Filosofia'],
  'anos-finais': ['Português', 'Matemática', 'História', 'Geografia', 'Inglês', 'Ciências', 'Artes', 'Educação Física', 'Filosofia'],
  'ensino-medio': ['Língua Portuguesa', 'Literatura', 'Matemática', 'Física', 'Química', 'Biologia', 'História', 'Geografia', 'Filosofia', 'Sociologia', 'Inglês', 'Artes'],
}
