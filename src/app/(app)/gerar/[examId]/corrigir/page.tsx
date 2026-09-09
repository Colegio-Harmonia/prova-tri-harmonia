import CorrigirExam from './CorrigirExam'

export default async function CorrigirPage(props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  return <CorrigirExam examId={Number(params.examId)} />
}
