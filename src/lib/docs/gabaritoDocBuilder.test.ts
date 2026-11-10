import { describe, expect, it, vi } from 'vitest'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
vi.mock('./acervoImageCache', () => ({ buildAcervoImageCache: vi.fn() }))
import { buildGabaritoOps } from './gabaritoDocBuilder'
import { buildProvaOps } from './provaDocBuilder'

const exam: ExamGenerationResult = {
  metadata: { segment: 'ensino-medio', gradeYear: 1, subject: 'Matemática', questionCount: 1, objectiveCount: 0, discursiveCount: 1, alternativesCount: 5 },
  questions: [{ number: 4, source: 'acervo', type: 'descritiva', bloomLevel: 'compreender', statement: 'Expresse a distância entre o avião e o radar.', expectedAnswer: 'A distância é dada pela fórmula:', gradingCriteria: 'Aplicar Pitágoras.', bnccCodes: [], bnccStatus: 'nao_mapeado', needsImage: false, saeb: { applicable: false, approximate: false }, pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' } },
    acervoRef: { questionId: 1, origin: 'ARCO', externalId: null, portalUrl: null, importedAt: '', original: { midias: [{ id: 1000000076239, local: 'resolucao' }] } },
  }],
}

describe('fórmulas do gabarito original em imagem', () => {
  it('insere a fração no meio do enunciado da prova do aluno', () => {
    const source = { texto: 'Gasta do salário.', html: '<p>Gasta <img src="/api/media/10"/> do salário.</p>' }
    const inlineExam = { ...exam, questions: [{ ...exam.questions[0]!, statement: 'Gasta  do salário.', acervoRef: { ...exam.questions[0]!.acervoRef!, original: { enunciado: source, midias: [{ id: 10, local: 'enunciado' }] } } }] }
    const ops = buildProvaOps(inlineExam, new Map(), new Map(), { originalMedia: new Map([[10, { driveFileId: 'fraction', widthPt: 12, heightPt: 18 }]]) })
    const index = ops.findIndex((op) => op.kind === 'image' && op.driveFileId === 'fraction')
    expect(index).toBeGreaterThan(0)
    expect(ops[index - 1]).toMatchObject({ kind: 'text', text: 'Gasta ' })
    expect(ops[index + 1]).toMatchObject({ kind: 'text', text: ' do salário.' })
  })
  it('inclui a imagem da resolução no gabarito e mantém o número em negrito', () => {
    const ops = buildGabaritoOps(exam, new Map(), new Map([[1000000076239, { driveFileId: 'answer-formula', widthPt: 240, heightPt: 60 }]]))
    expect(ops).toContainEqual({ kind: 'image', driveFileId: 'answer-formula', size: { widthPt: 240, heightPt: 60 } })
    expect(ops[0]).toEqual({ kind: 'text', text: '4. ', bold: true })
  })
  it('preserva a indicação da imagem quando não está disponível', () => {
    const ops = buildGabaritoOps(exam, new Map(), new Map())
    expect(ops).toContainEqual({ kind: 'text', text: 'Imagem da resolução original indisponível.' })
  })
  it('não inclui a fórmula da resposta na prova do aluno', () => {
    expect(buildProvaOps(exam, new Map(), new Map()).some((op) => op.kind === 'image')).toBe(false)
  })
})
