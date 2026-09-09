import { inferBloomFromVerb, isAttitudinal } from '@/config/bloomVerbs'
import type { ObjectiveSentence } from '@/types/exam'

function splitSentences(raw: string): string[] {
  return raw
    .split(/\.\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Parses the free-text "Objetivos" column into per-sentence Bloom
 * classifications. Attitudinal/afetivo phrases are filtered before verb
 * matching (checked first, since a phrase like "reconhecer e valorizar as
 * diferenças" must not become "Lembrar" just because it contains
 * "reconhecer").
 */
export function parseObjetivos(raw: string | null | undefined): ObjectiveSentence[] {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return []

  return splitSentences(trimmed).map((sentence) => {
    if (isAttitudinal(sentence)) {
      return { text: sentence, kind: 'atitudinal', bloomLevel: null, estimated: false }
    }
    const bloomLevel = inferBloomFromVerb(sentence)
    return { text: sentence, kind: 'cognitiva', bloomLevel, estimated: false }
  })
}

/**
 * Fallback when the "Objetivos" column doesn't exist at all for a tab
 * (confirmed absent in Inglês and in Geografia 8º/9º) — build a single
 * estimated cognitive entry from chapter title + content, defaulting to
 * Lembrar/Compreender since there's no verb to infer from.
 */
export function estimateObjectiveFromContent(tituloCapitulo: string, conteudo: string | null): ObjectiveSentence {
  const text = [tituloCapitulo, conteudo].filter(Boolean).join(' — ')
  return { text, kind: 'cognitiva', bloomLevel: 'compreender', estimated: true }
}
