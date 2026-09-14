import katex from 'katex'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { isRenderableMath, splitLatexSegments } from './latexRender'

type TextField = { path: string; value: string | null | undefined; set: (value: string | null) => void }

const BARE_LATEX = /\\(?:frac|sqrt|dfrac|tfrac|text|mathrm|mathbf|overline|underline|left|right|cdot|times|div|pm|neq|leq|geq|theta|alpha|beta|gamma|pi|sin|cos|tan|log|ln|vec)(?:\{(?:[^{}]|\{[^{}]*\})*\})*/g
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

// A resposta estruturada é JSON. Quando o modelo escreve `\t` sem escapar a
// barra, o parser JSON a converte num TAB: `\\times` vira `\times`,
// `\\text` vira `\text` e assim por diante. Recuperamos apenas os comandos
// matemáticos conhecidos, sem tocar em tabs normais de texto.
const TAB_ESCAPED_LATEX: ReadonlyArray<[RegExp, string]> = [
  [/\thickspace\b/g, '\\;'],
  [/\times\b/g, '\\times'],
  [/\text(?=\{)/g, '\\text'],
  [/\tfrac\b/g, '\\tfrac'],
  [/\theta\b/g, '\\theta'],
  [/\tan\b/g, '\\tan'],
]

// `\\thickspace` é aceito por alguns geradores, mas não pelo renderer que
// usamos para a revisão/documentos. A forma LaTeX canônica `\\;` produz o
// mesmo espaçamento e funciona nos dois destinos.
function normalizeMathCompatibility(value: string): string {
  let result = value
  for (const [pattern, replacement] of TAB_ESCAPED_LATEX) result = result.replace(pattern, replacement)
  return result.replace(/\\thickspace\b/g, '\\;')
}

/**
 * Formata comandos LaTeX que a IA deixou soltos no meio do texto. Só faz
 * conversões recuperáveis; texto corrompido vira erro de validação e é
 * regenerado, em vez de ser silenciosamente mutilado.
 */
export function normalizeMathText(value: string): string {
  // \[...\] e \(...\) só viram fórmula quando o conteúdo é de fato matemático.
  // Reticências de trecho omitido (ex.: "\[…\]" de textos da ENEM) viram
  // colchetes/parênteses literais, nunca uma imagem de fórmula vazia.
  let result = normalizeMathCompatibility(value)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, content: string) => (isRenderableMath(content) ? `$$ ${content.trim()} $$` : `[${content}]`))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, content: string) => (isRenderableMath(content) ? `$$ ${content.trim()} $$` : `(${content})`))
  const segments = splitLatexSegments(result)
  if (!segments.some((segment) => segment.type === 'text')) return result
  return segments.map((segment) => {
    if (segment.type === 'math') return segment.display ? `$$${segment.latex}$$` : `$${segment.latex}$`
    return segment.content.replace(BARE_LATEX, (latex, offset, text) => {
      // Não toca em comandos já cobertos por delimitadores ou em uma barra
      // usada como escape de texto comum.
      const before = text.slice(0, offset)
      return before.endsWith('\\') ? latex : `$${latex}$`
    })
  }).join('')
}

function fieldsOf(question: ExamQuestion): TextField[] {
  const next = { ...question, alternatives: question.alternatives?.map((alternative) => ({ ...alternative })), pedagogicalClassification: { ...question.pedagogicalClassification, dok: { ...question.pedagogicalClassification.dok }, soloExpected: { ...question.pedagogicalClassification.soloExpected } } }
  const fields: TextField[] = [
    { path: 'enunciado', value: next.statement, set: (value) => { next.statement = value ?? '' } },
    { path: 'texto de apoio', value: next.supportText, set: (value) => { next.supportText = value } },
    { path: 'resposta esperada', value: next.expectedAnswer, set: (value) => { next.expectedAnswer = value } },
    { path: 'critérios de correção', value: next.gradingCriteria, set: (value) => { next.gradingCriteria = value } },
    { path: 'resolução comentada', value: next.commentedResolution, set: (value) => { next.commentedResolution = value } },
    { path: 'resumo BNCC', value: next.bnccSummary, set: (value) => { next.bnccSummary = value } },
    { path: 'justificativa DOK', value: next.pedagogicalClassification.dok.justification, set: (value) => { next.pedagogicalClassification.dok.justification = value ?? '' } },
    { path: 'evidência DOK', value: next.pedagogicalClassification.dok.evidence, set: (value) => { next.pedagogicalClassification.dok.evidence = value ?? '' } },
    { path: 'justificativa SOLO', value: next.pedagogicalClassification.soloExpected.justification, set: (value) => { next.pedagogicalClassification.soloExpected.justification = value ?? '' } },
    { path: 'evidência SOLO', value: next.pedagogicalClassification.soloExpected.evidence, set: (value) => { next.pedagogicalClassification.soloExpected.evidence = value ?? '' } },
  ]
  for (const alternative of next.alternatives ?? []) fields.push({ path: `alternativa ${alternative.letter}`, value: alternative.text, set: (value) => { alternative.text = value ?? '' } })
  ;(fields as TextField[] & { question?: ExamQuestion }).question = next
  return fields
}

export function normalizeAndValidateQuestionText(question: ExamQuestion): { question: ExamQuestion; issues: string[]; normalized: boolean } {
  const fields = fieldsOf(question)
  const normalizedQuestion = (fields as TextField[] & { question: ExamQuestion }).question
  const issues: string[] = []
  let normalized = false
  for (const field of fields) {
    if (field.value == null) continue
    if (CONTROL_CHARACTER.test(field.value) || field.value.includes('\uFFFD')) {
      issues.push(`Questão ${question.number}: ${field.path} contém caracteres de controle/corrompidos; gere novamente esse texto.`)
      continue
    }
    const text = normalizeMathText(field.value)
    if (text !== field.value) { field.set(text); normalized = true }
    for (const segment of splitLatexSegments(text)) {
      if (segment.type !== 'math') continue
      try {
        katex.renderToString(segment.latex, { throwOnError: true })
      } catch {
        issues.push(`Questão ${question.number}: fórmula inválida em ${field.path}; gere novamente a questão com LaTeX válido.`)
      }
    }
    const remaining = text.replace(/\$\$[\s\S]*?\$\$|\$[^$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '')
    if (/(?:\$\$|(?<![\p{L}\p{N}])\$|\\\(|\\\[)/u.test(remaining)) {
      issues.push(`Questão ${question.number}: delimitador matemático sem fechamento em ${field.path}; gere novamente a questão.`)
    }
  }
  return { question: normalizedQuestion, issues, normalized }
}
