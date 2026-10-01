import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { decideReinforcementSelectionStrategy, reinforcementAllocationWeights, type ReinforcementSelectionDecision, type ReinforcementSelectionStrategy } from '@/lib/ai/reinforcementSelectionDecision'

// Seleção de questões do banco ENEM por habilidade INEP (Módulo 3, spec
// seção 3.4). Fonte: imported_questions + classificação oficial
// (enem_skill_id). Questões com imagem oficial também entram: o merge do
// banco preserva o arquivo do Drive para a revisão e os documentos.
// A distribuição entre habilidades e a preferência de Bloom são orientadas
// pelo Jev e executadas por regras locais; habilidade com poucas questões
// gera aviso, nunca invenção.

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
  options: { allocationWeights?: Record<string, number>; bloomProfile?: ReinforcementSelectionStrategy['bloomProfile']; yearMix?: ReinforcementSelectionStrategy['yearMix'] } = {},
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
    const years = options.yearMix === 'recente_variado' ? [...byYear.keys()].sort((a, b) => b - a) : shuffle([...byYear.keys()])
    for (const year of years) byYear.set(year, shuffle(byYear.get(year)!))
    const yearInterleaved: ReinforcementCandidate[] = []
    let remaining = candidates.length
    while (remaining > 0) {
      for (const year of years) {
        const candidate = byYear.get(year)!.shift()
        if (candidate) {
          yearInterleaved.push(candidate)
          remaining--
        }
      }
    }
    // Variação de Bloom: a cada vaga, pega o próximo item (na ordem sorteada
    // por ano) cujo nível ainda não apareceu na rodada; a rodada recomeça
    // quando todos os níveis disponíveis já saíram. Antes a busca olhava só a
    // fila de UM ano por vez e repetia o nível quando aquele ano não tinha
    // alternativa, mesmo havendo outros níveis no banco (teste instável ~17%).
    const distinctBlooms = new Set(candidates.map((candidate) => candidate.bloomLevel)).size
    const randomized: ReinforcementCandidate[] = []
    const bloomsInRound = new Set<string | null>()
    while (yearInterleaved.length > 0) {
      const bloomRank = (candidate: ReinforcementCandidate) => {
        const level = (candidate.bloomLevel ?? '').toLocaleLowerCase('pt-BR')
        const groups: Record<NonNullable<typeof options.bloomProfile>, string[][]> = {
          fundamentos_aplicacao: [['lembr', 'conhec', 'compreend', 'entend'], ['aplic'], ['analis', 'avali', 'cri']],
          aplicacao_contextual: [['aplic'], ['compreend', 'entend', 'analis'], ['lembr', 'conhec', 'avali', 'cri']],
          analise_transferencia: [['analis', 'avali', 'cri'], ['aplic'], ['compreend', 'entend', 'lembr', 'conhec']],
        }
        const groupsForProfile = groups[options.bloomProfile ?? 'fundamentos_aplicacao']
        const rank = groupsForProfile.findIndex((keywords) => keywords.some((keyword) => level.includes(keyword)))
        return rank < 0 ? groupsForProfile.length : rank
      }
      const eligibleIndexes = yearInterleaved.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(({ candidate }) => !bloomsInRound.has(candidate.bloomLevel))
      let index = eligibleIndexes.sort((a, b) => bloomRank(a.candidate) - bloomRank(b.candidate))[0]?.candidateIndex ?? -1
      if (index < 0) { bloomsInRound.clear(); index = 0 }
      const [candidate] = yearInterleaved.splice(index, 1)
      randomized.push(candidate)
      bloomsInRound.add(candidate.bloomLevel)
      if (bloomsInRound.size >= distinctBlooms) bloomsInRound.clear()
    }
    queues.set(skill, randomized)
  }

  const selected: ReinforcementCandidate[] = []
  const weights = Object.fromEntries(skills.map((skill) => [skill, Math.max(1, Math.min(3, Math.round(options.allocationWeights?.[skill] ?? 1)))]))
  const maxWeight = Math.max(1, ...Object.values(weights))
  const skillSchedule = Array.from({ length: maxWeight }, (_, round) => skills.filter((skill) => weights[skill] > round)).flat()
  const perSkill: Record<string, number> = Object.fromEntries(skills.map((s) => [s, 0]))

  // Round-robin entre habilidades até fechar `count` ou esgotar o banco.
  let progressed = true
  while (selected.length < count && progressed) {
    progressed = false
    for (const skill of skillSchedule) {
      if (selected.length >= count) break
      const queue = queues.get(skill)!
      const next = queue.shift()
      if (!next) continue
      selected.push(next)
      perSkill[skill]++
      progressed = true
    }
  }

  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  for (const skill of skills) {
    const targetPerSkill = Math.floor(count * weights[skill] / Math.max(1, totalWeight))
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
  gradeYear: number
  subject: string
  skillCodes: string[]
  count: number
  year?: number
  competencyNumbers?: readonly number[] | null
}): Promise<{ selected: ReinforcementCandidate[]; perSkill: Record<string, number>; warnings: string[]; decision: ReinforcementSelectionDecision }> {
  const bySkill = await fetchCandidatesBySkill(params.area, params.skillCodes, params.year, params.competencyNumbers)
  const decisionSkills = params.skillCodes.map((code) => {
    const candidates = bySkill.get(code) ?? []
    return {
      code,
      description: candidates.find((candidate) => candidate.skillDescription)?.skillDescription ?? null,
      candidateCount: candidates.length,
      bloomLevels: [...new Set(candidates.map((candidate) => candidate.bloomLevel).filter((level): level is string => Boolean(level)))],
    }
  })
  const decision = await decideReinforcementSelectionStrategy({
    gradeYear: params.gradeYear,
    subject: params.subject,
    area: params.area,
    questionCount: params.count,
    requestedYear: params.year ?? null,
    skills: decisionSkills,
  })
  const distributed = distributeAcrossSkills(bySkill, params.count, {
    allocationWeights: reinforcementAllocationWeights(decision.strategy, decisionSkills),
    bloomProfile: decision.strategy.bloomProfile,
    yearMix: params.year ? 'amplo' : decision.strategy.yearMix,
  })
  return { ...distributed, decision }
}
