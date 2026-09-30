/**
 * The grading model historically used a 0–10 contract.  Answers must instead
 * be stored on the question's point scale, including legacy exams that did
 * not snapshot a weight (which used one point in the correction UI).
 */
export function questionMaxGrade(question: { weight?: number }): number {
  const weight = Number(question.weight)
  return Number.isFinite(weight) && weight > 0 ? weight : 1
}

function roundGrade(value: number): number {
  // The correction flow already presents grades with two decimal places.
  return Math.round(value * 100) / 100
}

export function normalizeAiGrade(rawGrade: number, maxGrade: number): {
  rawGrade: number
  grade: number
  sourceScale: 'question' | '0-10'
} {
  const maximum = questionMaxGrade({ weight: maxGrade })
  const raw = Number.isFinite(rawGrade) ? Math.min(10, Math.max(0, rawGrade)) : 0
  const sourceScale = maximum < 10 && raw > maximum ? '0-10' : 'question'
  const converted = sourceScale === '0-10' ? raw / 10 * maximum : raw

  return {
    rawGrade: raw,
    grade: Math.min(maximum, Math.max(0, roundGrade(converted))),
    sourceScale,
  }
}
