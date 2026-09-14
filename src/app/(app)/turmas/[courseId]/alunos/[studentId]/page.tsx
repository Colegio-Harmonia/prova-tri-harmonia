import StudentDetail from './StudentDetail'

export default async function StudentPage({ params }: { params: Promise<{ courseId: string; studentId: string }> }) {
  const { courseId, studentId } = await params
  return <StudentDetail courseId={courseId} studentId={studentId} />
}
