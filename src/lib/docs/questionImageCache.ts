import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { getDriveClient } from './driveClient'
import { uploadToStaging } from '@/lib/images/questionImageService'
import { isQuestionImageApproved } from '@/lib/exams/questionOrigin'

/** Reprocessa também imagens antigas na exportação, sem alterar o original salvo. */
export async function prepareQuestionImages(exam: ExamGenerationResult): Promise<ExamGenerationResult> {
  const drive = getDriveClient()
  const cache = new Map<string, Awaited<ReturnType<typeof uploadToStaging>>>()
  const questions = []
  for (const question of exam.questions) {
    if (!isQuestionImageApproved(question) || (question.image.width && question.image.height)) {
      questions.push(question)
      continue
    }
    try {
      const fileId = question.image.driveFileId
      let uploaded = cache.get(fileId)
      if (!uploaded) {
        const { data } = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
        uploaded = await uploadToStaging(Buffer.from(data as ArrayBuffer), 'image/png', `questao-${question.number}.png`)
        cache.set(fileId, uploaded)
      }
      questions.push({ ...question, image: { ...question.image, ...uploaded } })
    } catch (error) {
      console.warn(`[questionImageCache] Mantida imagem original da questão ${question.number}:`, error instanceof Error ? error.message : error)
      questions.push(question)
    }
  }
  return { ...exam, questions }
}
