/**
 * Bimestre letivo corrente a partir do calendário do Colégio Harmonia:
 * 1º (fev-abr), 2º (mai-jul), 3º (ago-set) e 4º (out-dez). Janeiro é tratado
 * como início do 1º bimestre. Usado para a tela de geração já sugerir o
 * bimestre em que a avaliação está sendo criada.
 */
export function currentBimester(date: Date = new Date()): number {
  const month = date.getMonth() + 1
  if (month <= 4) return 1
  if (month <= 7) return 2
  if (month <= 9) return 3
  return 4
}
