import type { ExamQuestion } from '@/lib/gemini/examSchema'

const MIN_SUPPORT_TEXT_CHARACTERS = 60
const MIN_SUPPORT_TEXT_WORDS = 8

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A referência a uma leitura precisa ter a fonte visível; título não é texto. */
export function missingRequiredSupportTextReason(question: Pick<ExamQuestion, 'statement' | 'supportText'>): string | null {
  const statement = normalize(question.statement)
  const referencesExternalText =
    /\b(?:texto|trecho|excerto|artigo|poema|cronica|narrativa)\s+(?:acima|abaixo|a seguir|apresentad[oa])\b/.test(statement) ||
    /\b(?:de acordo com|com base no|a partir d[ae]|segundo|conforme|pela leitura d[eo]|no|na|do|da|pelo|pela|sobre o|sobre a)\s+(?:[a-z]+\s+){0,2}(?:texto|trecho|excerto|artigo|poema|cronica|narrativa|capitulo|material didatico)\b/.test(statement) ||
    /\b(?:leia|releia|observe|analise|interprete)\s+(?:[a-z]+\s+){0,2}(?:texto|trecho|excerto|artigo|poema|cronica|narrativa|capitulo|material didatico)\b/.test(statement) ||
    /\b(?:capitulo|material didatico)\b/.test(statement)

  if (!referencesExternalText) return null

  const supportText = (question.supportText ?? '').trim()
  const words = normalize(supportText).match(/[\p{L}\p{N}]+/gu) ?? []
  if (supportText.length >= MIN_SUPPORT_TEXT_CHARACTERS && words.length >= MIN_SUPPORT_TEXT_WORDS) return null

  return 'O enunciado referencia texto, capítulo ou material didático, mas o texto de apoio está ausente ou contém apenas um título/rótulo.'
}
