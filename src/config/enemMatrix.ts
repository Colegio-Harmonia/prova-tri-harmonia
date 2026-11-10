/**
 * Matriz de Referência do ENEM — fronteiras Competência × Habilidade por
 * área (H1-H30 de cada área), usadas para validar códigos "C2:H5" vindos
 * do planejamento do Ensino Médio (coluna "Habilidades ENEM" da planilha).
 *
 * Os textos de Linguagens seguem a Matriz de Referência oficial do INEP —
 * repetidos aqui para o parser/prompt funcionarem sem ida ao banco. Atenção:
 * `scripts/setup-enem-schema.ts` semeou H1 com o texto da H4 (erro do seed);
 * aqui está o texto oficial de H1. As demais áreas só têm as fronteiras (o
 * suficiente para validar o par C:H); o texto oficial delas continua
 * vindo do banco quando necessário.
 */

export type EnemAreaCode = 'linguagens' | 'matematica' | 'ciencias-natureza' | 'ciencias-humanas'

/** [competência, primeira H, última H] */
type CompetencyRange = readonly [number, number, number]

const COMPETENCY_RANGES: Record<EnemAreaCode, readonly CompetencyRange[]> = {
  linguagens: [
    [1, 1, 4], [2, 5, 8], [3, 9, 11], [4, 12, 14], [5, 15, 17],
    [6, 18, 20], [7, 21, 24], [8, 25, 27], [9, 28, 30],
  ],
  matematica: [
    [1, 1, 5], [2, 6, 9], [3, 10, 14], [4, 15, 18], [5, 19, 23], [6, 24, 26], [7, 27, 30],
  ],
  'ciencias-natureza': [
    [1, 1, 4], [2, 5, 7], [3, 8, 12], [4, 13, 16], [5, 17, 19], [6, 20, 23], [7, 24, 27], [8, 28, 30],
  ],
  'ciencias-humanas': [
    [1, 1, 5], [2, 6, 10], [3, 11, 15], [4, 16, 20], [5, 21, 25], [6, 26, 30],
  ],
}

const LINGUAGENS_SKILLS: Record<number, string> = {
  1: 'Identificar as diferentes linguagens e seus recursos expressivos como elementos de caracterização dos sistemas de comunicação.',
  2: 'Recorrer aos conhecimentos sobre as linguagens dos sistemas de comunicação e informação para resolver problemas.',
  3: 'Relacionar informações geradas nos sistemas de comunicação e informação, considerando a função social desses sistemas.',
  4: 'Reconhecer posições críticas aos usos sociais que são feitos das linguagens e aos sistemas de comunicação e informação.',
  5: 'Associar vocábulos e expressões de um texto em Língua Estrangeira Moderna ao seu tema.',
  6: 'Utilizar conhecimentos da Língua Estrangeira Moderna e de seus mecanismos como meio de ampliar possibilidades de acesso a informações, tecnologias e culturas.',
  7: 'Relacionar um texto em LEM, as estruturas linguísticas, sua função e seu uso social.',
  8: 'Reconhecer a importância da produção cultural em Língua Estrangeira Moderna como representação da diversidade cultural e linguística.',
  9: 'Reconhecer as manifestações corporais de movimento como originárias de necessidades cotidianas de um grupo social.',
  10: 'Reconhecer a necessidade de transformação de hábitos corporais em função das necessidades cinestésicas.',
  11: 'Reconhecer a linguagem corporal como meio de interação social, considerando os limites de desempenho e as alternativas de adaptação para diferentes indivíduos.',
  12: 'Reconhecer diferentes funções da arte, do trabalho da produção dos artistas em seus meios culturais.',
  13: 'Analisar as diversas produções artísticas como meio de explicar diferentes culturas, padrões estéticos e de comportamento.',
  14: 'Reconhecer o valor da diversidade artística e das inter-relações de elementos que se apresentam nas manifestações de vários grupos sociais e étnicos.',
  15: 'Estabelecer relações entre o texto literário e o momento de sua produção, situando aspectos do contexto histórico, social e político.',
  16: 'Relacionar informações sobre concepções artísticas e procedimentos de construção do texto literário.',
  17: 'Reconhecer a presença de valores sociais e humanos atualizáveis no patrimônio literário nacional.',
  18: 'Identificar os elementos que concorrem para a progressão temática e para a organização e estruturação de textos de diferentes gêneros e tipos.',
  19: 'Analisar a função da linguagem predominante nos textos em situações comunicativas específicas.',
  20: 'Reconhecer a importância do patrimônio linguístico para a preservação da memória e da identidade nacional.',
  21: 'Reconhecer em textos de diferentes gêneros, recursos verbais e não verbais utilizados com a finalidade de criar e mudar comportamentos e hábitos.',
  22: 'Relacionar, em diferentes textos, opiniões, temas, assuntos e recursos linguísticos.',
  23: 'Inferir em um texto a ideologia ou os sentidos propostos, a partir de análise dos procedimentos argumentativos utilizados.',
  24: 'Reconhecer no texto estratégias argumentativas empregadas para o convencimento do público, tais como a intimidação, sedução, comoção, chantagem, entre outras.',
  25: 'Identificar, em textos de diferentes gêneros, as marcas linguísticas que singularizam as variedades linguísticas sociais, regionais e de registro.',
  26: 'Relacionar as variedades linguísticas a situações específicas de uso social e de região.',
  27: 'Reconhecer os usos da norma-padrão da língua portuguesa nas diferentes situações de comunicação.',
  28: 'Reconhecer a função e o impacto social das diferentes tecnologias da comunicação e da informação.',
  29: 'Identificar pela análise de suas linguagens, as tecnologias da comunicação e da informação.',
  30: 'Relacionar as tecnologias da comunicação e da informação ao desenvolvimento das sociedades e ao conhecimento que elas produzem.',
}

export function isEnemAreaCode(value: string | null | undefined): value is EnemAreaCode {
  return value === 'linguagens' || value === 'matematica' || value === 'ciencias-natureza' || value === 'ciencias-humanas'
}

/** Competência oficial a que a habilidade pertence naquela área, ou null se H fora de 1-30. */
export function getEnemCompetencyForSkill(area: EnemAreaCode, skill: number): number | null {
  const range = COMPETENCY_RANGES[area].find(([, first, last]) => skill >= first && skill <= last)
  return range ? range[0] : null
}

export function isValidEnemPair(area: EnemAreaCode, competency: number, skill: number): boolean {
  return getEnemCompetencyForSkill(area, skill) === competency
}

/** Texto oficial da habilidade quando disponível estaticamente (hoje só Linguagens). */
export function getEnemSkillDescription(area: EnemAreaCode, skill: number): string | null {
  return area === 'linguagens' ? LINGUAGENS_SKILLS[skill] ?? null : null
}
