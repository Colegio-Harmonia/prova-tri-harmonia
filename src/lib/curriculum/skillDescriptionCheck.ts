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

export const DESCRIPTION_MATCH_THRESHOLD = 0.8
export const DESCRIPTION_MISMATCH_THRESHOLD = 0.2
const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const QUESTIONS_PER_REQUEST = 20
const REQUEST_TIMEOUT_MS = 8000

export type DescriptionCheckStatus = 'confere' | 'revisar' | 'diverge' | 'nao_verificado'

export type DescriptionCheck = {
  code: string
  spreadsheetDescription: string
  officialDescription: string | null
  status: DescriptionCheckStatus
  /** Probabilidade (0–1) de a planilha descrever a mesma habilidade; null quando não verificado. */
  probability: number | null
}

type SkillInput = { code: string; description: string | null }
type FetchLike = typeof fetch

export function normalizeSkillCode(code: string) {
  return code.trim().toUpperCase()
}

/** Chave estável de uma linha verificada: o mesmo código pode vir com textos diferentes. */
export function descriptionCheckKey(code: string, description: string) {
  return `${normalizeSkillCode(code)}::${description.trim()}`
}

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

async function askJev(batch: PendingCheck[], apiKey: string, fetchImpl: FetchLike): Promise<Map<string, number>> {
  const questions = Object.fromEntries(batch.map((item, index) => [`q${index}`, buildDescriptionQuestion(item.code, item.officialDescription, item.spreadsheetDescription)]))
  const response = await fetchImpl(TYPESAFE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: { contexto: 'Conferência de planejamento pedagógico: a coordenação quer saber se a descrição digitada na planilha corresponde ao código BNCC informado.' },
      questions,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TypeSafe ${response.status}`)
  const body = await response.json() as { answers?: Record<string, { noul?: unknown }> }
  const probabilities = new Map<string, number>()
  batch.forEach((item, index) => {
    const value = body.answers?.[`q${index}`]?.noul
    if (typeof value === 'number' && Number.isFinite(value)) probabilities.set(item.key, value)
  })
  return probabilities
}

export async function checkSkillDescriptions(
  skills: SkillInput[],
  options: {
    apiKey?: string
    fetchImpl?: FetchLike
    resolveOfficial?: (codes: string[]) => Promise<ReadonlyMap<string, string>>
  } = {},
): Promise<DescriptionCheck[]> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY
  const fetchImpl = options.fetchImpl ?? fetch
  const resolveOfficial = options.resolveOfficial ?? resolveBnccDescriptions

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
        for (const [key, value] of await askJev(batch, apiKey, fetchImpl)) probabilities.set(key, value)
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
