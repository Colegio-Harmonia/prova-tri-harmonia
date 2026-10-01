export type SemanticOrganizationView = {
  source: 'provider' | 'cache' | 'fallback'
  evidence: 'none' | 'limited' | 'sufficient'
  completeness: 'complete' | 'minor_pending' | 'material_pending'
  heading: string
  interpretation: string
  nextAction: string
}

type Coverage = { evaluatedCorrections: number; incompleteCorrections: number; uniqueExams: number }

export default function SemanticOrganizationCard({ organization, coverage }: { organization: SemanticOrganizationView | null; coverage: Coverage }) {
  if (!organization) return null
  const origin = organization.source === 'fallback' ? 'Jev indisponível · orientação automática aplicada' : 'Leitura organizada pelo Jev'
  const incompleteShare = Math.round((coverage.incompleteCorrections / Math.max(1, coverage.evaluatedCorrections + coverage.incompleteCorrections)) * 1000) / 10
  const evidenceNote = coverage.incompleteCorrections
    ? organization.completeness === 'material_pending'
      ? `As ${coverage.incompleteCorrections} pendências representam ${incompleteShare}% do recorte; conclua-as antes de comparar resultados.`
      : `As ${coverage.incompleteCorrections} pendências representam ${incompleteShare}% do recorte e não impedem a leitura geral; considere-as antes de fechar intervenções nos grupos afetados.`
    : organization.evidence === 'limited'
      ? 'A amostra ainda é pequena; use esta orientação como hipótese de acompanhamento, sem comparar grupos.'
      : 'A amostra deste recorte permite a leitura pedagógica.'
  return <section className="rounded border border-border bg-surface p-4" aria-label="Organização pedagógica dos resultados">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-content-primary">{organization.heading}</h2>
      <span className="rounded bg-surface-subtle px-2 py-1 text-xs text-content-muted">{origin}</span>
    </div>
    <p className="mt-2 text-xs text-content-muted">Base desta leitura: {coverage.evaluatedCorrections} participação(ões) avaliada(s) em {coverage.uniqueExams} avaliação(ões){coverage.incompleteCorrections ? ` · ${coverage.incompleteCorrections} incompleta(s)` : ''}.</p>
    <p className="mt-2 text-sm text-content-secondary">{evidenceNote}</p>
    <p className="mt-2 text-sm text-content-secondary">{organization.interpretation}</p>
    <p className="mt-2 text-sm font-medium text-content-primary">Próximo passo: {organization.nextAction}</p>
  </section>
}
