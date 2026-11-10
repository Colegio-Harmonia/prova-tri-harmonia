'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api/client'

const endpoint = '/api/admin/settings/acervo'

export default function AcervoSettingsForm() {
  const [url, setUrl] = useState('')
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ url: string }>(endpoint, { cache: 'no-store', signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setUrl(data.url); setSavedUrl(data.url) } })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar a configuração. Recarregue a página para tentar novamente.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const data = await apiRequest<{ url: string }>(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      })
      setUrl(data.url)
      setSavedUrl(data.url)
      setMessage('Endereço salvo. As próximas buscas no acervo já usarão essa configuração.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o endereço.')
    } finally { setSaving(false) }
  }

  return (
    <section className="max-w-2xl rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="acervo-title">
      <h2 id="acervo-title" className="text-lg font-semibold text-content-primary">Acervo de questões</h2>
      <p className="mt-2 text-sm text-content-secondary">Configure o endereço da API usada para buscar questões do acervo.</p>
      <form onSubmit={save} className="mt-6 space-y-4" aria-busy={loading || saving}>
        <div>
          <label htmlFor="acervo-url" className="block text-sm font-medium text-content-primary">IP ou endereço da API</label>
          <input id="acervo-url" type="text" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false}
            required maxLength={2048} value={url} disabled={loading || saving || savedUrl === null}
            onChange={(event) => { setUrl(event.target.value); setError(''); setMessage('') }}
            placeholder="http://192.168.1.100:5000" aria-describedby="acervo-url-help"
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-canvas px-3 text-sm text-content-primary disabled:opacity-60" />
          <p id="acervo-url-help" className="mt-2 text-xs text-content-muted">Inclua a porta, se houver. Exemplo: 192.168.1.100:5000 ou https://acervo.escola.com.br. O endereço deve ser acessível pelo servidor do Prova-TRI.</p>
        </div>
        {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
        {message && <p role="status" className="text-sm text-harmonia-green">{message}</p>}
        <button type="submit" disabled={loading || saving || savedUrl === null || !url.trim() || url === savedUrl}
          className="min-h-11 rounded-md bg-action-primary px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:opacity-50">
          {loading ? 'Carregando…' : saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </form>
    </section>
  )
}
