import { comparableNumber, computeCanonicalDomain, hasCanonicalDomain } from './domains'
import { detectAlternativeAmbiguities } from './alternatives'
import { parseSingleNumber } from './similarity'
import { getRuleEngine } from './rules'
import { StageGateError } from './types'
import { missingRequiredSupportTextReason } from '@/lib/exams/supportTextIntegrity'
import type { MetadataDraft, PipelineContext, QuestionPlan, StatementDraft, TruthObject, VisualPlan } from './types'

const NUMERIC_TOLERANCE = 1e-6

export function defaultShuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

/**
 * A resposta-modelo escrita pela IA numa descritiva calculável precisa conter o
 * resultado recalculado por código (mesma precisão ou arredondado, tolerância
 * de 1%). Lê números em formato pt-BR ("1.234,5") e
 * respeita o sinal quando o menos está colado ao número ("-2", não "5 - 2");
 * sem isso, uma prosa com número errado passaria.
 */
export function answerProseContainsResult(prose: string, numeric: number): boolean {
  const tolerance = Math.max(0.01, Math.abs(numeric) * 0.01)
  for (const match of prose.matchAll(/(?<![\d)\w])([-−–]?)(\d[\d.,]*)/g)) {
    let token = match[2].replace(/[.,]+$/, '')
    token = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(token) ? token.replace(/\./g, '').replace(',', '.') : token.replace(',', '.')
    const value = Number(token)
    if (!Number.isFinite(value)) continue
    if (Math.abs((match[1] ? -value : value) - numeric) <= tolerance) return true
  }
  return false
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

/** Gate V — a decisão visual precisa ser coerente antes do enunciado. */
export function gateVisualPlan(plan: VisualPlan): void {
  if (!plan.rationale.trim()) throw new StageGateError('stage_visual', 'visual_rationale', 'O plano visual precisa explicar por que a imagem é necessária ou dispensável.')
  if (plan.required && plan.visualType === 'none') throw new StageGateError('stage_visual', 'visual_type', 'Um visual obrigatório precisa ter um tipo de recurso definido.')
  if (!plan.required && plan.visualType !== 'none') throw new StageGateError('stage_visual', 'visual_type', 'Um visual dispensado deve usar visualType "none".')
  if (!plan.required && plan.purpose !== 'nenhum') throw new StageGateError('stage_visual', 'visual_purpose', 'Um visual dispensado deve ter purpose "nenhum".')
  if (plan.required && plan.purpose === 'nenhum') throw new StageGateError('stage_visual', 'visual_purpose', 'Um visual obrigatório precisa informar seu objetivo pedagógico.')
  if (!plan.required && plan.data && Object.keys(plan.data).length) throw new StageGateError('stage_visual', 'visual_data', 'Um visual dispensado não deve carregar dados de renderização.')
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

/**
 * Gate 1 (fonte ancorada/interpretativa) — a evidência vem do TEXTO DE APOIO
 * que o aluno lê, nunca da planilha curricular. A planilha só lista assuntos;
 * exigir citação literal dela fazia a IA copiar títulos de capítulo para
 * alternativas e gabaritos (prova #391, 02/10/2026).
 */
export function gateAnchoredClaim(supportText: string | null | undefined, truth: TruthObject): void {
  const claim = (truth.claim ?? '').trim()
  if (claim.length < 2) throw new StageGateError('stage1', 'claim_missing', 'A resposta correta ("claim") está vazia.')
  const support = normalize(supportText ?? '')
  if (support.split(' ').filter(Boolean).length < 8) return // sem apoio textual: nada a ancorar
  const evidence = normalize(truth.sourceEvidence ?? truth.textEvidence ?? '')
  if (evidence.length < 8) {
    throw new StageGateError('stage1', 'evidence_missing', 'A evidência ancorada está vazia ou curta demais; cite 1–2 frases do texto de apoio que sustentam a resposta.')
  }
  if (!support.includes(evidence) && !everySentenceIsLiteral(truth.sourceEvidence ?? truth.textEvidence ?? '', support)) {
    throw new StageGateError('stage1', 'evidence_not_found', 'A evidência citada não existe literalmente no texto de apoio escrito para a questão; copie palavra por palavra uma frase do próprio texto de apoio.')
  }
}

/**
 * A IA costuma citar duas frases do apoio saltando a do meio. Cada frase é
 * citação literal, mesmo sem ser um trecho contíguo; o que o gate quer barrar é
 * evidência inventada, e isso continua barrado (qualquer frase fora do apoio reprova).
 */
function everySentenceIsLiteral(evidence: string, normalizedSupport: string): boolean {
  const sentences = evidence.split(/(?<=[.!?])\s+/).map(normalize).filter((sentence) => sentence.length >= 8)
  return sentences.length > 0 && sentences.every((sentence) => normalizedSupport.includes(sentence))
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
  const supportTextIssue = missingRequiredSupportTextReason(draft)
  if (supportTextIssue) throw new StageGateError('stage3', 'missing_support_text', supportTextIssue)
  // Nunca expor nomes de campos internos do payload ao aluno. Isso acontecia
  // quando o modelo dizia "leia o trecho em supportText" em vez de usar o
  // texto de apoio apresentado pela interface.
  if (/\b(?:supportText|imageQuery|correctLetter|visualPlan|JSON|payload)\b/i.test(`${draft.statement}\n${draft.supportText ?? ''}`)) {
    throw new StageGateError('stage3', 'internal_field_reference', 'O texto usa um nome interno do sistema; reescreva a questão como texto pedagógico para o aluno.')
  }
  if (plan.truthStrategy !== 'calculavel') return
  const allowed = [
    ...Object.values(truth.values),
    truth.answerNumeric ?? Number.NaN,
    ...numericTokens(truth.derivedAnswer ?? ''),
    ...numericTokens(truth.derivation),
  ].filter((value) => Number.isFinite(value))

  const invented = numericTokens(`${draft.statement} ${draft.supportText ?? ''}`)
    // Inteiros de 0 a 9 são ordinais/contexto ("duas etapas", "1º") e não
    // indicam dado inventado; decimais e números ≥ 10 são verificados.
    .filter((value) => Math.abs(value) >= 10 || !Number.isInteger(value))
    .filter((value) => !allowed.some((candidate) => equivalentNumbers(candidate, value)))
  if (invented.length) {
    throw new StageGateError('stage3', 'statement_fidelity', `O enunciado citou valor(es) que não existem no objeto-fonte de verdade: ${invented.join(', ')}.`)
  }
  if (plan.domain === 'average_speed') {
    const normalizedStatement = normalize(`${draft.statement} ${draft.supportText ?? ''}`)
    const hasDistanceUnit = /\bkm\b|\bquilometros?\b/.test(normalizedStatement)
    const hasTimeUnit = /\bh\b|\bhora(s)?\b/.test(normalizedStatement)
    if (!hasDistanceUnit || !hasTimeUnit) {
      throw new StageGateError('stage3', 'average_speed_units', 'Velocidade média exige unidades explícitas de distância e tempo no enunciado.')
    }
  }
}

/** Impede que um enunciado dependa de uma figura que o plano visual dispensou. */
export function gateVisualReference(visualPlan: VisualPlan, draft: StatementDraft): void {
  if (visualPlan.required) return
  const text = normalize(`${draft.statement} ${draft.supportText ?? ''}`)
  if (/\b(figura|imagem|grafico|mapa|diagrama|ilustracao)\s+(abaixo|acima|a seguir|apresentad[ao])\b/.test(text)) {
    throw new StageGateError('stage3', 'unexpected_visual_reference', 'O enunciado faz referência a um recurso visual, mas o plano visual determinou que ele não é necessário.')
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
      // Só compara como número quando a alternativa É um número único — não a
      // primeira parcela de uma expressão com vários valores.
      const parsed = parseSingleNumber(distractor)
      if (parsed !== null && equivalentNumbers(parsed, truth.answerNumeric)) {
        throw new StageGateError('stage2', 'distractor_equals_answer', `O distrator ${index + 1} reproduz numericamente a resposta correta.`)
      }
    }
  }

  // Gate de ambiguidade por par: nenhuma alternativa pode ser equivalente a
  // outra (duplicada, numericamente igual, quase idêntica ou só separada por
  // negação), sob pena de haver mais de uma resposta defensável.
  const allOptions = [
    { letter: 'R', text: correctAnswerText },
    ...distractors.map((text, index) => ({ letter: String.fromCharCode(66 + index), text })),
  ]
  const ambiguity = detectAlternativeAmbiguities(allOptions).find((issue) => issue.severity === 'bloqueante')
  if (ambiguity) throw new StageGateError('stage2', 'alternative_ambiguity', ambiguity.reason)
}

/** A alternativa contém a resposta, nunca a linha final da resolução. */
export function gateAlternativePresentation(correctAnswerText: string): void {
  if (/^\s*(?:[a-z]\s*\d*|[a-z]\s*\([^)]*\))\s*=/i.test(correctAnswerText)) {
    throw new StageGateError('stage2', 'answer_presentation', 'A alternativa correta contém uma atribuição ou resolução (ex.: x = ...); use apenas o valor ou a forma curta da resposta.')
  }
}

/**
 * Evita alternativas de formatos incompatíveis: uma resposta curta como
 * "lindas" não pode concorrer com quatro frases completas que repetem o
 * enunciado. O gabarito e os distratores precisam representar a mesma lacuna.
 */
export function gateAlternativeShape(correctAnswerText: string, distractors: string[]): void {
  const correctWords = correctAnswerText.trim().split(/\s+/).filter(Boolean).length
  if (correctWords > 3 || distractors.length === 0) return
  const distractorWords = distractors.map((value) => value.trim().split(/\s+/).filter(Boolean).length)
  const longDistractors = distractorWords.filter((count) => count >= Math.max(4, correctWords * 3)).length
  if (longDistractors >= Math.ceil(distractors.length / 2)) {
    throw new StageGateError('stage2', 'alternative_shape', 'As alternativas não têm o mesmo formato da resposta: padronize todas como formas curtas ou como frases completas.')
  }
}

/** Gate 4 — metadados não podem criar uma pendência tardia no validador legado. */
export function gateMetadata(metadata: MetadataDraft): void {
  if (metadata.bnccStatus === 'mapeado' && metadata.bnccCodes.length === 0) {
    throw new StageGateError('stage4', 'bncc_mapping', 'Metadados marcaram BNCC como mapeada sem informar código.')
  }
  if (metadata.bnccStatus === 'nao_mapeado' && metadata.bnccCodes.length > 0) {
    throw new StageGateError('stage4', 'bncc_mapping', 'Metadados informaram códigos BNCC, mas marcaram o item como não mapeado.')
  }
  if (metadata.needsImage && !metadata.imageQuery?.trim()) {
    throw new StageGateError('stage4', 'image_query', 'Questão marcada como dependente de imagem sem consulta para gerar o recurso.')
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
