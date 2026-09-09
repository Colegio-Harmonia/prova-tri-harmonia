import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { PlannedQuestionSlot } from './contentPlan'

export type QuestionCandidate = {
  slotNumber: number
  candidateNumber: number
  question: ExamQuestion
}

export type ExamQualityIssue = {
  questionNumbers: number[]
  severity: 'bloqueante' | 'alerta'
  reason: string
}

const STOP_WORDS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'que', 'qual', 'como', 'sobre', 'uma', 'seu', 'sua', 'ao', 'aos', 'e', 'ou'])

function terms(question: ExamQuestion): Set<string> {
  return new Set(`${question.statement} ${question.supportText ?? ''} ${question.bnccSummary ?? ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)))
}

export function questionSimilarity(first: ExamQuestion, second: ExamQuestion): number {
  const a = terms(first)
  const b = terms(second)
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection++
  return intersection / new Set([...a, ...b]).size
}

/**
 * Seleciona um único candidato por posição sem mudar o desenho aprovado da
 * prova. A decisão é determinística: candidatos semanticamente menos
 * parecidos com os itens já escolhidos vencem; a IA não altera a matriz.
 */
export function assembleBestExamCandidates(slots: PlannedQuestionSlot[], candidates: QuestionCandidate[]): ExamQuestion[] {
  const selected: ExamQuestion[] = []
  for (const slot of slots) {
    const options = candidates.filter((candidate) => candidate.slotNumber === slot.number)
    if (!options.length) throw new Error(`Nenhum candidato válido foi gerado para a questão ${slot.number}.`)
    const winner = [...options].sort((left, right) => {
      const leftScore = selected.reduce((max, question) => Math.max(max, questionSimilarity(left.question, question)), 0)
      const rightScore = selected.reduce((max, question) => Math.max(max, questionSimilarity(right.question, question)), 0)
      return leftScore - rightScore || left.candidateNumber - right.candidateNumber
    })[0]
    selected.push({ ...winner.question, number: slot.number, curriculumUnitRowIndex: slot.unitRowIndex })
  }
  return selected
}

/** Regras locais, baratas e reproduzíveis antes da revisão editorial por IA. */
export function validateExamAssembly(questions: ExamQuestion[], slots: PlannedQuestionSlot[]): ExamQualityIssue[] {
  const issues: ExamQualityIssue[] = []
  if (questions.length !== slots.length) issues.push({ questionNumbers: questions.map((q) => q.number), severity: 'bloqueante', reason: `A montagem tem ${questions.length} questão(ões), mas o desenho exige ${slots.length}.` })

  for (const slot of slots) {
    const question = questions.find((candidate) => candidate.number === slot.number)
    if (!question) {
      issues.push({ questionNumbers: [slot.number], severity: 'bloqueante', reason: 'A posição prevista no desenho da prova ficou sem questão.' })
      continue
    }
    if (question.type !== slot.type || question.curriculumUnitRowIndex !== slot.unitRowIndex) {
      issues.push({ questionNumbers: [slot.number], severity: 'bloqueante', reason: 'A questão não respeita o capítulo ou o tipo definidos no desenho da prova.' })
    }
  }

  for (let first = 0; first < questions.length; first++) {
    for (let second = first + 1; second < questions.length; second++) {
      const similarity = questionSimilarity(questions[first], questions[second])
      if (similarity >= 0.82) {
        issues.push({ questionNumbers: [questions[first].number, questions[second].number], severity: 'bloqueante', reason: 'As questões têm enunciados excessivamente semelhantes.' })
      }
    }
  }
  return issues
}

export function compactQuestionContext(questions: ExamQuestion[], omitNumber?: number): string {
  return questions.filter((question) => question.number !== omitNumber).map((question) => {
    const text = `${question.statement} ${question.bnccSummary ?? ''}`.replace(/\s+/g, ' ').trim()
    return `Q${question.number} [capítulo ${question.curriculumUnitRowIndex}, ${question.type}]: ${text.slice(0, 280)}`
  }).join('\n')
}
