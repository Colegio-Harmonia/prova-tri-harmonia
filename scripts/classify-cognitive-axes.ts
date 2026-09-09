#!/usr/bin/env tsx
/**
 * Classifica o Eixo Cognitivo (DL, CF, SP, CA, EP) de cada questão do banco
 * ENEM via IA.
 *
 * Diferente da habilidade (H1-H30), o INEP NÃO publica eixo cognitivo por
 * item nos microdados — os 5 eixos são transversais por definição (toda
 * habilidade da matriz já carrega os 5 implicitamente). Não existe "eixo
 * oficial" por questão pra extrair de arquivo nenhum; isso é sempre uma
 * estimativa pedagógica, então essa classificação nunca muda
 * enem_classification_source (que continua descrevendo só área/competência/
 * habilidade) — só preenche enem_cognitive_axis_id à parte.
 *
 * Uso:
 *   DATABASE_URL="..." DEEPSEEK_API_KEY="..." tsx scripts/classify-cognitive-axes.ts
 *
 * Flags:
 *   DRY_RUN=true     mostra o que faria, sem gravar nem chamar a IA
 *   BATCH_SIZE=20    quantas questões por chamada (default 20)
 *   LIMIT=100        limita quantas questões processar nessa execução
 */

import postgres from 'postgres'
import axios from 'axios'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a variável de ambiente antes de rodar este script.')
}
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const DRY_RUN = process.env.DRY_RUN === 'true'
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 20)
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null
const DELAY_MS = 500 // entre chamadas — DeepSeek não é tão restrito quanto o free tier do Gemini

type Axis = { id: number; code: string; name: string; description: string }
type Question = { id: number; context: string | null; alternatives_introduction: string | null }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPrompt(axes: Axis[], batch: Question[]): string {
  const axisList = axes.map((a) => `- ${a.code}: ${a.name}. ${a.description}`).join('\n')
  const questionsList = batch
    .map((q, i) => `[${i}] ${(q.context ?? '').slice(0, 500)} ${(q.alternatives_introduction ?? '').slice(0, 200)}`.trim())
    .join('\n\n')

  return `Você é um especialista na Matriz de Referência do ENEM. Os 5 Eixos Cognitivos abaixo são comuns a todas as áreas do exame — toda questão testa predominantemente UM deles, mesmo que toque outros de forma secundária.

Eixos Cognitivos:
${axisList}

Para cada questão numerada abaixo, identifique qual eixo cognitivo (código) é o MAIS predominante testado por ela. Responda só com o código do eixo mais representativo por questão, sem explicação.

Questões:
${questionsList}`
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'índice da questão no lote, conforme numerado no prompt' },
          axisCode: { type: 'string', enum: ['DL', 'CF', 'SP', 'CA', 'EP'] },
        },
        required: ['index', 'axisCode'],
      },
    },
  },
  required: ['classifications'],
}

async function classifyBatch(axes: Axis[], batch: Question[]): Promise<Map<number, string>> {
  // DeepSeek não tem campo de responseSchema restringindo a estrutura no
  // servidor (só json_object garantindo sintaxe válida) — por isso o
  // schema esperado vai embutido no texto do prompt.
  const prompt = `${buildPrompt(axes, batch)}\n\nResponda ESTRITAMENTE em JSON válido, sem markdown, seguindo esta estrutura:\n${JSON.stringify(RESPONSE_SCHEMA)}`

  const { data } = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    },
    { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 },
  )

  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('DeepSeek não retornou conteúdo.')

  const parsed = JSON.parse(text) as { classifications: Array<{ index: number; axisCode: string }> }
  return new Map(parsed.classifications.map((c) => [c.index, c.axisCode]))
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🧠 Classificador de Eixo Cognitivo (IA) — ENEM')
  console.log('═══════════════════════════════════════════')
  console.log(`  DRY_RUN: ${DRY_RUN ? 'Sim' : 'Não'}`)
  console.log(`  BATCH_SIZE: ${BATCH_SIZE}`)
  console.log('═══════════════════════════════════════════\n')

  if (!DRY_RUN && !DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY não configurado.')
    process.exit(1)
  }

  const sql = postgres(DATABASE_URL, { ssl: false, connect_timeout: 10 })

  try {
    const axes = await sql<Axis[]>`SELECT id, code, name, description FROM enem_cognitive_axes ORDER BY id`
    const axisByCode = new Map(axes.map((a) => [a.code, a]))
    console.log(`📚 ${axes.length} eixos carregados.\n`)

    const pending = await sql<Question[]>`
      SELECT q.id, q.context, q.alternatives_introduction
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      WHERE c.enem_cognitive_axis_id IS NULL
      ORDER BY q.year DESC, q.question_index ASC
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
    `

    console.log(`📋 ${pending.length} questões sem eixo cognitivo.\n`)

    if (DRY_RUN) {
      console.log(`🏁 DRY RUN — pararia aqui, ${Math.ceil(pending.length / BATCH_SIZE)} chamada(s) à IA seriam feitas.`)
      return
    }

    let classified = 0
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE)
      try {
        const results = await classifyBatch(axes, batch)
        for (let j = 0; j < batch.length; j++) {
          const axisCode = results.get(j)
          const axis = axisCode ? axisByCode.get(axisCode) : null
          if (!axis) continue // não força — se o modelo não respondeu essa, fica pendente pra próxima execução
          await sql`
            INSERT INTO imported_question_classifications (question_id, source, enem_cognitive_axis_id, classified_at)
            VALUES (${batch[j].id}, 'enem', ${axis.id}, NOW())
            ON CONFLICT ON CONSTRAINT uq_classification DO UPDATE SET
              enem_cognitive_axis_id = EXCLUDED.enem_cognitive_axis_id,
              updated_at = NOW()
          `
          classified++
        }
        console.log(`  📊 ${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length} processadas (${classified} classificadas)...`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ⚠️  Lote ${i}-${i + batch.length} falhou: ${msg} — pulando, tenta de novo numa próxima execução.`)
      }
      await sleep(DELAY_MS)
    }

    console.log(`\n✅ ${classified}/${pending.length} questões classificadas com eixo cognitivo nesta execução.`)

    const stats = await sql`
      SELECT COALESCE(ax.code, 'sem_eixo') AS eixo, COUNT(*)::int AS count
      FROM imported_question_classifications c
      LEFT JOIN enem_cognitive_axes ax ON ax.id = c.enem_cognitive_axis_id
      WHERE c.source = 'enem'
      GROUP BY eixo
      ORDER BY count DESC
    `
    console.log('\n📊 Distribuição total:')
    for (const s of stats as Array<{ eixo: string; count: number }>) {
      console.log(`  ${s.eixo}: ${s.count}`)
    }
  } finally {
    await sql.end()
  }
}

main()
