import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { analyzeIllustrations } from './recommendations'
import { routeVisualPlan } from './visualPlanRouter'

export type VisualPlanningResult = {
  questions: ExamQuestion[]
  blockedQuestionNumbers: number[]
}

/**
 * Estágio visual da prova já montada: usa o mesmo analisador exposto ao
 * professor, persiste a decisão e prepara o renderer determinístico quando
 * ele existir. Assim a automação e a revisão nunca discordam sobre qual
 * biblioteca pode ser usada.
 */
export async function planAutomaticVisuals(subject: string, questions: ExamQuestion[]): Promise<VisualPlanningResult> {
  const blockedQuestionNumbers: number[] = []
  const planned = await Promise.all(questions.map(async (question) => {
    const routed = routeVisualPlan(subject, question)
    if (routed) {
      return {
        ...question,
        visualPlan: { ...question.visualPlan!, renderer: routed.renderer, parameters: routed.parameters },
        imageQuery: question.whatIfImage ?? question.imageQuery ?? question.visualPlan?.rationale ?? null,
      }
    }
    // O recomendador aprimora a prova, mas uma indisponibilidade temporária
    // dele não pode derrubar uma questão já validada. Nesse caso preservamos
    // a decisão do estágio visual e deixamos a contingência de imagem atuar.
    let analysis
    try {
      analysis = await analyzeIllustrations(subject, question)
    } catch {
      analysis = {
        decision: 'ai_optional' as const,
        reason: 'A análise de bibliotecas está indisponível; mantenha a decisão visual validada e use a contingência de IA somente se necessário.',
        recommendations: [],
      }
    }
    const recommendation = analysis.recommendations[0] ?? null
    const required = Boolean(question.visualPlan?.required || question.needsImage)
    // Uma referência a figura só é quebrada quando nenhum visual foi
    // planejado. Se o próprio estágio visual marcou a figura como necessária,
    // a imagem ainda será criada abaixo; bloqueá-la aqui impedia justamente
    // essa geração e fazia a prova inteira falhar antes da contingência.
    if (analysis.decision === 'missing_required_visual') {
      if (!required) {
        blockedQuestionNumbers.push(question.number)
        return question
      }
      return {
        ...question,
        visualPlan: {
          ...question.visualPlan!,
          decision: 'recommended' as const,
          renderer: null,
          parameters: question.visualPlan?.parameters ?? null,
          rationale: question.visualPlan?.rationale ?? analysis.reason,
        },
        imageQuery: question.whatIfImage ?? question.imageQuery ?? question.visualPlan?.rationale ?? null,
      }
    }
    // Em Matemática, um visual sem dados renderizáveis não pode cair em uma
    // imagem generativa: ela pode alterar a relação numérica ou antecipar a
    // resposta. Se o enunciado já é autossuficiente (referências ausentes
    // foram bloqueadas acima), preservamos o item sem imagem.
    const normalizedSubject = subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    if (normalizedSubject === 'matematica' && required && !recommendation && analysis.decision === 'ai_optional') {
      return {
        ...question,
        needsImage: false,
        imageQuery: null,
        visualPlan: {
          decision: 'not_needed' as const,
          required: false,
          purpose: 'nenhum' as const,
          visualType: 'none' as const,
          renderer: null,
          parameters: null,
          rationale: 'Não há renderer determinístico seguro para este visual; o enunciado é autossuficiente e segue sem imagem.',
        },
      }
    }
    return {
      ...question,
      // Só promove automaticamente a imagem quando o planejamento original
      // já disse que ela é necessária. Recomendações opcionais continuam
      // disponíveis na revisão, preservando a escolha docente.
      visualPlan: {
        decision: analysis.decision,
        required,
        purpose: question.visualPlan?.purpose,
        visualType: question.visualPlan?.visualType,
        renderer: recommendation?.generator ?? null,
        parameters: recommendation?.parameters ?? null,
        rationale: recommendation?.rationale ?? question.visualPlan?.rationale ?? analysis.reason,
      },
      imageQuery: required ? (question.whatIfImage ?? question.imageQuery ?? recommendation?.title ?? question.visualPlan?.rationale ?? analysis.reason) : null,
    }
  }))
  return { questions: planned, blockedQuestionNumbers: blockedQuestionNumbers.sort((a, b) => a - b) }
}
