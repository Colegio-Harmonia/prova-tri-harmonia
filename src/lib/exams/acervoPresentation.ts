import { JSDOM } from 'jsdom'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { stripLatexDelimiters } from '@/lib/math/latexRender'
import { normalizeMathText } from '@/lib/math/mathTextIntegrity'
import { originalAcervoMedia, type AcervoContentPart } from './acervoMedia'

/** Lê somente texto/estrutura do HTML da fonte. Nenhum HTML externo é executado. */
export function acervoHtmlToText(html: string, { restoreStyledScripts = true, imageText }: { restoreStyledScripts?: boolean; imageText?: (image: Element) => string } = {}): string {
  const fragment = JSDOM.fragment(html)
  fragment.querySelectorAll('script,style,iframe,object,template').forEach((element) => element.remove())
  // O acervo guarda MathML e uma cópia visual da mesma fórmula. Substitui
  // o conjunto pela anotação original para não repetir símbolos na impressão.
  fragment.querySelectorAll('math').forEach((math) => {
    const annotation = math.querySelector('annotation')?.textContent?.trim()
    if (!annotation) return
    let wrapper = math
    while (wrapper.parentElement?.tagName === 'SPAN') {
      const parent = wrapper.parentElement
      if (parent.querySelectorAll('math').length !== 1 || Array.from(parent.childNodes).some((child) => child.nodeType === 3 && child.textContent?.trim())) break
      wrapper = parent
    }
    wrapper.replaceWith(fragment.ownerDocument.createTextNode(`$${annotation}$`))
  })
  const visit = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/[\s\u00a0]+/g, ' ')
    if (node.nodeType !== 1 && node.nodeType !== 11) return ''
    const element = node as Element
    const tag = element.tagName
    if (tag === 'BR') return '\n'
    if (tag === 'IMG') return imageText?.(element) ?? ''
    if (['SVG', 'ANNOTATION'].includes(tag)) return ''
    const content = Array.from(node.childNodes).map(visit).join('')
    const verticalAlign = restoreStyledScripts ? element.getAttribute?.('style')?.match(/\bvertical-align\s*:\s*(super|sub)\b/i)?.[1]?.toLowerCase() : undefined
    if (tag === 'SUB' || tag === 'SUP' || verticalAlign) return `$${tag === 'SUB' || verticalAlign === 'sub' ? '_' : '^'}{${content.trim()}}$`
    if (tag === 'LI') return `\n• ${content.trim()}\n`
    if (['P', 'DIV', 'SECTION', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'TR'].includes(tag)) return `\n${content.trim()}\n`
    if (['TD', 'TH'].includes(tag)) return `${content}\t`
    return content
  }
  return visit(fragment).replace(/[^\S\n]+\n/g, '\n').replace(/\n[^\S\n]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

type SourceText = { texto?: string; html?: string }
export function acervoSourceText(original: SourceText): string {
  const plain = original.texto ?? ''
  if (!original.html?.trim()) return plain
  const formatted = acervoHtmlToText(original.html)
  // Não usa HTML divergente/incompleto como substituto do texto da API.
  const identity = (text: string) => stripLatexDelimiters(text).replace(/[\s$_^{}]+/g, '').replace(/\\[;,!]/g, '')
  return identity(formatted) === identity(plain) ? formatted : plain
}

function restoreField(current: string, original: SourceText | undefined): string {
  if (!original?.html?.trim() || typeof original.texto !== 'string') return current
  const comparable = (text: string) => normalizeMathText(text).replace(/\s+/g, ' ').trim()
  // Texto editado pelo professor sempre prevalece sobre a versão do acervo.
  if (current.includes('\n') && !original.texto.includes('\n')) return current
  if (comparable(current) !== comparable(original.texto)) {
    // Older imports flattened styled superscripts (x<span ...>2</span> -> x2).
    // Only restore that exact previous representation; teacher edits still win.
    if (!/vertical-align\s*:\s*(?:super|sub)\b/i.test(original.html)
      || comparable(current) !== comparable(acervoHtmlToText(original.html, { restoreStyledScripts: false }))) return current
  }
  return acervoSourceText(original) || current
}

function inlineContent(current: string, source: SourceText | undefined, allowedIds: Set<number>, alternative = false): AcervoContentPart[] | undefined {
  if (!source?.html || !/<img\b/i.test(source.html) || typeof source.texto !== 'string') return
  const formatted = acervoSourceText(source)
  // Legacy image-only alternatives were named "Figura A", "Figura B", etc.
  const legacyPlaceholder = alternative && !source.texto.trim() && /^Figura [A-Z]$/.test(current)
  if (!legacyPlaceholder && restoreField(current, source) === current && current !== formatted) return
  if (formatted !== acervoHtmlToText(source.html)) return
  const images = new Map<number, Extract<AcervoContentPart, { type: 'image' }>>()
  const withMarkers = acervoHtmlToText(source.html, { imageText: (image) => {
    const id = Number(image.getAttribute('src')?.match(/\/api\/media\/(\d+)(?:$|[?#])/)?.[1])
    const width = Number(image.getAttribute('style')?.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1])
    if (!allowedIds.has(id) || (!alternative && (!image.parentElement?.textContent?.trim() || width > 120))) return ''
    images.set(id, { type: 'image', mediaId: id, alt: image.getAttribute('alt') || 'Fórmula original', ...(width > 0 && width <= 800 ? { width } : {}) })
    return `\uFFF0${id}\uFFF1`
  } })
  if (!images.size) return
  const parts: AcervoContentPart[] = []
  let cursor = 0
  for (const match of withMarkers.matchAll(/\uFFF0(\d+)\uFFF1/g)) {
    if (match.index! > cursor) parts.push({ type: 'text', text: withMarkers.slice(cursor, match.index) })
    parts.push(images.get(Number(match[1]))!)
    cursor = match.index! + match[0].length
  }
  if (cursor < withMarkers.length) parts.push({ type: 'text', text: withMarkers.slice(cursor) })
  return parts
}

export function presentAcervoQuestion(question: ExamQuestion): ExamQuestion {
  if (question.source !== 'acervo' || !question.acervoRef) return question
  const original = question.acervoRef.original
  const resolution = original.resolucao as SourceText | undefined
  const answer = (original.gabarito as { resposta_discursiva?: string | null } | undefined)?.resposta_discursiva?.trim() || resolution?.texto
  // O HTML da resolução só substitui a resposta quando os conteúdos conferem.
  const answerSource = { texto: answer, html: resolution?.html }
  const criteriaPrefix = 'Avaliar a resposta em relação ao gabarito original: '
  const statement = restoreField(question.statement, original.enunciado as SourceText | undefined)
  const allowedIds = new Set(originalAcervoMedia(question).filter((media) => ['enunciado', 'alternativa'].includes(media.local)).map((media) => media.id))
  const statementParts = inlineContent(question.statement, original.enunciado as SourceText | undefined, allowedIds)
  const alternativeParts: Record<string, AcervoContentPart[]> = {}
  const alternatives = question.alternatives?.map((alternative, index) => {
    const originals = original.alternativas as Array<SourceText & { posicao: number }> | undefined
    const source = originals && [...originals].sort((a, b) => a.posicao - b.posicao)[index]
    const parts = inlineContent(alternative.text, source, allowedIds, true)
    if (parts) alternativeParts[alternative.letter] = parts
    return { ...alternative, text: restoreField(alternative.text, source) }
  }) ?? question.alternatives
  return {
    ...question,
    statement,
    acervoInlineContent: statementParts || Object.keys(alternativeParts).length ? { statement: statementParts, alternatives: alternativeParts } : undefined,
    expectedAnswer: question.expectedAnswer ? restoreField(question.expectedAnswer, answerSource) : question.expectedAnswer,
    commentedResolution: question.commentedResolution ? restoreField(question.commentedResolution, resolution) : question.commentedResolution,
    gradingCriteria: question.gradingCriteria?.startsWith(criteriaPrefix)
      ? criteriaPrefix + restoreField(question.gradingCriteria.slice(criteriaPrefix.length), answerSource)
      : question.gradingCriteria,
    alternatives,
  }
}

export function presentAcervoExam(exam: ExamGenerationResult): ExamGenerationResult {
  return { ...exam, questions: exam.questions.map(presentAcervoQuestion) }
}
