import { z } from 'zod'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { canonicalDomainsForSubject, type CanonicalDomainId } from './domains'
import { domainFitsContent } from './domainFit'
import { getRuleEngine, registeredRuleEngineIds } from './rules'
import { TRUTH_STRATEGIES, type TruthStrategy } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlueprintSlot = {
  slotNumber: number
  truthStrategy: TruthStrategy
  /** Preenchido pelo catálogo se calculável. */
  domain?: string
  /** Preenchido pelo catálogo se regra_deterministica. */
  ruleId?: string
  difficulty: 'facil' | 'media' | 'dificil'
  /** Ângulo/tema dentro da unidade curricular. */
  coreTopic: string
  /** Derivado do catálogo de regras/domínios, NÃO da IA. */
  needsVisual: boolean
  /** Derivado do catálogo, NÃO da IA. */
  needsSupportText: boolean
  questionType: 'objetiva' | 'descritiva'
  /** Referência à unidade curricular escolhida pelo professor. */
  unitRowIndex: number
  /** Currículo textual da unidade. */
  curriculumContent: string
}

export type BlueprintParams = {
  subject: string
  gradeYear: number
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  /** Orientação pedagógica tipada decidida antes do blueprint. */
  strategyInstruction?: string
  slots: Array<{
    number: number
    unitRowIndex: number
    type: 'objetiva' | 'descritiva'
    visualAid: 'auto' | 'obrigatorio' | 'sem_imagem'
    curriculumContent: string
    unitTitle: string
  }>
}

// ---------------------------------------------------------------------------
// Schema de saída da IA (1 chamada para a prova inteira)
// ---------------------------------------------------------------------------

const blueprintItemSchema = z.object({
  slotNumber: z.number().int().positive(),
  truthStrategy: z.enum(TRUTH_STRATEGIES),
  domain: z.string().nullable().optional(),
  ruleId: z.string().nullable().optional(),
  difficulty: z.enum(['facil', 'media', 'dificil']),
  coreTopic: z.string().min(3).max(200),
})

const blueprintSchema = z.object({
  slots: z.array(blueprintItemSchema).min(1),
})

const BLUEPRINT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slotNumber: { type: 'integer' },
          truthStrategy: { type: 'string', enum: [...TRUTH_STRATEGIES] },
          domain: { type: 'string', nullable: true },
          ruleId: { type: 'string', nullable: true },
          difficulty: { type: 'string', enum: ['facil', 'media', 'dificil'] },
          coreTopic: { type: 'string' },
        },
        required: ['slotNumber', 'truthStrategy', 'difficulty', 'coreTopic'],
      },
    },
  },
  required: ['slots'],
}

// ---------------------------------------------------------------------------
// Validação determinística do blueprint
// ---------------------------------------------------------------------------

/** Valida e enriquece cada slot do blueprint com dados do catálogo. */
export function validateAndEnrichBlueprint(
  params: BlueprintParams,
  parsed: z.infer<typeof blueprintSchema>,
): { slots: BlueprintSlot[]; issues: string[] } {
  const domains = canonicalDomainsForSubject(params.subject)
  const domainIds = new Set<string>(domains.map(d => d.id))
  const engineIds = new Set(registeredRuleEngineIds())
  const issues: string[] = []
  const enriched: BlueprintSlot[] = []

  for (const item of parsed.slots) {
    const inputSlot = params.slots.find(s => s.number === item.slotNumber)
    if (!inputSlot) {
      issues.push(`Slot ${item.slotNumber} não corresponde a nenhum slot da matriz do professor.`)
      continue
    }

    let truthStrategy = item.truthStrategy
    let domain = item.domain?.trim() || undefined
    let ruleId = item.ruleId?.trim() || undefined

    // Validar e corrigir estratégia
    if (truthStrategy === 'calculavel') {
      if (!domain || !domainIds.has(domain)) {
        issues.push(`Slot ${item.slotNumber}: domínio "${domain ?? 'ausente'}" inválido para calculável; rebaixado para fonte_ancorada.`)
        truthStrategy = 'fonte_ancorada'
        domain = undefined
      } else if (domainFitsContent(domain as CanonicalDomainId, `${inputSlot.unitTitle}\n${inputSlot.curriculumContent}`) === false) {
        // O recálculo por código só vale quando a questão pede a grandeza do domínio.
        // Capítulo de outro assunto (ex.: triângulos em "distância entre pontos")
        // vira questão ancorada em texto, conferida pelo juiz de qualidade.
        issues.push(`Slot ${item.slotNumber}: domínio "${domain}" fora do assunto do capítulo; rebaixado para fonte_ancorada.`)
        truthStrategy = 'fonte_ancorada'
        domain = undefined
      }
    } else if (truthStrategy === 'regra_deterministica') {
      if (!ruleId || !engineIds.has(ruleId)) {
        issues.push(`Slot ${item.slotNumber}: ruleId "${ruleId ?? 'ausente'}" inválido; rebaixado para fonte_ancorada.`)
        truthStrategy = 'fonte_ancorada'
        ruleId = undefined
      }
    } else {
      domain = undefined
      ruleId = undefined
    }

    // Derivar visual e support_text do catálogo, NÃO da IA
    const needsVisual = inputSlot.visualAid === 'obrigatorio' ||
      (inputSlot.visualAid === 'auto' && truthStrategy === 'calculavel' && !!domain &&
        ['function_graph', 'geometric_diagram', 'statistical_chart'].some(t =>
          domains.find(d => d.id === domain)?.title.toLowerCase().includes('gráfico') ?? false
        ))
    const needsSupportText = truthStrategy === 'fonte_ancorada' || truthStrategy === 'interpretativa'

    enriched.push({
      slotNumber: item.slotNumber,
      truthStrategy,
      domain,
      ruleId,
      difficulty: item.difficulty,
      coreTopic: item.coreTopic,
      needsVisual,
      needsSupportText,
      questionType: inputSlot.type,
      unitRowIndex: inputSlot.unitRowIndex,
      curriculumContent: inputSlot.curriculumContent,
    })
  }

  // Verificar se todos os slots da matriz foram cobertos
  for (const input of params.slots) {
    if (!enriched.some(s => s.slotNumber === input.number)) {
      issues.push(`Slot ${input.number} da matriz do professor não foi incluído no blueprint.`)
    }
  }

  return { slots: enriched, issues }
}

// ---------------------------------------------------------------------------
// Geração do blueprint (1 chamada IA)
// ---------------------------------------------------------------------------

export async function generateExamBlueprint(
  params: BlueprintParams,
): Promise<{ slots: BlueprintSlot[]; issues: string[] }> {
  const domains = canonicalDomainsForSubject(params.subject)
  const domainList = domains.map(d => `- ${d.id}: ${d.title}`).join('\n')
  const engines = registeredRuleEngineIds().map(id => {
    const engine = getRuleEngine(id)
    return engine ? `- ${engine.id}: ${engine.title}` : `- ${id}`
  }).join('\n')

  const slotDescriptions = params.slots.map(s =>
    `Slot ${s.number}: cap. "${s.unitTitle}"; tipo ${s.type}; visual ${s.visualAid}`,
  ).join('\n')

  const prompt = `Você é um planejador pedagógico. Distribua estratégias, dificuldade e ângulos temáticos para uma avaliação.

Disciplina: ${params.subject}. Série: ${params.gradeYear}º ano (${params.segment}).

${params.strategyInstruction ? `${params.strategyInstruction}\n` : ''}

Slots da matriz definida pelo professor (NÃO altere a quantidade nem os capítulos):
${slotDescriptions}

Estratégias de verdade disponíveis:
- "calculavel": resposta numérica recalculável. Domínios disponíveis:
${domainList || '(nenhum para esta disciplina)'}
- "regra_deterministica": regra gramatical/linguística. Motores disponíveis:
${engines || '(nenhum)'}
- "fonte_ancorada": fato de Humanas/Ciências ancorado literalmente no currículo.
- "interpretativa": leitura de texto/literatura.

Regras:
- Use "calculavel" APENAS se o capítulo tratar explicitamente do assunto do domínio escolhido (ex.: capítulo de porcentagem → percentage). Capítulo com números mas de outro assunto, geometria conceitual (triângulos, quadriláteros, ângulos, circunferências, construções, demonstrações) e conceitos sem cálculo do catálogo usam "fonte_ancorada". NUNCA force um domínio só porque o capítulo tem números.
- Use "regra_deterministica" APENAS para Língua Portuguesa com motores listados.
- NUNCA invente domínio ou ruleId fora das listas.
- Distribua dificuldade: ~30% fácil, ~50% média, ~20% difícil.
- Cada coreTopic deve ter um ângulo DIFERENTE dentro do mesmo capítulo.

Para cada slot, devolva: slotNumber, truthStrategy, domain (ou null), ruleId (ou null), difficulty, coreTopic.`

  const result = await generateValidatedStructuredContent({
    context: 'generation/blueprint',
    prompt,
    responseSchema: BLUEPRINT_RESPONSE_SCHEMA,
    zodSchema: blueprintSchema,
    maxAttempts: 3,
    validate: (parsed) => {
      const validated = validateAndEnrichBlueprint(params, parsed)
      const blocking = validated.issues.filter(i => i.includes('não corresponde') || i.includes('não foi incluído'))
      return {
        value: parsed,
        issues: blocking,
      }
    },
  })

  return validateAndEnrichBlueprint(params, result.value)
}
