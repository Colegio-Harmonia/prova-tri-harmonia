import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { MergedAdaptation } from './mergeLibraries'

// Prompt do motor de adaptação inclusiva (spec seção 6) — regras
// invioláveis fixas + blocos por biblioteca em ordem de prioridade +
// harmonização quando há 2+ laudos. A IA só reescreve FORMA; o
// equivalenceValidator confere programaticamente que o construto avaliado
// não mudou (nunca confiar só no prompt).

const INVIOLABLE_RULES = `Você é um especialista em educação inclusiva e desenho universal para
aprendizagem (DUA) do Colégio Harmonia. Sua tarefa é ADAPTAR questões de
uma prova já aprovada para alunos com necessidades educacionais
específicas, seguindo ESTRITAMENTE as diretrizes das bibliotecas de
adaptação fornecidas abaixo.

REGRAS INVIOLÁVEIS (a violação de qualquer uma invalida a resposta):
1. NUNCA altere o conteúdo avaliado: a habilidade BNCC, o nível de Bloom, o raciocínio exigido e o objetivo pedagógico de cada questão permanecem os mesmos.
2. NUNCA altere a resposta correta de uma questão objetiva, nem o número de alternativas, nem a letra de cada alternativa, nem torne a resposta mais óbvia (não simplifique as alternativas erradas a ponto de entregar a correta).
3. NUNCA remova ou altere a resposta esperada/critérios de correção de questões descritivas — adapte apenas o enunciado apresentado ao aluno.
4. NUNCA reduza a quantidade de questões nem funda questões — devolva exatamente uma adaptação por questão, com o mesmo "number".
5. Adaptação muda a FORMA de apresentar (linguagem, estrutura, fragmentação, apoios), nunca a DIFICULDADE COGNITIVA central.
6. Responda exclusivamente no formato JSON especificado.`

function buildLibraryBlocks(merged: MergedAdaptation): string {
  return merged.libraries
    .map((library) => `## Diretrizes ativas: ${library.label} — biblioteca v${library.version}\n${library.contentDirectives.map((d) => `- ${d}`).join('\n')}`)
    .join('\n\n')
}

function buildHarmonizationBlock(merged: MergedAdaptation): string {
  if (merged.libraries.length < 2) return ''
  const labels = merged.libraries.map((l) => l.label.split(' ')[0]).join(' + ')
  return `

## Harmonização de múltiplos perfis (${labels})
As diretrizes acima se aplicam SIMULTANEAMENTE. Regras de resolução:
- A biblioteca listada PRIMEIRO tem precedência na redação; as demais se aplicam SOBRE o texto já reescrito por ela (ex: linguagem literal primeiro, fragmentação em etapas depois).
- Suporte visual: mantenha/adicione APENAS apoio visual com função pedagógica direta; remova todo elemento decorativo. Nunca adicione ilustração meramente estética.
- Em conflito não coberto acima, aplique a diretriz da biblioteca listada primeiro e registre o conflito em "harmonizationNotes".`
}

function questionForPrompt(q: ExamQuestion) {
  return {
    number: q.number,
    type: q.type,
    supportText: q.supportText ?? null,
    statement: q.statement,
    alternatives: q.alternatives ?? null,
    hasImage: Boolean(q.image?.approved),
  }
}

export function buildAdaptationPrompt(questions: ExamQuestion[], merged: MergedAdaptation): string {
  return `${INVIOLABLE_RULES}

${buildLibraryBlocks(merged)}${buildHarmonizationBlock(merged)}

## Prova original (adapte TODAS as ${questions.length} questões)
${JSON.stringify(questions.map(questionForPrompt), null, 2)}

## Formato de saída (JSON)
Para CADA questão da prova original, devolva um item em "questions":
{
  "number": <mesmo número da questão original>,
  "adaptedStatement": "<enunciado adaptado, markdown simples>",
  "adaptedSupportText": "<texto de apoio adaptado, ou null se a questão não tem>",
  "adaptedAlternatives": [{"letter": "A", "text": "<texto adaptado>"}, ...] ou null (descritiva ou sem mudança),
  "formulaSupport": "<fórmulas/operações de consulta permitida>" ou null,
  "visualSupportSuggestion": "<descrição do apoio visual sugerido>" ou null,
  "imageDescription": "<descrição textual completa da imagem>" ou null,
  "removedElements": ["<elemento decorativo removido>", ...],
  "adaptationNotes": "<o que foi mudado e por quê, 1-2 frases>",
  "harmonizationNotes": "<conflitos entre bibliotecas nesta questão>" ou null
}

Responda APENAS com o JSON: {"questions": [...]}`
}
