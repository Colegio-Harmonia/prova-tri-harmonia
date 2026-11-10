import { classifyQuestionBncc, type BnccClassification } from '@/lib/exams/questionBnccClassification'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { importImageFromUrl } from '@/lib/images/questionImageService'
import { inferDokAndSoloExpected } from '@/lib/pedagogical/questionHeuristics'
import type { ExamQuestion } from './examSchema'

type BankRow = {
  id: number
  discipline: string | null
  raw_json: { bnccClassification?: BnccClassification } | null
  year: number
  context: string | null
  alternatives_introduction: string | null
  alternatives: Array<{ letter: string; text: string; isCorrect: boolean; file?: string | null }>
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
 * geradas por IA. São sempre objetivas (o ENEM não tem descritiva) e
 * preservam também os vínculos BNCC classificados pelo Jev. O campo
 * saeb.value carrega a habilidade da matriz ENEM quando
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
        q.id, q.discipline, q.raw_json, q.year, q.context, q.alternatives_introduction, q.alternatives, q.correct_alternative, q.files,
        c.bloom_level, s.code AS skill_code, s.description AS skill_description,
        c.enem_classification_source AS classification_source
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      LEFT JOIN enem_skills s ON s.id = c.enem_skill_id
      WHERE q.source = 'enem' AND q.id IN (${sql.raw(idList)})
    `,
  )

  // Preserva a ordem escolhida pelo usuário, não a ordem que veio do banco.
  const byId = new Map((rows as unknown as BankRow[]).map((r) => [r.id, r]))

  // Importa a mídia original do banco com aceite automático e origem registrada.
  // O download/upload continua validando o arquivo antes de anexá-lo.
  const questions = await Promise.all(
    questionIds.map(async (id, i): Promise<ExamQuestion | null> => {
      const r = byId.get(id)
      if (!r) return null // questão removida do banco entre a seleção e a geração — não trava, só cai fora
      // Alternativa-figura do ENEM (ex: 2013/151, "Qual destas figuras...")
      // vem com text null e a figura em `file`. Antes só o texto era
      // copiado e a prova mostrava 5 placeholders sem conteúdo nenhum.
      const alternatives = await Promise.all((r.alternatives ?? []).map(async (a) => {
        if (a.text || !a.file) return { letter: a.letter, text: a.text }
        try {
          const resolved = await importImageFromUrl(a.file, 'enem')
          return { letter: a.letter, text: a.text, image: { driveFileId: resolved.driveFileId, previewUrl: resolved.previewUrl, sourceUrl: a.file } }
        } catch (err) {
          console.warn(`[enemBankMerge] falha ao importar imagem da alternativa ${a.letter} da questão ${r.id} (${a.file}):`, err instanceof Error ? err.message : err)
          return { letter: a.letter, text: a.text }
        }
      }))
      const text = [
        r.context,
        r.alternatives_introduction,
        alternatives.map((alternative) => `${alternative.letter}) ${alternative.text ?? '[figura]'}`).join('\n'),
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
          image = { ...resolved, approved: true, originalBankMedia: true }
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
        needsImage: Boolean(originalUrl),
        hasImage: Boolean(originalUrl),
        imageQuery: null,
        image,
      }
      const stored = r.raw_json?.bnccClassification
      const classification = stored?.bnccCodes?.length ? stored : await classifyQuestionBncc(question, { segment: 'ensino-medio', gradeYear: 3, subject: r.discipline ?? 'ENEM' })
      if (!stored?.bnccCodes?.length) {
        await db.execute(sql`UPDATE imported_questions SET raw_json = jsonb_set(COALESCE(raw_json, '{}'::jsonb), '{bnccClassification}', ${JSON.stringify(classification)}::jsonb) WHERE id = ${r.id} AND COALESCE(jsonb_array_length(raw_json->'bnccClassification'->'bnccCodes'), 0) = 0 AND raw_json IS NOT DISTINCT FROM ${JSON.stringify(r.raw_json)}::jsonb`)
      }
      return { ...question, ...classification }
    }),
  )

  return questions.filter((q): q is ExamQuestion => q !== null)
}
