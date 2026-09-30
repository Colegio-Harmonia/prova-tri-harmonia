import { z } from 'zod'

/**
 * Motor de regras determinísticas (`truthStrategy = regra_deterministica`).
 *
 * A forma correta é decidida por CÓDIGO, nunca pelo modelo. O Estágio 1 só
 * produz o item-base estruturado (verbo/tempo/pessoa, adjetivo+gênero...), e o
 * Gate 1 consulta o motor registrado para o `ruleId`.
 */
export type RuleVerdict = {
  correctForm: string
  evidence: string
}

export type RuleEngine = {
  id: string
  title: string
  /** Campos esperados em `ruleInput`, usados no prompt do Estágio 1. */
  inputHint: string
  evaluate: (input: Record<string, unknown>) => RuleVerdict
}

const registry = new Map<string, RuleEngine>()

export function registerRuleEngine(engine: RuleEngine): void {
  registry.set(engine.id, engine)
}

export function getRuleEngine(id: string): RuleEngine | null {
  return registry.get(id) ?? null
}

export function hasRuleEngine(id: string): boolean {
  return registry.has(id)
}

export function registeredRuleEngineIds(): string[] {
  return [...registry.keys()]
}

// ---------------------------------------------------------------------------
// Conjugação verbal (regular + irregulares frequentes)
// ---------------------------------------------------------------------------

const PERSONS = ['eu', 'tu', 'ele', 'nos', 'vos', 'eles'] as const
type Person = (typeof PERSONS)[number]
type Tense = 'presente' | 'preterito_perfeito' | 'futuro_do_presente'
const PERSON_INDEX: Record<Person, number> = { eu: 0, tu: 1, ele: 2, nos: 3, vos: 4, eles: 5 }

const REGULAR_ENDINGS: Record<Tense, Record<string, string[]>> = {
  presente: {
    ar: ['o', 'as', 'a', 'amos', 'ais', 'am'],
    er: ['o', 'es', 'e', 'emos', 'eis', 'em'],
    ir: ['o', 'es', 'e', 'imos', 'is', 'em'],
  },
  preterito_perfeito: {
    ar: ['ei', 'aste', 'ou', 'amos', 'astes', 'aram'],
    er: ['i', 'este', 'eu', 'emos', 'estes', 'eram'],
    ir: ['i', 'iste', 'iu', 'imos', 'istes', 'iram'],
  },
  futuro_do_presente: {},
}
const FUTURE_ENDINGS = ['ei', 'ás', 'á', 'emos', 'eis', 'ão']

const IRREGULAR: Record<string, { presente: string[]; preterito_perfeito: string[] }> = {
  ser: { presente: ['sou', 'és', 'é', 'somos', 'sois', 'são'], preterito_perfeito: ['fui', 'foste', 'foi', 'fomos', 'fostes', 'foram'] },
  estar: { presente: ['estou', 'estás', 'está', 'estamos', 'estais', 'estão'], preterito_perfeito: ['estive', 'estiveste', 'esteve', 'estivemos', 'estivestes', 'estiveram'] },
  ter: { presente: ['tenho', 'tens', 'tem', 'temos', 'tendes', 'têm'], preterito_perfeito: ['tive', 'tiveste', 'teve', 'tivemos', 'tivestes', 'tiveram'] },
  ir: { presente: ['vou', 'vais', 'vai', 'vamos', 'ides', 'vão'], preterito_perfeito: ['fui', 'foste', 'foi', 'fomos', 'fostes', 'foram'] },
  haver: { presente: ['hei', 'hás', 'há', 'havemos', 'haveis', 'hão'], preterito_perfeito: ['houve', 'houveste', 'houve', 'houvemos', 'houvestes', 'houveram'] },
  fazer: { presente: ['faço', 'fazes', 'faz', 'fazemos', 'fazeis', 'fazem'], preterito_perfeito: ['fiz', 'fizeste', 'fez', 'fizemos', 'fizestes', 'fizeram'] },
  dizer: { presente: ['digo', 'dizes', 'diz', 'dizemos', 'dizeis', 'dizem'], preterito_perfeito: ['disse', 'disseste', 'disse', 'dissemos', 'dissestes', 'disseram'] },
  poder: { presente: ['posso', 'podes', 'pode', 'podemos', 'podeis', 'podem'], preterito_perfeito: ['pude', 'pudeste', 'pôde', 'pudemos', 'pudestes', 'puderam'] },
  vir: { presente: ['venho', 'vens', 'vem', 'vimos', 'vindes', 'vêm'], preterito_perfeito: ['vim', 'vieste', 'veio', 'viemos', 'viestes', 'vieram'] },
  dar: { presente: ['dou', 'dás', 'dá', 'damos', 'dais', 'dão'], preterito_perfeito: ['dei', 'deste', 'deu', 'demos', 'destes', 'deram'] },
  saber: { presente: ['sei', 'sabes', 'sabe', 'sabemos', 'sabeis', 'sabem'], preterito_perfeito: ['soube', 'soubeste', 'soube', 'soubemos', 'soubestes', 'souberam'] },
  querer: { presente: ['quero', 'queres', 'quer', 'queremos', 'quereis', 'querem'], preterito_perfeito: ['quis', 'quiseste', 'quis', 'quisemos', 'quisestes', 'quiseram'] },
  ver: { presente: ['vejo', 'vês', 'vê', 'vemos', 'vedes', 'veem'], preterito_perfeito: ['vi', 'viste', 'viu', 'vimos', 'vistes', 'viram'] },
  trazer: { presente: ['trago', 'trazes', 'traz', 'trazemos', 'trazeis', 'trazem'], preterito_perfeito: ['trouxe', 'trouxeste', 'trouxe', 'trouxemos', 'trouxestes', 'trouxeram'] },
}

function conjugate(infinitiveRaw: string, tense: Tense, person: Person): string {
  const infinitive = infinitiveRaw.trim().toLowerCase()
  const index = PERSON_INDEX[person]
  if (tense === 'futuro_do_presente') return `${infinitive}${FUTURE_ENDINGS[index]}`
  const irregular = IRREGULAR[infinitive]
  if (irregular) return irregular[tense][index]
  const ending = infinitive.slice(-2)
  if (!['ar', 'er', 'ir'].includes(ending)) throw new Error(`Verbo "${infinitiveRaw}" não é regular de 1ª/2ª/3ª conjugação.`)
  const stem = infinitive.slice(0, -2)
  return `${stem}${REGULAR_ENDINGS[tense][ending][index]}`
}

// ---------------------------------------------------------------------------
// Concordância nominal (adjetivo)
// ---------------------------------------------------------------------------

const ADJECTIVE_IRREGULAR: Record<string, { m_sg: string; f_sg: string; m_pl: string; f_pl: string }> = {
  bom: { m_sg: 'bom', f_sg: 'boa', m_pl: 'bons', f_pl: 'boas' },
  mau: { m_sg: 'mau', f_sg: 'má', m_pl: 'maus', f_pl: 'más' },
  ateu: { m_sg: 'ateu', f_sg: 'ateia', m_pl: 'ateus', f_pl: 'ateias' },
  europeu: { m_sg: 'europeu', f_sg: 'europeia', m_pl: 'europeus', f_pl: 'europeias' },
}

function inflectAdjective(adjectiveRaw: string, gender: 'm' | 'f', number: 'sg' | 'pl'): string {
  const adjective = adjectiveRaw.trim().toLowerCase()
  const irregular = ADJECTIVE_IRREGULAR[adjective]
  if (irregular) return irregular[`${gender}_${number}`]
  let base = adjective
  if (gender === 'f') {
    if (base.endsWith('o')) base = `${base.slice(0, -1)}a`
    else if (base.endsWith('ês') || base.endsWith('es')) base = `${base.slice(0, -2)}esa`
    else if (!base.endsWith('a')) base = `${base}a`
  }
  if (number === 'pl') {
    if (base.endsWith('s')) { /* já plural */ }
    else if (base.endsWith('r') || base.endsWith('z')) base = `${base}es`
    else if (base.endsWith('l')) base = `${base.slice(0, -1)}is`
    else if (base.endsWith('m')) base = `${base.slice(0, -1)}ns`
    else if (base.endsWith('n')) base = `${base}s`
    else base = `${base}s`
  }
  return base
}

// ---------------------------------------------------------------------------
// Ortografia (pares confusos, decisão pela intenção declarada)
// ---------------------------------------------------------------------------

const ORTOGRAFIA_RULES: Record<string, Record<string, string>> = {
  mas_mais: { adversativo: 'mas', intensidade: 'mais', quantidade: 'mais' },
  mau_mal: { adjetivo: 'mau', adverbio: 'mal' },
  ha_a: { tempo_passado: 'há', tempo_futuro: 'a', distancia: 'a' },
  porque: { causa: 'porque', pergunta: 'por que', finalidade: 'por que', substantivado: 'porquê' },
  senao_se_nao: { excecao: 'senão', condicao: 'se não' },
  onde_aonde: { lugar_estatico: 'onde', movimento: 'aonde' },
}

// O modelo costuma expressar a mesma função linguística com termos de sala
// de aula ("oposição", "explicação") em vez do identificador interno do
// motor ("adversativo", "causa"). Normalizamos somente sinônimos cujo
// resultado ortográfico é inequívoco; valores fora dessa lista continuam
// bloqueados pelo motor determinístico.
const ORTOGRAFIA_SENSE_ALIASES: Record<string, Record<string, string>> = {
  mas_mais: {
    adversidade: 'adversativo',
    oposicao: 'adversativo',
    contraste: 'adversativo',
    'oposicao de ideias': 'adversativo',
    'oposicao de sentidos': 'adversativo',
  },
  porque: {
    explicacao: 'causa',
    'causa explicacao': 'causa',
    'causa ou explicacao': 'causa',
    interrogacao: 'pergunta',
    interrogativa: 'pergunta',
  },
}

function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function canonicalOrthographySense(rule: string, sense: string): string {
  const normalizedSense = normalizeKey(sense)
  const exactAlias = ORTOGRAFIA_SENSE_ALIASES[rule]?.[normalizedSense]
  if (exactAlias) return exactAlias
  // Aceita formulações compostas geradas pelo modelo apenas quando elas
  // contêm o marcador semântico inequívoco da categoria canônica.
  if (rule === 'mas_mais' && /\b(advers|oposic|contrast)/.test(normalizedSense)) return 'adversativo'
  if (rule === 'porque' && /\b(causa|explicacao)/.test(normalizedSense)) return 'causa'
  if (rule === 'porque' && /\b(pergunta|interrog)/.test(normalizedSense)) return 'pergunta'
  return normalizedSense
}

function decideOrtografia(rule: string, sense: string): string {
  const normalizedRule = normalizeKey(rule)
  const table = ORTOGRAFIA_RULES[normalizedRule]
  if (!table) throw new Error(`Regra de ortografia "${rule}" não implementada.`)
  const canonicalSense = canonicalOrthographySense(normalizedRule, sense)
  const correct = table[canonicalSense]
  if (!correct) throw new Error(`Intenção "${sense}" não mapeada para a regra "${rule}".`)
  return correct
}

// ---------------------------------------------------------------------------
// Regência verbal (verbo → preposição exigida)
// ---------------------------------------------------------------------------

const REGENCIA: Record<string, string> = {
  assistir: 'assistir a (no sentido de ver/presenciar)',
  obedecer: 'obedecer a',
  desobedecer: 'desobedecer a',
  aspirar: 'aspirar a (no sentido de desejar)',
  visar: 'visar a (no sentido de almejar)',
  esquecer: 'esquecer-se de',
  lembrar: 'lembrar-se de',
  gostar: 'gostar de',
  precisar: 'precisar de',
  necessitar: 'necessitar de',
  referir: 'referir-se a',
  recorrer: 'recorrer a',
  aludir: 'aludir a',
  simpatizar: 'simpatizar com',
  implicar: 'implicar (sem preposição, sentido de acarretar)',
}

// ---------------------------------------------------------------------------
// Acentuação (lexicon de palavras frequentes)
// ---------------------------------------------------------------------------

const ACENTUACAO: Record<string, string> = {
  arvore: 'árvore', arvores: 'árvores', agua: 'água', aguas: 'águas', musica: 'música', historias: 'histórias',
  historia: 'história', matematica: 'matemática', fisica: 'física', quimica: 'química', portugues: 'português',
  ingles: 'inglês', frances: 'francês', cafe: 'café', pais: 'país', paises: 'países', voce: 'você', voces: 'vocês',
  tambem: 'também', alguem: 'alguém', ninguem: 'ninguém', ciencia: 'ciência', ciencias: 'ciências', familia: 'família',
  area: 'área', ideia: 'ideia', assembleia: 'assembleia', possivel: 'possível', impossivel: 'impossível',
  nivel: 'nível', facil: 'fácil', dificil: 'difícil', util: 'útil', saude: 'saúde', juiz: 'juiz', raizes: 'raízes',
}

// ---------------------------------------------------------------------------

const personSchema = z.enum(PERSONS)
const tenseSchema = z.enum(['presente', 'preterito_perfeito', 'futuro_do_presente'])

registerRuleEngine({
  id: 'conjugacao_verbal',
  title: 'Conjugação verbal',
  inputHint: '{ verb: infinitivo, tense: presente|preterito_perfeito|futuro_do_presente, person: eu|tu|ele|nos|vos|eles }',
  evaluate(input) {
    const parsed = z.object({ verb: z.string().min(2), tense: tenseSchema, person: personSchema }).parse(input)
    const form = conjugate(parsed.verb, parsed.tense, parsed.person)
    return { correctForm: form, evidence: `Conjugação determinística de "${parsed.verb}" em ${parsed.tense}, pessoa ${parsed.person}: ${form}.` }
  },
})

registerRuleEngine({
  id: 'concordancia_verbal',
  title: 'Concordância verbal',
  inputHint: '{ verb: infinitivo, tense: presente|preterito_perfeito|futuro_do_presente, subject: sujeito (ex.: "os alunos") }',
  evaluate(input) {
    const parsed = z.object({ verb: z.string().min(2), tense: tenseSchema, subject: z.string().min(1) }).parse(input)
    const normalized = normalizeKey(parsed.subject)
    const person: Person = /\b(eu)\b/.test(normalized) ? 'eu'
      : /\b(tu)\b/.test(normalized) ? 'tu'
      : /\b(nos|nós)\b/.test(normalized) ? 'nos'
      : /\b(vos|vós)\b/.test(normalized) ? 'vos'
      : /\b(eles|elas)\b/.test(normalized) || /s$/.test(normalized) && !/\b(voces|vocês)\b/.test(normalized) ? 'eles'
      : 'ele'
    const form = conjugate(parsed.verb, parsed.tense, person)
    return { correctForm: form, evidence: `Sujeito "${parsed.subject}" → pessoa ${person}; "${parsed.verb}" → ${form}.` }
  },
})

registerRuleEngine({
  id: 'concordancia_nominal',
  title: 'Concordância nominal',
  inputHint: '{ adjective: adjetivo, gender: m|f, number: sg|pl }',
  evaluate(input) {
    const parsed = z.object({ adjective: z.string().min(2), gender: z.enum(['m', 'f']), number: z.enum(['sg', 'pl']) }).parse(input)
    const form = inflectAdjective(parsed.adjective, parsed.gender, parsed.number)
    return { correctForm: form, evidence: `Adjetivo "${parsed.adjective}" flexionado em gênero ${parsed.gender} e número ${parsed.number}: ${form}.` }
  },
})

registerRuleEngine({
  id: 'ortografia',
  title: 'Ortografia (pares confusos)',
  inputHint: '{ rule: mas_mais|mau_mal|ha_a|porque|senao_se_nao|onde_aonde, sense: mas_mais=adversativo|intensidade|quantidade; mau_mal=adjetivo|adverbio; ha_a=tempo_passado|tempo_futuro|distancia; porque=causa|pergunta|finalidade|substantivado; senao_se_nao=excecao|condicao; onde_aonde=lugar_estatico|movimento }',
  evaluate(input) {
    const parsed = z.object({ rule: z.string().min(2), sense: z.string().min(2) }).parse(input)
    const form = decideOrtografia(parsed.rule, parsed.sense)
    return { correctForm: form, evidence: `Regra "${parsed.rule}" com intenção "${parsed.sense}" exige "${form}".` }
  },
})

registerRuleEngine({
  id: 'regencia_verbal',
  title: 'Regência verbal',
  inputHint: '{ verb: infinitivo }',
  evaluate(input) {
    const parsed = z.object({ verb: z.string().min(2) }).parse(input)
    const form = REGENCIA[normalizeKey(parsed.verb)]
    if (!form) throw new Error(`Regência do verbo "${parsed.verb}" não está no motor.`)
    return { correctForm: form, evidence: `Regência determinística: ${form}.` }
  },
})

registerRuleEngine({
  id: 'acentuacao',
  title: 'Acentuação',
  inputHint: '{ word: palavra (sem acento) }',
  evaluate(input) {
    const parsed = z.object({ word: z.string().min(2) }).parse(input)
    const form = ACENTUACAO[normalizeKey(parsed.word)]
    if (!form) throw new Error(`Acentuação de "${parsed.word}" não está no lexicon do motor.`)
    return { correctForm: form, evidence: `Forma acentuada determinística de "${parsed.word}": ${form}.` }
  },
})
