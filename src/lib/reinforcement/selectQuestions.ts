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

export async function fetchCandidatesBySkill(area: string, skillCodes: string[], year?: number): Promise<Map<string, ReinforcementCandidate[]>> {
  if (!skillCodes.length) return new Map()

  const rows = await db.execute(sql`
    SELECT q.id, q.year, s.code AS skill_code, s.description AS skill_description, c.bloom_level
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
    ORDER BY q.year DESC, q.question_index ASC
  `)

  const bySkill = new Map<string, ReinforcementCandidate[]>()
  for (const code of skillCodes) bySkill.set(code, [])
  for (const raw of rows as unknown as Array<Record<string, unknown>>) {
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

  // Fila por habilidade com Bloom intercalado: agrupa por nível e alterna
  // entre os grupos, pra seleção "top N" não sair toda do mesmo nível.
  const queues = new Map<string, ReinforcementCandidate[]>()
  for (const [skill, candidates] of candidatesBySkill) {
    const byBloom = new Map<string, ReinforcementCandidate[]>()
    for (const c of candidates) {
      const key = c.bloomLevel ?? 'sem_bloom'
      if (!byBloom.has(key)) byBloom.set(key, [])
      byBloom.get(key)!.push(c)
    }
    const groups = [...byBloom.values()]
    const interleaved: ReinforcementCandidate[] = []
    for (let i = 0; interleaved.length < candidates.length; i++) {
      for (const group of groups) {
        if (group[i]) interleaved.push(group[i])
      }
    }
    queues.set(skill, interleaved)
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
}): Promise<{ selected: ReinforcementCandidate[]; perSkill: Record<string, number>; warnings: string[] }> {
  const bySkill = await fetchCandidatesBySkill(params.area, params.skillCodes, params.year)
  return distributeAcrossSkills(bySkill, params.count)
}
