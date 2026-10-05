/**
 * Verbos de comando do enunciado ("explique", "analise", "cite"...) — no
 * documento final da Prova (Fundamental 1 e 2) só eles ficam em negrito,
 * pra orientar o aluno sobre o que está sendo pedido. O resto do texto não
 * muda. Detecção determinística (lista fechada), não pedida à IA: funciona
 * também em provas já geradas e não depende de a IA marcar nada.
 *
 * As formas ficam COM acento de propósito e o match não normaliza
 * diacríticos: "analise" (verbo) não pode casar com "análise" (substantivo).
 */

// Imperativo singular (o aluno é tratado por "você" nas provas).
const COMMAND_VERBS_PT = [
  // Registrar / responder
  'responda', 'escreva', 'reescreva', 'complete', 'preencha', 'registre', 'anote', 'copie', 'diga', 'dê', 'apresente', 'relate', 'narre', 'comente', 'resuma',
  // Selecionar / marcar
  'assinale', 'marque', 'circule', 'sublinhe', 'pinte', 'ligue', 'relacione', 'associe', 'selecione', 'ordene', 'organize', 'agrupe', 'separe',
  // Recordar / identificar
  'cite', 'liste', 'nomeie', 'identifique', 'indique', 'aponte', 'localize', 'reconheça', 'encontre', 'enumere',
  // Compreender / explicar
  'explique', 'descreva', 'defina', 'conceitue', 'interprete', 'exemplifique', 'caracterize', 'esclareça', 'diferencie', 'classifique', 'compare', 'distinga',
  // Aplicar / calcular
  'calcule', 'resolva', 'determine', 'efetue', 'simplifique', 'converta', 'estime', 'aplique', 'utilize', 'use', 'substitua', 'transforme', 'corrija', 'verifique', 'mostre', 'demonstre', 'represente', 'construa', 'desenhe', 'trace', 'meça',
  // Analisar / avaliar / criar
  'analise', 'avalie', 'justifique', 'argumente', 'discuta', 'reflita', 'conclua', 'deduza', 'infira', 'estabeleça', 'proponha', 'elabore', 'crie', 'produza', 'invente', 'planeje', 'formule', 'pesquise',
  // Leitura / observação (instrução de tarefa)
  'leia', 'observe',
]

// Verbos de comando que também são substantivo/outra classe na mesma grafia
// ("a escolha", "o informe") — só viram negrito quando abrem a frase.
const AMBIGUOUS_COMMAND_VERBS_PT = ['escolha', 'informe', 'destaque']

// Provas de Inglês trazem o comando em inglês. Imperativo inglês quase sempre
// abre a frase, e várias formas colidem com substantivo ("name", "order",
// "match"), então só abrem negrito em início de frase.
const COMMAND_VERBS_EN = [
  'read', 'write', 'rewrite', 'complete', 'choose', 'match', 'circle', 'underline', 'fill', 'answer', 'name', 'describe', 'explain', 'compare', 'identify',
  'list', 'mark', 'tick', 'find', 'translate', 'order', 'put', 'say', 'look', 'listen', 'tell', 'ask', 'give', 'use', 'analyse', 'analyze', 'discuss',
  'justify', 'cite', 'define', 'underline', 'correct', 'decide', 'choose',
]

const LETTER = '\\p{L}'

function alternation(words: string[]): string {
  return [...new Set(words)].sort((a, b) => b.length - a.length).join('|')
}

// Fim de frase / item de lista: início do texto, ".?!:;", quebra de linha ou
// marcador "a)" / "1." — seguido de espaços/aspas/parênteses opcionais.
const SENTENCE_START = '(?:^|[.?!:;\\n]|\\b[a-z0-9]\\))[\\s"\'“‘(]*'

const FREE_PT = new RegExp(`(?<!${LETTER})(${alternation(COMMAND_VERBS_PT)})(?!${LETTER})`, 'giu')
const AMBIGUOUS_PT = new RegExp(`(${SENTENCE_START})(${alternation(AMBIGUOUS_COMMAND_VERBS_PT)})(?!${LETTER})`, 'giu')
const SENTENCE_START_EN = new RegExp(`(${SENTENCE_START})(${alternation(COMMAND_VERBS_EN)})(?!${LETTER})`, 'giu')

export type CommandVerbSegment = { text: string; bold: boolean }

export type CommandVerbOptions = {
  /** Provas de Inglês também reconhecem comandos em inglês. */
  includeEnglish?: boolean
}

/** Só Fundamental 1 e 2 recebem o negrito; Ensino Médio segue o formato ENEM, sem destaque. */
export function shouldBoldCommandVerbs(segment: string): boolean {
  return segment === 'anos-iniciais' || segment === 'anos-finais'
}

export function isEnglishSubject(subject: string): boolean {
  return /ingl[eê]s|english/i.test(subject)
}

/**
 * Divide `text` em trechos preservando a ordem e o conteúdo EXATOS (a
 * concatenação dos trechos é sempre igual ao texto original) — só muda o
 * flag `bold` dos verbos de comando.
 */
export function splitCommandVerbs(text: string, options: CommandVerbOptions = {}): CommandVerbSegment[] {
  if (!text) return []

  const ranges: Array<{ start: number; end: number }> = []

  for (const match of text.matchAll(FREE_PT)) {
    ranges.push({ start: match.index!, end: match.index! + match[0].length })
  }

  const prefixed = options.includeEnglish ? [AMBIGUOUS_PT, SENTENCE_START_EN] : [AMBIGUOUS_PT]
  for (const regex of prefixed) {
    for (const match of text.matchAll(regex)) {
      const verb = match[2]
      const end = match.index! + match[0].length
      ranges.push({ start: end - verb.length, end })
    }
  }

  if (!ranges.length) return [{ text, bold: false }]

  ranges.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }

  const segments: CommandVerbSegment[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), bold: false })
    segments.push({ text: text.slice(range.start, range.end), bold: true })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), bold: false })
  return segments
}
