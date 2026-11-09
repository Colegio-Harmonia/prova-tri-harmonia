import type { EnemSkillsParseResult, ParsedEnemSkill } from '@/types/exam'
import { getEnemSkillDescription, isValidEnemPair, type EnemAreaCode } from '@/config/enemMatrix'

// "C2:H5", "C2-H5", "C2 H5", "c2:h5", opcionalmente seguido da origem da
// questão do material entre parênteses: "C2:H5 (Unesp-2022)".
const ENEM_CODE_PATTERN = /\bC\s*(\d{1,2})\s*[:\-–/]?\s*H\s*(\d{1,2})\b(?:\s*\(([^)]*)\))?/gi

/**
 * Lê habilidades da Matriz do ENEM no formato Competência:Habilidade, como
 * vêm no planejamento do Ensino Médio (uma linha por questão do material):
 *
 *   C2:H5 (Unesp-2022)
 *   C2:H5 (Unesp-2022)
 *   C7:H24 (PUC Goiás-2020)
 *
 * Repetições são agregadas em `count` (peso do capítulo). Pares que não
 * existem na matriz da área (ex: C2:H14 em Linguagens) vão para `invalid`
 * — nunca são "corrigidos" por palpite. Sem área conhecida, aceita o par
 * como veio (não há como validar) e sem descrição.
 */
export function parseEnemSkills(raw: string | null | undefined, area: EnemAreaCode | null): EnemSkillsParseResult {
  const text = (raw ?? '').trim()
  if (!text) return { skills: [], invalid: [] }

  const byCode = new Map<string, ParsedEnemSkill>()
  const invalid: string[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(ENEM_CODE_PATTERN.source, ENEM_CODE_PATTERN.flags)

  while ((match = pattern.exec(text)) !== null) {
    const competency = Number(match[1])
    const skill = Number(match[2])
    const code = `C${competency}:H${skill}`
    const source = match[3]?.trim() || null

    if (area && !isValidEnemPair(area, competency, skill)) {
      if (!invalid.includes(code)) invalid.push(code)
      continue
    }

    const existing = byCode.get(code)
    if (existing) {
      existing.count += 1
      if (source && !existing.sources.includes(source)) existing.sources.push(source)
    } else {
      byCode.set(code, {
        code,
        competency,
        skill,
        count: 1,
        sources: source ? [source] : [],
        description: area ? getEnemSkillDescription(area, skill) : null,
      })
    }
  }

  // Mais frequente primeiro (é o que o capítulo mais trabalha); empate pela ordem C/H.
  const skills = [...byCode.values()].sort(
    (a, b) => b.count - a.count || a.competency - b.competency || a.skill - b.skill,
  )
  return { skills, invalid }
}

/** Extrai "C2:H5" de um valor livre (ex: saeb.value "C2:H5 — Associar..." ou "C2-H5"). */
export function extractEnemCode(value: string | null | undefined): { code: string; competency: number; skill: number } | null {
  if (!value) return null
  const match = new RegExp(ENEM_CODE_PATTERN.source, 'i').exec(value)
  if (!match) return null
  const competency = Number(match[1])
  const skill = Number(match[2])
  return { code: `C${competency}:H${skill}`, competency, skill }
}
