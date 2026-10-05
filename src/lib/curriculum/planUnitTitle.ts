import type { CurricularUnit } from '@/types/exam'

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

/**
 * Título da unidade do planejamento. Abas como a de Inglês trazem a unidade
 * ("7. Necessity is the mother of invention") separada do capítulo ("1. A great
 * inventor"); sem a unidade, capítulos numerados de unidades diferentes ficam
 * indistinguíveis. O título do capítulo na planilha não muda, para não quebrar o
 * cruzamento com o conteúdo enriquecido na geração por planilha.
 */
export function composePlanUnitTitle(unit: Pick<CurricularUnit, 'tituloCapitulo' | 'unidade'>, fallback: string): string {
  const chapter = squash(unit.tituloCapitulo)
  const group = squash(unit.unidade)
  if (!group) return chapter || fallback
  if (!chapter) return group
  if (group.toLowerCase() === chapter.toLowerCase()) return chapter
  return `${group} — ${chapter}`
}
