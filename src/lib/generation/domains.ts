/**
 * Motor de domínios canônicos para `truthStrategy = calculavel`.
 *
 * Cada domínio é um recalculador determinístico: recebe apenas os valores de
 * entrada (nunca o resultado, nunca a prosa), produz a resposta correta por
 * código e sugere distratores de erro típico. Isto substitui a classe de bug
 * documentada na prova 331, em que o modelo inventava um resultado que não
 * fechava com os próprios dados (recorrência em `other`, circunferência com
 * dois pontos de interseção apesar de d > r1 + r2, esfera, etc.).
 *
 * Regra estrutural: NENHUM domínio pode cair em `other` sem recalculador. O
 * Gate 0 consulta `hasCanonicalDomain`; o que não tem recalculador não pode
 * ser selecionado.
 */
import { NUMBER_TOKEN, parseNumberToken } from './similarity'

export const CANONICAL_DOMAIN_IDS = [
  'linear_system',
  'percentage',
  'ratio_proportion',
  'simple_interest',
  'compound_interest',
  'arithmetic_progression',
  'geometric_progression',
  'linear_recurrence',
  'linear_recurrence_order2',
  'linear_function',
  'quadratic_function',
  'point_distance',
  'circle_relative_position',
  'sphere_point_position',
  'rectangular_prism_volume',
  'average_speed',
  // Física (fase 3)
  'kinematics_uniform',
  'kinematics_accelerated',
  'newton_second_law',
  'weight_force',
  'kinetic_energy',
  'ohms_law',
  'electric_power',
  'density',
  // Química (fase 3)
  'mole_calculation',
  'molar_concentration',
  'solution_dilution',
] as const

export type CanonicalDomainId = (typeof CANONICAL_DOMAIN_IDS)[number]

export type DomainAnswer = {
  /** Resposta numérica canônica (para classificação usamos um código: 0/1/2 interseções, -1/0/1 posição). */
  numeric: number
  /** Texto exibível, em pt-BR, com unidade quando houver. */
  display: string
  /** Forma curta para uma alternativa objetiva; nunca inclui a resolução. */
  choiceDisplay?: string
  unit?: string
  /** Para respostas categóricas (ex.: posição relativa de circunferências). */
  category?: string
}

export type DomainComputation = {
  answer: DomainAnswer
  /** Derivação passo a passo, para a ficha técnica e para o Gabarito. */
  derivation: string
  /** Valores errados típicos (erro de cálculo/conceito), como texto exibível. */
  distractorHints: string[]
}

export type CanonicalDomain = {
  id: CanonicalDomainId
  title: string
  /** Disciplinas normalizadas em que o domínio pode ser usado. */
  subjects: string[]
  /** Campos numéricos de entrada obrigatórios. */
  fields: string[]
  /** Descrição curta das entradas, para o prompt do Estágio 1. */
  inputDescription: string
  compute: (values: Record<string, number>) => DomainComputation
}

export function normalizeSubject(subject: string): string {
  return subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(6))
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
}

function req(values: Record<string, number>, keys: string[]): void {
  for (const key of keys) {
    if (!Number.isFinite(values[key])) throw new Error(`Valor de entrada ausente ou inválido: ${key}.`)
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

function numericHints(correct: number, candidates: number[], unit?: string): string[] {
  return uniq(
    candidates
      .filter((value) => Number.isFinite(value) && Math.abs(value - correct) > 1e-9)
      .map((value) => (unit ? `${formatNumber(value)} ${unit}` : formatNumber(value))),
  )
}

const DOMAINS: Record<CanonicalDomainId, CanonicalDomain> = {
  linear_system: {
    id: 'linear_system',
    title: 'Sistema linear de duas variáveis',
    subjects: ['matematica'],
    fields: ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'],
    inputDescription: 'Coeficientes de a1x+b1y=c1 e a2x+b2y=c2. Nunca envie x ou y.',
    compute(values) {
      req(values, this.fields)
      const { a1, b1, c1, a2, b2, c2 } = values
      const det = a1 * b2 - b1 * a2
      if (Math.abs(det) < 1e-9) throw new Error('O sistema não tem solução única (determinante nulo).')
      const x = (c1 * b2 - b1 * c2) / det
      const y = (a1 * c2 - c1 * a2) / det
      const display = `x = ${formatNumber(x)} e y = ${formatNumber(y)}`
      return {
        answer: { numeric: x, display, choiceDisplay: `(${formatNumber(x)}; ${formatNumber(y)})` },
        derivation: `det = ${formatNumber(a1)}·${formatNumber(b2)} − ${formatNumber(b1)}·${formatNumber(a2)} = ${formatNumber(det)}; x = ${formatNumber(x)}; y = ${formatNumber(y)}.`,
        distractorHints: uniq([`x = ${formatNumber(y)} e y = ${formatNumber(x)}`, `x = ${formatNumber(-x)} e y = ${formatNumber(-y)}`, `x = ${formatNumber(x)} e y = ${formatNumber(-y)}`]),
      }
    },
  },
  percentage: {
    id: 'percentage',
    title: 'Porcentagem',
    subjects: ['matematica', 'geografia'],
    fields: ['base', 'percent'],
    inputDescription: 'base (valor total) e percent (taxa em %). O resultado percent×base deve ser calculado por código.',
    compute(values) {
      req(values, this.fields)
      const result = (values.base * values.percent) / 100
      return {
        answer: { numeric: result, display: formatNumber(result) },
        derivation: `${formatNumber(values.percent)}% de ${formatNumber(values.base)} = ${formatNumber(values.base)} × ${formatNumber(values.percent)} ÷ 100 = ${formatNumber(result)}.`,
        distractorHints: numericHints(result, [values.base * values.percent, (values.base * (100 - values.percent)) / 100, values.base - result]),
      }
    },
  },
  ratio_proportion: {
    id: 'ratio_proportion',
    title: 'Razão, proporção e regra de três',
    subjects: ['matematica'],
    fields: ['a', 'b', 'c'],
    inputDescription: 'Grandezas diretas: se a corresponde a b, então c corresponde ao valor x. Envie a, b e c (nunca x).',
    compute(values) {
      req(values, this.fields)
      if (values.a === 0) throw new Error('A grandeza de referência (a) não pode ser zero.')
      const x = (values.b * values.c) / values.a
      return {
        answer: { numeric: x, display: formatNumber(x) },
        derivation: `a/b = c/x ⇒ x = b·c/a = ${formatNumber(values.b)} × ${formatNumber(values.c)} ÷ ${formatNumber(values.a)} = ${formatNumber(x)}.`,
        distractorHints: numericHints(x, [(values.a * values.c) / values.b, (values.a * values.b) / values.c, values.b + values.c - values.a]),
      }
    },
  },
  simple_interest: {
    id: 'simple_interest',
    title: 'Juros simples',
    subjects: ['matematica'],
    fields: ['principal', 'rate', 'time'],
    inputDescription: 'principal (R$), rate (taxa % ao período) e time (número de períodos).',
    compute(values) {
      req(values, this.fields)
      const interest = (values.principal * values.rate * values.time) / 100
      const total = values.principal + interest
      return {
        answer: { numeric: interest, display: `R${formatNumber(interest)}` },
        derivation: `J = C·i·t = ${formatNumber(values.principal)} × ${formatNumber(values.rate)}% × ${formatNumber(values.time)} = ${formatNumber(interest)}; montante = ${formatNumber(total)}.`,
        distractorHints: numericHints(interest, [values.principal * values.rate * values.time, total - interest * 2, values.principal * values.rate * values.time / 100 + values.principal * 0.1]),
      }
    },
  },
  compound_interest: {
    id: 'compound_interest',
    title: 'Juros compostos',
    subjects: ['matematica'],
    fields: ['principal', 'rate', 'time'],
    inputDescription: 'principal (R$), rate (taxa % ao período) e time (número de períodos).',
    compute(values) {
      req(values, this.fields)
      const total = values.principal * Math.pow(1 + values.rate / 100, values.time)
      const interest = total - values.principal
      const simple = (values.principal * values.rate * values.time) / 100
      return {
        answer: { numeric: total, display: `R${formatNumber(Number(total.toFixed(2)))}` },
        derivation: `M = C·(1+i)^t = ${formatNumber(values.principal)} × (1 + ${formatNumber(values.rate)}/100)^${formatNumber(values.time)} = ${formatNumber(Number(total.toFixed(2)))}; juros = ${formatNumber(Number(interest.toFixed(2)))}.`,
        distractorHints: numericHints(Number(total.toFixed(2)), [values.principal + simple, values.principal + interest, values.principal * Math.pow(1 + values.rate / 100, values.time + 1)]),
      }
    },
  },
  arithmetic_progression: {
    id: 'arithmetic_progression',
    title: 'Progressão aritmética',
    subjects: ['matematica'],
    fields: ['a1', 'd', 'n'],
    inputDescription: 'a1 (primeiro termo), d (razão) e n (posição do termo pedido).',
    compute(values) {
      req(values, this.fields)
      const an = values.a1 + (values.n - 1) * values.d
      const sum = (values.n * (values.a1 + an)) / 2
      return {
        answer: { numeric: an, display: `a${formatNumber(values.n)} = ${formatNumber(an)}`, choiceDisplay: formatNumber(an) },
        derivation: `a_n = a1 + (n−1)d = ${formatNumber(values.a1)} + (${formatNumber(values.n)}−1)·${formatNumber(values.d)} = ${formatNumber(an)}; soma dos ${formatNumber(values.n)} primeiros termos = ${formatNumber(sum)}.`,
        distractorHints: numericHints(an, [values.a1 + values.n * values.d, values.a1 + (values.n + 1) * values.d, values.a1 * values.d * values.n]),
      }
    },
  },
  geometric_progression: {
    id: 'geometric_progression',
    title: 'Progressão geométrica',
    subjects: ['matematica'],
    fields: ['a1', 'q', 'n'],
    inputDescription: 'a1 (primeiro termo), q (razão) e n (posição do termo pedido).',
    compute(values) {
      req(values, this.fields)
      const an = values.a1 * Math.pow(values.q, values.n - 1)
      return {
        answer: { numeric: an, display: `a${formatNumber(values.n)} = ${formatNumber(an)}`, choiceDisplay: formatNumber(an) },
        derivation: `a_n = a1·q^(n−1) = ${formatNumber(values.a1)}·${formatNumber(values.q)}^${formatNumber(values.n - 1)} = ${formatNumber(an)}.`,
        distractorHints: numericHints(an, [values.a1 * Math.pow(values.q, values.n), values.a1 * values.q * values.n, values.a1 + values.n * values.q]),
      }
    },
  },
  linear_recurrence: {
    id: 'linear_recurrence',
    title: 'Recorrência linear de 1ª ordem',
    subjects: ['matematica'],
    fields: ['a0', 'a', 'b', 'n'],
    inputDescription: 'Sequência dada por x0 = a0 e x_{k+1} = a·x_k + b. Envie a0, a, b e n (posição pedida). Nunca envie o resultado.',
    compute(values) {
      req(values, this.fields)
      if (!Number.isInteger(values.n) || values.n < 0) throw new Error('n precisa ser um inteiro não negativo.')
      let current = values.a0
      const steps = [`x0 = ${formatNumber(current)}`]
      for (let k = 1; k <= values.n; k++) {
        current = values.a * current + values.b
        if (k <= 6 || k === values.n) steps.push(`x${k} = ${formatNumber(values.a)}·x${k - 1} + ${formatNumber(values.b)} = ${formatNumber(current)}`)
      }
      return {
        answer: { numeric: current, display: `x${formatNumber(values.n)} = ${formatNumber(current)}`, choiceDisplay: formatNumber(current) },
        derivation: steps.join('; ') + '.',
        distractorHints: uniq([
          `${formatNumber(values.a * current + values.b)} (avançou um passo além)`,
          `${formatNumber(values.a0 + values.n * values.b)} (tratou como progressão aritmética)`,
          `${formatNumber(values.a * values.a0 + values.b)} (parou no primeiro passo)`,
        ]),
      }
    },
  },
  linear_recurrence_order2: {
    id: 'linear_recurrence_order2',
    title: 'Recorrência linear de 2ª ordem',
    subjects: ['matematica'],
    fields: ['firstTerm', 'secondTerm', 'previousCoefficient', 'currentCoefficient', 'termIndex'],
    inputDescription: 'Sequência dada por u1 = firstTerm, u2 = secondTerm e u_n = previousCoefficient·u_(n-2) + currentCoefficient·u_(n-1). Envie os dois termos iniciais, os coeficientes e termIndex (n ≥ 3). Nunca envie o resultado.',
    compute(values) {
      req(values, this.fields)
      const n = values.termIndex
      if (!Number.isInteger(n) || n < 3 || n > 60) throw new Error('termIndex precisa ser inteiro entre 3 e 60.')
      let previous = values.firstTerm
      let current = values.secondTerm
      const steps = [`u1 = ${formatNumber(previous)}; u2 = ${formatNumber(current)}`]
      for (let index = 3; index <= n; index++) {
        const next = values.previousCoefficient * previous + values.currentCoefficient * current
        previous = current
        current = next
      }
      const display = `u${formatNumber(n)} = ${formatNumber(Number(current.toFixed(6)))}`
      return {
        answer: { numeric: current, display, choiceDisplay: formatNumber(Number(current.toFixed(6))) },
        derivation: `${steps[0]}; u_n = ${formatNumber(values.previousCoefficient)}·u_(n-2) + ${formatNumber(values.currentCoefficient)}·u_(n-1) ⇒ ${display}.`,
        distractorHints: uniq([
          `${formatNumber(values.currentCoefficient * current + values.previousCoefficient * previous)} (avançou um passo além)`,
          `${formatNumber(values.currentCoefficient * values.secondTerm + values.previousCoefficient * values.firstTerm)} (parou cedo)`,
          `${formatNumber(values.firstTerm + values.secondTerm + (n - 2) * values.currentCoefficient)} (tratou como progressão aritmética)`,
        ]),
      }
    },
  },
  linear_function: {
    id: 'linear_function',
    title: 'Função afim',
    subjects: ['matematica'],
    fields: ['a', 'b', 'x'],
    inputDescription: 'f(x) = a·x + b. Envie a, b e x; nunca envie f(x).',
    compute(values) {
      req(values, this.fields)
      const y = values.a * values.x + values.b
      return {
        answer: { numeric: y, display: `f(${formatNumber(values.x)}) = ${formatNumber(y)}`, choiceDisplay: formatNumber(y) },
        derivation: `f(${formatNumber(values.x)}) = ${formatNumber(values.a)}·${formatNumber(values.x)} + ${formatNumber(values.b)} = ${formatNumber(y)}.`,
        distractorHints: numericHints(y, [values.a * values.x - values.b, (values.a + values.b) * values.x, values.a + values.b * values.x]),
      }
    },
  },
  quadratic_function: {
    id: 'quadratic_function',
    title: 'Função quadrática',
    subjects: ['matematica'],
    fields: ['a', 'b', 'c', 'x'],
    inputDescription: 'f(x) = a·x² + b·x + c. Envie a, b, c e x; nunca envie f(x).',
    compute(values) {
      req(values, this.fields)
      if (values.a === 0) throw new Error('Em uma função quadrática, a ≠ 0.')
      const y = values.a * values.x * values.x + values.b * values.x + values.c
      const delta = values.b * values.b - 4 * values.a * values.c
      return {
        answer: { numeric: y, display: `f(${formatNumber(values.x)}) = ${formatNumber(y)}`, choiceDisplay: formatNumber(y) },
        derivation: `f(${formatNumber(values.x)}) = ${formatNumber(values.a)}·(${formatNumber(values.x)})² + ${formatNumber(values.b)}·${formatNumber(values.x)} + ${formatNumber(values.c)} = ${formatNumber(y)}; Δ = ${formatNumber(delta)}.`,
        distractorHints: numericHints(y, [values.a * values.x * values.x - values.b * values.x + values.c, values.a * values.x + values.b * values.x + values.c, delta]),
      }
    },
  },
  point_distance: {
    id: 'point_distance',
    title: 'Distância entre dois pontos',
    subjects: ['matematica'],
    fields: ['x1', 'y1', 'x2', 'y2'],
    inputDescription: 'Coordenadas dos pontos A(x1,y1) e B(x2,y2). Nunca envie a distância.',
    compute(values) {
      req(values, this.fields)
      const dx = values.x2 - values.x1
      const dy = values.y2 - values.y1
      const distance = Math.sqrt(dx * dx + dy * dy)
      return {
        answer: { numeric: distance, display: formatNumber(Number(distance.toFixed(6))) },
        derivation: `d = √((${formatNumber(dx)})² + (${formatNumber(dy)})²) = √${formatNumber(dx * dx + dy * dy)} = ${formatNumber(Number(distance.toFixed(6)))}.`,
        distractorHints: numericHints(Number(distance.toFixed(6)), [Math.abs(dx) + Math.abs(dy), dx * dx + dy * dy, Math.sqrt(Math.abs(dx) + Math.abs(dy))]),
      }
    },
  },
  circle_relative_position: {
    id: 'circle_relative_position',
    title: 'Posição relativa entre circunferências',
    subjects: ['matematica'],
    fields: ['r1', 'r2', 'distance'],
    inputDescription: 'r1 e r2 (raios) e distance (distância entre os centros). Nunca informe o número de interseções.',
    compute(values) {
      req(values, this.fields)
      const { r1, r2, distance } = values
      const sum = r1 + r2
      const diff = Math.abs(r1 - r2)
      let intersections: number
      let label: string
      let category: string
      if (Math.abs(distance - sum) < 1e-9) { intersections = 1; label = 'tangentes externas (1 ponto)'; category = 'tangente' }
      else if (Math.abs(distance - diff) < 1e-9) { intersections = 1; label = 'tangentes internas (1 ponto)'; category = 'tangente' }
      else if (distance > sum) { intersections = 0; label = 'externas (nenhum ponto)'; category = 'externa' }
      else if (distance < diff) { intersections = 0; label = 'uma interna à outra (nenhum ponto)'; category = 'interna' }
      else { intersections = 2; label = 'secantes (2 pontos)'; category = 'secante' }
      return {
        answer: { numeric: intersections, display: `${label} — ${intersections} ponto(s) de interseção`, category },
        derivation: `r1 + r2 = ${formatNumber(sum)}; |r1 − r2| = ${formatNumber(diff)}; d = ${formatNumber(distance)} ⇒ ${label}.`,
        // Categorias curtas e distintas, nunca a correta — para o modelo não
        // copiar texto explicativo longo como alternativa.
        distractorHints: ['externa', 'tangente', 'secante', 'interna'].filter((item) => item !== category),
      }
    },
  },
  sphere_point_position: {
    id: 'sphere_point_position',
    title: 'Posição de ponto em relação a uma esfera',
    subjects: ['matematica'],
    fields: ['radius', 'distance'],
    inputDescription: 'radius (raio da esfera) e distance (distância do centro ao ponto). Nunca informe a posição.',
    compute(values) {
      req(values, this.fields)
      const { radius, distance } = values
      const code = Math.abs(distance - radius) < 1e-9 ? 0 : distance < radius ? -1 : 1
      const label = code === 0 ? 'sobre a superfície' : code < 0 ? 'interno à esfera' : 'externo à esfera'
      const category = code === 0 ? 'sobre' : code < 0 ? 'interno' : 'externo'
      return {
        answer: { numeric: code, display: label, category },
        derivation: `d = ${formatNumber(distance)}; r = ${formatNumber(radius)} ⇒ d ${code < 0 ? '<' : code === 0 ? '=' : '>'} r ⇒ ${label}.`,
        distractorHints: ['interno', 'sobre a superfície', 'externo'].filter((item) => item !== category),
      }
    },
  },
  rectangular_prism_volume: {
    id: 'rectangular_prism_volume',
    title: 'Volume de prisma retangular',
    subjects: ['matematica'],
    fields: ['length', 'width', 'height'],
    inputDescription: 'length, width, height na mesma unidade. unitFactor converte o volume para a unidade final (ex.: 1000 para m³→litros).',
    compute(values) {
      req(values, this.fields)
      const factor = Number.isFinite(values.unitFactor) ? values.unitFactor : 1
      const volume = values.length * values.width * values.height * factor
      return {
        answer: { numeric: volume, display: formatNumber(volume) },
        derivation: `V = ${formatNumber(values.length)} × ${formatNumber(values.width)} × ${formatNumber(values.height)} × ${formatNumber(factor)} = ${formatNumber(volume)}.`,
        distractorHints: numericHints(volume, [values.length + values.width + values.height, values.length * values.width * values.height, values.length * values.width * values.height * factor * 1000]),
      }
    },
  },
  average_speed: {
    id: 'average_speed',
    title: 'Velocidade média',
    subjects: ['matematica', 'fisica'],
    fields: ['distance', 'time'],
    inputDescription: 'distance (distância percorrida) e time (tempo gasto, > 0). Nunca envie a velocidade.',
    compute(values) {
      req(values, this.fields)
      if (values.time === 0) throw new Error('O tempo não pode ser zero.')
      const speed = values.distance / values.time
      return {
        answer: { numeric: speed, display: `${formatNumber(Number(speed.toFixed(6)))} km/h` },
        derivation: `v = d / t = ${formatNumber(values.distance)} km ÷ ${formatNumber(values.time)} h = ${formatNumber(Number(speed.toFixed(6)))} km/h.`,
        distractorHints: numericHints(Number(speed.toFixed(6)), [values.distance * values.time, values.time / values.distance, values.distance - values.time]),
      }
    },
  },
  // ---- Física (fase 3) ----
  kinematics_uniform: {
    id: 'kinematics_uniform',
    title: 'Cinemática — movimento uniforme',
    subjects: ['fisica'],
    fields: ['velocity', 'time'],
    inputDescription: 'velocity (m/s) e time (s). Calcula a distância percorrida (d = v·t).',
    compute(values) {
      req(values, this.fields)
      const distance = values.velocity * values.time
      return {
        answer: { numeric: distance, display: `${formatNumber(Number(distance.toFixed(6)))} m` },
        derivation: `d = v·t = ${formatNumber(values.velocity)} × ${formatNumber(values.time)} = ${formatNumber(Number(distance.toFixed(6)))} m.`,
        distractorHints: numericHints(Number(distance.toFixed(6)), [values.velocity / values.time, values.velocity + values.time, values.velocity * values.time / 2]),
      }
    },
  },
  kinematics_accelerated: {
    id: 'kinematics_accelerated',
    title: 'Cinemática — movimento uniformemente variado',
    subjects: ['fisica'],
    fields: ['initialVelocity', 'acceleration', 'time'],
    inputDescription: 'initialVelocity (m/s), acceleration (m/s²) e time (s). Calcula a velocidade final (v = v₀ + a·t).',
    compute(values) {
      req(values, this.fields)
      const finalVelocity = values.initialVelocity + values.acceleration * values.time
      const distance = values.initialVelocity * values.time + (values.acceleration * values.time * values.time) / 2
      return {
        answer: { numeric: finalVelocity, display: `${formatNumber(Number(finalVelocity.toFixed(6)))} m/s` },
        derivation: `v = v₀ + a·t = ${formatNumber(values.initialVelocity)} + ${formatNumber(values.acceleration)}·${formatNumber(values.time)} = ${formatNumber(Number(finalVelocity.toFixed(6)))} m/s; distância = ${formatNumber(Number(distance.toFixed(6)))} m.`,
        distractorHints: numericHints(Number(finalVelocity.toFixed(6)), [values.initialVelocity - values.acceleration * values.time, values.initialVelocity + values.acceleration, distance]),
      }
    },
  },
  newton_second_law: {
    id: 'newton_second_law',
    title: 'Segunda lei de Newton',
    subjects: ['fisica'],
    fields: ['mass', 'acceleration'],
    inputDescription: 'mass (kg) e acceleration (m/s²). Calcula a força resultante (F = m·a) em newtons.',
    compute(values) {
      req(values, this.fields)
      const force = values.mass * values.acceleration
      return {
        answer: { numeric: force, display: `${formatNumber(Number(force.toFixed(6)))} N` },
        derivation: `F = m·a = ${formatNumber(values.mass)} × ${formatNumber(values.acceleration)} = ${formatNumber(Number(force.toFixed(6)))} N.`,
        distractorHints: numericHints(Number(force.toFixed(6)), [values.mass / values.acceleration, values.mass + values.acceleration, values.mass * values.acceleration * 10]),
      }
    },
  },
  weight_force: {
    id: 'weight_force',
    title: 'Força peso',
    subjects: ['fisica'],
    fields: ['mass', 'gravity'],
    inputDescription: 'mass (kg) e gravity (m/s²). Calcula o peso (P = m·g) em newtons.',
    compute(values) {
      req(values, this.fields)
      const weight = values.mass * values.gravity
      return {
        answer: { numeric: weight, display: `${formatNumber(Number(weight.toFixed(6)))} N` },
        derivation: `P = m·g = ${formatNumber(values.mass)} × ${formatNumber(values.gravity)} = ${formatNumber(Number(weight.toFixed(6)))} N.`,
        distractorHints: numericHints(Number(weight.toFixed(6)), [values.mass / values.gravity, values.mass + values.gravity, values.mass * values.gravity / 10]),
      }
    },
  },
  kinetic_energy: {
    id: 'kinetic_energy',
    title: 'Energia cinética',
    subjects: ['fisica'],
    fields: ['mass', 'velocity'],
    inputDescription: 'mass (kg) e velocity (m/s). Calcula a energia cinética (Ec = m·v²/2) em joules.',
    compute(values) {
      req(values, this.fields)
      const energy = (values.mass * values.velocity * values.velocity) / 2
      return {
        answer: { numeric: energy, display: `${formatNumber(Number(energy.toFixed(6)))} J` },
        derivation: `Ec = m·v²/2 = ${formatNumber(values.mass)} × (${formatNumber(values.velocity)})² ÷ 2 = ${formatNumber(Number(energy.toFixed(6)))} J.`,
        distractorHints: numericHints(Number(energy.toFixed(6)), [values.mass * values.velocity * values.velocity, values.mass * values.velocity, values.mass * values.velocity / 2]),
      }
    },
  },
  ohms_law: {
    id: 'ohms_law',
    title: 'Primeira lei de Ohm',
    subjects: ['fisica'],
    fields: ['resistance', 'current'],
    inputDescription: 'resistance (Ω) e current (A). Calcula a tensão (U = R·i) em volts.',
    compute(values) {
      req(values, this.fields)
      const voltage = values.resistance * values.current
      return {
        answer: { numeric: voltage, display: `${formatNumber(Number(voltage.toFixed(6)))} V` },
        derivation: `U = R·i = ${formatNumber(values.resistance)} × ${formatNumber(values.current)} = ${formatNumber(Number(voltage.toFixed(6)))} V.`,
        distractorHints: numericHints(Number(voltage.toFixed(6)), [values.resistance / values.current, values.resistance + values.current, values.resistance * values.current * values.current]),
      }
    },
  },
  electric_power: {
    id: 'electric_power',
    title: 'Potência elétrica',
    subjects: ['fisica'],
    fields: ['voltage', 'current'],
    inputDescription: 'voltage (V) e current (A). Calcula a potência (P = U·i) em watts.',
    compute(values) {
      req(values, this.fields)
      const power = values.voltage * values.current
      return {
        answer: { numeric: power, display: `${formatNumber(Number(power.toFixed(6)))} W` },
        derivation: `P = U·i = ${formatNumber(values.voltage)} × ${formatNumber(values.current)} = ${formatNumber(Number(power.toFixed(6)))} W.`,
        distractorHints: numericHints(Number(power.toFixed(6)), [values.voltage / values.current, values.voltage + values.current, values.voltage * values.current / 2]),
      }
    },
  },
  density: {
    id: 'density',
    title: 'Densidade',
    subjects: ['fisica', 'quimica'],
    fields: ['mass', 'volume'],
    inputDescription: 'mass (g) e volume (cm³ ou mL). Calcula a densidade (d = m/V) em g/cm³.',
    compute(values) {
      req(values, this.fields)
      if (values.volume === 0) throw new Error('O volume não pode ser zero.')
      const density = values.mass / values.volume
      return {
        answer: { numeric: density, display: `${formatNumber(Number(density.toFixed(6)))} g/cm³` },
        derivation: `d = m/V = ${formatNumber(values.mass)} ÷ ${formatNumber(values.volume)} = ${formatNumber(Number(density.toFixed(6)))} g/cm³.`,
        distractorHints: numericHints(Number(density.toFixed(6)), [values.volume / values.mass, values.mass * values.volume, values.mass - values.volume]),
      }
    },
  },
  // ---- Química (fase 3) ----
  mole_calculation: {
    id: 'mole_calculation',
    title: 'Cálculo de quantidade de matéria',
    subjects: ['quimica'],
    fields: ['mass', 'molarMass'],
    inputDescription: 'mass (g) e molarMass (g/mol). Calcula o número de mols (n = m/M).',
    compute(values) {
      req(values, this.fields)
      if (values.molarMass === 0) throw new Error('A massa molar não pode ser zero.')
      const moles = values.mass / values.molarMass
      return {
        answer: { numeric: moles, display: `${formatNumber(Number(moles.toFixed(6)))} mol` },
        derivation: `n = m/M = ${formatNumber(values.mass)} ÷ ${formatNumber(values.molarMass)} = ${formatNumber(Number(moles.toFixed(6)))} mol.`,
        distractorHints: numericHints(Number(moles.toFixed(6)), [values.molarMass / values.mass, values.mass * values.molarMass, values.mass - values.molarMass]),
      }
    },
  },
  molar_concentration: {
    id: 'molar_concentration',
    title: 'Concentração em mol/L',
    subjects: ['quimica'],
    fields: ['moles', 'volume'],
    inputDescription: 'moles (mol) e volume (L). Calcula a concentração (C = n/V) em mol/L.',
    compute(values) {
      req(values, this.fields)
      if (values.volume === 0) throw new Error('O volume não pode ser zero.')
      const concentration = values.moles / values.volume
      return {
        answer: { numeric: concentration, display: `${formatNumber(Number(concentration.toFixed(6)))} mol/L` },
        derivation: `C = n/V = ${formatNumber(values.moles)} ÷ ${formatNumber(values.volume)} = ${formatNumber(Number(concentration.toFixed(6)))} mol/L.`,
        distractorHints: numericHints(Number(concentration.toFixed(6)), [values.volume / values.moles, values.moles * values.volume, values.moles + values.volume]),
      }
    },
  },
  solution_dilution: {
    id: 'solution_dilution',
    title: 'Diluição de soluções',
    subjects: ['quimica'],
    fields: ['initialConcentration', 'initialVolume', 'finalVolume'],
    inputDescription: 'initialConcentration (mol/L), initialVolume (L) e finalVolume (L). Calcula a concentração final (C₁·V₁ = C₂·V₂).',
    compute(values) {
      req(values, this.fields)
      if (values.finalVolume === 0) throw new Error('O volume final não pode ser zero.')
      const finalConcentration = (values.initialConcentration * values.initialVolume) / values.finalVolume
      return {
        answer: { numeric: finalConcentration, display: `${formatNumber(Number(finalConcentration.toFixed(6)))} mol/L` },
        derivation: `C₁·V₁ = C₂·V₂ ⇒ C₂ = ${formatNumber(values.initialConcentration)} × ${formatNumber(values.initialVolume)} ÷ ${formatNumber(values.finalVolume)} = ${formatNumber(Number(finalConcentration.toFixed(6)))} mol/L.`,
        distractorHints: numericHints(Number(finalConcentration.toFixed(6)), [values.initialConcentration * values.finalVolume / values.initialVolume, values.initialConcentration + values.initialVolume - values.finalVolume, values.initialVolume / values.finalVolume]),
      }
    },
  },
}

/** Catálogo somente-leitura dos domínios canônicos. */
export const canonicalDomains: Readonly<Record<CanonicalDomainId, CanonicalDomain>> = DOMAINS

export function isCanonicalDomainId(value: unknown): value is CanonicalDomainId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DOMAINS, value)
}

/** Gate 0: o domínio tem recalculador implementado? */
export function hasCanonicalDomain(value: unknown): boolean {
  return isCanonicalDomainId(value)
}

export function canonicalDomainsForSubject(subject: string): CanonicalDomain[] {
  const normalized = normalizeSubject(subject)
  return Object.values(DOMAINS).filter((domain) => domain.subjects.includes(normalized))
}

export function hasCanonicalDomainsForSubject(subject: string): boolean {
  return canonicalDomainsForSubject(subject).length > 0
}

export function getCanonicalDomain(id: string): CanonicalDomain | null {
  return isCanonicalDomainId(id) ? DOMAINS[id] : null
}

/** Recalcula o domínio a partir dos valores de entrada. Lança se as entradas não formarem o modelo. */
export function computeCanonicalDomain(id: CanonicalDomainId, values: Record<string, number>): DomainComputation {
  return DOMAINS[id].compute(values)
}

export function comparableNumber(value: string): number | null {
  const token = value.match(NUMBER_TOKEN)?.[0]
  return token ? parseNumberToken(token) : null
}
