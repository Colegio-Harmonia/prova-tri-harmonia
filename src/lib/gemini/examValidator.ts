import type { CurriculumPlanItem, CurriculumSelection, Segment } from '@/types/exam'
import type { ExamGenerationResult, ExamQuestion } from './examSchema'
import { getSaebApplicability } from '@/config/saebApplicability'
import { isImageEligibleSubject } from '@/config/imageEligibleSubjects'
import { computeQuestionSplit } from './promptBuilder'
import { normalizeAndValidateQuestionText } from '@/lib/math/mathTextIntegrity'
import { isMathSubject, validateSolutionBlueprint } from '@/lib/math/solutionBlueprint'

export type ValidationResult = {
  corrected: ExamGenerationResult
  /** Structural problems worth a re-prompt (counts/ratios/alt-count wrong). */
  issues: string[]
  /** Non-blocking notes surfaced to the human reviewer either way. */
  warnings: string[]
}

export function alternativesCountForSegment(segment: Segment): number {
  return segment === 'anos-iniciais' ? 4 : 5
}

// Código BNCC oficial: EF08MA01, EM13MAT101, EI03ET01. Descritores SAEB/Prova
// Brasil (D1, D26) NÃO são BNCC e nunca podem entrar em bnccCodes — o modelo
// às vezes confunde os dois.
const BNCC_CODE_PATTERN = /^(EI|EF|EM)\d{2}[A-Z]{2,3}\d{1,3}$/

export function isBnccCode(value: string): boolean {
  return BNCC_CODE_PATTERN.test(value.trim().toUpperCase())
}

function normalizeForConceptMatch(value: string): string {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\b([a-z]{4,})s\b/g, '$1')
}

/**
 * A definição explícita do termo cobrado torna uma questão de conhecimento
 * apenas uma busca de frase no texto. O prompt evita esse caso; este guard
 * cobre o formato mais direto que ainda possa escapar do modelo.
 */
function supportTextDefinesAssessedTerm(supportText: string, statement: string): boolean {
  const match = supportText.trim().match(/^(.{3,100}?)\s+(?:é|são|consiste(?:m)? em|representa(?:m)?|significa(?:m)?)\s+/i)
  if (!match) return false
  const definedTerm = normalizeForConceptMatch(match[1])
  const normalizedStatement = normalizeForConceptMatch(statement)
  return definedTerm.split(/\s+/).filter((word) => word.length >= 4).length >= 1 && normalizedStatement.includes(definedTerm)
}

/**
 * Corrige UMA questão contra as mesmas regras hard-override da prova
 * inteira (nunca confiar em SAEB/imagem fora do gate mecânico) — extraído
 * pra ser reaproveitado tanto no map() abaixo quanto em
 * /api/exams/[examId]/regenerate-question, que troca só 1 questão.
 */
export function correctSingleQuestion(
  q: ExamQuestion,
  curriculum: Pick<CurriculumSelection, 'segment' | 'gradeYear' | 'subject'>,
  options: { allowMathReviewFallback?: boolean } = {},
): { question: ExamQuestion; issues: string[]; warnings: string[] } {
  const issues: string[] = []
  const warnings: string[] = []
  const saebGate = getSaebApplicability(curriculum.segment, curriculum.gradeYear, curriculum.subject)
  const imageEligible = isImageEligibleSubject(curriculum.subject)
  const expectedAlt = alternativesCountForSegment(curriculum.segment)

  // Matemática é gerada a partir de uma ficha técnica interna: sem modelo e
  // solução verificáveis, enunciado/gabarito/imagem não podem ser confiáveis.
  if (isMathSubject(curriculum.subject)) {
    const blueprintIssues = validateSolutionBlueprint(q)
    if (options.allowMathReviewFallback && blueprintIssues.length) {
      warnings.push(...blueprintIssues.map((issue) => `${issue} A questão seguirá para revisão humana; confira cálculo e gabarito antes de aprovar.`))
    } else {
      issues.push(...blueprintIssues)
    }
    if (/\bpor\s+(?:a|o)\s+(?:dist[âa]ncia|quantidade|valor|n[uú]mero)\b/i.test(`${q.statement}\n${q.supportText ?? ''}`)) {
      issues.push(`Questão ${q.number}: variável matemática ausente no enunciado (ex.: "por a distância"); gere novamente com o símbolo delimitado, como $x$ ou $y$.`)
    }
  }

  const correctedSaeb = !saebGate.applicable ? { applicable: false, source: null, value: null, approximate: false } : q.saeb
  if (!saebGate.applicable && (q.saeb.applicable || q.saeb.value)) {
    warnings.push(`Questão ${q.number}: modelo preencheu SAEB/ENEM para uma disciplina sem matriz oficial — corrigido para "N/A".`)
  }

  const correctedNeedsImage = imageEligible ? q.needsImage : false
  const correctedImageQuery = imageEligible ? q.imageQuery : null
  if (!imageEligible && q.needsImage) {
    warnings.push(`Questão ${q.number}: modelo pediu imagem para uma disciplina não habilitada para imagens — corrigido para needsImage:false.`)
  }

  const correctedSupportText = q.supportText && supportTextDefinesAssessedTerm(q.supportText, q.statement) ? null : q.supportText
  if (q.supportText && !correctedSupportText) {
    warnings.push(`Questão ${q.number}: texto de apoio definia o conceito cobrado e foi removido para não entregar a resposta.`)
  }

  if (q.type === 'objetiva') {
    if (!q.alternatives || q.alternatives.length !== expectedAlt) {
      issues.push(`Questão ${q.number} (objetiva): esperado ${expectedAlt} alternativas, veio ${q.alternatives?.length ?? 0}.`)
    }
    if (!q.correctLetter || !q.alternatives?.some((a) => a.letter === q.correctLetter)) {
      issues.push(`Questão ${q.number} (objetiva): correctLetter ausente ou não corresponde a nenhuma alternativa.`)
    }
  } else {
    if (q.alternatives?.length || q.correctLetter) {
      issues.push(`Questão ${q.number} (descritiva): não deveria ter alternatives/correctLetter.`)
    }
  }

  let correctedBnccCodes = q.bnccCodes ?? []
  let correctedBnccStatus = q.bnccStatus
  if (correctedBnccStatus === 'nao_mapeado') {
    if (correctedBnccCodes.length) {
      warnings.push(`Questão ${q.number}: bnccStatus "nao_mapeado" mas veio com códigos BNCC preenchidos — códigos removidos.`)
    }
    correctedBnccCodes = []
  } else {
    const invalidCodes = correctedBnccCodes.filter((code) => !isBnccCode(code))
    if (invalidCodes.length) {
      warnings.push(`Questão ${q.number}: código(s) ${invalidCodes.map((code) => `"${code}"`).join(', ')} não são BNCC (formato EF/EM/EI) — removido(s).`)
      correctedBnccCodes = correctedBnccCodes.filter((code) => isBnccCode(code))
      if (!correctedBnccCodes.length) correctedBnccStatus = 'nao_mapeado'
    }
  }

  const textIntegrity = normalizeAndValidateQuestionText({
    ...q,
    supportText: correctedSupportText,
    saeb: correctedSaeb,
    needsImage: correctedNeedsImage,
    imageQuery: correctedImageQuery,
  })
  if (options.allowMathReviewFallback && textIntegrity.issues.length) {
    warnings.push(...textIntegrity.issues.map((issue) => `${issue} A questão seguirá para revisão humana; confira a notação antes de aprovar.`))
  } else {
    issues.push(...textIntegrity.issues)
  }
  if (textIntegrity.normalized) {
    warnings.push(`Questão ${q.number}: comandos matemáticos sem delimitador foram normalizados para renderização segura.`)
  }

  return {
    question: { ...textIntegrity.question, bnccCodes: correctedBnccCodes, bnccStatus: correctedBnccStatus },
    issues,
    warnings,
  }
}

/**
 * Re-derives structural facts from `questions[]` and never trusts the
 * model's own `metadata` block. Hard-overrides SAEB/ENEM fields for any
 * subject/grade without an official matrix, regardless of what Gemini
 * returned — this one rule (never invent SAEB/ENEM data) must not depend on
 * model compliance.
 */
export function validateExamResult(
  result: ExamGenerationResult,
  curriculum: CurriculumSelection,
  params: { questionCount: number; enforcePedagogicalCompleteness?: boolean; contentPlan?: CurriculumPlanItem[] },
): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  const expectedSplit = computeQuestionSplit(params.questionCount)
  const expectedAlt = alternativesCountForSegment(curriculum.segment)

  const correctedQuestions: ExamQuestion[] = result.questions.map((q) => {
    const { question, issues: qIssues, warnings: qWarnings } = correctSingleQuestion(q, curriculum)
    issues.push(...qIssues)
    warnings.push(...qWarnings)
    return question
  })

  // Segundo gate de BNCC: mesmo um código com formato válido precisa existir
  // no currículo real da unidade; senão seria invenção bem-formada.
  const codesByUnit = new Map<number, Set<string>>()
  const allCurriculumCodes = new Set<string>()
  for (const unit of curriculum.units) {
    if (unit.habilidades.status !== 'mapeado') continue
    const codes = new Set(unit.habilidades.skills.map((skill) => skill.code.trim().toUpperCase()))
    codesByUnit.set(unit.rowIndex, codes)
    for (const code of codes) allCurriculumCodes.add(code)
  }
  for (let index = 0; index < correctedQuestions.length; index++) {
    const question = correctedQuestions[index]
    if (!question.bnccCodes.length) continue
    const allowed = (question.curriculumUnitRowIndex != null ? codesByUnit.get(question.curriculumUnitRowIndex) : undefined) ?? allCurriculumCodes
    const kept = question.bnccCodes.filter((code) => allowed.has(code.trim().toUpperCase()))
    if (kept.length !== question.bnccCodes.length) {
      const removed = question.bnccCodes.filter((code) => !allowed.has(code.trim().toUpperCase()))
      warnings.push(`Questão ${question.number}: código(s) BNCC fora do currículo (${removed.join(', ')}) removido(s).`)
      correctedQuestions[index] = { ...question, bnccCodes: kept, bnccStatus: kept.length ? question.bnccStatus : 'nao_mapeado' }
    }
  }

  const actualObjective = correctedQuestions.filter((q) => q.type === 'objetiva').length
  const actualDiscursive = correctedQuestions.filter((q) => q.type === 'descritiva').length

  if (correctedQuestions.length !== params.questionCount) {
    issues.push(`Total de questões: esperado ${params.questionCount}, veio ${correctedQuestions.length}.`)
  }
  if (actualObjective !== expectedSplit.objectiveCount || actualDiscursive !== expectedSplit.discursiveCount) {
    issues.push(
      `Proporção 60/40: esperado ${expectedSplit.objectiveCount} objetivas + ${expectedSplit.discursiveCount} descritivas, ` +
        `veio ${actualObjective} + ${actualDiscursive}.`,
    )
  }

  if (params.contentPlan?.length) {
    for (const item of params.contentPlan.filter((candidate) => candidate.questionCount > 0)) {
      const actual = correctedQuestions.filter((question) => question.curriculumUnitRowIndex === item.unitRowIndex).length
      if (actual !== item.questionCount) {
        issues.push(`Matriz da avaliação: capítulo ${item.unitRowIndex} deveria ter ${item.questionCount} questão(ões), mas veio com ${actual}.`)
      }
    }
  }

  if (curriculum.segment === 'anos-finais' && curriculum.gradeYear === 9) {
    const higherOrder = correctedQuestions.filter((q) => q.bloomLevel === 'analisar' || q.bloomLevel === 'avaliar').length
    if (higherOrder < 2) {
      warnings.push(`9º ano deveria ter pelo menos 2-3 questões em nível Analisar/Avaliar; veio ${higherOrder}.`)
    }
  }

  if (params.enforcePedagogicalCompleteness) {
    for (const question of correctedQuestions) {
      if (question.source === 'ia' && !question.pedagogicalClassification.difficulty) {
        issues.push(`Questão ${question.number}: difficulty é obrigatória para geração com o gate pedagógico ativo.`)
      }
    }
  }

  const corrected: ExamGenerationResult = {
    metadata: {
      ...result.metadata,
      questionCount: correctedQuestions.length,
      objectiveCount: actualObjective,
      discursiveCount: actualDiscursive,
      alternativesCount: expectedAlt,
    },
    questions: correctedQuestions,
  }

  return { corrected, issues, warnings }
}
