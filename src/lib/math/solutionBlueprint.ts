import type { ExamQuestion } from '@/lib/gemini/examSchema'

type Blueprint = NonNullable<ExamQuestion['solutionBlueprint']>

function normalizeNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)))
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '')
}

function parseLinearSide(raw: string): { coefficients: Map<string, number>; constant: number } | null {
  const text = raw.replace(/\s+/g, '').replace(/,/g, '.').replace(/\*/g, '')
  if (!text) return null
  const coefficients = new Map<string, number>()
  let constant = 0
  let index = 0
  while (index < text.length) {
    const match = text.slice(index).match(/^([+-]?)(?:(\d+(?:\.\d+)?)?([a-zA-Z])|(\d+(?:\.\d+)?))/)
    if (!match) return null
    const [, sign, coefficientRaw, variable, numberRaw] = match
    const multiplier = sign === '-' ? -1 : 1
    if (variable) {
      const coefficient = multiplier * (coefficientRaw ? Number(coefficientRaw) : 1)
      coefficients.set(variable, (coefficients.get(variable) ?? 0) + coefficient)
    } else if (numberRaw) {
      constant += multiplier * Number(numberRaw)
    }
    index += match[0].length
  }
  return { coefficients, constant }
}

function solveTwoByTwo(equations: string[]): Record<string, number> | null {
  if (equations.length !== 2) return null
  const parsed = equations.map((equation) => {
    const parts = equation.split('=')
    if (parts.length !== 2) return null
    const left = parseLinearSide(parts[0])
    const right = parseLinearSide(parts[1])
    if (!left || !right) return null
    const coefficients = new Map(left.coefficients)
    for (const [variable, value] of right.coefficients) coefficients.set(variable, (coefficients.get(variable) ?? 0) - value)
    return { coefficients, constant: right.constant - left.constant }
  })
  if (parsed.some((item) => !item)) return null
  const rows = parsed as Array<{ coefficients: Map<string, number>; constant: number }>
  const variables = [...new Set(rows.flatMap((row) => [...row.coefficients.keys()]))]
  if (variables.length !== 2) return null
  const [x, y] = variables
  const a = rows[0].coefficients.get(x) ?? 0
  const b = rows[0].coefficients.get(y) ?? 0
  const c = rows[0].constant
  const d = rows[1].coefficients.get(x) ?? 0
  const e = rows[1].coefficients.get(y) ?? 0
  const f = rows[1].constant
  const determinant = a * e - b * d
  if (Math.abs(determinant) < 1e-9) return null
  return { [x]: (c * e - b * f) / determinant, [y]: (a * f - c * d) / determinant }
}

function numberValuesFor(domain: Blueprint['domain'], values: Record<string, number>): Record<string, number> | null {
  const required = (...keys: string[]) => keys.every((key) => Number.isFinite(values[key]))
  if (domain === 'rectangular_prism_volume') {
    if (!required('length', 'width', 'height')) return null
    const factor = Number.isFinite(values.unitFactor) ? values.unitFactor : 1
    return { volume: values.length * values.width * values.height * factor }
  }
  if (domain === 'average_speed') {
    if (!required('distance', 'time') || values.time === 0) return null
    return { speed: values.distance / values.time }
  }
  if (domain === 'percentage') {
    if (!required('base', 'percent')) return null
    return { result: values.base * values.percent / 100 }
  }
  return null
}

function answerContainsValues(answer: string, values: Record<string, number>): boolean {
  const normalized = normalizeText(answer)
  return Object.values(values).every((value) => normalized.includes(normalizeNumber(value)))
}

function alternativeMatchesValues(question: ExamQuestion, values: Record<string, number>): boolean {
  if (question.type !== 'objetiva' || !question.correctLetter || !question.alternatives) return true
  const alternative = question.alternatives.find((candidate) => candidate.letter === question.correctLetter)
  return Boolean(alternative && answerContainsValues(alternative.text, values))
}

export function isMathSubject(subject: string): boolean {
  return /^(matemática|matematica)$/i.test(subject.trim())
}

/** Recalcula o modelo que a própria ficha declarou; nunca confia só no texto da IA. */
export function validateSolutionBlueprint(question: ExamQuestion): string[] {
  const blueprint = question.solutionBlueprint
  if (!blueprint) return [`Questão ${question.number}: falta a ficha técnica de solução (solutionBlueprint).`]
  let values: Record<string, number> | null = null
  if (blueprint.domain === 'linear_system') values = solveTwoByTwo(blueprint.equations)
  else values = numberValuesFor(blueprint.domain, blueprint.values)

  if (blueprint.domain !== 'other' && blueprint.domain !== 'ratio_proportion' && !values) {
    return [`Questão ${question.number}: a ficha técnica não contém um modelo ${blueprint.domain} determinístico e recalculável.`]
  }
  if (!values) return []

  const issues: string[] = []
  if (!answerContainsValues(blueprint.derivedAnswer, values)) {
    issues.push(`Questão ${question.number}: a resposta derivada da ficha técnica não confere com o cálculo do modelo.`)
  }
  if (question.type === 'objetiva' && !alternativeMatchesValues(question, values)) {
    issues.push(`Questão ${question.number}: a alternativa marcada no gabarito não corresponde à solução calculada na ficha técnica.`)
  }
  if (question.type === 'descritiva' && (!question.expectedAnswer || !answerContainsValues(question.expectedAnswer, values))) {
    issues.push(`Questão ${question.number}: resposta esperada descritiva não registra a solução calculada na ficha técnica.`)
  }
  if (question.type === 'descritiva' && !question.gradingCriteria?.trim()) {
    issues.push(`Questão ${question.number}: critérios de correção são obrigatórios para questão descritiva com cálculo.`)
  }
  return issues
}
