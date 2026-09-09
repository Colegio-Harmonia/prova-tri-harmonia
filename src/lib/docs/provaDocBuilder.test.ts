import { describe, expect, it } from 'vitest'

import {
  hasLatexSegments,
  splitLatexSegments,
  stripLatexDelimiters,
  IMAGE_ALTERNATIVE_PLACEHOLDER,
} from '@/lib/math/latexRender'
import { collectTexts } from '@/lib/docs/latexImageCache'
import { buildOpsRequests, buildProvaOps } from '@/lib/docs/provaDocBuilder'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'

// Regressões reais do exam #31 (Química, banco ENEM):
// 1. Alternativa em imagem chega com `text: null` e derrubava a geração
//    ("Cannot read properties of null (reading 'matchAll')").
// 2. O documento imprimia o enunciado ANTES do texto de apoio, deixando a
//    questão incompreensível (o enunciado do ENEM é continuação do apoio).

const pedagogical: ExamQuestion['pedagogicalClassification'] = {
  dok: { categoryCode: 'DOK_2', confidence: 0.7, justification: 'teste', evidence: 'teste' },
  soloExpected: { categoryCode: 'MULTIESTRUTURAL', confidence: 0.7, justification: 'teste', evidence: 'teste' },
}

function objectiveQuestion(number: number, alternatives: { letter: string; text: string }[]): ExamQuestion {
  return {
    number,
    source: 'enem_bank',
    type: 'objetiva',
    bloomLevel: 'aplicar',
    statement: `Enunciado ${number}`,
    alternatives,
    correctLetter: 'A',
    bnccCodes: [],
    bnccStatus: 'nao_mapeado',
    pedagogicalClassification: pedagogical,
    saeb: { applicable: false, approximate: false },
    needsImage: false,
  }
}

function examWith(questions: ExamQuestion[]): ExamGenerationResult {
  return {
    metadata: {
      segment: 'ensino-medio',
      gradeYear: 2,
      subject: 'Química',
      questionCount: questions.length,
      objectiveCount: questions.filter((q) => q.type === 'objetiva').length,
      discursiveCount: questions.filter((q) => q.type === 'descritiva').length,
      alternativesCount: 5,
    },
    questions,
  }
}

// `text: null` viola o schema (tipado como string) mas é o dado real do
// ENEM importado — o cast reproduz exatamente esse caso.
const NULL_TEXT = null as unknown as string

/** Concatena só as ops de texto, na ordem em que entram no documento. */
function renderedText(ops: ReturnType<typeof buildProvaOps>): string {
  return ops
    .filter((op): op is { kind: 'text'; text: string; bold?: boolean } => op.kind === 'text')
    .map((op) => op.text)
    .join('')
}

describe('funções de LaTeX null-safe (raiz do crash matchAll)', () => {
  it('não lançam com null/undefined', () => {
    expect(() => splitLatexSegments(null)).not.toThrow()
    expect(() => splitLatexSegments(undefined)).not.toThrow()
    expect(splitLatexSegments(null)).toEqual([])
    expect(hasLatexSegments(null)).toBe(false)
    expect(hasLatexSegments(undefined)).toBe(false)
    expect(stripLatexDelimiters(null)).toBe('')
  })

  it('continuam separando fórmula de texto normalmente', () => {
    expect(splitLatexSegments('area $x^2$ fim')).toHaveLength(3)
    expect(hasLatexSegments('nada de fórmula aqui')).toBe(false)
    expect(hasLatexSegments('tem $y$ sim')).toBe(true)
    expect(stripLatexDelimiters('vale $z$ ok')).toBe('vale z ok')
  })

  it('o marcador de alternativa-imagem é uma string não vazia', () => {
    expect(typeof IMAGE_ALTERNATIVE_PLACEHOLDER).toBe('string')
    expect(IMAGE_ALTERNATIVE_PLACEHOLDER.length).toBeGreaterThan(0)
  })
})

describe('geração de documento com alternativa-imagem (text null)', () => {
  it('collectTexts descarta os textos null antes de renderizar fórmula', () => {
    const exam = examWith([
      objectiveQuestion(1, [
        { letter: 'A', text: NULL_TEXT },
        { letter: 'B', text: 'alternativa com texto' },
      ]),
    ])
    const texts = collectTexts(exam)
    expect(texts.every((t) => typeof t === 'string')).toBe(true)
    expect(texts).toContain('alternativa com texto')
  })

  it('buildProvaOps não quebra e marca a alternativa-imagem no lugar do branco', () => {
    const exam = examWith([
      objectiveQuestion(1, [
        { letter: 'A', text: NULL_TEXT },
        { letter: 'B', text: 'alternativa com texto' },
      ]),
    ])
    const allText = renderedText(buildProvaOps(exam, new Map(), new Map()))
    expect(allText).toContain(IMAGE_ALTERNATIVE_PLACEHOLDER)
    expect(allText).toContain('alternativa com texto')
  })
})

describe('ordem de impressão da questão', () => {
  it('imprime o texto de apoio ANTES do enunciado, com o número abrindo o bloco', () => {
    const question = objectiveQuestion(10, [{ letter: 'A', text: 'alternativa' }])
    question.supportText = 'CONTEXTO das panelas de pressão'
    question.statement = 'ENUNCIADO que continua o contexto'

    const allText = renderedText(buildProvaOps(examWith([question]), new Map(), new Map()))

    expect(allText.indexOf('CONTEXTO das panelas de pressão')).toBeLessThan(
      allText.indexOf('ENUNCIADO que continua o contexto'),
    )
    // o número abre o bloco, colado no texto de apoio
    expect(allText).toContain('10. CONTEXTO das panelas de pressão')
  })

  it('sem texto de apoio, o número abre direto no enunciado', () => {
    const question = objectiveQuestion(3, [{ letter: 'A', text: 'alternativa' }])
    question.statement = 'ENUNCIADO autossuficiente'

    const allText = renderedText(buildProvaOps(examWith([question]), new Map(), new Map()))

    expect(allText).toContain('3. ENUNCIADO autossuficiente')
  })

  it('mantém o enunciado antes das alternativas', () => {
    const question = objectiveQuestion(5, [{ letter: 'A', text: 'PRIMEIRA alternativa' }])
    question.supportText = 'APOIO'
    question.statement = 'ENUNCIADO'

    const allText = renderedText(buildProvaOps(examWith([question]), new Map(), new Map()))

    expect(allText.indexOf('APOIO')).toBeLessThan(allText.indexOf('ENUNCIADO'))
    expect(allText.indexOf('ENUNCIADO')).toBeLessThan(allText.indexOf('PRIMEIRA alternativa'))
  })
})

describe('tipografia do corpo da prova', () => {
  it('remove o negrito herdado do marcador do template para número, enunciado e alternativas', () => {
    const question = objectiveQuestion(1, [{ letter: 'A', text: 'Alternativa normal' }])
    const ops = buildProvaOps(examWith([question]), new Map(), new Map())
    const textOps = ops.filter((op): op is { kind: 'text'; text: string; bold?: boolean } => op.kind === 'text')

    expect(textOps.every((op) => op.bold !== true)).toBe(true)

    const requests = buildOpsRequests(ops, 12)
    const boldUpdates = requests
      .flatMap((request) => request.updateTextStyle ? [request.updateTextStyle.textStyle?.bold] : [])

    expect(boldUpdates).toHaveLength(textOps.length)
    expect(boldUpdates.every((bold) => bold === false)).toBe(true)
  })
})
