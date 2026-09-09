import type { AdaptationProfileId } from '@/db/schema'

// Bibliotecas de adaptação inclusiva (Módulo 4, spec seção 4.1) — mesmo
// padrão de config versionada em código de saebApplicability.ts /
// pedagogicalConfidence.ts. A `version` de cada biblioteca fica gravada em
// adapted_exams.library_versions: mudar uma diretriz aqui exige subir a
// versão, senão a auditoria de "qual regra gerou esta adaptação" mente.
//
// Separação deliberada (spec 4.1): `contentDirectives` guia a IA na
// reescrita de linguagem/estrutura; `layoutRules` é diagramação
// DETERMINÍSTICA aplicada pelo docBuilder — nunca pedir pra IA "aumentar
// a fonte", isso é regra de renderização.

export type AdaptationLayoutRules = {
  minFontPt?: number
  headingFontPt?: number
  fontFamily?: 'sans-serif'
  lineSpacing?: number // multiplicador (1.5 = 150%)
  boldCommandKeywords?: boolean
  extraAnswerSpace?: boolean
  highContrast?: boolean
  formulaSupportHeader?: boolean
  visualSupports?: 'add' | 'remove_nonessential' | 'keep'
}

export type AdaptationLibrary = {
  id: AdaptationProfileId
  label: string
  version: string
  // Desempate na harmonização de laudos múltiplos: menor vence quando duas
  // diretrizes de conteúdo conflitam (spec 6.3).
  conflictPriority: number
  contentDirectives: string[]
  layoutRules: AdaptationLayoutRules
}

export const ADAPTATION_LIBRARIES: Record<AdaptationProfileId, AdaptationLibrary> = {
  tea: {
    id: 'tea',
    label: 'TEA (Transtorno do Espectro Autista)',
    version: '1.0',
    conflictPriority: 1,
    contentDirectives: [
      'Reescreva enunciados em linguagem LITERAL e DIRETA.',
      'Elimine figuras de linguagem, ironia, metáfora, duplo sentido e ambiguidade. Se o texto de apoio original contiver linguagem figurada ESSENCIAL ao que é avaliado (ex: questão de interpretação de metáfora), mantenha a linguagem figurada no texto de apoio e torne apenas o COMANDO da questão explícito e literal.',
      'Estruture cada comando como instrução única e objetiva ("Leia o texto. Depois, marque a alternativa que..."), evitando orações encadeadas.',
      'Para cada questão, indique em "visualSupportSuggestion" um apoio visual/iconográfico explicativo quando ele ajudar a compreensão (ou null) — a inclusão final é decisão do revisor humano.',
    ],
    layoutRules: {
      lineSpacing: 1.5,
      visualSupports: 'add',
    },
  },
  tdah: {
    id: 'tdah',
    label: 'TDAH (Déficit de Atenção e Hiperatividade)',
    version: '1.0',
    conflictPriority: 2,
    contentDirectives: [
      'Marque com **negrito** (markdown) as palavras-chave de cada comando: NÃO, EXCETO, INCORRETA, CORRETA, APENAS, SOMENTE, MELHOR, MAIOR, MENOR e o verbo principal do comando.',
      'Fragmente todo enunciado com mais de 2 orações ou mais de ~40 palavras em etapas numeradas ou bullets curtos.',
      'Sinalize em "removedElements" os elementos visuais/textuais decorativos que devem ser removidos por serem distratores não essenciais (não remova nada que carregue informação necessária).',
    ],
    layoutRules: {
      boldCommandKeywords: true,
      lineSpacing: 1.5,
      visualSupports: 'remove_nonessential',
    },
  },
  discalculia: {
    id: 'discalculia',
    label: 'Discalculia',
    version: '1.0',
    conflictPriority: 3,
    contentDirectives: [
      'NÃO altere valores numéricos, operações nem o raciocínio matemático exigido.',
      'Para cada questão que envolva cálculo, preencha "formulaSupport": as fórmulas e operações básicas que o aluno tem direito de consultar (ex: "Área do retângulo: A = b × h"), que serão impressas junto à questão.',
      'Sugira em "visualSupportSuggestion" esquemas de apoio (reta numérica, tabela de organização de dados do problema) quando aplicável.',
      'Reescreva problemas com enunciado denso separando DADOS e PERGUNTA em blocos distintos.',
    ],
    layoutRules: {
      extraAnswerSpace: true,
      formulaSupportHeader: true,
      lineSpacing: 1.5,
    },
  },
  baixa_visao: {
    id: 'baixa_visao',
    label: 'Baixa Visão',
    version: '1.0',
    conflictPriority: 4,
    contentDirectives: [
      'A ampliação de fonte, contraste e espaçamento é feita pelo sistema na diagramação — NÃO trate disso no texto.',
      'Quando uma questão depender de figura/gráfico/mapa, preencha "imageDescription" com descrição textual completa e objetiva do elemento visual (todos os dados necessários para responder sem ver a imagem com nitidez).',
      'Evite referências puramente espaciais sem redundância textual ("como mostra a figura ao lado" → "como mostra o gráfico de barras abaixo, em que o valor de 2020 é 45").',
    ],
    layoutRules: {
      minFontPt: 18,
      headingFontPt: 20,
      fontFamily: 'sans-serif',
      lineSpacing: 1.5,
      highContrast: true,
    },
  },
}

// Palavras-chave de comando que recebem negrito determinístico na
// diagramação (TDAH) — lista fixa, aplicada pelo docBuilder por regex de
// palavra inteira, independente do que a IA marcou no texto.
export const COMMAND_KEYWORDS = ['NÃO', 'EXCETO', 'INCORRETA', 'INCORRETO', 'CORRETA', 'CORRETO', 'APENAS', 'SOMENTE'] as const
