'use client'

export default function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded bg-harmonia-green px-3 py-2 text-sm font-semibold text-action-primary-foreground">Imprimir / Salvar em PDF</button>
}
