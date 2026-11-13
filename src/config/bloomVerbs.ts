export type BloomLevel = 'lembrar' | 'compreender' | 'aplicar' | 'analisar' | 'avaliar' | 'criar'

/** Ordem crescente de demanda cognitiva — usada pra escolher o nível principal entre verbos coordenados. */
export const BLOOM_LEVEL_ORDER: readonly BloomLevel[] = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']

// Tabela base vem da tabela de verbos do CLAUDE.md raiz; o restante foi
// ampliado em 05/10/2026 a partir dos verbos que de fato aparecem nas
// habilidades BNCC do planejamento (577 códigos). Entradas fora da tabela
// base são decisões pedagógicas revisáveis — não dogma. Cada verbo tem
// UM nível; aceita frases fixas ("discutir a importância de") e o sufixo
// reflexivo ("engajar-se").
export const BLOOM_VERB_TABLE: Record<BloomLevel, string[]> = {
  lembrar: [
    'identificar', 'listar', 'nomear', 'reconhecer', 'recordar', 'citar', 'localizar', 'enumerar', 'memorizar',
    'perceber', 'observar', 'reproduzir', 'repetir', 'recitar', 'apontar', 'definir', 'assinalar', 'rotular',
    'copiar', 'notar', 'destacar', 'recuperar',
  ],
  compreender: [
    'explicar', 'descrever', 'compreender', 'interpretar', 'entender', 'resumir', 'parafrasear', 'recontar',
    'relatar', 'exemplificar', 'classificar', 'associar', 'caracterizar', 'ler', 'explorar', 'inferir', 'ilustrar',
    'traduzir', 'contextualizar', 'acompanhar', 'mostrar', 'conhecer', 'reler', 'escutar', 'atribuir',
    'apropriar-se', 'tomar nota', 'retomar', 'narrar', 'comentar', 'expressar', 'reconstituir',
  ],
  aplicar: [
    'aplicar', 'utilizar', 'executar', 'vivenciar', 'praticar', 'usar', 'resolver', 'experimentar', 'realizar',
    'calcular', 'medir', 'efetuar', 'empregar', 'operar', 'demonstrar', 'fazer', 'participar', 'manipular',
    'representar', 'escrever', 'grafar', 'declamar', 'buscar', 'pesquisar', 'dramatizar', 'dançar', 'jogar',
    'conduzir', 'cantar', 'tocar', 'registrar', 'flexionar', 'quantificar', 'interagir', 'grifar', 'mobilizar',
    'exercitar', 'apresentar', 'determinar', 'expressar-se', 'dialogar', 'divulgar', 'coletar', 'expor', 'atuar',
    'contribuir', 'completar', 'formar', 'converter', 'decompor',
  ],
  analisar: [
    'comparar', 'diferenciar', 'analisar', 'planejar e utilizar estratégias', 'relacionar', 'investigar',
    'estabelecer', 'distinguir', 'categorizar', 'organizar', 'examinar', 'contrastar', 'selecionar', 'verificar',
    'discutir', 'debater', 'correlacionar', 'mapear', 'estimar', 'levantar', 'questionar', 'diagnosticar',
    'decodificar', 'segmentar', 'separar', 'deduzir', 'concluir', 'refletir', 'problematizar', 'conectar',
    'articular', 'descobrir', 'inventariar', 'antecipar', 'discriminar', 'compilar',
  ],
  avaliar: [
    'avaliar', 'justificar', 'discutir a importância de', 'argumentar', 'criticar', 'julgar', 'defender',
    'posicionar-se', 'validar', 'priorizar', 'recomendar', 'ponderar', 'refutar', 'apreciar criticamente',
    'confrontar', 'opinar', 'revisar', 'interpretar criticamente', 'analisar criticamente',
  ],
  criar: [
    'criar', 'elaborar', 'produzir', 'propor', 'planejar e produzir alternativas', 'construir', 'planejar',
    'compor', 'desenvolver', 'projetar', 'formular', 'idealizar', 'redigir', 'publicar', 'recriar', 'inventar',
    'montar', 'gerar', 'improvisar', 'coreografar', 'parodiar', 'tecer', 'adaptar', 'editar', 'reescrever',
    'roteirizar', 'conceber', 'sintetizar', 'esquematizar', 'programar', 'modelar', 'delinear', 'fabricar',
    'confeccionar',
  ],
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

/** Verbos que, quando ABREM a habilidade, indicam objetivo atitudinal (sem nível de Bloom). */
export const ATTITUDINAL_LEAD_VERBS = [
  ...ATTITUDINAL_MARKERS, 'engajar-se', 'fruir', 'interessar-se', 'demonstrar interesse', 'colaborar', 'cooperar',
  'compartilhar', 'zelar', 'preservar', 'mostrar-se',
]

export type BloomInference = {
  /** Nível principal: o mais alto entre os verbos coordenados do início da frase. */
  level: BloomLevel | null
  /** Nível de CADA verbo coordenado, do mais baixo ao mais alto, sem repetição ("resolver e elaborar" → aplicar, criar). */
  levels: BloomLevel[]
  /** Verbos reconhecidos, normalizados (sem acento), na ordem em que aparecem. */
  verbs: string[]
  /**
   * `lider`: verbo que abre a frase (alta confiança). `fallback`: verbo líder
   * desconhecido, usou o 1º verbo conhecido em qualquer posição (revisar).
   * `atitudinal`: sem nível cognitivo, de propósito. `nenhum`: nada reconhecido.
   */
  via: 'lider' | 'fallback' | 'atitudinal' | 'nenhum'
}

const COMBINING_MARKS = /[̀-ͯ]/g
function strip(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
}

const LEVEL_BY_VERB = new Map<string, BloomLevel>()
for (const level of BLOOM_LEVEL_ORDER) for (const verb of BLOOM_VERB_TABLE[level]) LEVEL_BY_VERB.set(strip(verb), level)
// Frases fixas primeiro, da mais longa pra mais curta ("planejar e utilizar estratégias" ganha de "planejar").
const PHRASES = [...LEVEL_BY_VERB.keys()].filter((verb) => verb.includes(' ')).sort((a, b) => b.length - a.length)
const SINGLE_VERBS = new Set([...LEVEL_BY_VERB.keys()].filter((verb) => !verb.includes(' ')))
const ATTITUDINAL_LEADS = new Set(ATTITUDINAL_LEAD_VERBS.map(strip))

function tokenize(text: string): string[] {
  return strip(text)
    .replace(/^\s*\([^)]*\)\s*/, '') // "(EF05MA07) Resolver…" → código BNCC na frente
    .replace(/["“”']/g, '')
    .split(/[^a-z-]+/)
    .filter(Boolean)
}

function ascending(levels: BloomLevel[]): BloomLevel[] {
  return [...new Set(levels)].sort((a, b) => BLOOM_LEVEL_ORDER.indexOf(a) - BLOOM_LEVEL_ORDER.indexOf(b))
}

/**
 * Infere o nível de Bloom pelo VERBO QUE ABRE a frase (como a BNCC escreve
 * habilidades). Verbos coordenados logo no início ("Resolver e elaborar",
 * "Ler e compreender") mantêm cada um o próprio nível em `levels`; o nível
 * principal é o mais alto. Casa por palavra inteira — "reproduzir" não vira
 * "produzir". Se o verbo líder não estiver na tabela, cai pro 1º verbo
 * conhecido em qualquer posição (`via: 'fallback'`).
 */
export function inferBloomLevels(sentence: string): BloomInference {
  const tokens = tokenize(sentence)
  if (!tokens.length) return { level: null, levels: [], verbs: [], via: 'nenhum' }
  const text = tokens.join(' ')

  for (const phrase of PHRASES) {
    if (text === phrase || text.startsWith(`${phrase} `)) {
      const level = LEVEL_BY_VERB.get(phrase) as BloomLevel
      return { level, levels: [level], verbs: [phrase], via: 'lider' }
    }
  }

  const first = tokens[0]
  if (ATTITUDINAL_LEADS.has(first)) return { level: null, levels: [], verbs: [first], via: 'atitudinal' }

  if (SINGLE_VERBS.has(first)) {
    const verbs = [first]
    let i = 1
    while (i + 1 < tokens.length && (tokens[i] === 'e' || tokens[i] === 'ou') && SINGLE_VERBS.has(tokens[i + 1])) {
      verbs.push(tokens[i + 1])
      i += 2
    }
    const levels = ascending(verbs.map((verb) => LEVEL_BY_VERB.get(verb) as BloomLevel))
    return { level: levels[levels.length - 1], levels, verbs, via: 'lider' }
  }

  for (const token of tokens) {
    if (SINGLE_VERBS.has(token) && !ATTITUDINAL_LEADS.has(token)) {
      const level = LEVEL_BY_VERB.get(token) as BloomLevel
      return { level, levels: [level], verbs: [token], via: 'fallback' }
    }
  }
  return { level: null, levels: [], verbs: [first], via: 'nenhum' }
}

/** Mantido por compatibilidade: só o nível principal. Preferir `inferBloomLevels` quando precisar dos níveis de cada verbo. */
export function inferBloomFromVerb(sentence: string): BloomLevel | null {
  return inferBloomLevels(sentence).level
}
