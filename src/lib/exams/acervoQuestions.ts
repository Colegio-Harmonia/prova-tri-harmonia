import { z } from 'zod'
import { acervoSourceText } from './acervoPresentation'
import { normalizeQuestionImage } from '@/lib/images/normalizeQuestionImage'
import { examQuestionSchema, type ExamQuestion } from '@/lib/gemini/examSchema'
import { acervoIdentity, questionContentKey } from './questionOrigin'
import { getAcervoApiUrl } from '@/lib/settings/acervoSettings'
import { SHEET_MAX_ALTERNATIVES, SHEET_MIN_ALTERNATIVES } from '@/lib/scan-sheets/sheetLayout'

const textSchema = z.object({ texto: z.string(), html: z.string().default('') })
const catalogSchema = z.object({
  bncc_solicitada: z.string(), total_elegiveis: z.number().int().nonnegative(),
  questoes: z.array(z.object({ id: z.number().int().positive().safe() })),
})
const responseSchema = z.object({
  questao: z.object({
    id: z.number().int(), tipo: z.string(), enunciado: textSchema,
    alternativas: z.array(z.object({ posicao: z.number().int(), rotulo: z.string(), texto: z.string(), html: z.string().default(''), correta: z.boolean().nullable() })),
    gabarito: z.object({ alternativas_corretas: z.array(z.object({ posicao: z.number().int(), rotulo: z.string() })), resposta_discursiva: z.string().nullable() }).passthrough(),
    resolucao: textSchema, bncc: z.array(z.string()),
    origem: z.object({ plataforma: z.string(), id_externo: z.string().nullable(), url_portal: z.string().nullable(), acervo: z.unknown().optional() }).passthrough(),
    midias: z.array(z.object({ id: z.number().int(), local: z.string(), alternativa_posicao: z.number().int(), posicao: z.number().int(), texto_alternativo: z.string().nullable().optional(), status: z.string(), url: z.string().nullable() })),
    pendencias: z.array(z.unknown()), midias_pendentes: z.number().int(),
  }).passthrough(),
})
type ApiQuestion = z.infer<typeof responseSchema>['questao']
export type AcervoHistory = Array<{ key: string; statement: string; questionId?: number }>
export class AcervoUnavailableError extends Error {}
/** The original exists but cannot be used as-is; the message says why (not a transient failure). */
export class AcervoQuestionRejectedError extends AcervoUnavailableError {
  constructor(message: string, readonly rejection: AcervoRejection) { super(message) }
}

export type AcervoSearchResult = { question: ExamQuestion | null; reason: string }
export type AcervoSearchParams = {
  codes: string[]; number: number; type: ExamQuestion['type'];
  excludedQuestions?: ExamQuestion[]; history?: AcervoHistory;
  visualAid?: 'auto' | 'obrigatorio' | 'sem_imagem';
  session?: AcervoSearchSession;
  jobId?: number;
  manualSelection?: boolean;
  acceptCandidate?: (question: ExamQuestion) => Promise<boolean>;
  planningSearch?: { subject: string; content: string; title: string };
  /** Compartilhado entre os tipos tentados na busca por BNCC de uma mesma questão. */
  alignmentBudget?: AlignmentBudget;
}

function concurrencyLimit(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try { return await run() }
    finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

type JsonResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

/** Shared only within one exam; failures never become consumed IDs or a persistent cache. */
export function createAcervoSearchSession() {
  const requests = new Map<string, Promise<JsonResponse>>()
  const limitRequests = concurrencyLimit(8)
  const limitMedia = concurrencyLimit(4)
  const reserved = new Set<string>()
  const stats = { apiRequests: 0, cacheHits: 0 }
  let baseUrl: Promise<string> | undefined
  return {
    stats,
    baseUrl: () => baseUrl ??= getAcervoApiUrl(),
    request(url: URL): Promise<JsonResponse> {
      const key = url.href
      const cached = requests.get(key)
      if (cached) { stats.cacheHits++; return cached }
      const pending = limitRequests(async () => {
        stats.apiRequests++
        const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store', headers: { Accept: 'application/json' } })
        if (!response.ok) {
          requests.delete(key)
          return { ok: false, status: response.status, json: async () => null }
        }
        try {
          const body: unknown = await response.json()
          return { ok: true, status: response.status, json: async () => body }
        } catch (error) {
          requests.delete(key)
          return { ok: true, status: response.status, json: async () => { throw error } }
        }
      }).catch((error) => { requests.delete(key); throw error })
      requests.set(key, pending)
      return pending
    },
    reserve(question: ExamQuestion): (() => void) | null {
      const keys = [
        `id:${question.acervoRef!.questionId}`, `origin:${acervoIdentity(question)}`,
        `content:${questionContentKey(question)}`,
      ]
      if (keys.some((key) => reserved.has(key))) return null
      keys.forEach((key) => reserved.add(key))
      return () => keys.forEach((key) => reserved.delete(key))
    },
    importMedia: limitMedia,
  }
}

export type AcervoSearchSession = ReturnType<typeof createAcervoSearchSession>

type AcervoFailureStage = 'configuration' | 'catalog_request' | 'catalog_response' | 'catalog_validation' | 'detail_request' | 'detail_response' | 'detail_schema' | 'detail_validation' | 'question_mapping' | 'media_import'

function safeErrorCategory(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof Error && /timeout|timed out/i.test(error.message)) return 'timeout'
  if (error instanceof SyntaxError) return 'invalid_json'
  return 'request_or_processing_error'
}

function logAcervoFailure(fields: { stage: AcervoFailureStage; bnccCode?: string; questionId?: number; httpStatus?: number; category: string; jobId?: number; slotNumber?: number }) {
  console.warn('[acervo/search] falha na consulta/importação', {
    timestamp: new Date().toISOString(),
    ...fields,
  })
}

const GENERIC_ACERVO_FALLBACK = 'Nenhuma questão compatível foi importada do acervo; esta questão foi gerada por IA.'

// Busca com conferência de aderência (Ensino Médio). Os códigos BNCC do EM são
// de área (EM13CNT* cobre Biologia, Física e Química): o catálogo por código
// chega a ~28 mil itens, quase todos de outra disciplina, e cada candidato ia
// ao Jev. Lote 479 (10/11/2026): 1.708 conferências, 98,8% incompatíveis.
// Agora a disciplina declarada pelo acervo é filtrada antes do Jev e cada
// questão tem teto de conferências/consultas; ao esgotar, segue para a busca
// por conteúdo (que filtra disciplina) e, por fim, para a IA.
export const MAX_ALIGNMENT_CHECKS_PER_SLOT = 24
export const MAX_DETAIL_FETCHES_PER_SLOT = 400
export type AlignmentBudget = { checks: number; fetches: number; exhausted: boolean }

const DISCIPLINE_ALIASES: Record<string, string> = { 'Inglês': 'Língua Inglesa', 'Artes': 'Arte', 'Literatura': 'Língua Portuguesa' }
function normalizeDiscipline(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
}
/** Disciplina declarada pelo acervo em `classificacoes` (kind=disciplina), se houver. */
export function acervoDisciplines(raw: object): string[] {
  const classificacoes = (raw as Record<string, unknown>).classificacoes
  if (!Array.isArray(classificacoes)) return []
  return classificacoes.flatMap((item) => item && typeof item === 'object'
    && (item as Record<string, unknown>).kind === 'disciplina' && typeof (item as Record<string, unknown>).value === 'string'
    ? [String((item as Record<string, unknown>).value)] : [])
}
/** Sem disciplina declarada o item segue para a conferência; com outra disciplina, é descartado. */
export function matchesPlanningDiscipline(raw: object, subject: string): boolean {
  const declared = acervoDisciplines(raw)
  if (!declared.length) return true
  const wanted = new Set([subject, DISCIPLINE_ALIASES[subject] ?? subject].map(normalizeDiscipline))
  return declared.some((discipline) => wanted.has(normalizeDiscipline(discipline)))
}

/** Why an original cannot be used as-is; `null` when it can. Single source of truth for `mapAcervoQuestion`. */
export type AcervoRejection =
  | { code: 'unsupported_type'; tipo: string } | { code: 'empty_statement' } | { code: 'pending_issues'; pendencias: string[] }
  | { code: 'pending_media' } | { code: 'media_incomplete' } | { code: 'visual_aid_mismatch' }
  | { code: 'alternatives_count'; count: number } | { code: 'answer_key_invalid' } | { code: 'alternative_empty' } | { code: 'missing_answer' }

export function acervoRejection(raw: ApiQuestion, params: Pick<AcervoSearchParams, 'type' | 'manualSelection' | 'visualAid'>): AcervoRejection | null {
  const blockingPending = params.manualSelection
    ? raw.pendencias.filter((pending) => !['bncc_ausente', 'bncc_nao_mapeada', 'bloom_ausente', 'resolucao_ausente'].includes(String(pending)))
    : raw.pendencias
  if (!raw.enunciado.texto.trim()) return { code: 'empty_statement' }
  if (params.type === 'objetiva' ? raw.tipo !== 'multipla_escolha' : raw.tipo !== 'discursiva') return { code: 'unsupported_type', tipo: raw.tipo }
  if (blockingPending.length) return { code: 'pending_issues', pendencias: blockingPending.map(String) }
  if (raw.midias_pendentes) return { code: 'pending_media' }
  const media = raw.midias.filter((item) => ['enunciado', 'alternativa'].includes(item.local))
  if (media.length > 12) return { code: 'media_incomplete' }
  // Unknown media locations or missing files must not silently disappear.
  if (media.some((item) => !item.url)) return { code: 'media_incomplete' }
  if ((params.visualAid === 'sem_imagem' && media.length) || (params.visualAid === 'obrigatorio' && !media.length)) return { code: 'visual_aid_mismatch' }
  if (/<(?:img|svg|math)\b/i.test(raw.enunciado.html) && !media.some((m) => m.local === 'enunciado')) return { code: 'media_incomplete' }
  if (raw.alternativas.some((a) => /<(?:img|svg|math)\b/i.test(a.html) && !media.some((m) => m.local === 'alternativa' && m.alternativa_posicao === a.posicao))) return { code: 'media_incomplete' }
  if (params.type === 'objetiva') {
    const alternatives = [...raw.alternativas].sort((a, b) => a.posicao - b.posicao)
    const correct = raw.gabarito.alternativas_corretas
    // Fora de 4-5 alternativas o cartão-resposta não pode ser emitido (sheetLayout).
    if (alternatives.length < SHEET_MIN_ALTERNATIVES || alternatives.length > SHEET_MAX_ALTERNATIVES) return { code: 'alternatives_count', count: alternatives.length }
    if (correct.length !== 1 || new Set(alternatives.map((a) => a.posicao)).size !== alternatives.length) return { code: 'answer_key_invalid' }
    const correctIndex = alternatives.findIndex((a) => a.posicao === correct[0]?.posicao)
    if (correctIndex < 0 || alternatives.some((a, i) => a.correta !== null && a.correta !== (i === correctIndex))) return { code: 'answer_key_invalid' }
    if (alternatives.some((a) => !a.texto.trim() && !media.some((m) => m.local === 'alternativa' && m.alternativa_posicao === a.posicao))) return { code: 'alternative_empty' }
  } else if (!discursiveAnswer(raw)) return { code: 'missing_answer' }
  return null
}

function discursiveAnswer(raw: ApiQuestion): string {
  return acervoSourceText({ texto: raw.gabarito.resposta_discursiva?.trim() || raw.resolucao.texto.trim(), html: raw.resolucao.html })
}

const TYPE_LABELS: Record<string, string> = { relacionar_colunas: 'ligar/relacionar colunas', ordenar: 'ordenar etapas', verdadeiro_falso: 'verdadeiro ou falso', lacunas: 'completar lacunas' }
const PENDING_LABELS: Record<string, string> = { gabarito_estruturado_nao_disponivel_no_dom: 'o gabarito não está disponível na fonte' }

/** Mensagem para o professor: diz o que impede a importação, em vez de sugerir tentar de novo. */
export function acervoRejectionMessage(rejection: AcervoRejection): string {
  const pick = 'Escolha outra questão ou peça à coordenação para adaptá-la.'
  switch (rejection.code) {
    case 'unsupported_type': return `Esta questão é do formato "${TYPE_LABELS[rejection.tipo] ?? rejection.tipo.replace(/_/g, ' ')}", que a prova ainda não aceita (só múltipla escolha ou discursiva). ${pick}`
    case 'alternatives_count': return `Esta questão tem ${rejection.count} alternativa${rejection.count === 1 ? '' : 's'}; o cartão-resposta exige 4 ou 5. ${pick}`
    case 'pending_issues': return `O acervo marca esta questão como incompleta: ${rejection.pendencias.map((p) => PENDING_LABELS[p] ?? p.replace(/_/g, ' ')).join('; ')}. ${pick}`
    case 'pending_media': return 'As imagens desta questão ainda estão sendo processadas no acervo. Tente novamente mais tarde ou escolha outra questão.'
    case 'media_incomplete': return `As imagens desta questão estão incompletas no acervo. ${pick}`
    case 'visual_aid_mismatch': return 'Esta questão não atende à preferência de imagem da prova.'
    case 'answer_key_invalid': return `O gabarito desta questão no acervo é inconsistente (não indica exatamente uma alternativa correta). ${pick}`
    case 'alternative_empty': return `Uma das alternativas desta questão está vazia no acervo. ${pick}`
    case 'missing_answer': return `Esta questão discursiva não tem resposta esperada nem resolução no acervo. ${pick}`
    case 'empty_statement': return `Esta questão está sem enunciado no acervo. ${pick}`
  }
}

/** Maps only complete, supported originals. Never invents or rewrites an answer. */
export function mapAcervoQuestion(raw: ApiQuestion, params: AcervoSearchParams): ExamQuestion | null {
  if (acervoRejection(raw, params)) return null
  const media = raw.midias.filter((item) => ['enunciado', 'alternativa'].includes(item.local))
  const alternatives = [...raw.alternativas].sort((a, b) => a.posicao - b.posicao)
  const correctIndex = alternatives.findIndex((a) => a.posicao === raw.gabarito.alternativas_corretas[0]?.posicao)
  const answer = discursiveAnswer(raw)
  const origin = (typeof raw.origem.acervo === 'string' && raw.origem.acervo.trim() ? raw.origem.acervo : raw.origem.plataforma).toUpperCase()
  return examQuestionSchema.parse({
    number: params.number, slotId: `q${String(params.number).padStart(2, '0')}`, source: 'acervo', type: params.type,
    acervoRef: { questionId: raw.id, origin, externalId: raw.origem.id_externo, portalUrl: raw.origem.url_portal, importedAt: new Date().toISOString(), original: raw },
    bloomLevel: 'compreender', statement: acervoSourceText(raw.enunciado), supportText: null,
    alternatives: params.type === 'objetiva' ? alternatives.map((a, i) => ({ letter: String.fromCharCode(65 + i), text: acervoSourceText(a).trim() || `Figura ${String.fromCharCode(65 + i)}` })) : null,
    correctLetter: params.type === 'objetiva' ? String.fromCharCode(65 + correctIndex) : null,
    expectedAnswer: params.type === 'descritiva' ? answer : null,
    gradingCriteria: params.type === 'descritiva' ? `Avaliar a resposta em relação ao gabarito original: ${answer}` : null,
    commentedResolution: acervoSourceText(raw.resolucao) || null,
    bnccCodes: params.codes.filter((code) => raw.bncc.includes(code)), bnccStatus: params.codes.some((code) => raw.bncc.includes(code)) ? 'mapeado' : 'nao_mapeado',
    pedagogicalClassification: {
      dok: { categoryCode: 'DOK_1', confidence: 0, justification: 'Importada; classificação pedagógica pendente de revisão.', evidence: '' },
      soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: 'Importada; classificação pedagógica pendente de revisão.', evidence: '' },
    }, needsImage: media.length > 0, hasImage: media.length > 0, image: null,
    imageDescription: media.length ? 'Mídias originais do acervo.' : null,
    visualReview: { status: 'complete', reason: 'Conteúdo original preservado; conferir na revisão docente.' }, review: null,
  })
}

let mediaServiceModule: Promise<typeof import('@/lib/images/questionImageService')> | undefined

/** Explicit teacher selection does not require a BNCC or a planned question type. */
export async function importAcervoQuestionById(questionId: number, number: number): Promise<ExamQuestion> {
  const base = await getAcervoApiUrl()
  try {
    const response = await fetch(new URL(`/api/v1/questoes/${questionId}`, base), { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`detail_http_${response.status}`)
    const { questao: raw } = responseSchema.parse(await response.json())
    if (raw.id !== questionId) throw new Error('detail_id_mismatch')
    const type = raw.tipo === 'multipla_escolha' ? 'objetiva' : 'descritiva'
    const mapParams = { codes: raw.bncc, number, type, manualSelection: true } as const
    const rejection = acervoRejection(raw, mapParams)
    if (rejection) {
      console.warn('[acervo/manual] questão recusada', { questionId, category: rejection.code, ...('tipo' in rejection ? { tipo: rejection.tipo } : {}), ...('count' in rejection ? { count: rejection.count } : {}) })
      // Mídia ainda em processamento é passageira: não é recusa definitiva.
      if (rejection.code === 'pending_media') throw new AcervoUnavailableError(acervoRejectionMessage(rejection))
      throw new AcervoQuestionRejectedError(acervoRejectionMessage(rejection), rejection)
    }
    const question = mapAcervoQuestion(raw, mapParams)!
    return question.hasImage ? await attachOriginalMedia(question, raw, base) : question
  } catch (error) {
    if (error instanceof AcervoUnavailableError) throw error
    console.warn('[acervo/manual] falha na importação', { questionId, category: error instanceof Error ? error.message : 'import_failed' })
    throw new AcervoUnavailableError('Não foi possível importar esta questão completa. Escolha outra questão ou tente novamente.')
  }
}

async function attachOriginalMedia(question: ExamQuestion, raw: ApiQuestion, base: string): Promise<ExamQuestion> {
  const media = raw.midias.filter((m) => ['enunciado', 'alternativa'].includes(m.local)).sort((a, b) => a.alternativa_posicao - b.alternativa_posicao || a.posicao - b.posicao)
  if (!media.length) return question
  const { default: sharp } = await import('sharp')
  const { uploadToStaging } = await (mediaServiceModule ??= import('@/lib/images/questionImageService'))
  const panels: Buffer[] = []
  const alternatives = [...raw.alternativas].sort((a, b) => a.posicao - b.posicao)
  for (const item of media) {
    const url = new URL(item.url!, base)
    if (url.origin !== new URL(base).origin || !/^\/api\/media\/\d+$/.test(url.pathname)) throw new Error('URL de mídia inválida no acervo.')
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error' })
    if (!response.ok) throw new Error('Mídia original indisponível.')
    if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('Mídia original muito grande.')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 10 * 1024 * 1024) throw new Error('Mídia original muito grande.')
    const normalized = await normalizeQuestionImage(buffer)
    const image = await sharp(normalized.buffer, { limitInputPixels: 20_000_000 }).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const dimensions = await sharp(image).metadata()
    const label = item.local === 'alternativa' ? `Alternativa ${String.fromCharCode(65 + alternatives.findIndex((a) => a.posicao === item.alternativa_posicao))}` : 'Enunciado'
    const header = Buffer.from(`<svg width="1000" height="40"><rect width="100%" height="100%" fill="white"/><text x="10" y="28" font-size="24">${label}</text></svg>`)
    panels.push(await sharp({ create: { width: 1000, height: dimensions.height! + 40, channels: 4, background: '#ffffff' } }).composite([{ input: header, top: 0, left: 0 }, { input: image, top: 40, left: 0 }]).png().toBuffer())
  }
  let top = 0
  const layers = []
  for (const panel of panels) { layers.push({ input: panel, top, left: 0 }); top += (await sharp(panel).metadata()).height! }
  if (top > 12000) throw new Error('Mídias originais excedem o tamanho suportado.')
  const composite = await sharp({ create: { width: 1000, height: top, channels: 4, background: '#ffffff' } }).composite(layers).png().toBuffer()
  const uploaded = await uploadToStaging(composite, 'image/png', `acervo-${raw.id}.png`)
  return { ...question, image: { ...uploaded, source: 'importado', sourceUrl: new URL(`/api/v1/questoes/${raw.id}`, base).href, approved: true, originalBankMedia: true } }
}

export async function findAcervoQuestion(params: AcervoSearchParams): Promise<AcervoSearchResult> {
  const session = params.session ?? createAcervoSearchSession()
  if (params.acceptCandidate && !params.alignmentBudget) params = { ...params, alignmentBudget: { checks: 0, fetches: 0, exhausted: false } }
  const preferred = await findAcervoQuestionOfType({ ...params, session })
  // Esgota o tipo solicitado em todas as BNCCs antes de tentar o outro tipo.
  // Preserva o tipo original e o gabarito; não converte o conteúdo do banco.
  if (preferred.question) return preferred
  const alternateType = params.type === 'objetiva' ? 'descritiva' : 'objetiva'
  const fallback = await findAcervoQuestionOfType({ ...params, type: alternateType, session })
  if (fallback.question) console.info('[acervo/search] tipo alternativo usado antes da IA', {
    timestamp: new Date().toISOString(), jobId: params.jobId, slotNumber: params.number,
    bnccCodes: fallback.question.bnccCodes, questionId: fallback.question.acervoRef?.questionId,
    requestedType: params.type, importedType: fallback.question.type,
  })
  if (!fallback.question && params.planningSearch) return findAcervoByPlanning({ ...params, session })
  return fallback
}

/** ENEM-only plans still search the acervo before AI, without inventing BNCC codes. */
async function findAcervoByPlanning(params: AcervoSearchParams): Promise<AcervoSearchResult> {
  const search = params.planningSearch!
  const session = params.session!
  const subject = ({ 'Inglês': 'Língua Inglesa', 'Artes': 'Arte', 'Literatura': 'Língua Portuguesa' } as Record<string, string>)[search.subject] ?? search.subject
  const stop = new Set(['para', 'como', 'sobre', 'entre', 'through', 'with', 'from', 'that', 'this', 'questoes', 'habilidades', 'conteudo', 'compreender', 'identificar'])
  const words = [...new Set(`${search.title} ${search.content}`.toLowerCase().match(/[\p{L}]{5,}/gu) ?? [])].filter((word) => !stop.has(word)).slice(0, 3)
  const ids = new Set<number>()
  const excluded = new Set([...(params.excludedQuestions ?? []).flatMap((q) => q.acervoRef ? [q.acervoRef.questionId] : []), ...(params.history ?? []).flatMap((h) => h.questionId ? [h.questionId] : [])])
  const base = await session.baseUrl()
  for (const term of [...words, '']) {
    try {
      const url = new URL('/api/painel/questions', base)
      url.searchParams.set('disciplina', subject)
      url.searchParams.set('segmento', 'Ensino Médio')
      url.searchParams.set('size', '48')
      if (term) url.searchParams.set('q', term)
      const response = await session.request(url)
      if (!response.ok) continue
      const body = z.object({ items: z.array(z.object({ id: z.number().int().positive().safe() })) }).safeParse(await response.json())
      if (!body.success) continue
      for (const item of body.data.items) if (!excluded.has(item.id)) ids.add(item.id)
      if (ids.size >= 48) break
    } catch { logAcervoFailure({ stage: 'catalog_request', category: 'planning_catalog_failed', jobId: params.jobId, slotNumber: params.number }) }
  }
  const originals: ExamQuestion[] = []
  for (const id of [...ids].slice(0, 48)) {
    try {
      const response = await session.request(new URL(`/api/v1/questoes/${id}`, base))
      if (!response.ok) continue
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.questao.id !== id) continue
      const raw = parsed.data.questao
      const type = raw.tipo === 'multipla_escolha' ? 'objetiva' : 'descritiva'
      const question = mapAcervoQuestion(raw, { ...params, type, codes: raw.bncc, manualSelection: true })
      if (question) originals.push(question)
    } catch { logAcervoFailure({ stage: 'detail_request', questionId: id, category: 'planning_detail_failed', jobId: params.jobId, slotNumber: params.number }) }
  }
  let checked = 0
  for (const type of [params.type, params.type === 'objetiva' ? 'descritiva' : 'objetiva']) {
    for (const question of originals.filter((question) => question.type === type)) {
      if (checked++ >= 24) break
      if ((params.excludedQuestions ?? []).some((q) => questionContentKey(q) === questionContentKey(question)) || (params.history ?? []).some((h) => questionContentKey(h) === questionContentKey(question))) continue
      if (params.acceptCandidate && !await params.acceptCandidate(question)) continue
      const release = session.reserve(question)
      if (!release) continue
      try {
        const complete = question.hasImage ? await session.importMedia(() => attachOriginalMedia(question, question.acervoRef!.original as ApiQuestion, base)) : question
        return { question: complete, reason: '' }
      } catch { release(); logAcervoFailure({ stage: 'media_import', questionId: question.acervoRef?.questionId, category: 'planning_media_failed', jobId: params.jobId, slotNumber: params.number }) }
    }
  }
  console.info('[acervo/planning] busca por conteúdo concluída', { jobId: params.jobId, slotNumber: params.number, listedIds: ids.size, checked, limit: 24 })
  return { question: null, reason: 'Nenhuma questão compatível foi importada na busca por conteúdo e disciplina (até 24 candidatas conferidas); complemento por IA.' }
}

async function findAcervoQuestionOfType(params: AcervoSearchParams): Promise<AcervoSearchResult> {
  const startedAt = Date.now()
  const session = params.session ?? createAcervoSearchSession()
  const logFailure = (fields: Parameters<typeof logAcervoFailure>[0]) => logAcervoFailure({ ...fields, jobId: params.jobId, slotNumber: params.number })
  let base: string
  try { base = await session.baseUrl() }
  catch (error) {
    logFailure({ stage: 'configuration', category: safeErrorCategory(error) })
    return { question: null, reason: GENERIC_ACERVO_FALLBACK }
  }
  const excludedIds = new Set([...(params.excludedQuestions ?? []).map(acervoIdentity).filter(Boolean), ...(params.history ?? []).map((h) => h.key)])
  const excludedContent = new Set([...(params.excludedQuestions ?? []).map(questionContentKey), ...(params.history ?? []).map(questionContentKey)])
  const usedIds = new Set([
    ...(params.excludedQuestions ?? []).flatMap((q) => q.acervoRef ? [q.acervoRef.questionId] : []),
    ...(params.history ?? []).flatMap((entry) => entry.questionId === undefined ? [] : [entry.questionId]),
  ])
  const attemptedIds = new Set<number>()
  const failedIds = new Set<number>()
  const budget = params.alignmentBudget
  codeLoop: for (const code of [...new Set(params.codes.map((c) => c.trim().toUpperCase()))]) {
    if (budget?.exhausted) break
    let ids: number[]
    try {
      const url = new URL('/api/v1/questoes', base)
      url.searchParams.set('bncc', code)
      const response = await session.request(url)
      if (response.status === 404) continue
      if (!response.ok) {
        logFailure({ stage: 'catalog_request', bnccCode: code, httpStatus: response.status, category: 'http_error' })
        return { question: null, reason: GENERIC_ACERVO_FALLBACK }
      }
      let body: unknown
      try { body = await response.json() }
      catch (error) {
        logFailure({ stage: 'catalog_response', bnccCode: code, httpStatus: response.status, category: safeErrorCategory(error) })
        return { question: null, reason: GENERIC_ACERVO_FALLBACK }
      }
      const parsedCatalog = catalogSchema.safeParse(body)
      if (!parsedCatalog.success) {
        logFailure({ stage: 'catalog_response', bnccCode: code, httpStatus: response.status, category: 'invalid_catalog_schema' })
        return { question: null, reason: GENERIC_ACERVO_FALLBACK }
      }
      const catalog = parsedCatalog.data
      ids = [...new Set(catalog.questoes.map((q) => q.id))]
      if (catalog.bncc_solicitada !== code || ids.length !== catalog.total_elegiveis) {
        logFailure({ stage: 'catalog_validation', bnccCode: code, category: 'catalog_count_or_bncc_mismatch' })
        return { question: null, reason: GENERIC_ACERVO_FALLBACK }
      }
    } catch (error) {
      logFailure({ stage: 'catalog_request', bnccCode: code, category: safeErrorCategory(error) })
      return { question: null, reason: GENERIC_ACERVO_FALLBACK }
    }
    if (!ids.length) continue
    // Random order without replacement. No draw limit can hide a later eligible item.
    const candidates = ids.filter((id) => !usedIds.has(id) && !attemptedIds.has(id))
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
    }
    const failuresAtStart = failedIds.size
    let ineligibleForCode = 0
    for (let offset = 0; offset < candidates.length; offset += 8) {
      if (budget) {
        if (budget.fetches >= MAX_DETAIL_FETCHES_PER_SLOT) { budget.exhausted = true; break codeLoop }
        budget.fetches += Math.min(8, candidates.length - offset)
      }
      // Prefetch a small batch; the session bounds total requests across all slots.
      const batch = await Promise.all(candidates.slice(offset, offset + 8).map(async (id) => {
        attemptedIds.add(id)
        let stage: AcervoFailureStage = 'detail_request'
        let httpStatus: number | undefined
        try {
          const response = await session.request(new URL(`/api/v1/questoes/${id}`, base))
          httpStatus = response.status
          if (!response.ok) {
            failedIds.add(id)
            logFailure({ stage, bnccCode: code, questionId: id, httpStatus, category: 'http_error' })
            return { id, raw: null }
          }
          stage = 'detail_response'
          const body = await response.json()
          stage = 'detail_schema'
          const parsedQuestion = responseSchema.safeParse(body)
          if (!parsedQuestion.success) {
            failedIds.add(id)
            logFailure({ stage, bnccCode: code, questionId: id, httpStatus, category: 'invalid_question_schema' })
            return { id, raw: null }
          }
          const { questao: raw } = parsedQuestion.data
          stage = 'detail_validation'
          if (raw.id !== id || !raw.bncc.includes(code)) {
            failedIds.add(id)
            logFailure({ stage, bnccCode: code, questionId: id, httpStatus, category: raw.id !== id ? 'question_id_mismatch' : 'bncc_code_mismatch' })
            return { id, raw: null }
          }
          return { id, raw }
        } catch (error) {
          failedIds.add(id)
          logFailure({ stage, bnccCode: code, questionId: id, httpStatus, category: safeErrorCategory(error) })
          return { id, raw: null }
        }
      }))
      for (const { id, raw } of batch) {
        if (!raw) continue
        let stage: AcervoFailureStage = 'question_mapping'
        let releaseReservation: (() => void) | null = null
        try {
          if (params.planningSearch && !matchesPlanningDiscipline(raw, params.planningSearch.subject)) { ineligibleForCode++; continue }
          const question = mapAcervoQuestion(raw, { ...params, codes: [code] })
          if (!question) { ineligibleForCode++; continue }
          if (excludedIds.has(acervoIdentity(question)) || excludedContent.has(questionContentKey(question))) continue
          if (params.acceptCandidate && budget) {
            if (budget.checks >= MAX_ALIGNMENT_CHECKS_PER_SLOT) { budget.exhausted = true; break codeLoop }
            budget.checks++
          }
          if (params.acceptCandidate && !await params.acceptCandidate(question)) { ineligibleForCode++; continue }
          releaseReservation = session.reserve(question)
          if (!releaseReservation) continue
          stage = 'media_import'
          const mediaStartedAt = Date.now()
          const complete = question.hasImage ? await session.importMedia(() => attachOriginalMedia(question, raw, base)) : question
          // Callers persist acervoRef and history only after accepting the complete question.
          console.info('[acervo/search] questão importada', { timestamp: new Date().toISOString(), jobId: params.jobId, slotNumber: params.number, bnccCode: code, questionId: id, attemptedIds: attemptedIds.size, failedIds: failedIds.size, durationMs: Date.now() - startedAt, mediaDurationMs: Date.now() - mediaStartedAt })
          return { question: complete, reason: '' }
        } catch (error) {
          releaseReservation?.()
          if (error instanceof Error && error.name === 'PlanningAlignmentUnavailableError') throw error
          failedIds.add(id)
          logFailure({ stage, bnccCode: code, questionId: id, category: safeErrorCategory(error) })
        }
      }
    }
    console.info('[acervo/search] busca sem questão compatível', {
      timestamp: new Date().toISOString(), jobId: params.jobId, slotNumber: params.number, bnccCode: code, totalListedIds: ids.length,
      candidateIds: candidates.length, attemptedIds: candidates.length, failedIds: failedIds.size - failuresAtStart, ineligibleIds: ineligibleForCode,
    })
  }
  if (budget?.exhausted) console.info('[acervo/search] teto de conferências por questão atingido', {
    timestamp: new Date().toISOString(), jobId: params.jobId, slotNumber: params.number, type: params.type,
    alignmentChecks: budget.checks, detailFetches: budget.fetches,
    maxChecks: MAX_ALIGNMENT_CHECKS_PER_SLOT, maxFetches: MAX_DETAIL_FETCHES_PER_SLOT,
  })
  return { question: null, reason: GENERIC_ACERVO_FALLBACK }
}
