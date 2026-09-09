import { getDriveClient, getDocsClient } from './driveClient'
import { ensureExamFolderPath } from './folderStructure'
import { applyA4PageSize } from './pageSetup'
import { applyProvaContent } from './provaDocBuilder'
import { applyGabaritoContent } from './gabaritoDocBuilder'
import { applyMapaContent } from './mapaDocBuilder'
import { buildAssessmentMeta } from './assessmentMeta'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { Segment } from '@/types/exam'
import type { ExamKind } from '@/db/schema'

export type GenerateExamDocsParams = {
  segment: Segment
  gradeYear: number
  subject: string
  bimester?: number | null
  // 'reforco_enem' muda títulos e nomes de arquivo (Atividade/Gabarito
  // Comentado/Mapa da Atividade) — a estrutura dos 3 docs é a mesma.
  examKind?: ExamKind
}

export type GenerateExamDocsResult = {
  driveFolderId: string
  prova: { docId: string; url: string }
  gabarito: { docId: string; url: string }
  mapa: { docId: string; url: string }
}

async function copyTemplate(drive: ReturnType<typeof getDriveClient>, templateId: string, name: string, folderId: string) {
  const { data } = await drive.files.copy({
    fileId: templateId,
    requestBody: { name, parents: [folderId] },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  })
  return { docId: data.id as string, url: (data.webViewLink as string) ?? `https://docs.google.com/document/d/${data.id}/edit` }
}

export async function generateExamDocs(exam: ExamGenerationResult, params: GenerateExamDocsParams): Promise<GenerateExamDocsResult> {
  const provaTemplateId = process.env.TEMPLATE_PROVA_DOC_ID
  const gabaritoTemplateId = process.env.TEMPLATE_GABARITO_DOC_ID
  const mapaTemplateId = process.env.TEMPLATE_MAPA_DOC_ID
  if (!provaTemplateId || !gabaritoTemplateId || !mapaTemplateId) {
    throw new Error('Templates do Google Docs não configurados (TEMPLATE_PROVA_DOC_ID / TEMPLATE_GABARITO_DOC_ID / TEMPLATE_MAPA_DOC_ID).')
  }

  const drive = getDriveClient()
  const docs = getDocsClient()

  const dateLabel = new Date().toLocaleDateString('pt-BR')
  const folderId = await ensureExamFolderPath(
    drive,
    { segment: params.segment, gradeYear: params.gradeYear, subject: params.subject, bimester: params.bimester },
    dateLabel,
  )

  const isReforco = params.examKind === 'reforco_enem'
  const isActivity = params.examKind === 'atividade'
  const reinforcementMeta = (exam.metadata as { reinforcement?: { enemSkills?: string[] } }).reinforcement
  const enemSkills = reinforcementMeta?.enemSkills ?? []

  const namePrefix = isReforco
    ? `${params.subject} - ${params.gradeYear}º ano${enemSkills.length ? ` - ${enemSkills.join(', ')}` : ''}`
    : `${params.subject} - ${params.gradeYear}º ano${params.bimester ? ` - Bimestre ${params.bimester}` : ''}`

  const [prova, gabarito, mapa] = await Promise.all([
    copyTemplate(drive, provaTemplateId, `${isReforco ? 'Atividade de Reforço' : isActivity ? 'Atividade' : 'Prova'} - ${namePrefix}`, folderId),
    copyTemplate(drive, gabaritoTemplateId, `${isReforco ? 'Gabarito comentado' : isActivity ? 'Gabarito da atividade' : 'Gabarito'} - ${namePrefix}`, folderId),
    copyTemplate(drive, mapaTemplateId, `${isReforco || isActivity ? 'Mapa da atividade' : 'Mapa da prova'} - ${namePrefix}`, folderId),
  ])

  const meta = buildAssessmentMeta({ ...params, enemSkills })

  await applyA4PageSize(docs, prova.docId)
  await applyProvaContent(docs, prova.docId, exam, meta)

  await applyA4PageSize(docs, gabarito.docId)
  await applyGabaritoContent(docs, gabarito.docId, exam, meta)

  await applyA4PageSize(docs, mapa.docId)
  await applyMapaContent(docs, mapa.docId, exam, meta)

  return { driveFolderId: folderId, prova, gabarito, mapa }
}
