import type { CurriculumPlanItem, CurriculumSelection, Segment } from '@/types/exam'
import { shouldRequireVisualAid } from '@/lib/exams/contentPlan'
import { getSaebApplicability } from '@/config/saebApplicability'
import { getSaebDescriptorsForSubject } from '@/lib/sheets/bnccSaebMap'
import { ANOS_INICIAIS_BLOOM_DISTRIBUTION } from '@/config/bloomDistribution'
import { isImageEligibleSubject } from '@/config/imageEligibleSubjects'
import { isInterpretiveSubject } from '@/config/interpretiveSubjects'
import { getEnemStyleExemplars } from './enemExemplars'
import { replacementStrategyInstruction, type ReplacementRequest } from './replacementPolicy'

export type ExamGenerationParams = {
  questionCount: number
  mode?: 'prova' | 'atividade'
  selectedBnccCodes?: string[]
  contentPlan?: CurriculumPlanItem[]
}

export type QuestionSplit = { objectiveCount: number; discursiveCount: number }

/**
 * 60% objetiva / 40% descritiva, min 40% descritiva, rounding down on the
 * objective side — per the root CLAUDE.md's own worked examples (15 → 9+6,
 * 12 → 7+5). floor(0.6N) always leaves the remainder >= 40% of N, so this
 * single rule satisfies both the ratio and the "never go under 40%
 * descritiva" constraint without a separate branch.
 */
export function computeQuestionSplit(questionCount: number): QuestionSplit {
  const objectiveCount = Math.floor(questionCount * 0.6)
  return { objectiveCount, discursiveCount: questionCount - objectiveCount }
}

export function alternativesCountForSegment(segment: Segment): number {
  return segment === 'anos-iniciais' ? 4 : 5
}

export function bloomGuidance(segment: Segment, gradeYear: number): string {
  if (segment === 'anos-iniciais') {
    const dist = ANOS_INICIAIS_BLOOM_DISTRIBUTION[gradeYear]
    if (dist) {
      return `Distribuição-alvo de Bloom para o ${gradeYear}º ano (aproximada, em % das questões): ` +
        Object.entries(dist).map(([level, pct]) => `${level} ${pct}%`).join(', ') + '.'
    }
  }
  if (segment === 'anos-finais') {
    return gradeYear >= 9
      ? 'Distribua Bloom com mais peso em Aplicar/Analisar; o 9º ano deve ter pelo menos 2-3 questões em nível Analisar/Avaliar.'
      : 'Distribua Bloom com mais peso em Aplicar/Analisar a partir do 7º ano; evite concentrar tudo em Lembrar/Compreender.'
  }
  if (segment === 'ensino-medio') {
    return 'Distribuição de Bloom deve pender para Aplicar/Analisar/Avaliar — nível Lembrar deve ser minoria, coerente com o desenho do ENEM.'
  }
  return 'Evite concentrar tudo em Lembrar/Compreender; inclua ao menos 1 questão em nível mais alto quando a habilidade permitir.'
}

function unitToPromptBlock(unit: CurriculumSelection['units'][number]): string {
  const skillsText =
    unit.habilidades.status === 'mapeado'
      ? unit.habilidades.skills.map((s) => (s.description ? `${s.code}: ${s.description}` : s.code)).join('; ')
      : `NENHUMA (bnccStatus deve ser "nao_mapeado", bnccCodes deve ficar vazio — não invente um código)`

  const objetivosText = unit.objetivos.length
    ? unit.objetivos
        .filter((o) => o.kind === 'cognitiva')
        .map((o) => `${o.text} [Bloom sugerido: ${o.bloomLevel ?? 'não identificado'}${o.estimated ? ', estimado' : ''}]`)
        .join(' | ')
    : '(sem objetivos cognitivos explícitos)'

  const enrichmentBlock = unit.enrichedContent
    ? `  CONTEÚDO DETALHADO (do planejamento pedagógico): ${unit.enrichedContent}`
    : null

  return [
    `- Capítulo: ${unit.tituloCapitulo || '(sem título)'}`,
    unit.conteudo ? `  Conteúdo: ${unit.conteudo}` : null,
    enrichmentBlock,
    `  Habilidades BNCC: ${skillsText}`,
    `  Objetivos: ${objetivosText}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSaebInstruction(curriculum: CurriculumSelection): string {
  const { segment, gradeYear, subject } = curriculum
  const saeb = getSaebApplicability(segment, gradeYear, subject)
  const saebDescriptors = saeb.applicable && saeb.matrixType === 'saeb' ? getSaebDescriptorsForSubject(subject, gradeYear) : null

  if (!saeb.applicable) {
    return `Esta disciplina (${subject}) NÃO possui matriz SAEB/ENEM oficial para o ${gradeYear}º ano do segmento ${segment}. Para TODA questão, retorne saeb.applicable:false, saeb.source:null, saeb.value:null — nunca preencha esses campos mesmo que pareça óbvio.`
  }
  if (saeb.matrixType === 'enem') {
    return `Esta disciplina usa a Matriz de Referência do ENEM. Preencha saeb.source:"enem" e saeb.value com "Competência + Habilidade ENEM" aproximada (ex: "C2-H7"), marcando saeb.approximate:true a menos que a correspondência seja claramente exata.`
  }
  return `Esta disciplina tem matriz SAEB oficial (transcrita direto do INEP)${saeb.adapted ? ` — ADAPTADA: o SAEB avalia formalmente só o ano de referência dessa matriz (2º/5º/9º, conforme a disciplina), então marque approximate:true pra esse ${gradeYear}º ano` : ''}. Descritores oficiais disponíveis — escolha o código mais específico que a questão testa de verdade, nunca um genérico: ${
    saebDescriptors ? saebDescriptors.map((d) => `${d.code} (${d.topicLabel}): ${d.text}`).join(' | ') : '(nenhum descritor específico disponível — use approximate:true e uma descrição textual)'
  }. Preencha saeb.source:"classica" e saeb.value com o CÓDIGO exato escolhido da lista acima (ex: "D7", "H10", "2N1.3", "B3"), nunca um tópico genérico nem um código inventado fora da lista.`
}

export function buildImageInstruction(subject: string): string {
  return isImageEligibleSubject(subject)
    ? `Para questões onde uma imagem de apoio (diagrama, mapa, ilustração, foto) tornaria a questão mais clara ou pedagogicamente melhor: needsImage:true e imageQuery com uma consulta de busca curta e específica em português (ex: "célula animal diagrama partes", "mapa político da Europa 1945", "ciclo da água ilustração"). Nem toda questão precisa de imagem — use com critério. Não descreva a imagem no statement, só no imageQuery.`
    : `Esta disciplina não está habilitada para imagens nesta versão — sempre retorne needsImage:false e imageQuery:null.`
}

export function buildUnitsBlock(curriculum: CurriculumSelection): string {
  return curriculum.units.map(unitToPromptBlock).join('\n\n')
}

/**
 * Reforço pedido diretamente (16/07/2026): questões de História, Geografia,
 * Filosofia, Sociologia e Língua Portuguesa/Literatura estavam saindo
 * diretas demais nos níveis altos de Bloom — "o que é X" em vez de exigir
 * interpretar um texto/situação de verdade. Contraste explícito (ruim vs
 * bom) rende mais que só pedir "seja mais interpretativo" — LLM segue
 * padrão concreto melhor que instrução abstrata.
 */
function buildInterpretationInstruction(subject: string, segment: Segment): string | null {
  if (!isInterpretiveSubject(subject)) return null
  return `Esta disciplina (${subject}) exige leitura e interpretação, não só recordação de fato isolado. Para toda questão em nível Analisar, Avaliar ou Criar: o supportText é OBRIGATÓRIO e precisa ser substancial (um trecho de texto/trecho literário, um estudo de caso, uma situação-problema, a descrição de um mapa/gráfico/charge/tabela) — a alternativa correta NUNCA pode ser encontrada só relendo uma definição do capítulo, precisa exigir relacionar/comparar/inferir a partir do texto de apoio. Ruim (evite): "O que foi a Revolução Industrial?" — Bom: um trecho descrevendo consequências sociais de uma mudança tecnológica específica, seguido de "Com base no texto, a transformação social descrita decorre principalmente de...". Nos níveis Lembrar/Compreender pode ser mais direto, mas contextualize quando fizer sentido (${segment === 'ensino-medio' ? 'nível esperado no Ensino Médio' : 'adequado ao vocabulário e extensão de texto da série'}).`
}

/**
 * Reforço universal (16/07/2026, pedido direto com exemplos reais de
 * Matemática) — diferente de buildInterpretationInstruction (só
 * disciplinas interpretativas, só níveis altos), esta regra vale pra
 * QUALQUER disciplina e vale até em nível Lembrar/Domínio de Linguagem:
 * mesmo recordar uma classificação/definição/regra técnica deve vir
 * embutido numa situação real aplicada, nunca como pergunta de definição
 * nua ("o que é X"). Ver CLAUDE.md (seção "Estrutura da prova") pros
 * mesmos exemplos documentados.
 */
function buildContextualizationInstruction(): string {
  return `NUNCA gere uma questão de definição nua ("o que é X", "qual a definição de Y", "cite as características de Z"), nem em nível Lembrar (Bloom) ou testando o eixo "Dominar Linguagens"/vocabulário técnico. Toda questão — mesmo as que só exigem recordar uma classificação, fórmula ou regra — precisa embutir isso numa situação real e específica que o aluno aplica o conceito pra resolver. Exemplos de referência (mesmo padrão, adapte pra outras disciplinas):

Ruim: "O que é um triângulo obtusângulo?"
Bom: "Um estudante de arquitetura está analisando a estrutura metálica de um telhado. Ao observar um dos triângulos que compõem a sustentação, ele nota que a medida de um de seus ângulos internos é igual a 110°. Com base estritamente na classificação dos triângulos quanto às medidas de seus ângulos internos, esse triângulo é classificado como: [alternativas]"

Ruim: "Qual é a condição de existência de um triângulo?"
Bom: "Um artesão de joias recebeu uma encomenda para criar um pingente de ouro no formato triangular. Para confeccionar a peça, ele dispõe de três filetes rígidos de metal com os seguintes comprimentos: 5 cm, 8 cm e 15 cm. a) Explique se o artesão conseguirá ou não construir o pingente triangular utilizando exatamente esses três filetes. b) Descreva qual é a propriedade geométrica (regra) que determina se três segmentos de reta podem ou não formar um triângulo."`
}

/**
 * Pedido direto (16/07/2026): fórmula em ASCII solto ("2^(n-1)", "3*2^(n-1)")
 * é difícil de ler pro aluno, muito diferente de livro impresso. A notação
 * LaTeX delimitada por $...$ é convertida em imagem tipografada de verdade
 * (ver src/lib/math/latexRender.ts — tela de revisão e documento final),
 * então a IA precisa marcar a fórmula nesse formato pra virar imagem.
 */
function buildMathNotationInstruction(): string {
  return `Toda expressão matemática com expoente, fração, raiz, subscrito, somatório, ou qualquer notação que não seja texto corrido simples DEVE vir em LaTeX delimitado por $...$ — nunca em ASCII solto. Exemplos: "$3 \\cdot 2^{n-1}$" (não "3*2^(n-1)" nem "3 * 2^(n-1)"), "$\\frac{a+b}{2}$" (não "(a+b)/2"), "$\\sqrt{x^2+1}$" (não "raiz(x^2+1)"). Operações simples sem elevado/fração/raiz (ex: "x + 5 = 12") podem ficar em texto normal, sem $...$. Use em statement, supportText e em cada alternativa que precisar.`
}

function buildPedagogicalClassificationInstruction(): string {
  return `Para TODA questão gerada por IA, preencha pedagogicalClassification com metadados pedagógicos estruturados. Não use uma confiança única para tudo: DOK e SOLO_EXPECTED precisam ter confidence, justification e evidence próprios.
- pedagogicalClassification.dok.categoryCode deve ser exatamente um destes: DOK_1, DOK_2, DOK_3, DOK_4. DOK mede profundidade de raciocínio, não dificuldade nem tamanho do texto.
- pedagogicalClassification.soloExpected.categoryCode deve ser exatamente um destes: UNIESTRUTURAL, MULTIESTRUTURAL, RELACIONAL, ABSTRATO_AMPLIADO. SOLO_EXPECTED mede a estrutura de compreensão esperada da questão, nunca o desempenho observado do aluno.
- evidence deve ser uma citação LITERAL curta da própria questão (statement, supportText, alternativas, expectedAnswer ou gradingCriteria), nunca uma paráfrase solta.
- confidence deve ficar entre 0 e 1 e refletir ambiguidade real da classificação.
- DOK_3 só é válido se o aluno precisar escolher/justificar uma estratégia ou integrar evidências reais; texto comprido, cálculo comprido e o verbo "explique" não bastam. DOK_4 exige investigação prolongada e normalmente não cabe em questão isolada de prova.
- SOLO_EXPECTED não pode ser deduzido de DOK: classifique a estrutura que a RESPOSTA esperada precisa demonstrar.
- estimatedTimeMinutes é estimativa operacional de tempo da questão; difficulty deve ser sempre uma de facil, media ou dificil.`
}

async function buildStyleExemplarsBlock(subject: string, segment: Segment): Promise<string | null> {
  if (segment !== 'ensino-medio' || !isInterpretiveSubject(subject)) return null
  try {
    const exemplars = await getEnemStyleExemplars(subject)
    if (!exemplars) return null
    return `EXEMPLOS DE ESTILO (questões reais do ENEM, mesma área — use só como referência de NÍVEL DE EXIGÊNCIA e formato, nunca copie o conteúdo/tema):\n${exemplars}`
  } catch (err) {
    console.warn('[promptBuilder] falha ao buscar exemplares de estilo do ENEM:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function buildExamPrompt(curriculum: CurriculumSelection, params: ExamGenerationParams): Promise<string> {
  const { segment, gradeYear, subject } = curriculum
  const split = computeQuestionSplit(params.questionCount)
  const alternativesCount = alternativesCountForSegment(segment)
  const saebInstruction = buildSaebInstruction(curriculum)
  const unitsBlock = buildUnitsBlock(curriculum)
  const imageInstruction = buildImageInstruction(subject)
  const interpretationInstruction = buildInterpretationInstruction(subject, segment)
  const styleExemplarsBlock = await buildStyleExemplarsBlock(subject, segment)

  const activity = params.mode === 'atividade'
  const artifactLabel = activity ? 'atividade formativa' : 'prova'
  const selectedBnccInstruction = activity && params.selectedBnccCodes?.length
    ? `Esta atividade foi planejada para as habilidades BNCC ${params.selectedBnccCodes.join(', ')}. Use somente essas habilidades nos campos bnccCodes; se uma unidade não trouxer uma delas, não invente código.`
    : null
  const contentPlanInstruction = params.contentPlan?.length
    ? `MATRIZ DA AVALIAÇÃO (definida pelo professor, obrigatória):\n${params.contentPlan
        .filter((item) => item.questionCount > 0)
        .map((item) => {
          const unit = curriculum.units.find((candidate) => candidate.rowIndex === item.unitRowIndex)
          if (!unit) return null
          const visual = item.visualAid === 'obrigatorio' || (item.visualAid === 'auto' && shouldRequireVisualAid(unit))
          return `- Capítulo [${unit.rowIndex}] ${unit.tituloCapitulo}: exatamente ${item.questionCount} questão(ões); prioridade ${item.priority}; recurso visual ${visual ? 'OBRIGATÓRIO (needsImage:true e imageQuery preenchido)' : item.visualAid === 'sem_imagem' ? 'NÃO usar (needsImage:false)' : 'avaliar necessidade'}.`
        })
        .filter(Boolean)
        .join('\n')}\nPara TODA questão, preencha curriculumUnitRowIndex com o número entre colchetes do capítulo usado. Respeite exatamente as quantidades por capítulo.`
    : null

  return `Você é um especialista em avaliação pedagógica do Colégio Harmonia, gerando uma ${artifactLabel} para o ${gradeYear}º ano (${segment}), disciplina ${subject}${curriculum.bimester ? `, ${curriculum.bimester}º bimestre` : ''}.

REGRAS FIXAS (não negociáveis):
- Gere exatamente ${params.questionCount} questões: ${split.objectiveCount} objetivas (múltipla escolha, ${alternativesCount} alternativas cada, letras A-${String.fromCharCode(64 + alternativesCount)}) e ${split.discursiveCount} descritivas (abertas).
- Questões descritivas NUNCA têm "alternatives" ou "correctLetter" preenchidos.
- Questões objetivas SEMPRE têm exatamente ${alternativesCount} alternativas e um "correctLetter" válido, com distratores plausíveis (não óbvios).
- ${bloomGuidance(segment, gradeYear)}
${selectedBnccInstruction ? `- ${selectedBnccInstruction}\n` : ''}${activity ? '- A atividade deve ser apropriada à faixa etária, contextualizada e pronta para revisão docente antes da publicação.\n' : ''}- Para capítulos marcados "NENHUMA" habilidade BNCC abaixo: gere a questão normalmente a partir do capítulo/conteúdo, mas retorne bnccCodes:[] e bnccStatus:"nao_mapeado" — NUNCA invente um código BNCC.
- Para capítulos marcados "NENHUMA" habilidade BNCC abaixo: gere a questão normalmente a partir do capítulo/conteúdo, mas retorne bnccCodes:[] e bnccStatus:"nao_mapeado" — NUNCA invente um código BNCC.
- bnccSummary: uma frase curta resumindo a habilidade testada pela questão (para a coluna "Habilidade" do Mapa da prova) — mesmo quando bnccStatus for "nao_mapeado", descreva a habilidade testada com base no conteúdo, sem inventar um código.
- ${saebInstruction}
- Não inclua gabarito nem indicação de BNCC no texto do enunciado (statement) — esses campos vão em campos estruturados separados.
- ${buildPedagogicalClassificationInstruction()}
- supportText é OPCIONAL e só pode trazer situação-problema, dados ou evidência indispensável para raciocinar. NUNCA use supportText para definir, parafrasear ou explicar o conceito que a questão avalia; o aluno não pode descobrir a alternativa correta apenas relendo esse texto. Se a questão mede conhecimento de um conceito e não depende de dados externos, retorne supportText:null. Nunca descreva uma imagem dentro de supportText, use o campo needsImage/imageQuery para isso. Quando houver tabela, use Markdown completo e válido: uma linha de cabeçalho com pipes, uma linha separadora com ao menos três hifens por coluna e uma ou mais linhas de dados. Não use tabela para organizar alternativas.
- IMPORTANTE sobre a ordem de exibição: supportText SEMPRE aparece ANTES do statement na tela/documento final (texto de apoio primeiro, pergunta depois). Se o statement referenciar o supportText, use "acima"/"no texto" — NUNCA "abaixo" (o texto nunca vem depois da pergunta). Prefira formas sem direção ("leia o texto e responda", "com base no texto") pra não depender de posição nenhuma.
- ${buildContextualizationInstruction()}
- ${buildMathNotationInstruction()}
- ${imageInstruction}${interpretationInstruction ? `\n- ${interpretationInstruction}` : ''}
${contentPlanInstruction ? `- ${contentPlanInstruction}\n` : ''}

CONTEÚDO CURRICULAR DISPONÍVEL PARA ESTA PROVA:
${unitsBlock}${styleExemplarsBlock ? `\n\n${styleExemplarsBlock}` : ''}

Gere a prova completa respeitando o schema JSON fornecido.`
}

export type SingleQuestionOpts = {
  type: 'objetiva' | 'descritiva'
  /** Número que será preservado na avaliação ao substituir o item. */
  questionNumber: number
  /** Enunciado da questão sendo substituída — pra IA não repetir a mesma ideia. */
  avoidStatement: string
  /** Motivo dado pelo professor revisor (ex: "muito difícil", comentário livre) — orienta a troca. */
  reviewFeedback?: string | null
  /** Escolha explícita do revisor para a substituição da questão. */
  replacement?: ReplacementRequest
  visualAid?: 'auto' | 'obrigatorio' | 'sem_imagem'
}

/**
 * Gera o prompt pra UMA ÚNICA questão de substituição — usado por
 * /api/exams/[examId]/regenerate-question quando o revisor troca só uma
 * questão em vez de regenerar a prova inteira. Reaproveita as mesmas
 * instruções de SAEB/imagem/conteúdo curricular de buildExamPrompt, mas
 * força o tipo (objetiva/descritiva) pra manter a proporção 60/40 da prova
 * já aprovada, em vez de deixar a IA decidir de novo.
 */
export async function buildSingleQuestionPrompt(curriculum: CurriculumSelection, opts: SingleQuestionOpts): Promise<string> {
  const { segment, gradeYear, subject } = curriculum
  const alternativesCount = alternativesCountForSegment(segment)
  const saebInstruction = buildSaebInstruction(curriculum)
  const unitsBlock = buildUnitsBlock(curriculum)
  const imageInstruction = buildImageInstruction(subject)
  const interpretationInstruction = buildInterpretationInstruction(subject, segment)
  const styleExemplarsBlock = await buildStyleExemplarsBlock(subject, segment)

  const typeRule =
    opts.type === 'objetiva'
      ? `múltipla escolha, exatamente ${alternativesCount} alternativas, letras A-${String.fromCharCode(64 + alternativesCount)}, com "correctLetter" válido e distratores plausíveis (não óbvios)`
      : `aberta — NUNCA preencha "alternatives" ou "correctLetter"`

  const feedbackLine = opts.reviewFeedback
    ? `\n- MOTIVO DA TROCA (feedback do professor revisor): "${opts.reviewFeedback}" — a nova questão precisa resolver esse problema específico, não só ser diferente.`
    : ''
  const replacementLine = opts.replacement
    ? `\n- ${replacementStrategyInstruction(opts.replacement)}`
    : ''
  const visualAidLine = opts.visualAid === 'obrigatorio'
    ? '\n- RECURSO VISUAL OBRIGATÓRIO: retorne needsImage:true e imageQuery específica. A questão deve depender pedagogicamente de figura, gráfico, tabela, mapa ou diagrama.'
    : opts.visualAid === 'sem_imagem'
      ? '\n- RECURSO VISUAL NÃO PERMITIDO: retorne needsImage:false e imageQuery:null.'
      : ''

  return `Você é um especialista em avaliação pedagógica do Colégio Harmonia, gerando UMA ÚNICA questão de SUBSTITUIÇÃO pra uma prova já existente do ${gradeYear}º ano (${segment}), disciplina ${subject}${curriculum.bimester ? `, ${curriculum.bimester}º bimestre` : ''}.

REGRAS FIXAS (não negociáveis):
- Gere exatamente 1 questão, tipo "${opts.type}": ${typeRule}.
- ${bloomGuidance(segment, gradeYear)}
- Para capítulos marcados "NENHUMA" habilidade BNCC abaixo: gere a questão normalmente a partir do capítulo/conteúdo, mas retorne bnccCodes:[] e bnccStatus:"nao_mapeado" — NUNCA invente um código BNCC.
- bnccSummary: uma frase curta resumindo a habilidade testada pela questão.
- ${saebInstruction}
- QUESTÃO ORIGINAL A SUBSTITUIR: "${opts.avoidStatement}". Nunca a copie nem a reformule superficialmente.${replacementLine}${feedbackLine}
- Não inclua gabarito nem indicação de BNCC no texto do enunciado (statement).
- ${buildPedagogicalClassificationInstruction()}
- supportText é só texto — nunca descreva uma imagem dentro dele, use needsImage/imageQuery. Quando houver tabela, use Markdown completo e válido: cabeçalho com pipes, divisor com ao menos três hifens por coluna e uma ou mais linhas de dados.
- IMPORTANTE sobre a ordem de exibição: supportText SEMPRE aparece ANTES do statement na tela/documento final. Se o statement referenciar o supportText, use "acima"/"no texto" — NUNCA "abaixo". Prefira formas sem direção ("leia o texto e responda", "com base no texto").
- ${buildContextualizationInstruction()}
- ${buildMathNotationInstruction()}
- ${imageInstruction}${interpretationInstruction ? `\n- ${interpretationInstruction}` : ''}${visualAidLine}

CONTEÚDO CURRICULAR DISPONÍVEL:
${unitsBlock}${styleExemplarsBlock ? `\n\n${styleExemplarsBlock}` : ''}

Gere a questão respeitando o schema JSON fornecido, com "number" exatamente igual a ${opts.questionNumber}.`
}
