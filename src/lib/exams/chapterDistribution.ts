/**
 * Distribuição de questões por capítulo. O professor define livremente o
 * número de questões de cada capítulo (o total pode ficar acima ou abaixo do
 * esperado durante a edição). O equilíbrio nunca é automático: só acontece
 * quando ele aciona a ação "Equilibrar".
 */

export function evenQuestionCounts(rowIndexes: number[], total: number): Record<number, number> {
  const counts: Record<number, number> = {}
  if (rowIndexes.length === 0) return counts
  rowIndexes.forEach((rowIndex, index) => {
    counts[rowIndex] = Math.floor(total / rowIndexes.length) + (index < total % rowIndexes.length ? 1 : 0)
  })
  return counts
}
