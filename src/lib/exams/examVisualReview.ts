import { z } from 'zod'
import { examQuestionSchema, type ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { fundamentalOneQuestionGuidance } from '@/lib/pedagogical/gradeInstructions'
import { coherenceIssues } from '@/lib/generation/coherence'

const patchSchema = examQuestionSchema.pick({ slotId: true, statement: true, supportText: true, alternatives: true, correctLetter: true, expectedAnswer: true, gradingCriteria: true, hasImage: true, imageDescription: true }).required()
const reviewSchema = z.object({ questions: z.array(patchSchema) })
const nullableText = { type: 'string', nullable: true }
const responseSchema = { type: 'object', properties: { questions: { type: 'array', items: {
  type: 'object', properties: {
    slotId: { type: 'string' }, statement: { type: 'string' }, supportText: nullableText,
    alternatives: { type: 'array', nullable: true, items: { type: 'object', properties: { letter: { type: 'string' }, text: { type: 'string' } }, required: ['letter', 'text'] } },
    correctLetter: nullableText, expectedAnswer: nullableText, gradingCriteria: nullableText,
    hasImage: { type: 'boolean' }, imageDescription: nullableText,
  }, required: ['slotId', 'statement', 'supportText', 'alternatives', 'correctLetter', 'expectedAnswer', 'gradingCriteria', 'hasImage', 'imageDescription'],
} } }, required: ['questions'] }

/** Referências explícitas a um suporte visual que não está no texto. */
export function referencesMissingVisual(question: Pick<ExamQuestion, 'statement' | 'supportText' | 'hasImage' | 'needsImage'>): boolean {
  if (question.hasImage || question.needsImage) return false
  const text = question.statement.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const reference = /\b(?:observe|veja|analise|olhe)\b.{0,80}\b(?:imagem|figura|grafico|mapa|malha|diagrama|ilustracao)\b|\b(?:na|nessa|nesta) malha quadriculada\b|\b(?:figura|imagem|grafico|mapa|diagrama)\s+(?:abaixo|acima|a seguir|apresentad[ao])\b/.test(text)
  return reference
}

export function reflectionVisualIssues(question: ExamQuestion): string[] {
  const statement = question.statement.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (!question.hasImage || !/refletid|reflexo|reflexao|espelh/.test(statement) || !/triangulo|figura|malha/.test(statement)) return []
  const issues: string[] = []
  if (/eixo de simetria/.test(statement)) issues.push('Use eixo de reflexão ao pedir o espelhamento de uma figura; não atribua à figura original um eixo de simetria externo.')
  if (question.type === 'objetiva' && /qual (?:figura|opcao|desenho)/.test(statement)) {
    if (/\bfigura\s+[A-E]\b/.test(question.statement)) issues.push('Chame a figura inicial de figura original; reserve A, B etc. às opções visuais.')
    if (question.alternatives?.some((alternative) => !new RegExp(`^(?:figura|opção|opcao|desenho|imagem)\\s+${alternative.letter}\\.?$`, 'i').test(alternative.text.trim()))) issues.push('Use alternativas curtas Figura A, Figura B etc.; descreva as formas de todas as opções somente no roteiro da imagem.')
    if (!/\d/.test(question.imageDescription ?? '')) issues.push('Defina coordenadas ou distâncias na malha para a figura original e transformações precisas de cada opção; descrições como triângulo maior ou espelhado são insuficientes.')
  }
  return issues
}

export async function reviewExamVisuals(questions: ExamQuestion[], context: { subject: string; segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'; gradeYear: number }): Promise<{ questions: ExamQuestion[]; warnings: string[] }> {
  if (!questions.length) return { questions, warnings: [] }
  if (questions.some((question) => question.source !== 'ia')) {
    const reviewed = await reviewExamVisuals(questions.filter((question) => question.source === 'ia'), context)
    const byNumber = new Map(reviewed.questions.map((question) => [question.number, question]))
    return { questions: questions.map((question) => question.source === 'ia' ? byNumber.get(question.number) ?? question : question), warnings: reviewed.warnings }
  }
  if (questions.every((question) => question.visualReview?.status === 'complete')) return { questions, warnings: [] }
  const prompt = [
    `Revise exclusivamente a clareza e a coerência visual desta prova completa de ${context.subject} para o ${context.gradeYear}º ano do ${context.segment === 'ensino-medio' ? 'Ensino Médio' : 'Ensino Fundamental'}, ensino brasileiro.`,
    fundamentalOneQuestionGuidance(context.segment, context.gradeYear),
    'A prova já está gerada. Analise TODAS as questões em uma chamada. Não gere uma nova prova e não classifique dificuldade. Preserve slotId, ordem, quantidade, tipo, habilidade BNCC, Bloom e os valores matemáticos de cada questão. Mantenha integralmente os itens que já estejam coerentes.',
    'Decida novamente hasImage e imageDescription. Pergunte: o aluno precisa ver a figura para observar, contar, medir, comparar ou identificar a resposta? Referências a uma malha, figura, gráfico ou imagem ausente exigem hasImage:true e descrição completa. Uma tabela já escrita em supportText pode dispensar imagem. Não confunda imagem útil com decoração.',
    'Respeite generationContext.visualAid: obrigatorio exige imagem; sem_imagem exige retirar referências visuais e tornar a questão autossuficiente; auto permite escolher. Use hasImage:false e imageDescription:null apenas quando todo o suporte necessário estiver no enunciado ou supportText.',
    'Quando houver imagem, ajuste o enunciado e as alternativas se necessário: use linguagem curta, concreta e adequada à turma. Não substitua uma atividade de observação por uma longa descrição verbal da resposta. Para opções de figuras, identifique as opções A, B, C etc. no visual e use alternativas curtas correspondentes. Evite usar a mesma letra para a figura original e uma alternativa.',
    'Em reflexão, distinga o eixo de reflexão do eixo de simetria da própria figura. Não diga que uma reta é eixo de simetria de um triângulo situado inteiramente de um lado dela. A descrição deve especificar malha, posição da figura original, reta, coordenadas ou distâncias necessárias e cada opção visual; não basta dizer cinco opções, uma correta. Garanta que apenas a opção do gabarito seja correta.',
    'imageDescription é o roteiro de produção: inclua todos os dados necessários e rótulos visíveis, sem escrever qual é a resposta correta nem destacá-la. Preserve os números e resultados originais. Ajuste correctLetter, expectedAnswer e gradingCriteria somente se indispensável para manter coerência com as opções visuais. Não altere cálculos cobertos por solutionBlueprint.',
    'Devolva para cada questão somente slotId, statement, supportText, alternatives, correctLetter, expectedAnswer, gradingCriteria, hasImage e imageDescription. Retorne JSON {"questions":[...]}.',
    `Prova original:\n${JSON.stringify(questions)}`,
  ].filter(Boolean).join('\n\n')
  try {
    const reviewed = await generateValidatedStructuredContent({
      context: 'generation/exam-visual-review', prompt, responseSchema, zodSchema: reviewSchema, maxAttempts: 2,
      validate: (response) => {
        const issues: string[] = []
        if (response.questions.length !== questions.length) return { value: questions, issues: ['A revisão visual deve devolver todas as questões, na ordem original.'] }
        const updated = questions.map((question, index) => {
          const patch = response.questions[index]!
          if (patch.slotId !== question.slotId) issues.push(`Questão ${question.number}: slotId ou ordem alterado.`)
          const parsed = examQuestionSchema.safeParse({ ...question, ...patch })
          if (!parsed.success) { issues.push(`Questão ${question.number}: contrato inválido.`); return question }
          const next = { ...parsed.data, needsImage: patch.hasImage, imageQuery: patch.imageDescription, image: null, visualReview: { status: 'complete' as const } }
          if (!next.statement.trim()) issues.push(`Questão ${question.number}: enunciado vazio.`)
          if (next.hasImage && !next.imageDescription?.trim()) issues.push(`Questão ${question.number}: imagem sem roteiro.`)
          if (!next.hasImage && next.imageDescription) issues.push(`Questão ${question.number}: descrição sem imagem.`)
          if (referencesMissingVisual(next)) issues.push(`Questão ${question.number}: referência a figura ausente; inclua imagem e roteiro ou remova a dependência visual.`)
          issues.push(...reflectionVisualIssues(next).map((issue) => `Questão ${question.number}: ${issue}`))
          if (question.generationContext?.visualAid === 'obrigatorio' && !next.hasImage) issues.push(`Questão ${question.number}: imagem obrigatória.`)
          if (question.generationContext?.visualAid === 'sem_imagem' && next.hasImage) issues.push(`Questão ${question.number}: professor selecionou sem imagem.`)
          if (question.type === 'objetiva') {
            if (JSON.stringify(next.alternatives?.map((a) => a.letter)) !== JSON.stringify(question.alternatives?.map((a) => a.letter))) issues.push(`Questão ${question.number}: letras ou quantidade de alternativas alteradas.`)
            if (!next.correctLetter || !next.alternatives?.some((a) => a.letter === next.correctLetter) || next.alternatives?.some((a) => !a.text.trim())) issues.push(`Questão ${question.number}: alternativas ou gabarito inválidos.`)
          } else if (!next.expectedAnswer?.trim() || !next.gradingCriteria?.trim() || next.alternatives !== null || next.correctLetter !== null) issues.push(`Questão ${question.number}: resposta discursiva ou critérios inválidos.`)
          return next
        })
        issues.push(...coherenceIssues(updated).filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason))
        return { value: updated, issues }
      },
    })
    return { questions: reviewed.value, warnings: reviewed.warnings }
  } catch {
    // Preserva o rascunho. A aprovação verifica referências visuais ausentes.
    const reason = 'A revisão visual automática não pôde ser concluída; confira enunciados, alternativas e imagens antes de aprovar.'
    return { questions: questions.map((question) => ({ ...question, visualReview: { status: 'pending', reason } })), warnings: [reason] }
  }
}
