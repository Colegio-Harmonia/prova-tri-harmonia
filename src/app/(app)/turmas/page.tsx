import MinhasTurmas from './MinhasTurmas'

export default function TurmasPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Turmas</h1>
      <p className="mt-1 text-sm text-neutral-500">Turmas do seu Google Classroom que possuem provas vinculadas no Prova-TRI.</p>

      <div className="mt-6">
        <MinhasTurmas />
      </div>
    </div>
  )
}
