/**
 * Mapeia a disciplina da escola (Ensino Médio) para a área macro do ENEM
 * (as 4 áreas que o banco de questões importadas usa: linguagens,
 * matematica, ciencias-natureza, ciencias-humanas). O ENEM não separa
 * Física/Química/Biologia nem História/Geografia/Filosofia/Sociologia —
 * agrupa tudo na área correspondente. Usado só pra filtrar o banco de
 * questões reais na tela de geração — não é o crosswalk fino BNCC
 * EM13→habilidade (isso é outra frente de trabalho, ver bnccSaebMap.ts).
 */
export const SUBJECT_TO_ENEM_AREA: Record<string, string> = {
  'Língua Portuguesa': 'linguagens',
  'Literatura': 'linguagens',
  'Inglês': 'linguagens',
  'Artes': 'linguagens',
  'Matemática': 'matematica',
  'Física': 'ciencias-natureza',
  'Química': 'ciencias-natureza',
  'Biologia': 'ciencias-natureza',
  'História': 'ciencias-humanas',
  'Geografia': 'ciencias-humanas',
  'Filosofia': 'ciencias-humanas',
  'Sociologia': 'ciencias-humanas',
}

// A área de Linguagens reúne Português, Literatura, Língua Estrangeira,
// Educação Física e Artes. No reforço por disciplina, porém, não podemos
// apresentar nem selecionar as competências de outro componente curricular.
// As demais áreas do ENEM ainda não têm esse recorte fino no banco, portanto
// retornam null e continuam usando todas as competências da própria área.
const SUBJECT_TO_ENEM_COMPETENCIES: Record<string, readonly number[]> = {
  'Língua Portuguesa': [1, 5, 6, 7, 8, 9],
  Literatura: [5, 6, 7],
  'Inglês': [2],
  Artes: [4],
}

export function getEnemCompetenciesForSubject(subject: string): readonly number[] | null {
  return SUBJECT_TO_ENEM_COMPETENCIES[subject] ?? null
}

function linguagensCompetencyForSkill(skillCode: string): number | null {
  const number = Number(skillCode.replace(/^H/i, ''))
  if (!Number.isInteger(number) || number < 1 || number > 30) return null
  if (number <= 4) return 1
  if (number <= 8) return 2
  if (number <= 11) return 3
  if (number <= 14) return 4
  if (number <= 17) return 5
  if (number <= 20) return 6
  if (number <= 24) return 7
  if (number <= 27) return 8
  return 9
}

export function isEnemSkillAllowedForSubject(subject: string, skillCode: string): boolean {
  const allowedCompetencies = getEnemCompetenciesForSubject(subject)
  if (!allowedCompetencies) return true
  const competency = linguagensCompetencyForSkill(skillCode)
  return competency !== null && allowedCompetencies.includes(competency)
}

export function getEnemAreaForSubject(subject: string): string | null {
  return SUBJECT_TO_ENEM_AREA[subject] ?? null
}
