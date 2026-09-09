import ScanReviewQueue from './scanReviewQueue'

export default async function ScanReviewPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  return <ScanReviewQueue examId={Number(examId)} />
}
