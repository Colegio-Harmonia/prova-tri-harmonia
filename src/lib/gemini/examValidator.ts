import type { CurriculumSelection, Segment } from '@/types/exam'
import type { ExamGenerationResult, ExamQuestion } from './examSchema'
import { getSaebApplicability } from '@/config/saebApplicability'
import { isImageEligibleSubject } from '@/config/imageEligibleSubjects'
import { computeQuestionSplit } from './promptBuilder'

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
): { question: ExamQuestion; issues: string[]; warnings: string[] } {
  const issues: string[] = []
  const warnings: string[] = []
  const saebGate = getSaebApplicability(curriculum.segment, curriculum.gradeYear, curriculum.subject)
  const imageEligible = isImageEligibleSubject(curriculum.subject)
  const expectedAlt = alternativesCountForSegment(curriculum.segment)

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

  if (q.bnccStatus === 'nao_mapeado' && q.bnccCodes.length > 0) {
    warnings.push(`Questão ${q.number}: bnccStatus "nao_mapeado" mas veio com códigos BNCC preenchidos — possível invenção do modelo, revisar manualmente.`)
  }

  return {
    question: { ...q, supportText: correctedSupportText, saeb: correctedSaeb, needsImage: correctedNeedsImage, imageQuery: correctedImageQuery },
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
  params: { questionCount: number; enforcePedagogicalCompleteness?: boolean },
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
