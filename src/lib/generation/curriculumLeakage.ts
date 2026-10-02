import type { ExamQuestion } from '@/lib/gemini/examSchema'

/**
 * Gate determinístico contra vazamento do escopo curricular.
 *
 * O currículo (título do capítulo + conteúdos-foco da planilha) define o
 * ASSUNTO da questão; nunca pode ser fonte de redação. Este gate barra os
 * sintomas observados na prova #391 (02/10/2026): alternativa correta igual a
 * um título da planilha, resposta esperada descrevendo o capítulo, texto de
 * apoio abrindo com "10. Título do capítulo" e enunciado que repete o apoio.
 */

export type LeakageIssue = { severity: 'bloqueante' | 'alerta'; code: string; reason: string }

type QuestionText = Pick<ExamQuestion, 'type' | 'statement' | 'supportText' | 'alternatives' | 'correctLetter' | 'expectedAnswer'>

const MIN_FRAGMENT_WORDS_VERBATIM = 4
const MAX_HEADING_WORDS = 14

function normalize(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean)
}

/** Linguagem de planejamento que nunca deve aparecer numa resposta. */
const PLANNING_LANGUAGE = [
  /\bo estudo d[eoa]s?\b/,
  /\btrecho curricular\b/,
  /\bcurriculo\b/,
  /\bconteudos? foco\b/,
  /\brelacao tematica\b/,
  /\bcapitulo \d+\b/,
  /\best[a]? intitulad[oa]\b/,
  /\bo topico\b/,
]

export function curriculumFragments(curriculumContent: string): string[] {
  const fragments = new Set<string>()
  for (const line of curriculumContent.split(/\n+|;/)) {
    const cleaned = line.replace(/^\s*\d{1,2}[.)]\s*/, '').trim()
    if (words(cleaned).length >= 2) fragments.add(normalize(cleaned))
    for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) {
      if (words(sentence).length >= 2) fragments.add(normalize(sentence))
    }
  }
  return [...fragments]
}

function containsFragment(text: string, fragments: string[], minWords: number): string | null {
  const normalizedText = normalize(text)
  for (const fragment of fragments) {
    if (fragment.split(' ').length < minWords) continue
    if (normalizedText.includes(fragment)) return fragment
  }
  return null
}

function stem(word: string): string {
  return word.slice(0, 6)
}

function contentStems(text: string): string[] {
  return words(text).filter((word) => word.length >= 4).map(stem)
}

/** Resposta curta cujos termos já estão quase todos na própria pergunta. */
function isTautological(answer: string, statement: string): boolean {
  const answerStems = contentStems(answer)
  if (answerStems.length < 2 || answerStems.length > 5) return false
  const statementStems = new Set(contentStems(statement))
  const shared = answerStems.filter((item) => statementStems.has(item)).length
  return shared / answerStems.length >= 0.8
}

function answerTexts(question: QuestionText): Array<{ label: string; text: string }> {
  const items: Array<{ label: string; text: string }> = []
  if (question.type === 'objetiva') {
    for (const alternative of question.alternatives ?? []) {
      items.push({ label: `alternativa ${alternative.letter}`, text: alternative.text })
    }
  } else if (question.expectedAnswer) {
    items.push({ label: 'resposta esperada', text: question.expectedAnswer })
  }
  return items
}

export function curriculumLeakageIssues(question: QuestionText, curriculumContent: string): LeakageIssue[] {
  const issues: LeakageIssue[] = []
  const fragments = curriculumFragments(curriculumContent)

  // 1. Linguagem de planejamento ou trecho da planilha dentro das respostas.
  for (const { label, text } of answerTexts(question)) {
    const normalized = normalize(text)
    const planning = PLANNING_LANGUAGE.find((pattern) => pattern.test(normalized))
    if (planning) {
      issues.push({ severity: 'bloqueante', code: 'planning_language', reason: `[vazamento-curricular] A ${label} usa linguagem de planejamento ("${text.slice(0, 80)}"). Escreva a resposta com conteúdo da disciplina, não uma descrição do currículo.` })
      continue
    }
    const copied = containsFragment(text, fragments, MIN_FRAGMENT_WORDS_VERBATIM)
    const equalsTopic = fragments.includes(normalized) && words(text).length >= 2
    if (copied || equalsTopic) {
      issues.push({ severity: 'bloqueante', code: 'copied_curriculum', reason: `[vazamento-curricular] A ${label} reproduz um título ou tópico do currículo ("${text.slice(0, 80)}"). O currículo é só o assunto: redija a resposta do zero.` })
    }
  }

  // 2. Resposta correta que só repete os termos da pergunta.
  if (question.type === 'objetiva') {
    const correct = question.alternatives?.find((alternative) => alternative.letter === question.correctLetter)
    if (correct && isTautological(correct.text, question.statement)) {
      issues.push({ severity: 'bloqueante', code: 'tautological_answer', reason: `[vazamento-curricular] A alternativa correta ("${correct.text.slice(0, 80)}") apenas repete os termos da pergunta e não a responde.` })
    }
  }

  // 3. Texto de apoio com título/numeração de capítulo da planilha.
  const support = question.supportText ?? ''
  for (const line of support.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const withoutNumber = trimmed.replace(/^\d{1,2}[.)]\s*/, '')
    const lineWords = words(withoutNumber)
    if (lineWords.length < 2 || lineWords.length > MAX_HEADING_WORDS) continue
    const normalizedLine = normalize(withoutNumber)
    if (fragments.some((fragment) => fragment === normalizedLine || (fragment.includes(normalizedLine) && lineWords.length >= 2))) {
      issues.push({ severity: 'bloqueante', code: 'support_heading', reason: `[vazamento-curricular] O texto de apoio contém uma linha que é título ou tópico do currículo ("${trimmed.slice(0, 80)}"). O apoio deve ser um texto ou dado escrito para o aluno, sem cabeçalhos da planilha.` })
      break
    }
  }
  return issues
}

const LEAD_IN = /^\s*(?:leia|releia|observe|considere|analise)\s+(?:o|a|os|as)?\s*(?:texto|trecho|dados?|tabela|gr[aá]fico|figura)?\s*(?:a seguir|abaixo|acima)?\s*[:.]?\s*/i

/**
 * Normalização de apresentação: remove do enunciado a cópia integral do texto
 * de apoio (o aluno já o vê na caixa de apoio) e o rótulo "Leia o texto a
 * seguir." que a IA coloca dentro do próprio apoio.
 */
export function normalizeQuestionPresentation<T extends Pick<ExamQuestion, 'statement' | 'supportText'>>(question: T): T {
  const support = question.supportText?.trim()
  if (!support) return question

  let statement = question.statement
  const flatSupport = support.replace(/\s+/g, ' ')
  const flatStatement = statement.replace(/\s+/g, ' ')
  if (flatSupport.length >= 40 && flatStatement.includes(flatSupport)) {
    const cleaned = flatStatement.replace(flatSupport, ' ').replace(/\s{2,}/g, ' ').trim()
    // "Considere o trecho abaixo e responda:" sobra sem sentido? mantém só se houver pergunta real.
    if (cleaned.length >= 20) statement = cleaned.replace(/^[\s:,.-]+/, '')
  }

  const supportText = support.replace(LEAD_IN, (match) => (match.trim().length >= 6 ? '' : match)).trim()
  return { ...question, statement, supportText: supportText || support }
}
