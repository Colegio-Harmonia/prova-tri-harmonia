import type { drive_v3 } from 'googleapis'
import { findOrCreateFolder } from './driveClient'
import type { Segment } from '@/types/exam'

const SEGMENT_LABELS: Record<Segment, string> = {
  'anos-iniciais': 'Anos Iniciais',
  'anos-finais': 'Anos Finais',
  'ensino-medio': 'Ensino Médio',
}

export async function ensureExamFolderPath(
  drive: drive_v3.Drive,
  params: { segment: Segment; gradeYear: number; subject: string; bimester?: number | null },
  dateLabel: string,
): Promise<string> {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID
  if (!rootId) throw new Error('DRIVE_ROOT_FOLDER_ID não configurado')

  const segmentFolder = await findOrCreateFolder(drive, SEGMENT_LABELS[params.segment], rootId)
  const gradeFolder = await findOrCreateFolder(drive, `${params.gradeYear}º ano`, segmentFolder)
  const subjectFolder = await findOrCreateFolder(drive, params.subject, gradeFolder)
  const examFolderName = params.bimester ? `Bimestre ${params.bimester} - ${dateLabel}` : `Prova - ${dateLabel}`
  return findOrCreateFolder(drive, examFolderName, subjectFolder)
}
