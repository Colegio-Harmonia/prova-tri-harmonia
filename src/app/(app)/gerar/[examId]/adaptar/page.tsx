import AdaptarExam from './AdaptarExam'

export default async function AdaptarPage(props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  return <AdaptarExam examId={Number(params.examId)} />
}
