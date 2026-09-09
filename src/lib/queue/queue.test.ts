import { describe, expect, it } from 'vitest'
import { buildGerarProvaJobPayloads, BatchValidationError } from './enqueue'
import { gerarAtividadeJobPayloadSchema, gerarProvaJobPayloadSchema, nextStatusAfterFailure, transcreverScanJobPayloadSchema } from './types'

const baseInput = {
  segment: 'anos-finais' as const,
  gradeYear: 8,
  academicYear: 2026,
  classLabel: '8º Ano B',
  subjects: ['História', 'Geografia', 'Português'],
  config: { bimester: 2, questionCount: 14 },
}

describe('buildGerarProvaJobPayloads', () => {
  it('expande N disciplinas em N payloads com a mesma config', () => {
    const payloads = buildGerarProvaJobPayloads(baseInput)
    expect(payloads).toHaveLength(3)
    expect(payloads.map((p) => p.subject)).toEqual(['História', 'Geografia', 'Português'])
    for (const p of payloads) {
      expect(p.segment).toBe('anos-finais')
      expect(p.gradeYear).toBe(8)
      expect(p.bimester).toBe(2)
      expect(p.questionCount).toBe(14)
      expect(p.classLabel).toBe('8º Ano B')
    }
  })

  it('deduplica e ignora disciplinas vazias/espaço', () => {
    const payloads = buildGerarProvaJobPayloads({
      ...baseInput,
      subjects: [' História ', 'História', '', '  ', 'Geografia'],
    })
    expect(payloads.map((p) => p.subject)).toEqual(['História', 'Geografia'])
  })

  it('rejeita batch sem nenhuma disciplina válida', () => {
    expect(() => buildGerarProvaJobPayloads({ ...baseInput, subjects: ['', '  '] })).toThrow(BatchValidationError)
  })

  it('rejeita questões do banco ENEM com mais de uma disciplina', () => {
    expect(() =>
      buildGerarProvaJobPayloads({
        ...baseInput,
        subjects: ['Matemática', 'Física'],
        config: { questionCount: 10, enemBankQuestionIds: [1, 2, 3] },
      }),
    ).toThrow(BatchValidationError)
  })

  it('aceita banco ENEM com disciplina única e valida o total 12-15', () => {
    const payloads = buildGerarProvaJobPayloads({
      ...baseInput,
      subjects: ['Matemática'],
      config: { questionCount: 10, enemBankQuestionIds: [1, 2, 3] },
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].enemBankQuestionIds).toEqual([1, 2, 3])
  })

  it('rejeita total de questões fora de 12-15 (regra da rota síncrona preservada)', () => {
    expect(() =>
      buildGerarProvaJobPayloads({ ...baseInput, config: { questionCount: 5 } }),
    ).toThrow(BatchValidationError)
    expect(() =>
      buildGerarProvaJobPayloads({
        ...baseInput,
        subjects: ['Matemática'],
        config: { questionCount: 10, enemBankQuestionIds: [1, 2, 3, 4, 5, 6] },
      }),
    ).toThrow(BatchValidationError)
  })
})

describe('gerarProvaJobPayloadSchema', () => {
  it('aceita prova só de banco ENEM (questionCount 0 + 12 do banco)', () => {
    const parsed = gerarProvaJobPayloadSchema.safeParse({
      segment: 'ensino-medio',
      gradeYear: 3,
      subject: 'Matemática',
      questionCount: 0,
      enemBankQuestionIds: Array.from({ length: 12 }, (_, i) => i + 1),
    })
    expect(parsed.success).toBe(true)
  })

  it('rejeita payload sem shape de job (JSONB não confiável)', () => {
    expect(gerarProvaJobPayloadSchema.safeParse({ foo: 'bar' }).success).toBe(false)
    expect(gerarProvaJobPayloadSchema.safeParse(null).success).toBe(false)
  })
})

describe('gerarAtividadeJobPayloadSchema', () => {
  const baseActivity = {
    academicYear: 2026,
    subject: 'Língua Portuguesa',
    questionCount: 12,
    bnccCodes: ['EM13LP01'],
  }

  it('aceita atividades do 1º ao 3º ano do Ensino Médio', () => {
    expect(gerarAtividadeJobPayloadSchema.safeParse({ ...baseActivity, segment: 'ensino-medio', gradeYear: 1 }).success).toBe(true)
    expect(gerarAtividadeJobPayloadSchema.safeParse({ ...baseActivity, segment: 'ensino-medio', gradeYear: 3 }).success).toBe(true)
  })

  it('rejeita séries incompatíveis com o segmento', () => {
    expect(gerarAtividadeJobPayloadSchema.safeParse({ ...baseActivity, segment: 'ensino-medio', gradeYear: 4 }).success).toBe(false)
    expect(gerarAtividadeJobPayloadSchema.safeParse({ ...baseActivity, segment: 'anos-iniciais', gradeYear: 1 }).success).toBe(false)
  })
})

describe('nextStatusAfterFailure', () => {
  it('volta pra pendente enquanto há tentativas sobrando', () => {
    expect(nextStatusAfterFailure(1, 2)).toBe('pendente')
  })

  it('vira erro definitivo na última tentativa (ou além)', () => {
    expect(nextStatusAfterFailure(2, 2)).toBe('erro')
    expect(nextStatusAfterFailure(3, 2)).toBe('erro')
  })
})

describe('transcreverScanJobPayloadSchema', () => {
  it('aceita somente referências opacas da página e da questão', () => {
    const parsed = transcreverScanJobPayloadSchema.safeParse({ examId: 30, pageId: 402, questionNumber: 11 })
    expect(parsed.success).toBe(true)
  })

  it('rejeita conteúdo do aluno no payload persistido', () => {
    expect(transcreverScanJobPayloadSchema.safeParse({ examId: 30, pageId: 402, questionNumber: 11, transcription: 'resposta manuscrita' }).success).toBe(false)
  })
})
