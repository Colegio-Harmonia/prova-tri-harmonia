import CurriculumPreview from './CurriculumPreview'

export default function GerarPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Gerar prova</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Escolha segmento, ano e uma ou mais disciplinas — cada disciplina vira uma prova na fila de geração, sem travar sua navegação.
      </p>
      <div className="mt-6">
        <CurriculumPreview />
      </div>
    </div>
  )
}
