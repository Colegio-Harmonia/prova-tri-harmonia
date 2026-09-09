/**
 * Seed Question Bank v4 - Gera questoes para o 4o ano via Gemini
 *
 * Uso: source <(cat .env.local | sed "s/^/export /") && npx tsx scripts/seed_questions_v4.ts
 */
import fs from "fs"
import path from "path"
import postgres from "postgres"
import axios from "axios"

const DB_URL = process.env.DATABASE_URL
const API_KEY = process.env.GEMINI_API_KEY
if (!DB_URL || !API_KEY) {
  console.error("DATABASE_URL e GEMINI_API_KEY obrigatorios")
  process.exit(1)
}

const sql = postgres(DB_URL)
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"

interface EnrichmentEntry {
  grade: number
  subjects: string[]
  bimester: number
  chapter: string
  enriched_conteudo: string
  skills: string
  objectives: string
}

interface RawQuestion {
  type?: string
  bloomLevel?: string
  statement?: string
  supportText?: string | null
  alternatives?: { letter: string; text: string }[] | null
  correctLetter?: string | null
  expectedAnswer?: string | null
  gradingCriteria?: string | null
  bnccCodes?: string[]
  bnccStatus?: string
  bnccSummary?: string
}

function safe(val: unknown, fallback: unknown = null): unknown {
  return val === undefined ? fallback : val
}

function extractJson(text: string): string {
  let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim()
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) return arrayMatch[0]
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) return objectMatch[0]
  return cleaned
}

async function generateQuestions(entry: EnrichmentEntry, count: number = 3): Promise<RawQuestion[]> {
  const subject = entry.subjects[0]
  const prompt = `Voce e um especialista em avaliacao pedagogica. Gere ${count} questoes
para o ${entry.grade}o ano (anos-iniciais), disciplina ${subject}, ${entry.bimester}o bimestre.

Conteudo da unidade: "${entry.chapter}"
Conteudo detalhado: ${entry.enriched_conteudo.substring(0, 500)}
Habilidades BNCC: ${entry.skills.substring(0, 500)}
Objetivos: ${entry.objectives.substring(0, 500)}

REGRAS:
- 2 objetivas (multipla escolha, 4 alternativas A-D) + 1 descritiva
- Niveis de Bloom variados
- bnccCodes preenchido com codigos validos
- bnccSummary: frase curta resumindo a habilidade testada
- Para objetivas: alternatives com {letter, text}[] e correctLetter
- Para descritivas: expectedAnswer e gradingCriteria
- Formato: array JSON de questoes

Responda APENAS com JSON array.`

  try {
    const { data } = await axios.post(`${GEMINI_URL}?key=${API_KEY}`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
    })
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error("Resposta vazia")
    const json = extractJson(text)
    const parsed: RawQuestion[] = JSON.parse(json)
    if (!Array.isArray(parsed)) throw new Error("Nao e array")
    return parsed
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes("Resposta vazia")) console.error(`  ERRO Gemini: ${msg.substring(0, 120)}`)
    return []
  }
}

async function main() {
  const jsonPath = path.join(__dirname, "curriculum_enrichment_4ano.json")
  if (!fs.existsSync(jsonPath)) {
    console.error("curriculum_enrichment_4ano.json nao encontrado!")
    process.exit(1)
  }
  
  const entries: EnrichmentEntry[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
  console.log(`Unidades: ${entries.length}`)

  const existing = await sql`SELECT COUNT(*) as c FROM question_bank WHERE grade_year = 4 AND source = 'seed_ia'`
  const existingCount = Number(existing[0].c)
  if (existingCount > 0) {
    console.log(`Ja existem ${existingCount} questoes seed_ia para 4o ano.`)
  }

  const existingRows = await sql`SELECT DISTINCT subject, bimester FROM question_bank WHERE grade_year = 4 AND source = 'seed_ia'`
  const alreadyDone = new Set(existingRows.map((r: any) => `${r.subject}-${r.bimester}`))
  console.log(`  ${alreadyDone.size} disciplinas-bimestres ja processadas`)

  let total = 0, errors = 0, skipped = 0

  for (const entry of entries) {
    const subject = entry.subjects[0]
    const bim = entry.bimester
    const key = `${subject}-${bim}`
    if (alreadyDone.has(key)) { skipped++; continue }

    console.log(`\n${subject} - ${entry.chapter.substring(0, 60)}...`)
    const questions = await generateQuestions(entry, 3)
    if (questions.length === 0) { console.log("  nenhuma"); continue }

    let inserted = 0
    for (const q of questions) {
      if (!q.statement || !q.type) { errors++; continue }
      try {
        const safeType = q.type === "objetiva" || q.type === "descritiva" ? q.type : "objetiva"
        const safeBloom = ["lembrar","compreender","aplicar","analisar","avaliar","criar"].includes(q.bloomLevel ?? "")
          ? q.bloomLevel : "compreender"
        const safeCodes = Array.isArray(q.bnccCodes) ? q.bnccCodes.filter(Boolean) : []
        const safeCorrect = typeof q.correctLetter === "string" && /^[A-D]$/i.test(q.correctLetter)
          ? q.correctLetter.toUpperCase() : null
        const safeAlternatives = Array.isArray(q.alternatives) && q.alternatives.length > 0
          ? JSON.stringify(q.alternatives) : null

        await sql`
          INSERT INTO question_bank 
          (segment, grade_year, subject, bimester, type, bloom_level,
           bncc_codes, statement, alternatives, correct_answer, source)
          VALUES (
            'anos-iniciais', ${entry.grade}, ${subject}, ${safe(bim, 1)},
            ${safeType}, ${safeBloom}, ${safeCodes}, ${q.statement},
            ${safeAlternatives}, ${safeCorrect}, 'seed_ia'
          )
        `
        inserted++; total++
      } catch (e) {
        errors++
      }
    }
    console.log(`  ${inserted}/${questions.length}`)
  }

  console.log(`\nFINALIZADO! ${total} questoes, ${errors} erros, ${skipped} puladas`)
  await sql.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
