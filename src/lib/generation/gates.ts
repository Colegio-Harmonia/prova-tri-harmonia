import { comparableNumber, computeCanonicalDomain, hasCanonicalDomain } from './domains'
import { getRuleEngine } from './rules'
import { StageGateError } from './types'
import type { PipelineContext, QuestionPlan, StatementDraft, TruthObject } from './types'

const NUMERIC_TOLERANCE = 1e-6

export function defaultShuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

function normalize(value: string): string {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function equivalentNumbers(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(NUMERIC_TOLERANCE, Math.abs(a) * 1e-6)
}

/** Gate 0 — estratégia e cobertura canônica. Nunca deixa `other` passar. */
export function gateStrategy(ctx: PipelineContext, plan: QuestionPlan): void {
  if (plan.truthStrategy === 'calculavel') {
    if (!plan.domain || !hasCanonicalDomain(plan.domain)) {
      throw new StageGateError('stage0', 'domain_coverage', `Domínio "${plan.domain ?? 'ausente'}" não possui recalculador determinístico; o uso está bloqueado.`)
    }
    return
  }
  if (plan.truthStrategy === 'regra_deterministica') {
    if (!plan.ruleId) throw new StageGateError('stage0', 'rule_id', 'Estratégia regra_deterministica exige um ruleId.')
    if (!getRuleEngine(plan.ruleId)) {
      throw new StageGateError('stage0', 'rule_engine_missing', `Não há motor de regras para "${plan.ruleId}"; o uso está bloqueado até o motor existir.`)
    }
    return
  }
  const material = (plan.sourceMaterial ?? ctx.curriculumContent ?? '').trim()
  if (!material) {
    throw new StageGateError('stage0', 'source_missing', `Estratégia ${plan.truthStrategy} exige material-fonte para ancorar a evidência.`)
  }
}

/** Gate 1 — o objeto-fonte de verdade é validado por código, nunca pela prosa do modelo. */
export function gateTruth(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject): void {
  if (plan.truthStrategy === 'calculavel') {
    if (!plan.domain) throw new StageGateError('stage1', 'domain_coverage', 'Domínio ausente na estratégia calculável.')
    let computation
    try {
      computation = computeCanonicalDomain(plan.domain, truth.values)
    } catch (error) {
      throw new StageGateError('stage1', 'recompute', `O recalculador não conseguiu derivar a resposta: ${error instanceof Error ? error.message : 'entrada inválida'}.`)
    }
    // O modelo NUNCA é a fonte do resultado: se ele declarou uma resposta,
    // validamos; em seguida sobrescrevemos com o recálculo determinístico.
    if (truth.answerNumeric !== undefined && !equivalentNumbers(truth.answerNumeric, computation.answer.numeric)) {
      throw new StageGateError('stage1', 'recompute', `A resposta declarada (${truth.answerNumeric}) diverge do recálculo determinístico (${computation.answer.numeric}).`)
    }
    if (truth.derivedAnswer !== undefined) {
      const declared = comparableNumber(truth.derivedAnswer)
      if (declared !== null && !equivalentNumbers(declared, computation.answer.numeric) && !computation.answer.category) {
        throw new StageGateError('stage1', 'recompute', `A resposta derivada ("${truth.derivedAnswer}") não confere com o recálculo (${computation.answer.display}).`)
      }
    }
    truth.answerNumeric = computation.answer.numeric
    truth.derivedAnswer = computation.answer.display
    truth.derivation = computation.derivation
    return
  }

  if (plan.truthStrategy === 'regra_deterministica') {
    const engine = plan.ruleId ? getRuleEngine(plan.ruleId) : null
    if (!engine) throw new StageGateError('stage1', 'rule_engine_missing', `Sem motor de regras para "${plan.ruleId ?? 'ausente'}".`)
    let verdict
    try {
      verdict = engine.evaluate(truth.ruleInput ?? {})
    } catch (error) {
      throw new StageGateError('stage1', 'rule_input', `Entrada inválida para o motor de regras "${plan.ruleId}": ${error instanceof Error ? error.message : 'entrada inválida'}.`)
    }
    // A forma correta é decidida pelo motor, nunca pelo modelo.
    truth.derivedAnswer = verdict.correctForm
    truth.derivation = verdict.evidence
    return
  }

  // fonte_ancorada / interpretativa: a evidência precisa existir literalmente no material.
  const material = normalize(plan.sourceMaterial ?? ctx.curriculumContent ?? '')
  const evidence = normalize(truth.sourceEvidence ?? truth.textEvidence ?? '')
  if (evidence.length < 8) {
    throw new StageGateError('stage1', 'evidence_missing', 'A evidência ancorada está vazia ou curta demais para ser verificável.')
  }
  if (!material.includes(evidence)) {
    throw new StageGateError('stage1', 'evidence_not_found', 'A evidência citada não existe literalmente no material-fonte fornecido (blindagem contra fato inventado).')
  }
}

function numericTokens(text: string): number[] {
  const cleaned = text.replace(/\b\d{1,2}\s*[ºªoa]\b/gi, ' ') // remove ordinais (1º, 2ª)
  const matches = cleaned.match(/-?\d+(?:[.,]\d+)*/g) ?? []
  return matches
    .map((token) => comparableNumber(token))
    .filter((value): value is number => value !== null)
}

/**
 * Gate 3 — nenhum número pode nascer na redação. Todo número do enunciado
 * precisa ser explicável pelo objeto-fonte de verdade (valores, resposta
 * derivada ou derivação canônica).
 */
export function gateStatement(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, draft: StatementDraft): void {
  if (plan.truthStrategy !== 'calculavel') return
  const allowed = [
    ...Object.values(truth.values),
    truth.answerNumeric ?? Number.NaN,
    ...numericTokens(truth.derivedAnswer ?? ''),
    ...numericTokens(truth.derivation),
  ].filter((value) => Number.isFinite(value))

  const invented = numericTokens(`${draft.statement} ${draft.supportText ?? ''}`)
    .filter((value) => !allowed.some((candidate) => equivalentNumbers(candidate, value)))
  if (invented.length) {
    throw new StageGateError('stage3', 'statement_fidelity', `O enunciado citou valor(es) que não existem no objeto-fonte de verdade: ${invented.join(', ')}.`)
  }
}

/** Gate 2 — distratores distintos entre si e nunca equivalentes à resposta correta. */
export function gateDistractors(plan: QuestionPlan, truth: TruthObject, distractors: string[], correctAnswerText: string): void {
  const normalized = distractors.map(normalize)
  if (new Set(normalized).size !== normalized.length) {
    const duplicate = normalized.find((value, index) => normalized.indexOf(value) !== index)
    throw new StageGateError('stage2', 'distractor_duplicate', `Há distratores repetidos ("${duplicate}").`)
  }
  const correct = normalize(correctAnswerText)
  for (const [index, distractor] of distractors.entries()) {
    if (normalize(distractor) === correct) {
      throw new StageGateError('stage2', 'distractor_equals_answer', `O distrator ${index + 1} é igual à resposta correta.`)
    }
    if (plan.truthStrategy === 'calculavel' && truth.answerNumeric !== undefined) {
      const parsed = comparableNumber(distractor)
      if (parsed !== null && equivalentNumbers(parsed, truth.answerNumeric)) {
        throw new StageGateError('stage2', 'distractor_equals_answer', `O distrator ${index + 1} reproduz numericamente a resposta correta.`)
      }
    }
  }
}

/**
 * Gate 2 (interpretativa) — nenhum distrator pode ter apoio textual
 * equivalente ao da resposta correta, sob pena de duas leituras defensáveis.
 */
export function gateInterpretiveSupport(plan: QuestionPlan, truth: TruthObject, distractors: string[]): void {
  if (plan.truthStrategy !== 'interpretativa') return
  const material = normalize(plan.sourceMaterial ?? '')
  const evidence = normalize(truth.textEvidence ?? '')
  // Blindagem textual: um distrator que é trecho literal do material tem
  // apoio equivalente ao da resposta correta e cria duas leituras defensáveis.
  for (const [index, distractor] of distractors.entries()) {
    const normalizedDistractor = normalize(distractor)
    if (normalizedDistractor.length >= 12 && material.includes(normalizedDistractor) && !evidence.includes(normalizedDistractor)) {
      throw new StageGateError('stage2', 'interpretive_support', `O distrator ${index + 1} é trecho literal do texto de apoio e tem apoio textual equivalente à resposta correta.`)
    }
  }
}

/** Monta as alternativas: resposta correta entra por código na posição sorteada. */
export function assembleAlternatives(
  distractors: string[],
  correctAnswerText: string,
  shuffle: <T>(items: T[]) => T[] = defaultShuffle,
): { alternatives: Array<{ letter: string; text: string }>; correctLetter: string } {
  const letter = (index: number) => String.fromCharCode(65 + index)
  const ordered = shuffle([{ text: correctAnswerText, correct: true }, ...distractors.map((text) => ({ text, correct: false }))])
  const alternatives = ordered.map((item, index) => ({ letter: letter(index), text: item.text }))
  const correctIndex = ordered.findIndex((item) => item.correct)
  return { alternatives, correctLetter: letter(correctIndex) }
}
