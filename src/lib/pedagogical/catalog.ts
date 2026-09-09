export const PEDAGOGICAL_MANUAL_VERSION = '1.0'

export type PedagogicalTaxonomySeed = {
  code: string
  name: string
  description: string
  manualVersion: string
  categories: PedagogicalCategorySeed[]
}

export type PedagogicalCategorySeed = {
  code: string
  name: string
  description: string
  order: number
  metadata: Record<string, unknown>
}

export const PEDAGOGICAL_TAXONOMY_CATALOG: PedagogicalTaxonomySeed[] = [
  {
    code: 'DOK',
    name: 'Depth of Knowledge',
    description: 'Profundidade de raciocinio exigida para resolver a tarefa, independente da dificuldade percebida.',
    manualVersion: PEDAGOGICAL_MANUAL_VERSION,
    categories: [
      {
        code: 'DOK_1',
        name: 'Recordacao e reproducao',
        description: 'Reproduzir fato ou executar procedimento rotineiro de uma etapa.',
        order: 1,
        metadata: {
          cognitiveSteps: '1 etapa',
          requiresJustification: false,
          requiresEvidenceIntegration: false,
          caution: 'Dificuldade, extensao do texto e quantidade de calculos nao elevam DOK por si so.',
        },
      },
      {
        code: 'DOK_2',
        name: 'Habilidades e conceitos',
        description: 'Aplicar procedimento de multiplos passos ou relacionar dois conceitos, sem decisao estrategica.',
        order: 2,
        metadata: {
          cognitiveSteps: '2+ etapas sequenciais',
          requiresJustification: 'as vezes',
          requiresEvidenceIntegration: 'parcial',
          caution: 'Se o caminho e unico e conhecido, mesmo com varias etapas, permanece DOK 2.',
        },
      },
      {
        code: 'DOK_3',
        name: 'Pensamento estrategico',
        description: 'Planejar e executar uma estrategia entre varias possiveis, justificando escolhas e integrando informacoes.',
        order: 3,
        metadata: {
          cognitiveSteps: 'multiplas etapas com decisao sobre o caminho',
          requiresJustification: true,
          requiresEvidenceIntegration: true,
          tieBreaker: 'Ha mais de um caminho valido e o aluno precisa escolher e justificar qual usar.',
        },
      },
      {
        code: 'DOK_4',
        name: 'Pensamento ampliado ou investigacao prolongada',
        description: 'Investigacao extensa, aberta e iterativa, conectando multiplas fontes ou disciplinas ao longo do tempo.',
        order: 4,
        metadata: {
          cognitiveSteps: 'processo aberto e iterativo',
          requiresJustification: 'extensa',
          requiresEvidenceIntegration: 'extensa e diversificada',
          caution: 'Usar com extrema cautela em provas de item isolado; na duvida, classificar como DOK 3.',
        },
      },
    ],
  },
  {
    code: 'SOLO_EXPECTED',
    name: 'SOLO Expected',
    description: 'Nivel estrutural de compreensao que o item foi desenhado para mobilizar.',
    manualVersion: PEDAGOGICAL_MANUAL_VERSION,
    categories: [
      {
        code: 'UNIESTRUTURAL',
        name: 'Uniestrutural',
        description: 'Usa um dado ou aspecto relevante isoladamente.',
        order: 1,
        metadata: {
          expectedStructure: 'aluno identifica um elemento correto',
          appliesTo: ['questao objetiva', 'questao discursiva', 'atividade pratica'],
          limitation: 'Nao demonstra o nivel efetivamente alcancado pelo aluno.',
        },
      },
      {
        code: 'MULTIESTRUTURAL',
        name: 'Multiestrutural',
        description: 'Usa varios dados ou aspectos, mas sem integra-los.',
        order: 2,
        metadata: {
          expectedStructure: 'aluno aborda varios elementos separadamente',
          appliesTo: ['questao objetiva', 'questao discursiva', 'atividade pratica'],
          limitation: 'Nao demonstra o nivel efetivamente alcancado pelo aluno.',
        },
      },
      {
        code: 'RELACIONAL',
        name: 'Relacional',
        description: 'Integra multiplos aspectos numa estrutura coerente.',
        order: 3,
        metadata: {
          expectedStructure: 'aluno relaciona elementos entre si e com o todo',
          appliesTo: ['questao objetiva', 'questao discursiva', 'atividade pratica'],
          limitation: 'Em questoes objetivas, pode ser acertada por adivinhacao ou eliminacao.',
        },
      },
      {
        code: 'ABSTRATO_AMPLIADO',
        name: 'Abstrato ampliado',
        description: 'Generaliza para alem do caso dado, transfere para novo dominio ou teoriza.',
        order: 4,
        metadata: {
          expectedStructure: 'aluno abstrai principio geral aplicavel a outros contextos',
          appliesTo: ['questao discursiva', 'projeto', 'producao extensa'],
          limitation: 'Raro em questao objetiva.',
        },
      },
    ],
  },
  {
    code: 'SOLO_OBSERVED',
    name: 'SOLO Observed',
    description: 'Nivel estrutural de compreensao demonstrado na resposta produzida pelo aluno.',
    manualVersion: PEDAGOGICAL_MANUAL_VERSION,
    categories: [
      {
        code: 'PRE_ESTRUTURAL',
        name: 'Pre-estrutural',
        description: 'Resposta nao relacionada a pergunta, copia do enunciado ou vazia.',
        order: 0,
        metadata: {
          evidence: 'resposta sem relacao logica com a pergunta',
          appliesTo: ['resposta discursiva', 'redacao', 'justificativa', 'projeto', 'portfolio'],
          limitation: 'Nunca atribuir a questao objetiva apenas pela alternativa marcada.',
        },
      },
      {
        code: 'UNIESTRUTURAL',
        name: 'Uniestrutural',
        description: 'Usa uma informacao correta e ignora o restante do que foi pedido.',
        order: 1,
        metadata: {
          evidence: 'um elemento correto sem conclusao completa',
          appliesTo: ['resposta discursiva', 'redacao', 'justificativa', 'projeto', 'portfolio'],
          limitation: 'Sem justificativa visivel, nao classificar como Relacional ou Abstrato ampliado.',
        },
      },
      {
        code: 'MULTIESTRUTURAL',
        name: 'Multiestrutural',
        description: 'Usa varias informacoes corretas, mas isoladas e sem conexao explicita.',
        order: 2,
        metadata: {
          evidence: 'varios passos ou informacoes sem explicar por que se conectam',
          appliesTo: ['resposta discursiva', 'redacao', 'justificativa', 'projeto', 'portfolio'],
          limitation: 'A classificacao acompanha a estrutura demonstrada, nao a nota.',
        },
      },
      {
        code: 'RELACIONAL',
        name: 'Relacional',
        description: 'Conecta informacoes numa explicacao coerente e completa.',
        order: 3,
        metadata: {
          evidence: 'explicacao com etapas conectadas em sequencia logica',
          appliesTo: ['resposta discursiva', 'redacao', 'justificativa', 'projeto', 'portfolio'],
          limitation: 'Exige material textual suficiente para analisar o raciocinio.',
        },
      },
      {
        code: 'ABSTRATO_AMPLIADO',
        name: 'Abstrato ampliado',
        description: 'Generaliza o raciocinio para um principio aplicavel alem do caso especifico.',
        order: 4,
        metadata: {
          evidence: 'resposta resolve o caso e discute transferencia ou limite do principio usado',
          appliesTo: ['resposta discursiva', 'redacao', 'justificativa', 'projeto', 'portfolio'],
          limitation: 'Nunca substitui nota, rubrica, correcao do professor ou SOLO_EXPECTED.',
        },
      },
    ],
  },
]
