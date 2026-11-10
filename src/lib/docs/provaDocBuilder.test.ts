import { describe, expect, it } from 'vitest'

import {
  hasLatexSegments,
  splitLatexSegments,
  stripLatexDelimiters,
  IMAGE_ALTERNATIVE_PLACEHOLDER,
} from '@/lib/math/latexRender'
import { collectTexts } from '@/lib/docs/latexImageCache'
import { buildOpsRequests, buildProvaOps, questionImageSize } from '@/lib/docs/provaDocBuilder'
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

function objectiveQuestion(number: number, alternatives: NonNullable<ExamQuestion['alternatives']>): ExamQuestion {
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

  it('insere a figura original da alternativa quando o banco ENEM trouxe a imagem (exam #586, ENEM 2013/151)', () => {
    const exam = examWith([
      objectiveQuestion(7, [
        { letter: 'A', text: NULL_TEXT, image: { driveFileId: 'alt-a', previewUrl: 'https://drive/alt-a' } },
        { letter: 'B', text: 'alternativa com texto' },
      ]),
    ])
    const ops = buildProvaOps(exam, new Map(), new Map())
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'image', driveFileId: 'alt-a' }))
    expect(renderedText(ops)).not.toContain(IMAGE_ALTERNATIVE_PLACEHOLDER)
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

describe('negrito nos verbos de comando do enunciado', () => {
  const boldTexts = (ops: ReturnType<typeof buildProvaOps>) =>
    ops.filter((op): op is { kind: 'text'; text: string; bold?: boolean } => op.kind === 'text' && !!op.bold).map((op) => op.text)

  function discursive(statement: string, supportText?: string): ExamQuestion {
    return { ...objectiveQuestion(1, []), source: 'ia', type: 'descritiva', alternatives: null, correctLetter: null, statement, supportText }
  }

  it('Fundamental: negrita só os verbos de comando do enunciado e preserva o texto', () => {
    const exam = examWith([discursive('Leia o texto e explique o que o autor quis dizer.', 'Texto: cite as palavras do poeta.')])
    exam.metadata.segment = 'anos-finais'
    const ops = buildProvaOps(exam, new Map(), new Map())
    expect(boldTexts(ops)).toEqual(['Leia', 'explique'])
    expect(renderedText(ops)).toContain('1. Texto: cite as palavras do poeta.\nLeia o texto e explique o que o autor quis dizer.')
  })

  it('Ensino Médio: sem negrito', () => {
    const exam = examWith([discursive('Explique o fenômeno.')])
    expect(boldTexts(buildProvaOps(exam, new Map(), new Map()))).toEqual([])
  })

  it('não negrita alternativas', () => {
    const q = { ...objectiveQuestion(1, [{ letter: 'A', text: 'Cite o autor' }]), statement: 'Assinale a correta.' }
    const exam = examWith([q])
    exam.metadata.segment = 'anos-iniciais'
    expect(boldTexts(buildProvaOps(exam, new Map(), new Map()))).toEqual(['Assinale'])
  })
})


describe('origem da questão no documento da prova', () => {
  it.each([['TECHY', 'Importado do Techy'], ['SAE', 'Importado do SAE']])('imprime crédito para original %s sem banca', (origin, attribution) => {
    const imported = { ...objectiveQuestion(1, []), source: 'acervo' as const, acervoRef: { questionId: 10, origin, externalId: null, portalUrl: null, importedAt: '', original: {} } }
    const text = renderedText(buildProvaOps(examWith([imported]), new Map(), new Map()))
    expect(text).toContain(`(${attribution})`)
    expect(text).not.toContain('IMPORTADA DO')
  })

  it('imprime banca e ano da API e omite etiquetas internas', () => {
    const ai = { ...objectiveQuestion(1, []), source: 'ia' as const }
    const imported = { ...objectiveQuestion(2, []), source: 'acervo' as const, acervoRef: { questionId: 10, origin: 'SAE', externalId: null, portalUrl: null, importedAt: new Date().toISOString(), original: { origem: { banca: { label: 'UEFS - BA', value: '356' }, ano: 2015 } } } }
    const ops = buildProvaOps(examWith([ai, imported]), new Map(), new Map())
    const text = ops.filter((op) => op.kind === 'text').map((op) => op.text).join('')
    expect(text).not.toContain('GERADO POR IA')
    expect(text).toContain('(UEFS - BA — 2015)')
    expect(text).not.toContain('IMPORTADA DO SAE')
  })
})


describe('mídia original importada nos documentos', () => {
  it('inclui a imagem original legada mesmo sem aceite manual e omite substituta pendente', () => {
    const original = { ...objectiveQuestion(1, [{ letter: 'A', text: 'Opção' }]), enemBankRef: { questionId: 1, year: 2020 }, image: { source: 'enem' as const, driveFileId: 'original', previewUrl: '/image', approved: false } }
    const originalOps = buildProvaOps(examWith([original]), new Map(), new Map())
    expect(originalOps).toContainEqual({ kind: 'image', driveFileId: 'original' })
    const replaced = { ...original, image: { ...original.image, source: 'gerada' as const } }
    expect(buildProvaOps(examWith([replaced]), new Map(), new Map())).not.toContainEqual({ kind: 'image', driveFileId: 'original' })
  })
})


describe('tamanho proporcional de figuras no documento', () => {
  it('preserva a proporção de um gráfico largo e de uma imagem vertical', () => {
    expect(questionImageSize(1000, 250)).toEqual({ widthPt: 420, heightPt: 105 })
    expect(questionImageSize(200, 1000)).toEqual({ widthPt: 60, heightPt: 300 })
  })
  it('usa dimensões salvas na imagem ao inserir no documento', () => {
    const question = { ...objectiveQuestion(1, []), image: { source: 'enem' as const, approved: true, driveFileId: 'chart', previewUrl: '/chart', width: 1000, height: 250 } }
    expect(buildProvaOps(examWith([question]), new Map(), new Map())).toContainEqual({ kind: 'image', driveFileId: 'chart', size: { widthPt: 420, heightPt: 105 } })
  })
})


describe('quebras originais do acervo no Google Docs', () => {
  it('mantém parágrafos e uma afirmativa por linha em questão antiga achatada', () => {
    const raw = {
      texto: 'Identifique V ou F: ( ) Primeira afirmativa. ( ) Segunda afirmativa. Assinale a alternativa.',
      html: '<p>Identifique V ou F:</p><p>( ) Primeira afirmativa.<br/>( ) Segunda afirmativa.</p><p>Assinale a alternativa.</p>',
    }
    const q = { ...objectiveQuestion(3, []), source: 'acervo' as const, statement: raw.texto, acervoRef: { questionId: 1, origin: 'ARCO', externalId: null, portalUrl: null, importedAt: '', original: { enunciado: raw } } }
    const ops = buildProvaOps(examWith([q]), new Map(), new Map())
    expect(renderedText(ops)).toContain('3. Identifique V ou F:\n\n( ) Primeira afirmativa.\n( ) Segunda afirmativa.\n\nAssinale a alternativa.')
    const requests = buildOpsRequests(ops, 1)
    expect(requests.flatMap((r) => r.insertText?.text ?? []).join('')).toContain('\n( ) Segunda afirmativa.')
  })
})
