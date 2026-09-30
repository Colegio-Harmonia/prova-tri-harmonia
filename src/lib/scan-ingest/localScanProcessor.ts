import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import axios from 'axios'
import sharp from 'sharp'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments, generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { createPageQrPayload, createSheetTokenDigest, readSheetQrSigningKeys, verifyPageQrPayload } from '@/lib/scan-sheets/sheetQr'
import { downloadPrivateScanBytes } from '@/lib/scan-ingest/privateScanContent'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { workerScanResultSchema, type WorkerScanResult } from '@/lib/scan-ingest/workerResultSchema'
import { queueDiscursiveTranscriptions } from '@/lib/scan-ingest/transcriptionQueue'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { PDFDocument } from 'pdf-lib'
import type { CorrectionAnswer } from '@/types/correction'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import { SCAN_PIPELINE_VERSION, SCAN_READER_MODEL } from '@/lib/scan-ingest/scanPipeline'

// ---------------------------------------------------------------------------
// Gemini Vision para leitura de QR + bolhas
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Sem marcação é uma resposta válida (em branco), não uma falha do scanner.
// O leitor local também deve retornar `null` quando conseguiu ler a bolha;
// `OMR_INCOMPLETE` era um fallback incorreto aplicado a toda leitura válida.
function normalizeOmrException(code: string | null | undefined) {
  return code === 'BLANK' || code === 'OMR_INCOMPLETE' ? null : code ?? null
}

function geminiModel() {
  return process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash'
}

/**
 * Converte a primeira (ou única) página de um PDF para JPEG.
 * O Gemini Vision não aceita PDF como inlineData — só imagens.
 * Usamos pdf-lib para extrair a página e sharp para renderizar via SVG/bitmap.
 * Como pdf-lib não renderiza pixels, usamos uma abordagem alternativa:
 * enviamos o PDF diretamente como parte de file (usando Files API seria melhor,
 * mas para simplicidade e compatibilidade, renderizamos via sharp com um shim).
 *
 * Nota: como o sharp não lê PDF nativamente, usamos o próprio Gemini Files API
 * quando o arquivo for PDF — enviando o base64 do PDF com mimeType correto.
 * O modelo gemini-2.0-flash aceita PDF como inlineData.
 */
// Sharp normalizes JPEG/PNG but this build does not include a PDF renderer.
// Poppler converts each already-isolated PDF page into the JPEG used by Vision.
const execFileAsync = promisify(execFile)

async function renderPdfPageToPng(pdfBytes: Buffer): Promise<Buffer> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'prova-tri-scan-'))
  const inputPath = join(tempDirectory, 'page.pdf')
    const outputRoot = join(tempDirectory, 'page')
  try {
    await writeFile(inputPath, pdfBytes, { mode: 0o600 })
    try {
      await execFileAsync(process.env.PDFTOPPM_PATH || 'pdftoppm', [
        '-f', '1', '-l', '1', '-r', '300', '-png', '-singlefile', inputPath, outputRoot,
      ], { maxBuffer: 1024 * 1024 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`PDF_RENDER_FAILED: pdftoppm could not rasterize the scan page (${message})`)
    }
    return await readFile(`${outputRoot}.png`)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

/**
 * Prepara a imagem uma única vez e sem compressão com perdas.
 *
 * O scanner já entrega JPEG. Reabrir e salvar esse JPEG novamente antes do
 * leitor destrói justamente os módulos pequenos do QR. PNG é usado como
 * formato intermediário para preservar os pixels até a retificação/decisão.
 */
async function normalizePageToLosslessPng(fileBytes: Buffer, mimeType: string): Promise<Buffer> {
  const imageBytes = mimeType === 'application/pdf' ? await renderPdfPageToPng(fileBytes) : fileBytes
  return sharp(imageBytes, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 3000, height: 4200, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

function describeGeminiVisionError(error: unknown, model: string) {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : String(error)
  const status = error.response?.status
  const providerError = error.response?.data?.error
  const providerMessage = typeof providerError?.message === 'string' ? providerError.message : null
  const providerStatus = typeof providerError?.status === 'string' ? providerError.status : null
  const providerCode = typeof providerError?.code === 'number' ? providerError.code : null
  const details = [providerStatus, providerCode ? `code ${providerCode}` : null, providerMessage].filter(Boolean).join(' - ')
  return `Gemini Vision (${model})${status ? ` HTTP ${status}` : ''}${details ? `: ${details}` : `: ${error.message}`}`
}

type LocalOmrResult = {
  qrToken: string | null
  qrFailureCode?: string | null
  readerVersion?: string
  qrEngine?: string
  qrAttempts?: number
  qrDurationMs?: number
  qrRotation?: number
  qualityScore: number
  exceptionCode: string | null
  bubbles: Array<{ answer: string | null; confidence: number; exceptionCode: string | null }>
}

type OmrProcessError = Error & { killed?: boolean; signal?: string | null; code?: string | number | null }

function normalizeOmrProcessError(error: unknown): Error {
  const candidate = error as OmrProcessError
  const message = error instanceof Error ? error.message : String(error)
  if (candidate?.killed || candidate?.signal === 'SIGTERM' || candidate?.code === 'ETIMEDOUT') {
    return new Error(`OMR_TIMEOUT: o leitor PTR1 excedeu o tempo máximo; ${message}`)
  }
  return new Error(`OMR_PROCESS_FAILED: ${message}`)
}

async function readLocalOmr(imageBytes: Buffer): Promise<{ result: LocalOmrResult; canonicalJpeg: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'prova-tri-omr-'))
  const inputPath = join(directory, 'input.png')
  const outputPath = join(directory, 'canonical.jpg')
  try {
    await writeFile(inputPath, imageBytes, { mode: 0o600 })
    const pythonBin = process.env.OMR_PYTHON_BIN || join(process.cwd(), '.venv-omr', 'bin', 'python')
    let stdout: string
    try {
      ;({ stdout } = await execFileAsync(pythonBin, [join(process.cwd(), 'services', 'omr', 'read_ptr1.py'), '--input', inputPath, '--output', outputPath], { maxBuffer: 1024 * 1024, timeout: 12_000 }))
    } catch (error) {
      throw normalizeOmrProcessError(error)
    }
    return {
      result: JSON.parse(stdout) as LocalOmrResult,
      canonicalJpeg: await readFile(outputPath),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  /*
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurado.')

  const model = 'local:opencv-ptr1'
  const { data } = await axios.post(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBytes.toString('base64') } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.0,
        maxOutputTokens: 4096,
      },
    },
    { timeout: 120_000 },
  )

  const text = data?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text
  if (!text) throw new Error(`Gemini não retornou conteúdo. Finish reason: ${data?.candidates?.[0]?.finishReason}`)
  return text */
}

/**
 * QR ausente pode ser consequência de contraste baixo, mesmo quando ele está
 * visível para uma pessoa. Fazemos uma única segunda tentativa preparada para
 * QR (cinza, normalização e nitidez), apenas nesse caso. Isso melhora a taxa
 * de leitura sem duplicar trabalho em todas as folhas nem criar nova fila.
 */
async function readLocalOmrWithQrRecovery(imageBytes: Buffer): Promise<{ result: LocalOmrResult; canonicalJpeg: Buffer }> {
  let firstResult: { result: LocalOmrResult; canonicalJpeg: Buffer } | null = null
  let firstError: unknown = null
  try {
    firstResult = await readLocalOmr(imageBytes)
    if (firstResult.result.qrToken) return firstResult
  } catch (error) {
    firstError = error
  }

  try {
    const qrEnhanced = await sharp(imageBytes, { failOn: 'none' })
      .grayscale()
      .normalise()
      .sharpen({ sigma: 1 })
      .png({ compressionLevel: 6 })
      .toBuffer()
    const recovered = await readLocalOmr(qrEnhanced)
    // A versão recuperada só substitui a primeira quando trouxe o QR. Caso
    // contrário preservamos a melhor imagem canônica da leitura original.
    return recovered.result.qrToken || !firstResult ? recovered : firstResult
  } catch (recoveryError) {
    if (firstResult) return firstResult
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
    const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
    const code = [firstMessage, recoveryMessage].some((message) => message.startsWith('OMR_TIMEOUT:')) ? 'OMR_TIMEOUT' : 'OMR_RECOVERY_FAILED'
    throw new Error(`${code}: initial=${firstMessage}; recovery=${recoveryMessage}`)
  }
}

// ---------------------------------------------------------------------------
// Prompt de leitura da folha
// ---------------------------------------------------------------------------

function buildScanPrompt(
  pageNumber: number,
  totalPages: number,
  expectedQuestions: Array<{ number: number; kind: 'objective' | 'discursive' }>,
) {
  const questionsDesc = expectedQuestions
    .map((q) => (q.kind === 'objective' ? `questão ${q.number} (objetiva, bolhas A B C D E)` : `questão ${q.number} (discursiva)`))
    .join(', ')

  const readingsTemplate = expectedQuestions
    .map((q) =>
      q.kind === 'objective'
        ? `{"questionNumber":${q.number},"kind":"objective","suggestedLetter":"<A|B|C|D|E ou null>","confidence":0.95,"exceptionCode":null}`
        : `{"questionNumber":${q.number},"kind":"discursive","suggestedTranscription":null,"confidence":null,"exceptionCode":null}`,
    )
    .join(',\n    ')

  return `Você é um sistema de leitura óptica de folhas de resposta escolar brasileira (formato PTR1).

Esta é a página ${pageNumber} de ${totalPages}.

TAREFA:
1. Localize e leia o QR code presente na folha (geralmente no canto superior ou inferior). Retorne o texto COMPLETO do QR, incluindo todos os pontos e hífens.
2. Identifique o tipo de página: 'objective' (tem bolhas A/B/C/D/E), 'discursive' (tem linhas para escrita), ou 'unknown'.
3. Para cada questão objetiva esperada, identifique qual bolha está marcada (preenchida ou com X).
4. Estime a qualidade da imagem entre 0.0 (ilegível) e 1.0 (perfeita).

QUESTÕES ESPERADAS NESTA PÁGINA: ${questionsDesc}

Responda APENAS com este JSON (sem texto fora do JSON):
{
  "qrToken": "<texto completo do QR code ou null se não encontrar>",
  "pageType": "<objective|discursive|unknown>",
  "qualityScore": <0.0 a 1.0>,
  "exceptionCode": null,
  "readings": [
    ${readingsTemplate}
  ]
}`
}

// ---------------------------------------------------------------------------
// Lógica de resolução de página (espelha a rota /result)
// ---------------------------------------------------------------------------

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

type Assignment = typeof examSheetAssignments.$inferSelect
type SigningKeys = ReturnType<typeof readSheetQrSigningKeys>

function isIssuedToken(assignment: Assignment, qr: NonNullable<ReturnType<typeof verifyPageQrPayload>>, signingKeys: SigningKeys) {
  const signingKey = signingKeys.find((k) => k.keyId === qr.keyId)
  if (!signingKey || !assignment.tokenDigest || qr.pageNumber > assignment.pageCount) return false
  const tokens = Array.from({ length: assignment.pageCount }, (_, i) =>
    createPageQrPayload({ publicId: assignment.publicId, pageNumber: i + 1, layoutVersion: assignment.layoutVersion }, signingKey)
  )
  return createSheetTokenDigest(tokens) === assignment.tokenDigest
}

function resolvePage(params: {
  qrToken: string | null | undefined
  exceptionCode: string | null | undefined
  pageType: string
  qualityScore: number | null | undefined
  assignmentsByPublicId: Map<string, Assignment>
  expectedPageKinds: Array<'objective' | 'discursive'>
  signingKeys: SigningKeys
  currentExamId: number
}) {
  const { qrToken, exceptionCode, pageType, qualityScore, assignmentsByPublicId, expectedPageKinds, signingKeys } = params
  if (!qrToken) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'QR_MISSING', assignment: null, sheetPageNumber: null, resolvedPageType: null, qrTokenDigest: null }
  }
  const qr = verifyPageQrPayload(qrToken, signingKeys)
  if (!qr) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'QR_INVALID', assignment: null, sheetPageNumber: null, resolvedPageType: null, qrTokenDigest: tokenDigest(qrToken) }
  }
  const assignment = assignmentsByPublicId.get(qr.publicId)
  if (!assignment) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'ASSIGNMENT_NOT_FOUND', assignment: null, sheetPageNumber: qr.pageNumber, resolvedPageType: null, qrTokenDigest: tokenDigest(qrToken) }
  }
  if (assignment.status !== 'emitida' || assignment.layoutVersion !== qr.layoutVersion || !isIssuedToken(assignment, qr, signingKeys)) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'SHEET_NOT_EMITTED', assignment: null, sheetPageNumber: qr.pageNumber, resolvedPageType: null, qrTokenDigest: tokenDigest(qrToken) }
  }
  if (assignment.examId !== params.currentExamId) {
    return { status: 'needs_review' as const, exceptionCode: 'SCAN_BELONGS_TO_ANOTHER_EXAM', assignment, sheetPageNumber: qr.pageNumber, resolvedPageType: null, qrTokenDigest: tokenDigest(qrToken) }
  }
  const expectedPageType = expectedPageKinds[qr.pageNumber - 1]
  if (!expectedPageType || pageType !== expectedPageType) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'PAGE_TYPE_MISMATCH', assignment, sheetPageNumber: qr.pageNumber, resolvedPageType: expectedPageType ?? null, qrTokenDigest: tokenDigest(qrToken) }
  }
  if (qualityScore !== null && qualityScore !== undefined && qualityScore < 0.65) {
    return { status: 'needs_review' as const, exceptionCode: exceptionCode ?? 'LOW_QUALITY', assignment, sheetPageNumber: qr.pageNumber, resolvedPageType: expectedPageType, qrTokenDigest: tokenDigest(qrToken) }
  }
  return { status: exceptionCode ? 'needs_review' as const : 'processed' as const, exceptionCode: exceptionCode ?? null, assignment, sheetPageNumber: qr.pageNumber, resolvedPageType: expectedPageType, qrTokenDigest: tokenDigest(qrToken) }
}

// ---------------------------------------------------------------------------
// Processador principal
// ---------------------------------------------------------------------------

export async function processLocalScan(input: { uploadId: number; examId: number; attemptId: number; pageId?: number }) {
  const { uploadId, examId, attemptId, pageId } = input

  // 1. Carregar dados
  const [upload, attempt, exam] = await Promise.all([
    db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)) }),
    db.query.examScanProcessingAttempts.findFirst({ where: eq(examScanProcessingAttempts.id, attemptId) }),
    db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) }),
  ])
  if (!upload || !attempt || !exam) throw new Error('Upload, tentativa ou prova não encontrados.')
  if (!['queued', 'delivered'].includes(attempt.status)) throw new Error('Tentativa não está em estado processável.')
  if (upload.status !== 'archived' || !upload.driveFileId) throw new Error('Upload não está arquivado.')

  // 2. Ler bytes do arquivo do storage local
  const fileBytes = await downloadPrivateScanBytes(upload.driveFileId)

  // 3. Montar layout esperado pela prova
  const payload = exam.generationPayload as ExamGenerationResult
  const plannedPages = planSheetPages(payload.questions)
  const expectedPageKinds = plannedPages.map((p) => p.kind)
  const expectedReadingsBySheetPage = new Map(plannedPages.map((page, index) => [
    index + 1,
    new Map(page.questions.map((q) => [q.number, q.type === 'objetiva' ? 'objective' as const : 'discursive' as const])),
  ]))

  // 4. Páginas catalogadas do upload
  const pages = await db.query.examScanPages.findMany({
    where: pageId
      ? and(eq(examScanPages.uploadId, uploadId), eq(examScanPages.id, pageId))
      : eq(examScanPages.uploadId, uploadId),
    orderBy: [asc(examScanPages.pageIndex)],
  })
  if (pages.length === 0) throw new Error('Nenhuma página catalogada para este upload.')
  if (pageId && pages[0].id !== pageId) throw new Error('A página do job não pertence ao upload informado.')
  await db.transaction(async (tx) => {
    await tx.update(examScanPages)
      .set({ status: 'processing', exceptionCode: null, updatedAt: new Date() })
      .where(pageId ? eq(examScanPages.id, pageId) : eq(examScanPages.uploadId, uploadId))
    await tx.update(examScanProcessingAttempts)
      .set({ status: 'delivered', updatedAt: new Date() })
      .where(eq(examScanProcessingAttempts.id, attemptId))
    await tx.insert(examScanAuditEvents).values({
      examId,
      uploadId,
      action: 'local_scan_processing_started',
      metadata: { attemptId, pageCount: pages.length },
    })
  })

  // 5. Chaves QR e atribuições de folha
  const signingKeys = readSheetQrSigningKeys()
  // O identificador da folha é globalmente único. Isso torna possível avisar
  // quando uma página foi enviada no scanner da prova errada, sem nunca
  // oferecer associação manual para mascarar o problema.
  const assignments = await db.query.examSheetAssignments.findMany()
  const assignmentsByPublicId = new Map(assignments.map((a) => [a.publicId, a]))

  // 6. Para PDFs multi-página, extrair páginas individuais
  let pageBuffers: Array<{ bytes: Buffer; mimeType: string }> = []
  if (upload.mimeType === 'application/pdf') {
    try {
      const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: false })
      const totalPdfPages = pdf.getPageCount()
      if (totalPdfPages === 1) {
        // PDF de 1 página: enviar direto (Gemini 2.0 aceita PDF como inlineData)
        pageBuffers = [{ bytes: fileBytes, mimeType: 'application/pdf' }]
      } else {
        // Jobs por página não precisam reconstruir todas as páginas do PDF.
        // Em uploads grandes isso reduz bastante CPU/memória e o tempo antes
        // da leitura; o caminho sem pageId continua processando o lote inteiro.
        const indexesToExtract = pageId ? [Math.max(0, Math.min(totalPdfPages - 1, pages[0].pageIndex - 1))] : Array.from({ length: totalPdfPages }, (_, index) => index)
        for (const i of indexesToExtract) {
          const singlePage = await PDFDocument.create()
          const [copiedPage] = await singlePage.copyPages(pdf, [i])
          singlePage.addPage(copiedPage)
          const singlePageBytes = Buffer.from(await singlePage.save())
          pageBuffers.push({ bytes: singlePageBytes, mimeType: 'application/pdf' })
        }
      }
    } catch {
      // Fallback: enviar PDF inteiro
      pageBuffers = [{ bytes: fileBytes, mimeType: 'application/pdf' }]
    }
  } else {
    pageBuffers = [{ bytes: fileBytes, mimeType: upload.mimeType as string }]
  }

  // 7. Chamar Gemini Vision para cada página catalogada
  const workerPages: WorkerScanResult['pages'] = []
  const model = SCAN_READER_MODEL
  const diagnosticsByPage = new Map<number, Record<string, unknown>>()

  for (const page of pages) {
    const pageIndex = page.pageIndex
    const pageBuffer = pageBuffers[pageIndex - 1] ?? pageBuffers[0]

    let visionResult: WorkerScanResult['pages'][number]
    try {
      // A imagem de análise permanece sem perdas até o leitor. A JPEG canônica
      // é criada somente depois da retificação e é usada pela revisão/OCR.
      const normalizedInput = await normalizePageToLosslessPng(pageBuffer.bytes, pageBuffer.mimeType)
      const { result: local, canonicalJpeg } = await readLocalOmrWithQrRecovery(normalizedInput)
      // Uma foto avulsa sempre tem pageIndex=1 no upload. A página real da
      // folha (e, portanto, suas questões) vem do QR assinado, não da ordem em
      // que arquivos foram selecionados ou páginas foram juntadas no PDF.
      const decodedQr = local.qrToken ? verifyPageQrPayload(local.qrToken, signingKeys) : null
      const assignment = decodedQr ? assignmentsByPublicId.get(decodedQr.publicId) : null
      const acceptedQr = Boolean(
        decodedQr
        && assignment
        && assignment.examId === examId
        && assignment.status === 'emitida'
        && assignment.layoutVersion === decodedQr.layoutVersion
        && decodedQr.pageNumber <= plannedPages.length
        && isIssuedToken(assignment, decodedQr, signingKeys),
      )
      const sheetPageIndex = acceptedQr && decodedQr ? decodedQr.pageNumber - 1 : -1
      const plannedPage = acceptedQr ? plannedPages[sheetPageIndex] : undefined
      const expectedQuestions = acceptedQr && plannedPage
        ? plannedPage.questions.map((question) => ({
            number: question.number,
            kind: (question.type === 'objetiva' ? 'objective' : 'discursive') as 'objective' | 'discursive',
          }))
        : []

      const canonicalSha256 = createHash('sha256').update(canonicalJpeg).digest('hex')
      const shouldReplaceCanonical = page.canonicalVerifiedSha256 !== canonicalSha256
      if (shouldReplaceCanonical) {
        await stageAndArchivePrivateArtifact({
          bytes: canonicalJpeg,
          examId,
          uploadId,
          artifact: 'canonical_page',
          artifactId: page.id,
          saveStagingKey: async (key) => {
            await db.update(examScanPages).set({ canonicalStagingObjectKey: key, canonicalArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanPages.id, page.id))
          },
          saveArchived: async (artifact, inspection) => {
            await db.update(examScanPages).set({ canonicalDriveFileId: artifact.driveFileId, canonicalVerifiedSha256: artifact.verifiedSha256, canonicalMimeType: inspection.mimeType, canonicalStagingObjectKey: null, canonicalArchivedAt: new Date(), canonicalArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanPages.id, page.id))
          },
          saveFailure: async () => {
            await db.update(examScanPages).set({ canonicalArchiveErrorCode: 'ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanPages.id, page.id))
          },
        })
      }

      const readings = expectedQuestions.map((question, index) => ({
        questionNumber: question.number,
        kind: question.kind,
        suggestedLetter: question.kind === 'objective' && ['A', 'B', 'C', 'D', 'E'].includes(local.bubbles[index]?.answer ?? '')
          ? local.bubbles[index].answer as 'A' | 'B' | 'C' | 'D' | 'E'
          : null,
        suggestedTranscription: null,
        confidence: question.kind === 'objective' ? (local.bubbles[index]?.confidence ?? null) : null,
        exceptionCode: question.kind === 'objective' ? normalizeOmrException(local.bubbles[index]?.exceptionCode) : null,
        modelReference: model,
      }))

      visionResult = {
        pageIndex,
        qrToken: local.qrToken,
        pageType: plannedPage?.kind ?? 'unknown',
        qualityScore: typeof local.qualityScore === 'number' ? Math.min(1, Math.max(0, local.qualityScore)) : null,
        exceptionCode: local.exceptionCode ?? local.qrFailureCode ?? null,
        readings,
      }
      diagnosticsByPage.set(page.id, {
        readerVersion: local.readerVersion ?? null,
        qrEngine: local.qrEngine ?? null,
        qrAttempts: local.qrAttempts ?? null,
        qrDurationMs: local.qrDurationMs ?? null,
        qrRotation: local.qrRotation ?? null,
        qrDecoded: Boolean(local.qrToken),
        qrAccepted: acceptedQr,
        canonicalReplaced: shouldReplaceCanonical,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[processar_scan] Falha no leitor OMR local', {
        examId,
        uploadId,
        attemptId,
        pageId: page.id,
        pageIndex,
        model,
        exceptionCode: errMsg.startsWith('OMR_TIMEOUT:') ? 'OMR_TIMEOUT' : errMsg.startsWith('OMR_PROCESS_FAILED:') ? 'OMR_PROCESS_FAILED' : 'OMR_RUNTIME_ERROR',
        error: errMsg,
      })
      // Auditoria nunca deve impedir que a página seja marcada para revisão.
      await db.insert(examScanAuditEvents).values({
        examId,
        uploadId,
        action: 'local_scan_page_runtime_error',
        metadata: { attemptId, pageId: page.id, pageIndex, exceptionCode: errMsg.startsWith('OMR_TIMEOUT:') ? 'OMR_TIMEOUT' : errMsg.startsWith('OMR_PROCESS_FAILED:') ? 'OMR_PROCESS_FAILED' : 'OMR_RUNTIME_ERROR', error: errMsg.slice(0, 500) },
      }).catch((auditError) => console.error('[processar_scan] Não foi possível registrar auditoria do erro OMR', { examId, uploadId, pageId: page.id, auditError: auditError instanceof Error ? auditError.message : String(auditError) }))
      visionResult = {
        pageIndex,
        qrToken: null,
        pageType: 'unknown',
        qualityScore: null,
        exceptionCode: errMsg.startsWith('OMR_TIMEOUT:') ? 'OMR_TIMEOUT' : errMsg.startsWith('OMR_PROCESS_FAILED:') ? 'OMR_PROCESS_FAILED' : 'OMR_RUNTIME_ERROR',
        readings: [],
      }
      diagnosticsByPage.set(page.id, { runtimeError: errMsg.slice(0, 500) })
    }

    workerPages.push(visionResult)
  }

  // 8. Validar estrutura completa
  const result = workerScanResultSchema.parse({
    uploadSha256: upload.sha256,
    pages: workerPages,
  })

  // 9. Persistir resultado no banco
  const pagesByIndex = new Map(pages.map((p) => [p.pageIndex, p]))
  let processedPages = 0
  let reviewPages = 0
  const readingRefs: Array<{ id: number; pageId: number; questionNumber: number }> = []
  const correctionIdsForOcr = new Set<number>()
  const correctionIdsForScoring = new Set<number>()

  await db.transaction(async (tx) => {
    for (const resultPage of result.pages) {
      const page = pagesByIndex.get(resultPage.pageIndex)!
      const resolved = resolvePage({
        qrToken: resultPage.qrToken,
        exceptionCode: resultPage.exceptionCode,
        pageType: resultPage.pageType,
        qualityScore: resultPage.qualityScore,
        assignmentsByPublicId,
        expectedPageKinds,
        signingKeys,
        currentExamId: examId,
      })

      const assignment = resolved.assignment
      const sheetPageNumber = resolved.sheetPageNumber
      const existingOfficialPage = assignment?.examId === examId && sheetPageNumber !== null
        ? await tx.query.examScanPages.findFirst({
          where: and(
            eq(examScanPages.sheetAssignmentId, assignment.id),
            eq(examScanPages.sheetPageNumber, sheetPageNumber),
            sql`${examScanPages.uploadId} <> ${uploadId}`,
            sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SUPERSEDED_BY_NEW_SCAN'`,
            sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'DUPLICATE_SHEET_SCAN'`,
            // A page that was identified as belonging to another exam is not
            // an authoritative copy of this assignment/page. It must not
            // block a later valid scan from becoming the current one.
            sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SCAN_BELONGS_TO_ANOTHER_EXAM'`,
          ),
          orderBy: [asc(examScanPages.createdAt)],
        })
        : null
      const isDuplicateScan = Boolean(existingOfficialPage)

      const expectedReadings = resolved.sheetPageNumber ? expectedReadingsBySheetPage.get(resolved.sheetPageNumber) : null
      const hasInvalidReading = resultPage.readings.some((r) => normalizeOmrException(r.exceptionCode) || !expectedReadings || expectedReadings.get(r.questionNumber) !== r.kind)
      const isIncomplete = Boolean(expectedReadings && [...expectedReadings.keys()].some((n) => !resultPage.readings.some((r) => r.questionNumber === n)))
      const hasReadingException = hasInvalidReading || isIncomplete
      const finalStatus = resolved.status === 'processed' && !hasReadingException && !isDuplicateScan ? 'processed' as const : 'needs_review' as const
      const finalException = resolved.exceptionCode ?? (isDuplicateScan ? 'DUPLICATE_SHEET_SCAN' : isIncomplete ? 'READING_INCOMPLETE' : hasInvalidReading ? 'READING_REVIEW_REQUIRED' : null)

      // Uma tentativa anterior sem QR pode ter criado leituras para a página
      // 1 por engano. Elas são apenas sugestões pendentes e precisam sair
      // quando a página real é descoberta; decisões docentes nunca são
      // apagadas automaticamente.
      const existingReadings = await tx.query.examScanReadings.findMany({
        where: eq(examScanReadings.pageId, page.id),
        columns: { id: true, questionNumber: true, reviewStatus: true },
      })
      for (const existing of existingReadings) {
        const belongsToResolvedPage = Boolean(expectedReadings?.has(existing.questionNumber))
        if (existing.reviewStatus === 'pending' && !belongsToResolvedPage) {
          await tx.delete(examScanReadings).where(eq(examScanReadings.id, existing.id))
        }
      }

      if (finalStatus === 'processed') processedPages += 1
      else reviewPages += 1
      if (!isDuplicateScan && resolved.assignment?.examId === examId && resolved.resolvedPageType === 'discursive') correctionIdsForOcr.add(resolved.assignment.examCorrectionId)

      await tx.update(examScanPages).set({
        // A QR from another exam is evidence for routing only. It must never
        // become the authoritative assignment of a page in this upload.
        detectedSheetAssignmentId: resolved.assignment?.examId !== examId ? resolved.assignment?.id ?? null : null,
        sheetAssignmentId: resolved.assignment?.examId === examId ? resolved.assignment.id : null,
        sheetPageNumber: resolved.sheetPageNumber,
        pageType: resolved.resolvedPageType,
        qrTokenDigest: resolved.qrTokenDigest,
        qualityScore: resultPage.qualityScore ?? null,
        status: finalStatus,
        exceptionCode: finalException,
        updatedAt: new Date(),
      }).where(eq(examScanPages.id, page.id))

      for (const reading of resultPage.readings) {
        const readingException = normalizeOmrException(reading.exceptionCode)
          ?? (!expectedReadings || expectedReadings.get(reading.questionNumber) !== reading.kind ? 'QUESTION_KIND_MISMATCH' : null)
        const existing = await tx.query.examScanReadings.findFirst({
          where: and(eq(examScanReadings.pageId, page.id), eq(examScanReadings.questionNumber, reading.questionNumber)),
        })
        if (existing?.reviewStatus && existing.reviewStatus !== 'pending') {
          readingRefs.push({ id: existing.id, pageId: page.id, questionNumber: reading.questionNumber })
          continue
        }
        const values = {
          kind: reading.kind,
          suggestedLetter: reading.suggestedLetter ?? null,
          // Reprocessing a page must not erase a transcription already
          // produced by the OCR worker while the scan reader was being
          // retried. The local OMR reader intentionally has no transcription
          // to provide for discursives.
          suggestedTranscription: existing?.suggestedTranscription ?? reading.suggestedTranscription ?? null,
          confirmedTranscription: existing?.confirmedTranscription ?? null,
          confidence: reading.confidence ?? null,
          exceptionCode: readingException,
          modelReference: reading.modelReference ?? null,
          updatedAt: new Date(),
        }
        if (existing) {
          await tx.update(examScanReadings).set(values).where(eq(examScanReadings.id, existing.id))
          readingRefs.push({ id: existing.id, pageId: page.id, questionNumber: reading.questionNumber })
        } else {
          const [created] = await tx.insert(examScanReadings).values({
            pageId: page.id,
            questionNumber: reading.questionNumber,
            ...values,
          }).returning({ id: examScanReadings.id })
          readingRefs.push({ id: created.id, pageId: page.id, questionNumber: reading.questionNumber })
        }
      }

      // A folha com QR válido, boa qualidade e bolhas inequívocas já está
      // confirmada pelo próprio contrato PTR1. Copia somente objetivas para a
      // correção formal; qualquer exceção continua exclusivamente na revisão.
      if (finalStatus === 'processed' && resolved.assignment?.examId === examId && resultPage.readings.some((reading) => reading.kind === 'objective')) {
        const correction = await tx.query.examCorrections.findFirst({ where: eq(examCorrections.id, resolved.assignment.examCorrectionId) })
        if (correction) {
          const answers = (correction.answers as CorrectionAnswer[]).map((answer) => {
            const reading = resultPage.readings.find((item) => item.kind === 'objective' && item.questionNumber === answer.questionNumber)
            if (!reading || answer.type !== 'objetiva' || !reading.suggestedLetter) return answer
            const isCorrect = reading.suggestedLetter === (answer.correctLetter ?? '').trim().toUpperCase()
            const maximum = questionMaxGrade(answer)
            return { ...answer, weight: maximum, transcribedAnswer: reading.suggestedLetter, isCorrect, finalGrade: isCorrect ? maximum : 0 }
          })
          await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
          correctionIdsForScoring.add(correction.id)
        }
      }
    }

    const allPages = await tx.query.examScanPages.findMany({
      where: eq(examScanPages.uploadId, uploadId),
      columns: { status: true },
    })
    const attemptCompleted = allPages.length > 0 && allPages.every((page) => ['processed', 'needs_review', 'failed'].includes(page.status))
    if (attemptCompleted) {
      await tx.update(examScanProcessingAttempts)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(examScanProcessingAttempts.id, attemptId))
    }

    await tx.insert(examScanAuditEvents).values({
      examId,
      uploadId,
      action: 'local_scan_processed',
      metadata: {
        attemptId,
        pageId: pageId ?? null,
        processedPages,
        reviewPages,
        model,
        pipelineVersion: SCAN_PIPELINE_VERSION,
        pageDiagnostics: [...diagnosticsByPage.entries()].map(([diagnosticPageId, metadata]) => ({ pageId: diagnosticPageId, ...metadata })),
        attemptCompleted,
      },
    })
  })

  // Discursivas não são lidas pelo OMR. Assim que a página e o QR forem
  // reconhecidos, o OCR é colocado automaticamente na fila para que a tela
  // de revisão já abra com a transcrição quando ela estiver pronta.
  for (const correctionId of correctionIdsForOcr) {
    try {
      await queueDiscursiveTranscriptions({ examId, requestedBy: attempt.requestedBy, correctionId })
    } catch (error) {
      console.warn('[processar_scan] não foi possível enfileirar OCR discursivo:', error instanceof Error ? error.message : error)
    }
  }

  // Um novo scan pode reconstruir uma correção que foi limpa ao descartar um
  // envio anterior. Recalcula o score persistido assim que as objetivas forem
  // copiadas, para não deixar o perfil do aluno com nota zero até outra edição.
  if (correctionIdsForScoring.size > 0) {
    try {
      await enqueuePontuarProvaJob(examId, attempt.requestedBy)
    } catch (error) {
      console.warn('[processar_scan] não foi possível enfileirar a pontuação após o scan:', error instanceof Error ? error.message : error)
    }
  }

  return { processedPages, reviewPages, readingRefs, pageId: pageId ?? null }
}

/** Marca uma página como revisável quando a falha ocorreu fora do leitor
 * controlado (storage, PDF ou banco) e o job chegou ao limite de tentativas. */
export async function markLocalScanPageFailure(input: { examId: number; uploadId: number; attemptId: number; pageId: number; error: string }) {
  await db.transaction(async (tx) => {
    await tx.update(examScanPages).set({
      status: 'needs_review',
      exceptionCode: 'SCAN_PROCESSING_FAILED',
      updatedAt: new Date(),
    }).where(and(eq(examScanPages.id, input.pageId), eq(examScanPages.uploadId, input.uploadId)))
    await tx.insert(examScanAuditEvents).values({
      examId: input.examId,
      uploadId: input.uploadId,
      action: 'local_scan_page_runtime_error',
      metadata: { attemptId: input.attemptId, pageId: input.pageId, exceptionCode: 'SCAN_PROCESSING_FAILED', error: input.error.slice(0, 500) },
    })
  })
}
