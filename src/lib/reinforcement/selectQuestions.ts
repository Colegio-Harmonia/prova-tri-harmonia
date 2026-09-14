import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

// Seleção de questões do banco ENEM por habilidade INEP (Módulo 3, spec
// seção 3.4). Fonte: imported_questions + classificação oficial
// (enem_skill_id). Questões com imagem oficial também entram: o merge do
// banco preserva o arquivo do Drive para a revisão e os documentos.
// A distribuição entre habilidades é equilibrada e variada em Bloom;
// habilidade com poucas questões gera aviso, nunca invenção.

export type ReinforcementCandidate = {
  id: number
  year: number
  skillCode: string
  skillDescription: string | null
  bloomLevel: string | null
}

/** Embaralhamento Fisher–Yates: cada permutação tem a mesma probabilidade. */
function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export async function fetchCandidatesBySkill(
  area: string,
  skillCodes: string[],
  year?: number,
  competencyNumbers?: readonly number[] | null,
): Promise<Map<string, ReinforcementCandidate[]>> {
  if (!skillCodes.length) return new Map()

  const rows = await db.execute(sql`
    SELECT q.id, q.year, s.code AS skill_code, s.description AS skill_description,
      c.bloom_level, ec.number AS competency_number
    FROM imported_questions q
    JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
    JOIN enem_skills s ON s.id = c.enem_skill_id
    JOIN enem_competencies ec ON ec.id = s.competency_id
    JOIN enem_areas ea ON ea.id = ec.area_id
    WHERE ea.code = ${area}
      AND s.code IN (${sql.join(skillCodes.map((code) => sql`${code}`), sql`, `)})
      AND (q.language IS NULL OR q.language = '')
      ${year ? sql`AND q.year = ${year}` : sql``}
      AND (q.context IS NULL OR q.context NOT LIKE '%![%')
      AND (q.alternatives_introduction IS NULL OR q.alternatives_introduction NOT LIKE '%![%')
      AND (q.alternatives IS NULL OR q.alternatives::text NOT LIKE '%![%')
      AND (
        COALESCE(q.raw_json->>'visualDetected', 'false') <> 'true'
        OR COALESCE(jsonb_array_length(q.files), 0) > 0
      )
    ORDER BY random()
  `)

  const bySkill = new Map<string, ReinforcementCandidate[]>()
  for (const code of skillCodes) bySkill.set(code, [])
  for (const raw of rows as unknown as Array<Record<string, unknown>>) {
    const competencyNumber = Number(raw.competency_number)
    if (competencyNumbers?.length && !competencyNumbers.includes(competencyNumber)) continue
    const candidate: ReinforcementCandidate = {
      id: Number(raw.id),
      year: Number(raw.year),
      skillCode: String(raw.skill_code),
      skillDescription: raw.skill_description ? String(raw.skill_description) : null,
      bloomLevel: raw.bloom_level ? String(raw.bloom_level) : null,
    }
    bySkill.get(candidate.skillCode)?.push(candidate)
  }
  return bySkill
}

/**
 * Distribuição pura (testável sem banco): reparte `count` entre as
 * habilidades o mais igualmente possível, round-robin; dentro de cada
 * habilidade alterna os níveis de Bloom disponíveis pra variar a carga
 * cognitiva. Se uma habilidade não tem candidatas suficientes, a sobra é
 * redistribuída entre as demais; se o banco todo não cobre `count`,
 * devolve menos com aviso — nunca completa com questão de outra
 * habilidade não pedida.
 */
export function distributeAcrossSkills(
  candidatesBySkill: Map<string, ReinforcementCandidate[]>,
  count: number,
): { selected: ReinforcementCandidate[]; perSkill: Record<string, number>; warnings: string[] } {
  const skills = [...candidatesBySkill.keys()]
  const warnings: string[] = []

  // Sorteio estratificado por ano: cada ano elegível recebe a mesma chance
  // de abrir a fila, independentemente de quantos itens ele possui. Depois
  // os anos se alternam aleatoriamente. Assim o banco não fica preso aos
  // itens mais recentes nem aos anos com mais registros, mas pode reutilizar
  // qualquer questão em provas futuras — não há bloqueio histórico.
  const queues = new Map<string, ReinforcementCandidate[]>()
  for (const [skill, candidates] of candidatesBySkill) {
    const byYear = new Map<number, ReinforcementCandidate[]>()
    for (const c of candidates) {
      if (!byYear.has(c.year)) byYear.set(c.year, [])
      byYear.get(c.year)!.push(c)
    }
    const years = shuffle([...byYear.keys()])
    for (const year of years) byYear.set(year, shuffle(byYear.get(year)!))
    const randomized: ReinforcementCandidate[] = []
    let remaining = candidates.length
    // Mantém a variação de Bloom dentro da própria rodada de anos. A ordem
    // continua aleatória, mas não desperdiça três vagas seguidas no mesmo
    // nível quando o banco oferece alternativas diferentes.
    const bloomsInRound = new Set<string | null>()
    while (remaining > 0) {
      for (const year of years) {
        const yearQueue = byYear.get(year)!
        const variedIndex = yearQueue.findIndex((candidate) => !bloomsInRound.has(candidate.bloomLevel))
        const candidate = yearQueue.splice(variedIndex >= 0 ? variedIndex : 0, 1)[0]
        if (candidate) {
          randomized.push(candidate)
          bloomsInRound.add(candidate.bloomLevel)
          remaining--
        }
      }
      if (bloomsInRound.size >= new Set(candidates.map((candidate) => candidate.bloomLevel)).size) bloomsInRound.clear()
    }
    queues.set(skill, randomized)
  }

  const selected: ReinforcementCandidate[] = []
  const perSkill: Record<string, number> = Object.fromEntries(skills.map((s) => [s, 0]))

  // Round-robin entre habilidades até fechar `count` ou esgotar o banco.
  let progressed = true
  while (selected.length < count && progressed) {
    progressed = false
    for (const skill of skills) {
      if (selected.length >= count) break
      const queue = queues.get(skill)!
      const next = queue.shift()
      if (!next) continue
      selected.push(next)
      perSkill[skill]++
      progressed = true
    }
  }

  const targetPerSkill = Math.floor(count / Math.max(1, skills.length))
  for (const skill of skills) {
    const available = candidatesBySkill.get(skill)?.length ?? 0
    if (available === 0) {
      warnings.push(`${skill}: nenhuma questão elegível no banco com classificação oficial — habilidade ficou de fora.`)
    } else if (perSkill[skill] < targetPerSkill) {
      warnings.push(`${skill}: só ${available} questão(ões) elegível(is) no banco — as demais vagas foram redistribuídas entre as outras habilidades.`)
    }
  }
  if (selected.length < count) {
    warnings.push(`O banco só cobre ${selected.length} de ${count} questões pedidas pras habilidades selecionadas — a atividade sai com ${selected.length}.`)
  }

  return { selected, perSkill, warnings }
}

export async function selectReinforcementQuestions(params: {
  area: string
  skillCodes: string[]
  count: number
  year?: number
  competencyNumbers?: readonly number[] | null
}): Promise<{ selected: ReinforcementCandidate[]; perSkill: Record<string, number>; warnings: string[] }> {
  const bySkill = await fetchCandidatesBySkill(params.area, params.skillCodes, params.year, params.competencyNumbers)
  return distributeAcrossSkills(bySkill, params.count)
}
