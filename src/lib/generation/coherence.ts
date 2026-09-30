import { textSimilarity } from './similarity'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

export const EXAM_OVERLAP_ALERT = 0.62
export const EXAM_OVERLAP_BLOCK = 0.82

export type QuestionLike = { number: number; statement: string; supportText?: string | null }

export type ExamOverlap = { first: number; second: number; similarity: number }
export type CoherenceIssue = { questionNumbers: number[]; severity: 'bloqueante' | 'alerta'; reason: string }

export type DiversityProfile = {
  family: string
  method: string
  dataSignature: string
}

/** Texto comparável de uma questão (enunciado + apoio). */
export function questionCoherenceText(question: QuestionLike): string {
  return `${question.statement} ${question.supportText ?? ''}`
}

/**
 * Checagem determinística de coerência da prova: nenhuma questão pode repetir
 * substancialmente outra. Importante sobretudo no pipeline fragmentado, em
 * que cada questão é gerada sem ver as demais.
 */
export function detectExamOverlaps(questions: QuestionLike[]): ExamOverlap[] {
  const overlaps: ExamOverlap[] = []
  for (let first = 0; first < questions.length; first++) {
    for (let second = first + 1; second < questions.length; second++) {
      const similarity = textSimilarity(questionCoherenceText(questions[first]), questionCoherenceText(questions[second]))
      if (similarity >= EXAM_OVERLAP_ALERT) {
        overlaps.push({ first: questions[first].number, second: questions[second].number, similarity })
      }
    }
  }
  return overlaps.sort((a, b) => b.similarity - a.similarity)
}

export function coherenceIssues(questions: QuestionLike[]): CoherenceIssue[] {
  return detectExamOverlaps(questions).map((overlap) => ({
    questionNumbers: [overlap.first, overlap.second],
    severity: overlap.similarity >= EXAM_OVERLAP_BLOCK ? 'bloqueante' : 'alerta',
    reason: `Questões ${overlap.first} e ${overlap.second} têm enunciados muito semelhantes (${Math.round(overlap.similarity * 100)}% de termos em comum).`,
  }))
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function inferFamily(question: ExamQuestion): string {
  if (question.solutionBlueprint?.domain) return question.solutionBlueprint.domain
  const text = normalized(`${question.supportText ?? ''} ${question.statement}`)
  if (/distancia.*pontos?|pontos?.*plano cartesiano/.test(text)) return 'point_distance'
  if (/sistema.*linear|equacoes lineares/.test(text)) return 'linear_system'
  if (/proporcao|regra de tres/.test(text)) return 'ratio_proportion'
  if (/porcentagem|desconto|acrescimo percentual/.test(text)) return 'percentage'
  if (/juros compostos/.test(text)) return 'compound_interest'
  if (/juros simples/.test(text)) return 'simple_interest'
  if (/progressao aritmetica/.test(text)) return 'arithmetic_progression'
  if (/progressao geometrica/.test(text)) return 'geometric_progression'
  return 'other'
}

function inferMethod(question: ExamQuestion, family: string): string {
  const text = normalized(`${question.supportText ?? ''} ${question.statement}`)
  if (/cramer|determinante/.test(text)) return 'cramer_determinant'
  if (/matriz inversa/.test(text)) return 'matrix_inverse'
  if (/substituicao/.test(text)) return 'substitution'
  if (family === 'point_distance') return 'distance_formula'
  if (family === 'ratio_proportion') return 'cross_multiplication'
  return family
}

function literalDataSignature(question: ExamQuestion): string {
  if (question.solutionBlueprint?.values && Object.keys(question.solutionBlueprint.values).length) {
    return JSON.stringify(Object.entries(question.solutionBlueprint.values).sort(([a], [b]) => a.localeCompare(b)))
  }
  const text = normalized(`${question.supportText ?? ''} ${question.statement}`)
  const coordinates = [...text.matchAll(/[a-z]\s*\(\s*(-?\d+(?:[,.]\d+)?)\s*[,;]\s*(-?\d+(?:[,.]\d+)?)\s*\)/g)].map((match) => `${match[1]},${match[2]}`)
  if (coordinates.length) return `coordinates:${coordinates.sort().join('|')}`
  const equations = [...text.matchAll(/(?:-?\d*\s*[xy](?:\s*[+-]\s*\d*\s*[xy])?\s*=\s*-?\d+)/g)].map((match) => match[0].replace(/\s+/g, ''))
  if (equations.length) return `equations:${equations.sort().join('|')}`
  return ''
}

export function diversityProfile(question: ExamQuestion): DiversityProfile {
  const family = inferFamily(question)
  return { family, method: inferMethod(question, family), dataSignature: literalDataSignature(question) }
}

/**
 * Detecta repetição pedagógica mesmo quando a IA troca algumas palavras ou o
 * tipo da questão. Dados idênticos no mesmo domínio são sempre bloqueantes;
 * o mesmo método repetido em excesso também precisa ser substituído.
 */
export function diversityIssues(questions: ExamQuestion[]): CoherenceIssue[] {
  const issues: CoherenceIssue[] = []
  const profiles = new Map(questions.map((question) => [question.number, diversityProfile(question)]))
  const repeatedMethod = new Map<string, number[]>()

  for (let first = 0; first < questions.length; first++) {
    for (let second = first + 1; second < questions.length; second++) {
      const left = questions[first]
      const right = questions[second]
      const leftProfile = profiles.get(left.number)!
      const rightProfile = profiles.get(right.number)!
      if (leftProfile.family !== rightProfile.family) continue
      const distinctCanonicalData = Boolean(
        leftProfile.dataSignature && rightProfile.dataSignature
        && leftProfile.dataSignature !== rightProfile.dataSignature,
      )
      if (leftProfile.dataSignature && leftProfile.dataSignature === rightProfile.dataSignature) {
        issues.push({ questionNumbers: [left.number, right.number], severity: 'bloqueante', reason: `Questões ${left.number} e ${right.number} repetem o mesmo conteúdo e os mesmos dados (${leftProfile.family}).` })
      // Questões calculáveis com dados canônicos diferentes podem usar a
      // mesma forma de enunciado sem serem duplicatas. O template é uma
      // garantia de fidelidade, não evidência de repetição pedagógica.
      } else if (!distinctCanonicalData && leftProfile.method === rightProfile.method && textSimilarity(questionCoherenceText(left), questionCoherenceText(right)) >= 0.72) {
        issues.push({ questionNumbers: [left.number, right.number], severity: 'bloqueante', reason: `Questões ${left.number} e ${right.number} repetem o mesmo método (${leftProfile.method}) com enunciados muito próximos.` })
      } else if (!distinctCanonicalData && leftProfile.method === rightProfile.method && textSimilarity(questionCoherenceText(left), questionCoherenceText(right)) >= 0.48) {
        issues.push({ questionNumbers: [left.number, right.number], severity: 'alerta', reason: `Questões ${left.number} e ${right.number} usam o mesmo método (${leftProfile.method}) com contexto parecido; conferir a variedade pedagógica.` })
      }
    }
    const profile = profiles.get(questions[first].number)!
    const key = `${profile.family}:${profile.method}`
    repeatedMethod.set(key, [...(repeatedMethod.get(key) ?? []), questions[first].number])
  }

  // Um capítulo pode exigir legitimamente várias questões da mesma habilidade
  // (por exemplo, uma lista de sistemas lineares). Por isso quantidade nunca
  // bloqueia a prova: registramos a concentração para revisão, mas só dados
  // repetidos ou enunciados realmente próximos acionam substituição.
  for (const [key, numbers] of repeatedMethod) {
    if (numbers.length > 2) {
      issues.push({ questionNumbers: numbers, severity: 'alerta', reason: `A prova concentra ${numbers.length} questões em ${key.replace(':', ' pelo método ')}; a matriz permite isso, mas vale conferir a variedade de contextos.` })
    }
  }
  return issues
}
