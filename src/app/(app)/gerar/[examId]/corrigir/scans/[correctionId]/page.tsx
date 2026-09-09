import { redirect } from 'next/navigation'

export default async function ScanCorrectionReviewPage({ params }: { params: Promise<{ examId: string; correctionId: string }> }) {
  const { examId, correctionId } = await params
  redirect(`/gerar/${examId}/corrigir/alunos/${correctionId}`)
}
