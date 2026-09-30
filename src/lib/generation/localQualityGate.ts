import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { PipelineContext, QuestionPlan, TruthObject, VisualPlan } from './types'
import { StageGateError } from './types'
import { computeCanonicalDomain, hasCanonicalDomain, comparableNumber } from './domains'
import { getRuleEngine } from './rules'
import { detectAlternativeAmbiguities } from './alternatives'
import { parseSingleNumber } from './similarity'

const NUMERIC_TOLERANCE = 1e-6

export type LocalGateIssue = {
  code: string
  severity: 'bloqueante' | 'alerta'
  message: string
}

export type LocalGateResult = {
  passed: boolean
  issues: LocalGateIssue[]
  /** Truth object with recalculated values (for calculavel/regra_deterministica) */
  correctedTruth?: TruthObject
}

function normalize(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function equivalentNumbers(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(NUMERIC_TOLERANCE, Math.abs(a) * 1e-6)
}

function numericTokens(text: string): number[] {
  const cleaned = text.replace(/\b\d{1,2}\s*[ºªoa]\b/gi, ' ')
  const matches = cleaned.match(/-?\d+(?:[.,]\d+)*/g) ?? []
  return matches
    .map((token) => comparableNumber(token))
    .filter((value): value is number => value !== null)
}

/**
 * Executa TODAS as validações determinísticas sobre uma questão gerada,
 * sem nenhuma chamada de IA. Latência < 5ms.
 *
 * Consolida as checagens que antes estavam espalhadas entre gates.ts,
 * alternatives.ts e examValidator.ts em um único ponto de entrada.
 */
export function runLocalQualityGate(
  ctx: PipelineContext,
  question: ExamQuestion,
  plan: QuestionPlan,
  truth: TruthObject,
  visualPlan: VisualPlan,
): LocalGateResult {
  const issues: LocalGateIssue[] = []
  let correctedTruth = { ...truth }

  // === 1. Estrutura básica ===
  if (!question.statement || question.statement.trim().length < 20) {
    issues.push({ code: 'statement_too_short', severity: 'bloqueante', message: 'O enunciado tem menos de 20 caracteres.' })
  }

  // === 2. Alternativas (objetiva) ===
  if (ctx.questionType === 'objetiva') {
    const expectedCount = ctx.segment === 'anos-iniciais' ? 4 : 5
    const alts = question.alternatives ?? []

    if (alts.length !== expectedCount) {
      issues.push({ code: 'alternative_count', severity: 'bloqueante', message: `Esperadas ${expectedCount} alternativas, recebidas ${alts.length}.` })
    }

    if (!question.correctLetter) {
      issues.push({ code: 'missing_correct_letter', severity: 'bloqueante', message: 'Gabarito (correctLetter) ausente.' })
    } else if (!alts.some(a => a.letter === question.correctLetter)) {
      issues.push({ code: 'correct_letter_not_in_alternatives', severity: 'bloqueante', message: `Gabarito "${question.correctLetter}" não existe nas alternativas.` })
    }

    // Duplicidade entre alternativas
    const normalizedAlts = alts.map(a => normalize(a.text))
    const uniqueAlts = new Set(normalizedAlts)
    if (uniqueAlts.size !== normalizedAlts.length) {
      const dup = normalizedAlts.find((v, i) => normalizedAlts.indexOf(v) !== i)
      issues.push({ code: 'duplicate_alternative', severity: 'bloqueante', message: `Alternativas duplicadas detectadas: "${dup}".` })
    }

    // Presença de atribuição no gabarito
    const correctAlt = alts.find(a => a.letter === question.correctLetter)
    if (correctAlt && /^\s*(?:[a-z]\s*\d*|[a-z]\s*\([^)]*\))\s*=/i.test(correctAlt.text)) {
      issues.push({ code: 'answer_has_assignment', severity: 'bloqueante', message: 'A alternativa correta contém atribuição (ex.: x = ...); use apenas o valor.' })
    }

    // Ambiguidade entre pares de alternativas
    const ambiguities = detectAlternativeAmbiguities(alts)
    for (const amb of ambiguities) {
      if (amb.severity === 'bloqueante') {
        issues.push({ code: 'alternative_ambiguity', severity: 'bloqueante', message: amb.reason })
      }
    }
  }

  // === 3. Fonte de verdade ===
  if (plan.truthStrategy === 'calculavel' && plan.domain) {
    if (!hasCanonicalDomain(plan.domain)) {
      issues.push({ code: 'domain_missing', severity: 'bloqueante', message: `Domínio "${plan.domain}" não possui recalculador.` })
    } else {
      try {
        const computation = computeCanonicalDomain(plan.domain, truth.values)
        correctedTruth = {
          ...correctedTruth,
          answerNumeric: computation.answer.numeric,
          derivedAnswer: computation.answer.display,
          derivation: computation.derivation,
        }
        // Se a questão declarou uma resposta que diverge do recálculo
        if (truth.answerNumeric !== undefined && !equivalentNumbers(truth.answerNumeric, computation.answer.numeric)) {
          issues.push({ code: 'recompute_mismatch', severity: 'bloqueante', message: `Resposta declarada (${truth.answerNumeric}) diverge do recálculo (${computation.answer.numeric}).` })
        }
      } catch (error) {
        issues.push({ code: 'recompute_failed', severity: 'bloqueante', message: `Recálculo falhou: ${error instanceof Error ? error.message : 'entrada inválida'}.` })
      }
    }
  }

  if (plan.truthStrategy === 'regra_deterministica' && plan.ruleId) {
    const engine = getRuleEngine(plan.ruleId)
    if (!engine) {
      issues.push({ code: 'rule_engine_missing', severity: 'bloqueante', message: `Motor de regras "${plan.ruleId}" não registrado.` })
    } else if (truth.ruleInput) {
      try {
        const verdict = engine.evaluate(truth.ruleInput)
        correctedTruth = { ...correctedTruth, derivedAnswer: verdict.correctForm, derivation: verdict.evidence }
      } catch (error) {
        issues.push({ code: 'rule_evaluation_failed', severity: 'bloqueante', message: `Motor "${plan.ruleId}" rejeitou a entrada: ${error instanceof Error ? error.message : 'inválida'}.` })
      }
    }
  }

  if ((plan.truthStrategy === 'fonte_ancorada' || plan.truthStrategy === 'interpretativa') && plan.sourceMaterial) {
    const material = normalize(plan.sourceMaterial)
    const evidence = normalize(truth.sourceEvidence ?? truth.textEvidence ?? '')
    if (evidence.length < 8) {
      issues.push({ code: 'evidence_too_short', severity: 'bloqueante', message: 'Evidência ancorada vazia ou curta demais.' })
    } else if (!material.includes(evidence)) {
      issues.push({ code: 'evidence_not_found', severity: 'bloqueante', message: 'Evidência não existe literalmente no material-fonte.' })
    }
  }

  // === 4. Fidelidade numérica do enunciado ===
  if (plan.truthStrategy === 'calculavel') {
    const allowed = [
      ...Object.values(truth.values),
      truth.answerNumeric ?? NaN,
      ...numericTokens(truth.derivedAnswer ?? ''),
      ...numericTokens(truth.derivation),
    ].filter(v => Number.isFinite(v))

    const invented = numericTokens(`${question.statement} ${question.supportText ?? ''}`)
      .filter(v => Math.abs(v) >= 10 || !Number.isInteger(v))
      .filter(v => !allowed.some(c => equivalentNumbers(c, v)))
    if (invented.length) {
      issues.push({ code: 'invented_numbers', severity: 'bloqueante', message: `Enunciado cita valor(es) inexistentes na fonte de verdade: ${invented.join(', ')}.` })
    }
  }

  // === 5. Referência visual fantasma ===
  if (!visualPlan.required) {
    const text = normalize(`${question.statement} ${question.supportText ?? ''}`)
    if (/\b(figura|imagem|grafico|mapa|diagrama|ilustracao)\s+(abaixo|acima|a seguir|apresentad[ao])\b/.test(text)) {
      issues.push({ code: 'phantom_visual_reference', severity: 'bloqueante', message: 'Enunciado referencia recurso visual, mas o plano visual dispensou a imagem.' })
    }
  }

  // === 6. Consistência BNCC ===
  if (question.bnccStatus === 'mapeado' && (!question.bnccCodes || question.bnccCodes.length === 0)) {
    issues.push({ code: 'bncc_mapped_no_codes', severity: 'bloqueante', message: 'BNCC marcada como mapeada sem códigos.' })
  }
  if (question.bnccStatus === 'nao_mapeado' && question.bnccCodes && question.bnccCodes.length > 0) {
    issues.push({ code: 'bncc_codes_but_unmapped', severity: 'alerta', message: 'Códigos BNCC presentes, mas status marcado como não mapeado.' })
  }

  // === 7. Tamanho do enunciado ===
  if (question.statement.length > 3000) {
    issues.push({ code: 'statement_too_long', severity: 'alerta', message: `Enunciado muito longo (${question.statement.length} chars).` })
  }

  return {
    passed: !issues.some(i => i.severity === 'bloqueante'),
    issues,
    correctedTruth: correctedTruth,
  }
}

