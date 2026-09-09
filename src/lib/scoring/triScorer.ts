import { TRI_MIN_CALIBRATED_COVERAGE, type TriEstimate } from './scoringPolicy'

// Estimador TRI (spec seção 1.4): modelo logístico de 3 parâmetros (3PL)
// com estimação de proficiência por EAP (Expected A Posteriori) — prior
// N(0,1), quadratura em grade. Implementação própria (~40 linhas de
// cálculo), sem dependência nova.
//
// Regra de honestidade: só entram itens com calibração OFICIAL (INEP ou
// SAE), sempre na métrica N(0,1) — a normalização de escala acontece na
// importação (scripts/import-tri-params.ts), nunca aqui. Item sem
// parâmetro fica fora; cobertura baixa vira `approximate`; zero itens
// calibrados = sem TRI (o chamador cai pro percentual com aviso).

export type TriItem = {
  a: number // discriminação (> 0)
  b: number // dificuldade, métrica N(0,1)
  c: number // acerto casual (0..1)
  correct: boolean
}

// Constante de escala da ogiva logística — aproximação da ogiva normal,
// convenção usada pelo INEP no 3PL.
const D = 1.7

export function probability3pl(theta: number, item: Pick<TriItem, 'a' | 'b' | 'c'>): number {
  return item.c + (1 - item.c) / (1 + Math.exp(-D * item.a * (theta - item.b)))
}

export function estimateThetaEap(
  items: TriItem[],
  options: { points?: number; range?: number } = {},
): { theta: number; sem: number } {
  const points = options.points ?? 61
  const range = options.range ?? 4

  // log-verossimilhança + log-prior em cada ponto da grade; subtrai o
  // máximo antes do exp pra não estourar float com muitos itens.
  const thetas: number[] = []
  const logWeights: number[] = []
  for (let i = 0; i < points; i++) {
    const theta = -range + (2 * range * i) / (points - 1)
    let logL = 0
    for (const item of items) {
      // Clamp evita log(0) com c=0 e theta extremo.
      const p = Math.min(1 - 1e-9, Math.max(1e-9, probability3pl(theta, item)))
      logL += item.correct ? Math.log(p) : Math.log(1 - p)
    }
    thetas.push(theta)
    logWeights.push(logL - (theta * theta) / 2)
  }

  const maxLog = Math.max(...logWeights)
  const weights = logWeights.map((lw) => Math.exp(lw - maxLog))
  const totalWeight = weights.reduce((acc, w) => acc + w, 0)

  const theta = thetas.reduce((acc, t, i) => acc + t * weights[i], 0) / totalWeight
  const variance = thetas.reduce((acc, t, i) => acc + (t - theta) ** 2 * weights[i], 0) / totalWeight

  return { theta, sem: Math.sqrt(variance) }
}

export function thetaToEnemScale(theta: number): number {
  return Math.min(1000, Math.max(0, Math.round(500 + 100 * theta)))
}

/**
 * Estimativa TRI de uma prova: `items` são os itens objetivos COM
 * calibração oficial (já filtrados), `objectiveTotal` é o total de itens
 * objetivos da prova. Retorna null com zero itens calibrados — TRI não
 * existe nesse caso, não é "score zero".
 */
export function buildTriEstimate(items: TriItem[], objectiveTotal: number): TriEstimate | null {
  if (items.length === 0) return null

  const { theta, sem } = estimateThetaEap(items)
  return {
    score: thetaToEnemScale(theta),
    theta: Math.round(theta * 1000) / 1000,
    sem: Math.round(sem * 1000) / 1000,
    itemsUsed: items.length,
    itemsTotal: objectiveTotal,
    approximate: objectiveTotal > 0 && items.length / objectiveTotal < TRI_MIN_CALIBRATED_COVERAGE,
  }
}
