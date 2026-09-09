import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'

type ExemplarRow = {
  context: string | null
  alternatives_introduction: string | null
}

/**
 * Puxa 2-3 questões reais e bem classificadas do banco ENEM (mesma área da
 * disciplina) pra usar como EXEMPLO DE ESTILO no prompt — não pra copiar
 * conteúdo, só pro modelo ver o nível de exigência interpretativa real do
 * ENEM (texto de apoio substancial + pergunta que exige relacionar
 * informação, não recordar fato isolado). Só existe pra Ensino Médio: é o
 * único segmento com banco real classificado (SAEB não libera item
 * completo — ver bnccSaebMap.ts). Filtra por bloom_level em
 * analisar/avaliar (os níveis que o usuário quer reforçar) e
 * classification_source='oficial' (maior confiança na classificação).
 */
export async function getEnemStyleExemplars(subject: string, limit = 3): Promise<string | null> {
  const area = getEnemAreaForSubject(subject)
  if (!area) return null

  const rows = await db.execute<ExemplarRow>(
    sql`
      SELECT q.context, q.alternatives_introduction
      FROM imported_questions q
      JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      LEFT JOIN enem_areas a ON a.id = c.enem_area_id
      WHERE a.code = ${area}
        AND c.bloom_level IN ('analisar', 'avaliar')
        AND c.enem_classification_source = 'oficial'
        AND q.context IS NOT NULL
        AND length(q.context) > 200
      ORDER BY random()
      LIMIT ${limit}
    `,
  )

  const list = rows as unknown as ExemplarRow[]
  if (!list.length) return null

  return list
    .map((r, i) => {
      const context = (r.context ?? '').slice(0, 500)
      const question = (r.alternatives_introduction ?? '').slice(0, 200)
      return `Exemplo ${i + 1}:\nTexto de apoio: "${context}"\nPergunta: "${question}"`
    })
    .join('\n\n')
}
