import Link from 'next/link'

/** Nome de aluno navegável quando há cadastro interno; mantém texto simples
 * para alunos vindos apenas do Classroom, que ainda não têm `students.id`. */
export function StudentLink({ id, name, className }: { id: number | null | undefined; name: string; className?: string }) {
  if (!id) return <>{name}</>
  return <Link href={`/alunos/${id}`} className={className ?? 'text-harmonia-green hover:underline'}>{name}</Link>
}
