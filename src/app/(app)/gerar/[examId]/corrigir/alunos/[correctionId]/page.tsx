import ScanCorrectionReview from "../../scans/[correctionId]/scanCorrectionReview";

export default async function StudentCorrectionPage({
  params,
}: {
  params: Promise<{ examId: string; correctionId: string }>;
}) {
  const { examId, correctionId } = await params;
  return <ScanCorrectionReview examId={Number(examId)} correctionId={Number(correctionId)} />;
}
