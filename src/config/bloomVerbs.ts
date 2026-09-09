export type BloomLevel = 'lembrar' | 'compreender' | 'aplicar' | 'analisar' | 'avaliar' | 'criar'

// From the root CLAUDE.md verb table.
export const BLOOM_VERB_TABLE: Record<BloomLevel, string[]> = {
  lembrar: ['identificar', 'listar', 'nomear', 'reconhecer'],
  compreender: ['explicar', 'descrever', 'compreender', 'interpretar'],
  aplicar: ['aplicar', 'utilizar', 'executar', 'vivenciar', 'praticar'],
  analisar: ['comparar', 'diferenciar', 'analisar', 'planejar e utilizar estratégias'],
  avaliar: ['avaliar', 'justificar', 'discutir a importância de'],
  criar: ['criar', 'elaborar', 'produzir', 'propor', 'planejar e produzir alternativas'],
}

// Sentences containing these are attitudinal/afetivo, not cognitive — per the
// root CLAUDE.md warning ("reconhecer e valorizar as diferenças individuais"
// must NOT become a Bloom "Lembrar" question just because it contains
// "reconhecer"). Checked BEFORE verb matching.
export const ATTITUDINAL_MARKERS = [
  'valorizar',
  'respeitar',
  'conviver',
  'apreciar',
  'cuidar',
  'sensibilizar',
  'acolher',
]

export function isAttitudinal(sentence: string): boolean {
  const normalized = sentence.toLowerCase()
  return ATTITUDINAL_MARKERS.some((marker) => normalized.includes(marker))
}

export function inferBloomFromVerb(sentence: string): BloomLevel | null {
  const normalized = sentence.toLowerCase()
  // Longest phrase first so "planejar e utilizar estratégias" wins over a
  // bare "planejar"/"utilizar" match from a different level.
  const candidates: { level: BloomLevel; verb: string }[] = []
  for (const [level, verbs] of Object.entries(BLOOM_VERB_TABLE) as [BloomLevel, string[]][]) {
    for (const verb of verbs) {
      if (normalized.includes(verb)) candidates.push({ level, verb })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.verb.length - a.verb.length)
  return candidates[0].level
}
