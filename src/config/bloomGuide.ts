import type { BloomLevel } from './bloomVerbs'

/**
 * Texto do guia "Bloom e verbos" para a equipe pedagógica. Descrições na
 * linha da Taxonomia de Bloom revisada (Anderson e Krathwohl, 2001); os
 * exemplos são ilustrativos, escritos para este guia.
 */
export const BLOOM_GUIDE: Record<BloomLevel, { label: string; summary: string; studentDoes: string; objectiveExample: string; questionExample: string }> = {
  lembrar: {
    label: 'Lembrar',
    summary: 'Recuperar da memória uma informação já vista: nomes, datas, definições, fórmulas.',
    studentDoes: 'Reconhece ou recorda, sem precisar transformar a informação.',
    objectiveExample: 'Identificar os elementos de uma notícia (manchete, lide e corpo).',
    questionExample: 'A partir de uma notícia curta, apontar qual trecho é o lide.',
  },
  compreender: {
    label: 'Compreender',
    summary: 'Construir sentido: explicar com as próprias palavras, resumir, dar exemplos, interpretar.',
    studentDoes: 'Mostra que entendeu, dizendo o mesmo de outra forma.',
    objectiveExample: 'Explicar como o formato visual de um poema concreto cria efeito de sentido.',
    questionExample: 'Diante de um poema visual, explicar o que a disposição das palavras sugere.',
  },
  aplicar: {
    label: 'Aplicar',
    summary: 'Usar um conhecimento ou procedimento numa situação concreta, conhecida ou nova.',
    studentDoes: 'Executa: calcula, resolve, emprega uma regra, realiza um procedimento.',
    objectiveExample: 'Resolver problemas de proporção em receitas e escalas.',
    questionExample: 'Dada uma receita para 4 pessoas, calcular as quantidades para 10.',
  },
  analisar: {
    label: 'Analisar',
    summary: 'Decompor em partes e perceber como elas se relacionam entre si e com o todo.',
    studentDoes: 'Compara, diferencia, relaciona causas e efeitos, organiza evidências.',
    objectiveExample: 'Comparar duas fontes históricas sobre o mesmo acontecimento.',
    questionExample: 'A partir de dois relatos da mesma revolta, indicar em que divergem e por quê.',
  },
  avaliar: {
    label: 'Avaliar',
    summary: 'Julgar com base em critérios: verificar, criticar, justificar uma escolha.',
    studentDoes: 'Toma posição e a sustenta com argumentos ou dados.',
    objectiveExample: 'Avaliar propostas de uso da água com base em dados de consumo.',
    questionExample: 'Entre três propostas para reduzir o consumo, escolher a mais eficaz e justificar com os dados.',
  },
  criar: {
    label: 'Criar',
    summary: 'Reunir elementos para produzir algo novo e coerente: um texto, um plano, um modelo, uma solução.',
    studentDoes: 'Planeja e produz; o resultado não estava dado.',
    objectiveExample: 'Elaborar um roteiro de entrevista sobre a história do bairro.',
    questionExample: 'Propor um experimento para testar se a luz afeta o crescimento de uma planta.',
  },
}
