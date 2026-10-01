export type SemanticOrganizationView = {
  source: 'provider' | 'cache' | 'fallback'
  needsReview: boolean
  heading: string
  interpretation: string
  nextAction: string
}

export default function SemanticOrganizationCard({ organization }: { organization: SemanticOrganizationView | null }) {
  if (!organization) return null
  const origin = organization.source === 'fallback' ? 'Organização determinística de contingência' : 'Leitura organizada pelo Jev'
  return <section className="rounded border border-border bg-surface p-4" aria-label="Organização pedagógica dos resultados">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-content-primary">{organization.heading}</h2>
      <span className="rounded bg-surface-subtle px-2 py-1 text-xs text-content-muted">{origin}</span>
    </div>
    <p className="mt-2 text-sm text-content-secondary">{organization.interpretation}</p>
    <p className="mt-2 text-sm font-medium text-content-primary">Próximo passo: {organization.nextAction}</p>
    {organization.needsReview && <p className="mt-2 text-xs text-content-muted">Sugestão para revisão pedagógica; os resultados e critérios numéricos não foram alterados.</p>}
  </section>
}
