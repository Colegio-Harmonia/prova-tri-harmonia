import type { BloomLevel } from './bloomVerbs'

// Verbatim from gerador-de-prova/segments/fundamental-1/config.json — the
// only segment with a concrete numeric Bloom distribution on record. For
// anos-finais/ensino-medio the CLAUDE.md files only give qualitative
// guidance (e.g. "9º ano precisa de 2-3 questões Analisar/Avaliar"), so
// promptBuilder injects that qualitative text directly instead of inventing
// percentages the source documents never specified.
export const ANOS_INICIAIS_BLOOM_DISTRIBUTION: Record<number, Record<BloomLevel, number>> = {
  2: { lembrar: 25, compreender: 35, aplicar: 25, analisar: 10, avaliar: 3, criar: 2 },
  3: { lembrar: 20, compreender: 35, aplicar: 25, analisar: 12, avaliar: 5, criar: 3 },
  4: { lembrar: 15, compreender: 30, aplicar: 30, analisar: 15, avaliar: 5, criar: 5 },
  5: { lembrar: 10, compreender: 25, aplicar: 30, analisar: 20, avaliar: 10, criar: 5 },
}
