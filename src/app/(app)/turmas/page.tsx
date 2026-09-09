import MinhasTurmas from './MinhasTurmas'

export default function TurmasPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Minhas Turmas</h1>
      <p className="mt-1 text-sm text-neutral-500">Turmas do Google Classroom em que você é professor.</p>

      <div className="mt-6">
        <MinhasTurmas />
      </div>
    </div>
  )
}
