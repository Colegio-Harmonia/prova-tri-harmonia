export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">{value}</p>
    </div>
  )
}

export const CONFIDENCE_LABELS: Record<'baixa' | 'media' | 'alta', string> = {
  baixa: 'Confiança baixa',
  media: 'Confiança média',
  alta: 'Confiança alta',
}

export const BLOOM_ORDER = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']
export const DOK_ORDER = ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4']
export const BLOOM_LABELS: Record<string, string> = {
  lembrar: 'Lembrar', compreender: 'Compreender', aplicar: 'Aplicar', analisar: 'Analisar', avaliar: 'Avaliar', criar: 'Criar',
}
export const DOK_LABELS: Record<string, string> = {
  DOK_1: 'DOK 1',
  DOK_2: 'DOK 2',
  DOK_3: 'DOK 3',
  DOK_4: 'DOK 4',
}
