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

export function getEnemAreaForSubject(subject: string): string | null {
  return SUBJECT_TO_ENEM_AREA[subject] ?? null
}
