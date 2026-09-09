#!/usr/bin/env tsx
/**
 * Reclassifica o nível de Bloom de cada questão do banco ENEM via IA.
 *
 * O classificador anterior (classify-questions.ts) usava heurística de
 * verbo no enunciado ("identificar" → Lembrar etc.) — mas o ENEM é
 * majoritariamente contextual/situacional, sem verbo instrucional
 * explícito no texto, então ~85% das questões ficaram com bloom_level
 * NULL ("pending"). Este script substitui isso por classificação real via
 * DeepSeek, avaliando a demanda cognitiva de fato (não string matching),
 * mesmo padrão já usado com sucesso em classify-cognitive-axes.ts.
 *
 * Reclassifica TUDO (não só o pendente) pra ter uma metodologia única e
 * consistente no banco inteiro — os ~15% já classificados pelo heurística
 * antigo (bloom_level_source='ai', nome infeliz, não é IA de verdade)
 * também são sobrescritos. Idempotente e resumível: marca
 * bloom_level_source='deepseek-v2' em cada linha processada, então uma
 * execução interrompida só reprocessa o que ainda não tem esse marcador.
 *
 * Uso:
 *   DATABASE_URL="..." DEEPSEEK_API_KEY="..." tsx scripts/classify-bloom-ai.ts
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
const DELAY_MS = 500

type Question = { id: number; context: string | null; alternatives_introduction: string | null }

const BLOOM_LEVELS = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const

const BLOOM_DEFS: Record<(typeof BLOOM_LEVELS)[number], string> = {
  lembrar: 'reconhecer ou recuperar um fato, termo ou definição já dada, sem exigir raciocínio sobre o contexto.',
  compreender: 'interpretar, resumir ou explicar uma ideia/texto/gráfico com as próprias palavras, sem ainda aplicar a um caso novo.',
  aplicar: 'usar um conceito, fórmula ou procedimento conhecido pra resolver uma situação concreta e específica.',
  analisar: 'decompor uma situação em partes, comparar, relacionar causas e efeitos, ou identificar padrões/relações não explícitas.',
  avaliar: 'julgar, comparar ou selecionar a MELHOR entre opções/propostas/argumentos dados, com base em critérios — inclui escolher, entre alternativas prontas, qual medida/solução é mais adequada.',
  criar: 'reservado pra quando o próprio ato de resolver exige construir algo estruturalmente novo (montar uma expressão/fórmula nunca dada, combinar elementos numa configuração original) — não apenas escolher a alternativa que descreve uma proposta ou solução.',
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPrompt(batch: Question[]): string {
  const defs = BLOOM_LEVELS.map((l) => `- ${l}: ${BLOOM_DEFS[l]}`).join('\n')
  const questionsList = batch
    .map((q, i) => {
      const apoio = (q.context ?? '').slice(0, 600)
      const pergunta = (q.alternatives_introduction ?? '').slice(0, 250)
      return `[${i}]\nTexto de apoio (só contexto/dado factual, NÃO usar o vocabulário dele pra decidir o nível): ${apoio}\nPergunta (é ISSO que define o nível de Bloom): ${pergunta}`
    })
    .join('\n\n')

  return `Você é um especialista em Taxonomia de Bloom aplicada a questões de múltipla escolha do ENEM. Classifique pela DEMANDA COGNITIVA real da PERGUNTA — o que o estudante precisa fazer mentalmente pra resolvê-la — nunca por palavras que aparecem só no texto de apoio (ex: o texto pode mencionar "elaborar estratégias" sem que a pergunta em si peça isso).

Regra importante sobre o formato múltipla escolha: o estudante sempre ESCOLHE entre alternativas já prontas, nunca gera uma resposta do zero. Por isso "Criar" é raríssimo nesse formato — reserve-o só pra quando resolver a questão exige montar algo estruturalmente novo (ex: construir uma expressão algébrica nunca apresentada). Uma pergunta do tipo "qual medida/proposta resolveria X" é "Avaliar" (julgar qual alternativa é a mais adequada), não "Criar", mesmo que a alternativa correta descreva uma solução.

Níveis de Bloom:
${defs}

Para cada questão numerada abaixo, identifique o nível de Bloom PREDOMINANTE exigido pela PERGUNTA (não pelo texto de apoio). Responda só com o nível por questão, sem explicação.

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
          bloomLevel: { type: 'string', enum: [...BLOOM_LEVELS] },
        },
        required: ['index', 'bloomLevel'],
      },
    },
  },
  required: ['classifications'],
}

async function classifyBatch(batch: Question[]): Promise<Map<number, string>> {
  const prompt = `${buildPrompt(batch)}\n\nResponda ESTRITAMENTE em JSON válido, sem markdown, seguindo esta estrutura:\n${JSON.stringify(RESPONSE_SCHEMA)}`

  const { data } = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 4096,
    },
    { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 },
  )

  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('DeepSeek não retornou conteúdo.')

  const parsed = JSON.parse(text) as { classifications: Array<{ index: number; bloomLevel: string }> }
  return new Map(parsed.classifications.map((c) => [c.index, c.bloomLevel]))
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🧠 Classificador de Bloom (IA) — ENEM')
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
    const pending = await sql<Question[]>`
      SELECT q.id, q.context, q.alternatives_introduction
      FROM imported_questions q
      JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      WHERE c.bloom_level_source IS DISTINCT FROM 'deepseek-v2'
      ORDER BY q.year DESC, q.question_index ASC
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
    `

    console.log(`📋 ${pending.length} questões pra (re)classificar em Bloom via IA.\n`)

    if (DRY_RUN) {
      console.log(`🏁 DRY RUN — pararia aqui, ${Math.ceil(pending.length / BATCH_SIZE)} chamada(s) à IA seriam feitas.`)
      return
    }

    let classified = 0
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE)
      try {
        const results = await classifyBatch(batch)
        for (let j = 0; j < batch.length; j++) {
          const level = results.get(j)
          if (!level || !(BLOOM_LEVELS as readonly string[]).includes(level)) continue
          await sql`
            UPDATE imported_question_classifications
            SET bloom_level = ${level}, bloom_level_source = 'deepseek-v2', updated_at = NOW()
            WHERE question_id = ${batch[j].id} AND source = 'enem'
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

    console.log(`\n✅ ${classified}/${pending.length} questões (re)classificadas nesta execução.`)

    const stats = await sql`
      SELECT COALESCE(bloom_level, 'pending') AS level, COUNT(*)::int AS count
      FROM imported_question_classifications
      WHERE source = 'enem'
      GROUP BY level
      ORDER BY count DESC
    `
    console.log('\n📊 Distribuição total de Bloom:')
    for (const s of stats as Array<{ level: string; count: number }>) {
      console.log(`  ${s.level}: ${s.count}`)
    }
  } finally {
    await sql.end()
  }
}

main()
