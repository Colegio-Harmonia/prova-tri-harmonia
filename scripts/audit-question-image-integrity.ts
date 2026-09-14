import { loadEnvConfig } from '@next/env'
import { getDriveClient } from '@/lib/docs/driveClient'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

loadEnvConfig(process.cwd())

type ImageReference = { examId: number; questionNumber: number; driveFileId: string; sourceUrl: string | null }

async function main() {
  const exams = await db.select({ id: generatedExams.id, generationPayload: generatedExams.generationPayload }).from(generatedExams)
  const references = exams.flatMap(({ id, generationPayload }) => {
    const payload = generationPayload as ExamGenerationResult
    return payload.questions.flatMap((question): ImageReference[] => question.image
      ? [{ examId: id, questionNumber: question.number, driveFileId: question.image.driveFileId, sourceUrl: question.image.sourceUrl ?? null }]
      : [])
  })

  const drive = getDriveClient()
  const check = async (reference: ImageReference) => {
    try {
      const { data } = await drive.files.get({ fileId: reference.driveFileId, fields: 'mimeType,size', supportsAllDrives: true })
      const size = Number(data.size ?? 0)
      return { ...reference, ok: data.mimeType?.startsWith('image/') && Number.isSafeInteger(size) && size > 0, mimeType: data.mimeType ?? null, size }
    } catch (error) {
      return { ...reference, ok: false, mimeType: null, size: 0, error: error instanceof Error ? error.message : 'Erro ao consultar o Drive' }
    }
  }
  // Evita um pico de centenas de requisições contra a conta de serviço.
  const checked = [] as Awaited<ReturnType<typeof check>>[]
  for (let index = 0; index < references.length; index += 8) {
    checked.push(...await Promise.all(references.slice(index, index + 8).map(check)))
  }
  const invalid = checked.filter((entry) => !entry.ok)
  console.log(JSON.stringify({ checked: checked.length, invalid: invalid.length, invalidEntries: invalid }, null, 2))
  // O cliente Postgres é compartilhado com o runtime da aplicação e não
  // expõe um encerramento pelo proxy. Este é um script descartável, então
  // encerra explicitamente depois de emitir o relatório.
  process.exit(invalid.length ? 1 : 0)
}

void main()
