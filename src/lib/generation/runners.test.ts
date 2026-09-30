import { describe, expect, it } from 'vitest'
import { canonicalDomainsForSubject } from './domains'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { fallbackAnchoredPlan, fallbackAnchoredTruth, unavailableAuditWarning, validateStage0Plan } from './runners'
import type { PipelineContext } from './types'

const ctx: PipelineContext = {
  questionNumber: 9,
  subject: 'Matemática',
  gradeYear: 2,
  segment: 'ensino-medio',
  curriculumContent: 'Funções e relações entre grandezas no cotidiano.',
  questionType: 'objetiva',
}

describe('contrato do estágio 0', () => {
  it('rejeita calculável sem domínio antes de o plano chegar ao gate', () => {
    const result = validateStage0Plan(ctx, {
      truthStrategy: 'calculavel',
      domain: null,
      ruleId: null,
      rationale: 'A questão exige um cálculo.',
    }, canonicalDomainsForSubject(ctx.subject))

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toContain('domain')
    expect(result.value.truthStrategy).toBe('fonte_ancorada')
  })

  it('aceita somente um domínio disponível para a disciplina', () => {
    const result = validateStage0Plan(ctx, {
      truthStrategy: 'calculavel',
      domain: 'percentage',
      ruleId: null,
      rationale: 'Porcentagem é calculável.',
    }, canonicalDomainsForSubject(ctx.subject))

    expect(result.issues).toEqual([])
    expect(result.value).toMatchObject({ truthStrategy: 'calculavel', domain: 'percentage' })
  })

  it('tem reserva ancorada apenas quando existe currículo verificável', () => {
    expect(fallbackAnchoredPlan(ctx)).toEqual({
      truthStrategy: 'fonte_ancorada',
      sourceMaterial: ctx.curriculumContent,
    })
    expect(fallbackAnchoredPlan({ ...ctx, curriculumContent: '   ' })).toBeNull()
  })

  it('mantém uma evidência literal local quando o JSON do estágio 1 falha', () => {
    const fallback = fallbackAnchoredTruth({ ...ctx, curriculumContent: 'Os álcoois possuem o grupo hidroxila ligado a um carbono saturado. Aldeídos apresentam carbonila terminal.' }, 'fonte_ancorada')
    expect(fallback?.sourceEvidence).toBe('Os álcoois possuem o grupo hidroxila ligado a um carbono saturado.')
    expect(fallback?.claim).toBe(fallback?.sourceEvidence)
  })

  it('transforma falha estrutural da auditoria complementar em alerta', () => {
    const warning = unavailableAuditWarning(new StructuredGenerationError(
      'Resposta da IA inválida após 3 tentativa(s).',
      'generation/stage5-1',
      3,
      ['issues: Required'],
      'validation_rejected',
    ))

    expect(warning).toEqual([expect.objectContaining({ severity: 'alerta', reason: expect.stringContaining('3 tentativa(s)') })])
    expect(unavailableAuditWarning(new Error('falha não estruturada'))).toBeNull()
  })
})
