const DEFAULT_MAX_STUDENT_ANSWER_CHARS = 4000

function redactSensitiveText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email ocultado]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf ocultado]')
    .replace(/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}\b/g, '[telefone ocultado]')
}

function maxStudentAnswerChars() {
  const configured = Number(process.env.AI_MAX_STUDENT_ANSWER_CHARS)
  if (Number.isInteger(configured) && configured > 0 && configured <= 12000) return configured
  return DEFAULT_MAX_STUDENT_ANSWER_CHARS
}

export function prepareStudentAnswerForAi(answer: string) {
  const normalized = redactSensitiveText(answer).replace(/\s+/g, ' ').trim()
  const limit = maxStudentAnswerChars()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}\n\n[resposta truncada para analise automatica]`
}
