import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { importImageFromUrl } from '@/lib/images/questionImageService'
import { inferDokAndSoloExpected } from '@/lib/pedagogical/questionHeuristics'
import type { ExamQuestion } from './examSchema'

type BankRow = {
  id: number
  year: number
  context: string | null
  alternatives_introduction: string | null
  alternatives: Array<{ letter: string; text: string; isCorrect: boolean }>
  correct_alternative: string
  bloom_level: string | null
  skill_code: string | null
  skill_description: string | null
  classification_source: string | null
  files: string[] | null
}

/**
 * Busca as questões do banco ENEM escolhidas manualmente na tela de geração
 * e converte pro formato ExamQuestion, pra entrar na prova ao lado das
 * geradas por IA. São sempre objetivas (o ENEM não tem descritiva) e nunca
 * levam código BNCC (não fazem parte do currículo próprio da escola, são
 * prova externa) — o campo saeb.value carrega a habilidade oficial quando
 * existe, marcando approximate:true se a classificação não é 'oficial'.
 */
export async function buildBankExamQuestions(questionIds: number[], startNumber: number): Promise<ExamQuestion[]> {
  if (!questionIds.length) return []

  // IDs já vieram validados como inteiros pelo zod na rota de geração —
  // seguro interpolar direto num IN(...). `= ANY(${array})` do postgres.js
  // exige um cast de tipo explícito pra funcionar com array JS puro; IN é
  // mais simples e portátil pra essa lista pequena (no máx. 15 ids).
  const idList = questionIds.map((id) => Number(id)).join(',')

  const rows = await db.execute<BankRow>(
    sql`
      SELECT
        q.id, q.year, q.context, q.alternatives_introduction, q.alternatives, q.correct_alternative, q.files,
        c.bloom_level, s.code AS skill_code, s.description AS skill_description,
        c.enem_classification_source AS classification_source
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      LEFT JOIN enem_skills s ON s.id = c.enem_skill_id
      WHERE q.id IN (${sql.raw(idList)})
    `,
  )

  // Preserva a ordem escolhida pelo usuário, não a ordem que veio do banco.
  const byId = new Map((rows as unknown as BankRow[]).map((r) => [r.id, r]))

  // A imagem original da questão (mapa, tira, gráfico) vem direto da API
  // enem.dev via imported_questions.files — a mesma imagem aplicada na
  // prova real, não uma busca/geração aproximada. Baixa e sobe pro Drive
  // (mesmo pipeline de staging já usado pras outras fontes de imagem),
  // sempre approved:false — mesma regra de "revisor confirma antes do
  // documento final" que vale pras imagens geradas/buscadas por IA,
  // mesmo sendo a imagem original (defende contra a fonte pública ficar
  // fora do ar ou trazer algo inesperado sem ninguém perceber). Resolve
  // em paralelo (Promise.all) — cada download/upload é independente.
  const questions = await Promise.all(
    questionIds.map(async (id, i) => {
      const r = byId.get(id)
      if (!r) return null // questão removida do banco entre a seleção e a geração — não trava, só cai fora
      const alternatives = (r.alternatives ?? []).map((a) => ({ letter: a.letter, text: a.text }))
      const text = [
        r.context,
        r.alternatives_introduction,
        alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join('\n'),
      ].filter(Boolean).join('\n\n')
      const inferred = inferDokAndSoloExpected({
        text,
        bloomLevel: r.bloom_level,
      })

      let image: ExamQuestion['image'] = null
      const originalUrl = r.files?.[0]
      if (originalUrl) {
        try {
          const resolved = await importImageFromUrl(originalUrl, 'enem')
          image = { ...resolved, approved: false }
        } catch (err) {
          console.warn(`[enemBankMerge] falha ao importar imagem original da questão ${r.id} (${originalUrl}):`, err instanceof Error ? err.message : err)
        }
      }

      const question: ExamQuestion = {
        number: startNumber + i,
        source: 'enem_bank',
        enemBankRef: { questionId: r.id, year: r.year },
        type: 'objetiva',
        bloomLevel: (r.bloom_level as ExamQuestion['bloomLevel']) ?? 'aplicar',
        supportText: r.context,
        statement: r.alternatives_introduction ?? '',
        alternatives,
        correctLetter: r.correct_alternative,
        bnccCodes: [],
        bnccStatus: 'nao_mapeado',
        bnccSummary: null,
        pedagogicalClassification: {
          dok: {
            categoryCode: inferred.dok.categoryCode as 'DOK_1' | 'DOK_2' | 'DOK_3' | 'DOK_4',
            confidence: inferred.dok.confidence,
            justification: inferred.dok.explanation,
            evidence: inferred.dok.evidence,
          },
          soloExpected: {
            categoryCode: inferred.soloExpected.categoryCode as 'UNIESTRUTURAL' | 'MULTIESTRUTURAL' | 'RELACIONAL' | 'ABSTRATO_AMPLIADO',
            confidence: inferred.soloExpected.confidence,
            justification: inferred.soloExpected.explanation,
            evidence: inferred.soloExpected.evidence,
          },
          estimatedTimeMinutes: null,
          difficulty: null,
        },
        saeb: {
          applicable: true,
          source: 'enem',
          value: r.skill_code ? `${r.skill_code} — ${r.skill_description ?? ''}`.trim() : `ENEM ${r.year} (sem habilidade classificada)`,
          approximate: r.classification_source !== 'oficial',
        },
        needsImage: Boolean(image),
        imageQuery: null,
        image,
      }
      return question
    }),
  )

  return questions.filter((q): q is ExamQuestion => q !== null)
}
