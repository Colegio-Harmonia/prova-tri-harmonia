/**
 * Matriz de Referência do ENEM — texto oficial completo das 4 áreas
 * (competências de área + H1-H30), para o Assistente de Planejamento.
 *
 * Fonte: INEP, "Matriz de Referência ENEM"
 * (https://download.inep.gov.br/download/enem/matriz_referencia.pdf),
 * transcrita em 12/11/2026. Matemática, Ciências da Natureza e Ciências
 * Humanas estão aqui; Linguagens reaproveita os textos já transcritos em
 * `enemMatrix.ts` (mesma fonte).
 *
 * ⚠️ NÃO usar `enem_skills` (banco) como fonte de texto oficial: o seed de
 * `scripts/setup-enem-schema.ts` diverge do INEP em várias habilidades
 * (ex.: Natureza H7/H14/H15/H16, Humanas H6-H8/H12/H14/H17/H18/H20/H26-H28;
 * Humanas H28 e H29 estão duplicadas). Corrigir o seed é trabalho separado.
 */
import { getEnemCompetencyForSkill, getEnemSkillDescription, type EnemAreaCode } from './enemMatrix'

export const ENEM_AREA_LABELS: Record<EnemAreaCode, string> = {
  linguagens: 'Linguagens, Códigos e suas Tecnologias',
  matematica: 'Matemática e suas Tecnologias',
  'ciencias-natureza': 'Ciências da Natureza e suas Tecnologias',
  'ciencias-humanas': 'Ciências Humanas e suas Tecnologias',
}

const COMPETENCIES: Record<EnemAreaCode, Record<number, string>> = {
  linguagens: {
    1: 'Aplicar as tecnologias da comunicação e da informação na escola, no trabalho e em outros contextos relevantes para sua vida.',
    2: 'Conhecer e usar língua(s) estrangeira(s) moderna(s) como instrumento de acesso a informações e a outras culturas e grupos sociais.',
    3: 'Compreender e usar a linguagem corporal como relevante para a própria vida, integradora social e formadora da identidade.',
    4: 'Compreender a arte como saber cultural e estético gerador de significação e integrador da organização do mundo e da própria identidade.',
    5: 'Analisar, interpretar e aplicar recursos expressivos das linguagens, relacionando textos com seus contextos, mediante a natureza, função, organização, estrutura das manifestações, de acordo com as condições de produção e recepção.',
    6: 'Compreender e usar os sistemas simbólicos das diferentes linguagens como meios de organização cognitiva da realidade pela constituição de significados, expressão, comunicação e informação.',
    7: 'Confrontar opiniões e pontos de vista sobre as diferentes linguagens e suas manifestações específicas.',
    8: 'Compreender e usar a língua portuguesa como língua materna, geradora de significação e integradora da organização do mundo e da própria identidade.',
    9: 'Entender os princípios, a natureza, a função e o impacto das tecnologias da comunicação e da informação na sua vida pessoal e social, no desenvolvimento do conhecimento, associando-o aos conhecimentos científicos, às linguagens que lhes dão suporte, às demais tecnologias, aos processos de produção e aos problemas que se propõem solucionar.',
  },
  matematica: {
    1: 'Construir significados para os números naturais, inteiros, racionais e reais.',
    2: 'Utilizar o conhecimento geométrico para realizar a leitura e a representação da realidade e agir sobre ela.',
    3: 'Construir noções de grandezas e medidas para a compreensão da realidade e a solução de problemas do cotidiano.',
    4: 'Construir noções de variação de grandezas para a compreensão da realidade e a solução de problemas do cotidiano.',
    5: 'Modelar e resolver problemas que envolvem variáveis socioeconômicas ou técnico-científicas, usando representações algébricas.',
    6: 'Interpretar informações de natureza científica e social obtidas da leitura de gráficos e tabelas, realizando previsão de tendência, extrapolação, interpolação e interpretação.',
    7: 'Compreender o caráter aleatório e não-determinístico dos fenômenos naturais e sociais e utilizar instrumentos adequados para medidas, determinação de amostras e cálculos de probabilidade para interpretar informações de variáveis apresentadas em uma distribuição estatística.',
  },
  'ciencias-natureza': {
    1: 'Compreender as ciências naturais e as tecnologias a elas associadas como construções humanas, percebendo seus papéis nos processos de produção e no desenvolvimento econômico e social da humanidade.',
    2: 'Identificar a presença e aplicar as tecnologias associadas às ciências naturais em diferentes contextos.',
    3: 'Associar intervenções que resultam em degradação ou conservação ambiental a processos produtivos e sociais e a instrumentos ou ações científico-tecnológicos.',
    4: 'Compreender interações entre organismos e ambiente, em particular aquelas relacionadas à saúde humana, relacionando conhecimentos científicos, aspectos culturais e características individuais.',
    5: 'Entender métodos e procedimentos próprios das ciências naturais e aplicá-los em diferentes contextos.',
    6: 'Apropriar-se de conhecimentos da física para, em situações problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.',
    7: 'Apropriar-se de conhecimentos da química para, em situações problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.',
    8: 'Apropriar-se de conhecimentos da biologia para, em situações problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.',
  },
  'ciencias-humanas': {
    1: 'Compreender os elementos culturais que constituem as identidades.',
    2: 'Compreender as transformações dos espaços geográficos como produto das relações socioeconômicas e culturais de poder.',
    3: 'Compreender a produção e o papel histórico das instituições sociais, políticas e econômicas, associando-as aos diferentes grupos, conflitos e movimentos sociais.',
    4: 'Entender as transformações técnicas e tecnológicas e seu impacto nos processos de produção, no desenvolvimento do conhecimento e na vida social.',
    5: 'Utilizar os conhecimentos históricos para compreender e valorizar os fundamentos da cidadania e da democracia, favorecendo uma atuação consciente do indivíduo na sociedade.',
    6: 'Compreender a sociedade e a natureza, reconhecendo suas interações no espaço em diferentes contextos históricos e geográficos.',
  },
}

const SKILLS: Record<Exclude<EnemAreaCode, 'linguagens'>, Record<number, string>> = {
  matematica: {
    1: 'Reconhecer, no contexto social, diferentes significados e representações dos números e operações - naturais, inteiros, racionais ou reais.',
    2: 'Identificar padrões numéricos ou princípios de contagem.',
    3: 'Resolver situação-problema envolvendo conhecimentos numéricos.',
    4: 'Avaliar a razoabilidade de um resultado numérico na construção de argumentos sobre afirmações quantitativas.',
    5: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos numéricos.',
    6: 'Interpretar a localização e a movimentação de pessoas/objetos no espaço tridimensional e sua representação no espaço bidimensional.',
    7: 'Identificar características de figuras planas ou espaciais.',
    8: 'Resolver situação-problema que envolva conhecimentos geométricos de espaço e forma.',
    9: 'Utilizar conhecimentos geométricos de espaço e forma na seleção de argumentos propostos como solução de problemas do cotidiano.',
    10: 'Identificar relações entre grandezas e unidades de medida.',
    11: 'Utilizar a noção de escalas na leitura de representação de situação do cotidiano.',
    12: 'Resolver situação-problema que envolva medidas de grandezas.',
    13: 'Avaliar o resultado de uma medição na construção de um argumento consistente.',
    14: 'Avaliar proposta de intervenção na realidade utilizando conhecimentos geométricos relacionados a grandezas e medidas.',
    15: 'Identificar a relação de dependência entre grandezas.',
    16: 'Resolver situação-problema envolvendo a variação de grandezas, direta ou inversamente proporcionais.',
    17: 'Analisar informações envolvendo a variação de grandezas como recurso para a construção de argumentação.',
    18: 'Avaliar propostas de intervenção na realidade envolvendo variação de grandezas.',
    19: 'Identificar representações algébricas que expressem a relação entre grandezas.',
    20: 'Interpretar gráfico cartesiano que represente relações entre grandezas.',
    21: 'Resolver situação-problema cuja modelagem envolva conhecimentos algébricos.',
    22: 'Utilizar conhecimentos algébricos/geométricos como recurso para a construção de argumentação.',
    23: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos algébricos.',
    24: 'Utilizar informações expressas em gráficos ou tabelas para fazer inferências.',
    25: 'Resolver problema com dados apresentados em tabelas ou gráficos.',
    26: 'Analisar informações expressas em gráficos ou tabelas como recurso para a construção de argumentos.',
    27: 'Calcular medidas de tendência central ou de dispersão de um conjunto de dados expressos em uma tabela de frequências de dados agrupados (não em classes) ou em gráficos.',
    28: 'Resolver situação-problema que envolva conhecimentos de estatística e probabilidade.',
    29: 'Utilizar conhecimentos de estatística e probabilidade como recurso para a construção de argumentação.',
    30: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos de estatística e probabilidade.',
  },
  'ciencias-natureza': {
    1: 'Reconhecer características ou propriedades de fenômenos ondulatórios ou oscilatórios, relacionando-os a seus usos em diferentes contextos.',
    2: 'Associar a solução de problemas de comunicação, transporte, saúde ou outro, com o correspondente desenvolvimento científico e tecnológico.',
    3: 'Confrontar interpretações científicas com interpretações baseadas no senso comum, ao longo do tempo ou em diferentes culturas.',
    4: 'Avaliar propostas de intervenção no ambiente, considerando a qualidade da vida humana ou medidas de conservação, recuperação ou utilização sustentável da biodiversidade.',
    5: 'Dimensionar circuitos ou dispositivos elétricos de uso cotidiano.',
    6: 'Relacionar informações para compreender manuais de instalação ou utilização de aparelhos, ou sistemas tecnológicos de uso comum.',
    7: 'Selecionar testes de controle, parâmetros ou critérios para a comparação de materiais e produtos, tendo em vista a defesa do consumidor, a saúde do trabalhador ou a qualidade de vida.',
    8: 'Identificar etapas em processos de obtenção, transformação, utilização ou reciclagem de recursos naturais, energéticos ou matérias-primas, considerando processos biológicos, químicos ou físicos neles envolvidos.',
    9: 'Compreender a importância dos ciclos biogeoquímicos ou do fluxo energia para a vida, ou da ação de agentes ou fenômenos que podem causar alterações nesses processos.',
    10: 'Analisar perturbações ambientais, identificando fontes, transporte e(ou) destino dos poluentes ou prevendo efeitos em sistemas naturais, produtivos ou sociais.',
    11: 'Reconhecer benefícios, limitações e aspectos éticos da biotecnologia, considerando estruturas e processos biológicos envolvidos em produtos biotecnológicos.',
    12: 'Avaliar impactos em ambientes naturais decorrentes de atividades sociais ou econômicas, considerando interesses contraditórios.',
    13: 'Reconhecer mecanismos de transmissão da vida, prevendo ou explicando a manifestação de características dos seres vivos.',
    14: 'Identificar padrões em fenômenos e processos vitais dos organismos, como manutenção do equilíbrio interno, defesa, relações com o ambiente, sexualidade, entre outros.',
    15: 'Interpretar modelos e experimentos para explicar fenômenos ou processos biológicos em qualquer nível de organização dos sistemas biológicos.',
    16: 'Compreender o papel da evolução na produção de padrões, processos biológicos ou na organização taxonômica dos seres vivos.',
    17: 'Relacionar informações apresentadas em diferentes formas de linguagem e representação usadas nas ciências físicas, químicas ou biológicas, como texto discursivo, gráficos, tabelas, relações matemáticas ou linguagem simbólica.',
    18: 'Relacionar propriedades físicas, químicas ou biológicas de produtos, sistemas ou procedimentos tecnológicos às finalidades a que se destinam.',
    19: 'Avaliar métodos, processos ou procedimentos das ciências naturais que contribuam para diagnosticar ou solucionar problemas de ordem social, econômica ou ambiental.',
    20: 'Caracterizar causas ou efeitos dos movimentos de partículas, substâncias, objetos ou corpos celestes.',
    21: 'Utilizar leis físicas e (ou) químicas para interpretar processos naturais ou tecnológicos inseridos no contexto da termodinâmica e(ou) do eletromagnetismo.',
    22: 'Compreender fenômenos decorrentes da interação entre a radiação e a matéria em suas manifestações em processos naturais ou tecnológicos, ou em suas implicações biológicas, sociais, econômicas ou ambientais.',
    23: 'Avaliar possibilidades de geração, uso ou transformação de energia em ambientes específicos, considerando implicações éticas, ambientais, sociais e/ou econômicas.',
    24: 'Utilizar códigos e nomenclatura da química para caracterizar materiais, substâncias ou transformações químicas.',
    25: 'Caracterizar materiais ou substâncias, identificando etapas, rendimentos ou implicações biológicas, sociais, econômicas ou ambientais de sua obtenção ou produção.',
    26: 'Avaliar implicações sociais, ambientais e/ou econômicas na produção ou no consumo de recursos energéticos ou minerais, identificando transformações químicas ou de energia envolvidas nesses processos.',
    27: 'Avaliar propostas de intervenção no meio ambiente aplicando conhecimentos químicos, observando riscos ou benefícios.',
    28: 'Associar características adaptativas dos organismos com seu modo de vida ou com seus limites de distribuição em diferentes ambientes, em especial em ambientes brasileiros.',
    29: 'Interpretar experimentos ou técnicas que utilizam seres vivos, analisando implicações para o ambiente, a saúde, a produção de alimentos, matérias primas ou produtos industriais.',
    30: 'Avaliar propostas de alcance individual ou coletivo, identificando aquelas que visam à preservação e a implementação da saúde individual, coletiva ou do ambiente.',
  },
  'ciencias-humanas': {
    1: 'Interpretar historicamente e/ou geograficamente fontes documentais acerca de aspectos da cultura.',
    2: 'Analisar a produção da memória pelas sociedades humanas.',
    3: 'Associar as manifestações culturais do presente aos seus processos históricos.',
    4: 'Comparar pontos de vista expressos em diferentes fontes sobre determinado aspecto da cultura.',
    5: 'Identificar as manifestações ou representações da diversidade do patrimônio cultural e artístico em diferentes sociedades.',
    6: 'Interpretar diferentes representações gráficas e cartográficas dos espaços geográficos.',
    7: 'Identificar os significados histórico-geográficos das relações de poder entre as nações.',
    8: 'Analisar a ação dos estados nacionais no que se refere à dinâmica dos fluxos populacionais e no enfrentamento de problemas de ordem econômico-social.',
    9: 'Comparar o significado histórico-geográfico das organizações políticas e socioeconômicas em escala local, regional ou mundial.',
    10: 'Reconhecer a dinâmica da organização dos movimentos sociais e a importância da participação da coletividade na transformação da realidade histórico-geográfica.',
    11: 'Identificar registros de práticas de grupos sociais no tempo e no espaço.',
    12: 'Analisar o papel da justiça como instituição na organização das sociedades.',
    13: 'Analisar a atuação dos movimentos sociais que contribuíram para mudanças ou rupturas em processos de disputa pelo poder.',
    14: 'Comparar diferentes pontos de vista, presentes em textos analíticos e interpretativos, sobre situação ou fatos de natureza histórico-geográfica acerca das instituições sociais, políticas e econômicas.',
    15: 'Avaliar criticamente conflitos culturais, sociais, políticos, econômicos ou ambientais ao longo da história.',
    16: 'Identificar registros sobre o papel das técnicas e tecnologias na organização do trabalho e/ou da vida social.',
    17: 'Analisar fatores que explicam o impacto das novas tecnologias no processo de territorialização da produção.',
    18: 'Analisar diferentes processos de produção ou circulação de riquezas e suas implicações sócio-espaciais.',
    19: 'Reconhecer as transformações técnicas e tecnológicas que determinam as várias formas de uso e apropriação dos espaços rural e urbano.',
    20: 'Selecionar argumentos favoráveis ou contrários às modificações impostas pelas novas tecnologias à vida social e ao mundo do trabalho.',
    21: 'Identificar o papel dos meios de comunicação na construção da vida social.',
    22: 'Analisar as lutas sociais e conquistas obtidas no que se refere às mudanças nas legislações ou nas políticas públicas.',
    23: 'Analisar a importância dos valores éticos na estruturação política das sociedades.',
    24: 'Relacionar cidadania e democracia na organização das sociedades.',
    25: 'Identificar estratégias que promovam formas de inclusão social.',
    26: 'Identificar em fontes diversas o processo de ocupação dos meios físicos e as relações da vida humana com a paisagem.',
    27: 'Analisar de maneira crítica as interações da sociedade com o meio físico, levando em consideração aspectos históricos e(ou) geográficos.',
    28: 'Relacionar o uso das tecnologias com os impactos sócio-ambientais em diferentes contextos histórico-geográficos.',
    29: 'Reconhecer a função dos recursos naturais na produção do espaço geográfico, relacionando-os com as mudanças provocadas pelas ações humanas.',
    30: 'Avaliar as relações entre preservação e degradação da vida no planeta nas diferentes escalas.',
  },
}

export type OfficialEnemSkill = {
  /** Forma canônica usada na planilha, ex: "C2:H5" */
  code: string
  competency: number
  skill: number
  description: string
}

/** Texto oficial da habilidade (as 4 áreas), ou null se H fora de 1-30. */
export function getOfficialEnemSkillText(area: EnemAreaCode, skill: number): string | null {
  if (area === 'linguagens') return getEnemSkillDescription(area, skill)
  return SKILLS[area][skill] ?? null
}

export function getOfficialEnemCompetencyText(area: EnemAreaCode, competency: number): string | null {
  return COMPETENCIES[area][competency] ?? null
}

/** As 30 habilidades oficiais da área, em ordem. */
export function listOfficialEnemSkills(area: EnemAreaCode): OfficialEnemSkill[] {
  const skills: OfficialEnemSkill[] = []
  for (let skill = 1; skill <= 30; skill++) {
    const competency = getEnemCompetencyForSkill(area, skill)
    const description = getOfficialEnemSkillText(area, skill)
    if (competency === null || !description) continue
    skills.push({ code: `C${competency}:H${skill}`, competency, skill, description })
  }
  return skills
}
