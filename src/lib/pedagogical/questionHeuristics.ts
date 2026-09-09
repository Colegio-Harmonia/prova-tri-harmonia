import { getPedagogicalConfidenceBand } from '@/config/pedagogicalConfidence'

export type PedagogicalQuestionProposal = {
  taxonomyCode: 'DOK' | 'SOLO_EXPECTED'
  categoryCode: string
  confidence: number
  explanation: string
  evidence: string
}

export type PedagogicalQuestionHeuristicInput = {
  text: string
  bloomLevel?: string | null
  cognitiveAxisCode?: string | null
  questionType?: 'objetiva' | 'descritiva' | null
  expectedAnswer?: string | null
  gradingCriteria?: string | null
}

export type PedagogicalQuestionHeuristicResult = {
  dok: PedagogicalQuestionProposal
  soloExpected: PedagogicalQuestionProposal
  confidenceBands: {
    dok: ReturnType<typeof getPedagogicalConfidenceBand>
    soloExpected: ReturnType<typeof getPedagogicalConfidenceBand>
  }
}

export function normalizePedagogicalText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function compactPedagogicalEvidence(questionText: string) {
  return questionText.replace(/\s+/g, ' ').trim().slice(0, 360)
}

function includesAny(text: string, markers: string[]) {
  return markers.some((marker) => text.includes(marker))
}

export function inferDokProposal(input: PedagogicalQuestionHeuristicInput): PedagogicalQuestionProposal {
  const normalized = normalizePedagogicalText(input.text)
  const bloom = input.bloomLevel ?? ''
  const axis = input.cognitiveAxisCode ?? ''
  const evidence = compactPedagogicalEvidence(input.text)
  const hasDiscursiveReasoning = input.questionType === 'descritiva'
    && Boolean(input.expectedAnswer || input.gradingCriteria)

  if (
    bloom === 'avaliar'
    || bloom === 'criar'
    || axis === 'EP'
    || axis === 'CA'
    || hasDiscursiveReasoning
    || includesAny(normalized, ['justifique', 'explique', 'argumente', 'melhor explica', 'mais adequada', 'proposta', 'estrategia', 'intervencao'])
  ) {
    return {
      taxonomyCode: 'DOK',
      categoryCode: 'DOK_3',
      confidence: 0.72,
      explanation: 'Sugestao inicial: exige justificar, avaliar estrategia ou integrar contexto e criterio de decisao.',
      evidence,
    }
  }

  if (
    bloom === 'aplicar'
    || bloom === 'analisar'
    || includesAny(normalized, ['calcule', 'determine', 'grafico', 'tabela', 'relacao', 'variacao', 'comparacao', 'proporcao', 'resolva'])
  ) {
    return {
      taxonomyCode: 'DOK',
      categoryCode: 'DOK_2',
      confidence: 0.78,
      explanation: 'Sugestao inicial: mobiliza conceito/procedimento em contexto, sem evidenciar investigacao aberta.',
      evidence,
    }
  }

  return {
    taxonomyCode: 'DOK',
    categoryCode: 'DOK_1',
    confidence: 0.68,
    explanation: 'Sugestao inicial conservadora: evidencias disponiveis indicam reconhecimento ou recuperacao direta.',
    evidence,
  }
}

export function inferSoloExpectedProposal(
  dok: PedagogicalQuestionProposal,
  input: PedagogicalQuestionHeuristicInput,
): PedagogicalQuestionProposal {
  const evidence = compactPedagogicalEvidence(input.text)

  if (dok.categoryCode === 'DOK_3') {
    return {
      taxonomyCode: 'SOLO_EXPECTED',
      categoryCode: 'RELACIONAL',
      confidence: 0.72,
      explanation: 'Item tende a exigir integracao de contexto, criterio e resposta em uma estrutura coerente.',
      evidence,
    }
  }

  if (dok.categoryCode === 'DOK_2') {
    return {
      taxonomyCode: 'SOLO_EXPECTED',
      categoryCode: 'MULTIESTRUTURAL',
      confidence: 0.74,
      explanation: 'Item tende a exigir uso de mais de um dado/conceito, sem evidenciar generalizacao alem do caso.',
      evidence,
    }
  }

  return {
    taxonomyCode: 'SOLO_EXPECTED',
    categoryCode: 'UNIESTRUTURAL',
    confidence: 0.68,
    explanation: 'Item tende a exigir foco em um aspecto principal da situacao apresentada.',
    evidence,
  }
}

export function inferDokAndSoloExpected(
  input: PedagogicalQuestionHeuristicInput,
): PedagogicalQuestionHeuristicResult {
  const dok = inferDokProposal(input)
  const soloExpected = inferSoloExpectedProposal(dok, input)

  return {
    dok,
    soloExpected,
    confidenceBands: {
      dok: getPedagogicalConfidenceBand(dok.confidence),
      soloExpected: getPedagogicalConfidenceBand(soloExpected.confidence),
    },
  }
}
