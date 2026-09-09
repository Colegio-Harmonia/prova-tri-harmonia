import { Readable } from 'node:stream'
import dns from 'node:dns/promises'
import net from 'node:net'
import axios from 'axios'
import { getDriveClient, findOrCreateFolder } from '@/lib/docs/driveClient'
import { searchWikimediaImage } from './wikimediaSearch'
import { generateIllustration } from './imageGenerate'
import { tryRenderChart } from './chartRender'
import { validateGeneratedQuestionImage } from './imageValidation'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

export type ResolvedQuestionImage = {
  source: 'busca' | 'gerada' | 'grafico' | 'importado' | 'enem'
  driveFileId: string
  previewUrl: string
  /** Só preenchido pra source:'importado'/'enem' — de onde a imagem veio, pra referência/crédito. */
  sourceUrl?: string
}

/**
 * Uma questão que declarou um recurso visual não pode ser persistida como
 * pronta sem esse recurso quando o gate de qualidade está ligado. O erro é
 * recuperável: a prova ainda não foi salva e uma nova geração pode tentar
 * novamente os provedores de imagem.
 */
export class RequiredQuestionImageError extends Error {
  constructor(public readonly questionNumbers: number[]) {
    super(`Não foi possível obter imagem para a(s) questão(ões) ${questionNumbers.join(', ')}.`)
  }
}

export async function uploadToStaging(buffer: Buffer, mimeType: string, name: string): Promise<{ driveFileId: string; previewUrl: string }> {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID
  if (!rootId) throw new Error('DRIVE_ROOT_FOLDER_ID não configurado')

  const drive = getDriveClient()
  const stagingFolderId = await findOrCreateFolder(drive, 'Staging - Imagens de questões', rootId)

  const { data } = await drive.files.create({
    requestBody: { name, parents: [stagingFolderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
    supportsAllDrives: true,
  })
  const driveFileId = data.id as string

  // insertInlineImage needs a publicly fetchable URI, same tradeoff as the
  // logo upload in seed-templates.ts.
  await drive.permissions.create({
    fileId: driveFileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  })

  // `drive.google.com/uc?id=` (used by the Docs API for insertInlineImage,
  // see provaDocBuilder.ts) often redirects browsers to an HTML interstitial
  // instead of raw image bytes when hotlinked in an <img> tag — Google's
  // `/thumbnail` endpoint is the one meant for that and renders reliably in
  // the /revisar review screen.
  return { driveFileId, previewUrl: `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w800` }
}

// Bloqueia URL apontando pra rede interna do servidor — o professor
// controla o texto do link, mas o fetch roda no backend (mesmo risco de
// SSRF de qualquer "importar por URL"). Cobre os alvos óbvios (localhost,
// faixas privadas RFC1918, link-local/metadata) sem tentar ser exaustivo.
function isPrivateAddress(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase()
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80')
  }
  return false
}

async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('URL inválida.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Só URLs http/https são aceitas.')
  }
  const hostname = parsed.hostname
  if (hostname === 'localhost') throw new Error('URL aponta pra um endereço interno, não permitido.')

  const addresses = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true })).map((r) => r.address)
  if (addresses.some(isPrivateAddress)) {
    throw new Error('URL aponta pra um endereço interno, não permitido.')
  }
  return parsed
}

const MAX_IMPORT_BYTES = 15 * 1024 * 1024 // 15MB — teto generoso pra imagem de questão, evita download gigante

/**
 * Importa uma imagem a partir de um link colado pelo professor — pra casos
 * onde nem busca automática (Wikimedia) nem geração por IA/gráfico servem
 * (ex: um mapa temático específico, com dados reais, que só existe numa
 * fonte concreta que o professor já achou). Mesmo pipeline de upload pro
 * Drive das outras fontes, sempre entra como não-aprovada até revisão.
 */
export async function importImageFromUrl(
  url: string,
  source: 'importado' | 'enem' = 'importado',
): Promise<ResolvedQuestionImage> {
  const parsed = await assertPublicUrl(url)

  const { data, headers } = await axios.get<ArrayBuffer>(parsed.toString(), {
    responseType: 'arraybuffer',
    timeout: 15_000,
    maxContentLength: MAX_IMPORT_BYTES,
    maxRedirects: 3,
    headers: { 'User-Agent': 'ProvaTri/1.0 (Colégio Harmonia; https://colegioharmonia.com.br) node-axios' },
  })

  const contentType = String(headers['content-type'] ?? '')
  if (!contentType.startsWith('image/')) {
    throw new Error(`O link não retornou uma imagem (content-type: ${contentType || 'desconhecido'}).`)
  }
  const mimeType = contentType.split(';')[0].trim()
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'

  const { driveFileId, previewUrl } = await uploadToStaging(Buffer.from(data), mimeType, `${source}-${Date.now()}.${ext}`)
  return { source, driveFileId, previewUrl, sourceUrl: url }
}

/**
 * Chart-then-search-then-generate: quando o pedido tem dados numéricos
 * claros ("gráfico com as notas..."), renderiza um gráfico determinístico
 * via QuickChart primeiro — sempre correto, e não depende de crédito de
 * IA nenhum. Senão, tenta Wikimedia Commons (free-licensed, sem chave),
 * e só cai pra ilustração gerada por IA se nada usável foi encontrado.
 * Nunca lança erro por uma questão isolada — retorna null pra não travar
 * a geração da prova inteira; o professor ainda aprova/rejeita por
 * questão (essa etapa é o verdadeiro check de aplicabilidade, não esta).
 */
export async function resolveQuestionImage(imageQuery: string, questionContext: string, expectedText?: string): Promise<ResolvedQuestionImage | null> {
  // Texto verificável exige DALL-E e validação visual; bancos externos não
  // oferecem garantia de correspondência literal com o conteúdo pedido.
  if (expectedText) return resolveGeneratedImage(imageQuery, questionContext, expectedText)
  try {
    const chart = await tryRenderChart(imageQuery, questionContext)
    if (chart) {
      const { driveFileId, previewUrl } = await uploadToStaging(chart, 'image/png', `grafico-${Date.now()}.png`)
      return { source: 'grafico', driveFileId, previewUrl }
    }
  } catch (err) {
    console.warn('[questionImageService] renderização de gráfico falhou, tentando Wikimedia:', err instanceof Error ? err.message : err)
  }

  try {
    const found = await searchWikimediaImage(imageQuery)
    if (found) {
      const { data } = await axios.get<ArrayBuffer>(found.url, { responseType: 'arraybuffer', timeout: 15_000 })
      const mimeType = /\.png$/i.test(found.url) ? 'image/png' : 'image/jpeg'
      const { driveFileId, previewUrl } = await uploadToStaging(Buffer.from(data), mimeType, `wikimedia-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`)
      return { source: 'busca', driveFileId, previewUrl }
    }
  } catch (err) {
    console.warn('[questionImageService] busca no Wikimedia falhou, tentando gerar:', err instanceof Error ? err.message : err)
  }

  return resolveGeneratedImage(imageQuery, questionContext)
}

async function resolveGeneratedImage(imageQuery: string, questionContext: string, expectedText?: string): Promise<ResolvedQuestionImage | null> {
  try {
    const generated = await generateIllustration(imageQuery, questionContext, expectedText)
    const validation = await validateGeneratedQuestionImage({
      buffer: Buffer.from(generated.base64, 'base64'),
      mimeType: generated.mimeType,
      visualBrief: imageQuery,
      questionContext,
      expectedText,
    })
    if (!validation.usable || !validation.layoutComplete || !validation.textLegible || (!expectedText && validation.containsInstructionalText) || (Boolean(expectedText) && !validation.textMatchesExpected)) {
      console.warn('[questionImageService] imagem gerada rejeitada pelo controle de qualidade:', validation.reason)
      return null
    }
    const ext = generated.mimeType.includes('png') ? 'png' : 'jpg'
    const { driveFileId, previewUrl } = await uploadToStaging(Buffer.from(generated.base64, 'base64'), generated.mimeType, `gerada-${Date.now()}.${ext}`)
    return { source: 'gerada', driveFileId, previewUrl }
  } catch (err) {
    console.warn('[questionImageService] geração via IA também falhou:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Resolves images for every question flagged needsImage:true, in parallel.
 * Never marks an image approved — that's always a human decision made in
 * the /revisar review screen, never automatic just because an image was
 * found/generated.
 */
export async function attachImagesToExam(
  exam: ExamGenerationResult,
  options: { requireResolvedImages?: boolean; maxAttemptsPerImage?: number } = {},
): Promise<ExamGenerationResult> {
  const attempts = Math.max(1, options.maxAttemptsPerImage ?? 1)
  const unresolved: number[] = []
  const questions = await Promise.all(
    exam.questions.map(async (q) => {
      if (!q.needsImage) return q
      if (!q.imageQuery) {
        unresolved.push(q.number)
        return q
      }
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const resolved = await resolveQuestionImage(q.imageQuery, q.statement)
        if (resolved) return { ...q, image: { ...resolved, approved: false } }
      }
      unresolved.push(q.number)
      return q
    }),
  )
  if (options.requireResolvedImages && unresolved.length) {
    throw new RequiredQuestionImageError(unresolved)
  }
  return { ...exam, questions }
}
