import TurmaDetail from './TurmaDetail'

export default async function TurmaDetailPage(props: { params: Promise<{ courseId: string }> }) {
  const params = await props.params;
  return <TurmaDetail courseId={params.courseId} />
}
