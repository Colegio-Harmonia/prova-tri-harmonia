// Confere se a descrição digitada na planilha corresponde à habilidade
// oficial da BNCC do código informado. A busca do texto oficial é consulta
// por código (bnccDescriptions.ts); a comparação semântica usa o Jev
// (TypeSafe System One), que devolve a probabilidade de "mesma habilidade".
//
// Decisões:
// - Só verifica linhas com descrição na planilha e texto oficial disponível.
//   Sem descrição, o sistema já usa o texto oficial: não há o que conferir.
// - Nunca bloqueia a importação nem altera o texto: só sinaliza para a
//   coordenação revisar a planilha na origem.
// - Falha aberta: sem TYPESAFE_API_KEY, timeout ou erro do provedor, a linha
//   volta como `nao_verificado` e a tela segue funcionando.
// - Faixas calibradas no teste de 30/09/2026 (74/74 casos sintéticos:
//   truncados x habilidades vizinhas do mesmo componente). Truncamento que
//   apaga a parte distintiva ficou em ~0,82, por isso a faixa de revisão.

import { resolveBnccDescriptions } from './bnccDescriptions'
import { evaluateWithJev, type JevAnswers } from '@/lib/ai/jevClient'
import { descriptionCheckKey, normalizeSkillCode, type DescriptionCheck, type DescriptionCheckStatus } from './skillDescriptionTypes'

export { descriptionCheckKey, normalizeSkillCode, type DescriptionCheck, type DescriptionCheckStatus } from './skillDescriptionTypes'

export const DESCRIPTION_MATCH_THRESHOLD = 0.8
export const DESCRIPTION_MISMATCH_THRESHOLD = 0.2
const QUESTIONS_PER_REQUEST = 20
const DESCRIPTION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

type SkillInput = { code: string; description: string | null }
type FetchLike = typeof fetch

export function classifyDescriptionProbability(probability: number): DescriptionCheckStatus {
  if (probability >= DESCRIPTION_MATCH_THRESHOLD) return 'confere'
  if (probability <= DESCRIPTION_MISMATCH_THRESHOLD) return 'diverge'
  return 'revisar'
}

export function buildDescriptionQuestion(code: string, officialDescription: string, spreadsheetDescription: string) {
  return {
    type: 'noul' as const,
    instructions: {
      codigo: code,
      descricao_oficial_bncc: officialDescription,
      descricao_na_planilha: spreadsheetDescription,
      pergunta: 'A `descricao_na_planilha` se refere à mesma habilidade da BNCC descrita em `descricao_oficial_bncc` (código `codigo`)?',
    },
    criteria: {
      true: 'Mesma habilidade: o texto da planilha é igual, resumido, truncado ou parafraseado, mantendo o mesmo objeto de conhecimento e a mesma ação esperada do aluno.',
      false: 'Habilidade diferente: o texto da planilha trata de outro objeto de conhecimento ou de outra ação, mesmo que seja da mesma disciplina ou tenha vocabulário parecido.',
    },
  }
}

type PendingCheck = { key: string; code: string; spreadsheetDescription: string; officialDescription: string }

function routeDescriptionBatch(answers: JevAnswers) {
  const values = Object.values(answers).filter((answer) => answer.type === 'noul').map((answer) => answer.noul)
  const needsReview = values.length === 0 || values.some((value) => value > DESCRIPTION_MISMATCH_THRESHOLD && value < DESCRIPTION_MATCH_THRESHOLD)
  return { route: needsReview ? 'review' as const : 'automatic' as const, outcome: needsReview ? 'description_review_required' : 'description_checks_completed' }
}

async function askJev(batch: PendingCheck[], apiKey: string, fetchImpl: FetchLike, persistDecisions: boolean): Promise<Map<string, number>> {
  const questions = Object.fromEntries(batch.map((item, index) => [`q${index}`, buildDescriptionQuestion(item.code, item.officialDescription, item.spreadsheetDescription)]))
  const result = await evaluateWithJev({
    operation: 'jev/curriculum/description-match',
    questionVersion: '2026-09-30.v1',
    state: { contexto: 'Conferência de planejamento pedagógico: a coordenação quer saber se a descrição digitada na planilha corresponde ao código BNCC informado.' },
    questions,
    route: routeDescriptionBatch,
    fallback: { answers: {}, routing: { route: 'fallback', outcome: 'description_check_unavailable' } },
    context: { feature: 'planning', skillCount: batch.length },
    cacheTtlMs: DESCRIPTION_CACHE_TTL_MS,
    apiKey,
    fetchImpl,
    store: persistDecisions ? undefined : null,
    telemetry: persistDecisions ? undefined : null,
    reserveOperation: persistDecisions ? undefined : null,
  })
  const probabilities = new Map<string, number>()
  batch.forEach((item, index) => {
    const answer = result.answers[`q${index}`]
    if (answer?.type === 'noul') probabilities.set(item.key, answer.noul)
  })
  return probabilities
}

export async function checkSkillDescriptions(
  skills: SkillInput[],
  options: {
    apiKey?: string
    fetchImpl?: FetchLike
    resolveOfficial?: (codes: string[]) => Promise<ReadonlyMap<string, string>>
    /** Testes unitários podem desativar banco e telemetria; produção mantém ambos. */
    persistDecisions?: boolean
  } = {},
): Promise<DescriptionCheck[]> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY
  const fetchImpl = options.fetchImpl ?? fetch
  const resolveOfficial = options.resolveOfficial ?? resolveBnccDescriptions
  const persistDecisions = options.persistDecisions ?? true

  const unique = new Map<string, { code: string; spreadsheetDescription: string }>()
  for (const skill of skills) {
    const description = skill.description?.trim()
    if (!description) continue
    unique.set(descriptionCheckKey(skill.code, description), { code: normalizeSkillCode(skill.code), spreadsheetDescription: description })
  }
  if (unique.size === 0) return []

  const official = await resolveOfficial([...new Set([...unique.values()].map((item) => item.code))])
  const pending: PendingCheck[] = []
  for (const [key, item] of unique) {
    const officialDescription = official.get(item.code)
    if (officialDescription) pending.push({ key, ...item, officialDescription })
  }

  const probabilities = new Map<string, number>()
  if (apiKey && pending.length) {
    for (let index = 0; index < pending.length; index += QUESTIONS_PER_REQUEST) {
      const batch = pending.slice(index, index + QUESTIONS_PER_REQUEST)
      try {
        for (const [key, value] of await askJev(batch, apiKey, fetchImpl, persistDecisions)) probabilities.set(key, value)
      } catch (error) {
        console.warn('[curriculum/description-check] verificação indisponível:', error instanceof Error ? error.message : error)
      }
    }
  }

  return [...unique].map(([key, item]) => {
    const probability = probabilities.get(key) ?? null
    return {
      code: item.code,
      spreadsheetDescription: item.spreadsheetDescription,
      officialDescription: official.get(item.code) ?? null,
      status: probability === null ? 'nao_verificado' : classifyDescriptionProbability(probability),
      probability,
    }
  })
}
