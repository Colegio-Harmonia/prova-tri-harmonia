#!/usr/bin/env tsx
/**
 * Cria as tabelas da Matriz de Referência do ENEM e sementeia os dados.
 *
 * Uso:
 *   DATABASE_URL="..." tsx scripts/setup-enem-schema.ts
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a variável de ambiente antes de rodar este script.')
}

async function main() {
  console.log('📦 Configurando schema ENEM...')
  
  const sql = postgres(DATABASE_URL, { ssl: false, connect_timeout: 10 })
  
  try {
    await sql`SELECT 1`
    console.log('✅ Conectado ao banco.\n')

    // ── 1. Criar tabelas ──────────────────────────────────────────
    console.log('📦 Criando tabelas...')

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS enem_areas (
        id SERIAL PRIMARY KEY,
        code VARCHAR(16) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        "order" SMALLINT NOT NULL
      )
    `)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS enem_competencies (
        id SERIAL PRIMARY KEY,
        area_id INTEGER NOT NULL REFERENCES enem_areas(id),
        number SMALLINT NOT NULL,
        description TEXT NOT NULL
      )
    `)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS enem_skills (
        id SERIAL PRIMARY KEY,
        competency_id INTEGER NOT NULL REFERENCES enem_competencies(id),
        code VARCHAR(8) NOT NULL,
        description TEXT NOT NULL
      )
    `)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS enem_cognitive_axes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(4) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL
      )
    `)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS imported_question_classifications (
        id SERIAL PRIMARY KEY,
        question_id INTEGER NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'enem',
        bloom_level VARCHAR(16),
        bloom_level_source VARCHAR(16) DEFAULT 'pending',
        enem_area_id INTEGER REFERENCES enem_areas(id),
        enem_competency_id INTEGER REFERENCES enem_competencies(id),
        enem_skill_id INTEGER REFERENCES enem_skills(id),
        enem_cognitive_axis_id INTEGER REFERENCES enem_cognitive_axes(id),
        enem_classification_source VARCHAR(16) DEFAULT 'pending',
        classified_at TIMESTAMP,
        classified_by INTEGER,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)

    // Indexes
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_classifications_question ON imported_question_classifications (question_id)`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_classifications_bloom ON imported_question_classifications (bloom_level)`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_classifications_enem_area ON imported_question_classifications (enem_area_id)`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_classifications_enem_skill ON imported_question_classifications (enem_skill_id)`)

    console.log('✅ Tabelas criadas.\n')

    // ── 2. Inserir Eixos Cognitivos ───────────────────────────────
    console.log('📚 Inserindo Eixos Cognitivos...')
    const axes = [
      { code: 'DL', name: 'Dominar linguagens', description: 'Dominar a norma culta da língua portuguesa e fazer uso das linguagens matemática, artística e científica.' },
      { code: 'CF', name: 'Compreender fenômenos', description: 'Construir e aplicar conceitos das várias áreas do conhecimento para a compreensão de fenômenos naturais, de processos histórico-geográficos, da produção tecnológica e das manifestações artísticas.' },
      { code: 'SP', name: 'Enfrentar situações-problema', description: 'Selecionar, organizar, relacionar, interpretar dados e informações representados de diferentes formas, para tomar decisões e enfrentar situações-problema.' },
      { code: 'CA', name: 'Construir argumentação', description: 'Relacionar informações, representadas em diferentes formas, e conhecimentos disponíveis em situações concretas, para construir argumentação consistente.' },
      { code: 'EP', name: 'Elaborar propostas', description: 'Recorrer aos conhecimentos desenvolvidos na escola para elaboração de propostas de intervenção solidária na realidade, respeitando os valores humanos e considerando a diversidade sociocultural.' },
    ]
    for (const ax of axes) {
      await sql`
        INSERT INTO enem_cognitive_axes (code, name, description)
        VALUES (${ax.code}, ${ax.name}, ${ax.description})
        ON CONFLICT (code) DO NOTHING
      `
    }
    console.log('✅ 5 eixos cognitivos inseridos.\n')

    // ── 3. Inserir Áreas ──────────────────────────────────────────
    console.log('📚 Inserindo Áreas de Conhecimento...')

    // Linguagens
    const [areaLinguagens] = await sql`
      INSERT INTO enem_areas (code, name, "order") 
      VALUES ('linguagens', 'Linguagens, Códigos e suas Tecnologias', 1)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `

    const [areaMatematica] = await sql`
      INSERT INTO enem_areas (code, name, "order") 
      VALUES ('matematica', 'Matemática e suas Tecnologias', 2)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `

    const [areaNatureza] = await sql`
      INSERT INTO enem_areas (code, name, "order") 
      VALUES ('ciencias-natureza', 'Ciências da Natureza e suas Tecnologias', 3)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `

    const [areaHumanas] = await sql`
      INSERT INTO enem_areas (code, name, "order") 
      VALUES ('ciencias-humanas', 'Ciências Humanas e suas Tecnologias', 4)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `

    console.log('✅ 4 áreas inseridas.\n')

    // ── 4. Inserir Competências e Habilidades ──────────────────────
    console.log('📚 Inserindo Competências e Habilidades...')

    // ── LINGUAGENS ──
    const lingComps = [
      { n: 1, desc: 'Aplicar as tecnologias da comunicação e da informação na escola, no trabalho e em outros contextos relevantes para sua vida.' },
      { n: 2, desc: 'Conhecer e usar língua(s) estrangeira(s) moderna(s) como instrumento de acesso a informações e a outras culturas e grupos sociais.' },
      { n: 3, desc: 'Compreender e usar a linguagem corporal como relevante para a própria vida, integradora social e formadora da identidade.' },
      { n: 4, desc: 'Compreender a arte como saber cultural e estético gerador de significação e integrador da organização do mundo e da própria identidade.' },
      { n: 5, desc: 'Analisar, interpretar e aplicar recursos expressivos das linguagens, relacionando textos com seus contextos, mediante a natureza, função, organização, estrutura das manifestações, de acordo com as condições de produção e recepção.' },
      { n: 6, desc: 'Compreender e usar os sistemas simbólicos das diferentes linguagens como meios de organização cognitiva da realidade pela constituição de significados, expressão, comunicação e informação.' },
      { n: 7, desc: 'Confrontar opiniões e pontos de vista sobre as diferentes linguagens e suas manifestações específicas.' },
      { n: 8, desc: 'Compreender e usar a língua portuguesa como língua materna, geradora de significação e integradora da organização do mundo e da própria identidade.' },
      { n: 9, desc: 'Entender os princípios, a natureza, a função e o impacto das tecnologias da comunicação e da informação na sua vida pessoal e social, no desenvolvimento do conhecimento, associando-os aos conhecimentos científicos, às linguagens que lhes dão suporte, às demais tecnologias, aos processos de produção e aos problemas que se propõem solucionar.' },
    ]

    const lingSkills = [
      { compN: 1, skills: [
        { code: 'H1', desc: 'Reconhecer posições críticas aos usos sociais que são feitos das linguagens e aos sistemas de comunicação e informação.' },
        { code: 'H2', desc: 'Recorrer aos conhecimentos sobre as linguagens dos sistemas de comunicação e informação para resolver problemas.' },
        { code: 'H3', desc: 'Relacionar informações geradas nos sistemas de comunicação e informação, considerando a função social desses sistemas.' },
        { code: 'H4', desc: 'Reconhecer posições críticas aos usos sociais que são feitos das linguagens e aos sistemas de comunicação e informação.' },
      ]},
      { compN: 2, skills: [
        { code: 'H5', desc: 'Associar vocábulos e expressões de um texto em Língua Estrangeira Moderna ao seu tema.' },
        { code: 'H6', desc: 'Utilizar conhecimentos da Língua Estrangeira Moderna e de seus mecanismos como meio de ampliar possibilidades de acesso a informações, tecnologias e culturas.' },
        { code: 'H7', desc: 'Relacionar informações sobre um texto em Língua Estrangeira Moderna às informações de um texto em Língua Portuguesa, estabelecendo relações de complementaridade.' },
        { code: 'H8', desc: 'Reconhecer a importância da produção cultural em Língua Estrangeira Moderna como representação da diversidade cultural e linguística.' },
      ]},
      { compN: 3, skills: [
        { code: 'H9', desc: 'Reconhecer as manifestações corporais de movimento como originárias de necessidades cotidianas de um grupo social.' },
        { code: 'H10', desc: 'Reconhecer a necessidade de transformação de hábitos corporais em função das necessidades cinestésicas.' },
        { code: 'H11', desc: 'Reconhecer a linguagem corporal como meio de interação social, considerando os limites de desempenho e as alternativas de adaptação para diferentes indivíduos.' },
      ]},
      { compN: 4, skills: [
        { code: 'H12', desc: 'Reconhecer diferentes funções da arte, do trabalho da produção dos artistas em seus meios culturais.' },
        { code: 'H13', desc: 'Analisar as diversas produções artísticas como meio de explicar diferentes culturas, padrões estéticos e de comportamento.' },
        { code: 'H14', desc: 'Reconhecer o valor da diversidade artística e das inter-relações de elementos que se apresentam nas manifestações de vários grupos sociais e étnicos.' },
      ]},
      { compN: 5, skills: [
        { code: 'H15', desc: 'Estabelecer relações entre o texto literário e o momento de sua produção, situando aspectos do contexto histórico, social e político.' },
        { code: 'H16', desc: 'Relacionar informações sobre concepções artísticas e procedimentos de construção do texto literário.' },
        { code: 'H17', desc: 'Reconhecer a presença de valores sociais e humanos atualizáveis no patrimônio literário nacional.' },
      ]},
      { compN: 6, skills: [
        { code: 'H18', desc: 'Identificar os elementos que concorrem para a progressão temática e para a organização e estruturação de textos de diferentes gêneros e tipos.' },
        { code: 'H19', desc: 'Analisar a função da linguagem predominante nos textos em situações comunicativas específicas.' },
        { code: 'H20', desc: 'Reconhecer a importância do patrimônio linguístico para a preservação da memória e da identidade nacional.' },
      ]},
      { compN: 7, skills: [
        { code: 'H21', desc: 'Reconhecer em textos de diferentes gêneros, recursos verbais e não verbais utilizados com a finalidade de criar e mudar comportamentos e hábitos.' },
        { code: 'H22', desc: 'Relacionar, em diferentes textos, opiniões, temas, assuntos e recursos linguísticos.' },
        { code: 'H23', desc: 'Inferir em um texto a ideologia ou os sentidos propostos, a partir de análise dos procedimentos argumentativos utilizados.' },
        { code: 'H24', desc: 'Reconhecer no texto estratégias argumentativas empregadas para o convencimento do público, tais como a intimidação, sedução, comoção, chantagem, entre outras.' },
      ]},
      { compN: 8, skills: [
        { code: 'H25', desc: 'Identificar, em textos de diferentes gêneros, as marcas linguísticas que singularizam as variedades linguísticas sociais, regionais e de registro.' },
        { code: 'H26', desc: 'Relacionar as variedades linguísticas a situações específicas de uso social e de região.' },
        { code: 'H27', desc: 'Reconhecer os usos da norma-padrão da língua portuguesa nas diferentes situações de comunicação.' },
      ]},
      { compN: 9, skills: [
        { code: 'H28', desc: 'Reconhecer a função e o impacto social das diferentes tecnologias da comunicação e da informação.' },
        { code: 'H29', desc: 'Identificar pela análise de suas linguagens, as tecnologias da comunicação e da informação.' },
        { code: 'H30', desc: 'Relacionar as tecnologias da comunicação e da informação ao desenvolvimento das sociedades e ao conhecimento que elas produzem.' },
      ]},
    ]

    for (const comp of lingComps) {
      const [c] = await sql`
        INSERT INTO enem_competencies (area_id, number, description)
        VALUES (${areaLinguagens.id}, ${comp.n}, ${comp.desc})
        ON CONFLICT DO NOTHING RETURNING id
      `
      if (c) {
        const compSkills = lingSkills.find(s => s.compN === comp.n)?.skills || []
        for (const sk of compSkills) {
          await sql`
            INSERT INTO enem_skills (competency_id, code, description)
            VALUES (${c.id}, ${sk.code}, ${sk.desc})
            ON CONFLICT DO NOTHING
          `
        }
      }
    }

    // ── MATEMÁTICA ──
    const mathComps = [
      { n: 1, desc: 'Construir significados para os números naturais, inteiros, racionais e reais.' },
      { n: 2, desc: 'Utilizar o conhecimento geométrico para realizar a leitura e a representação da realidade e agir sobre ela.' },
      { n: 3, desc: 'Construir noções de grandezas e medidas para a compreensão da realidade e a solução de problemas do cotidiano.' },
      { n: 4, desc: 'Construir noções de variação de grandezas para a compreensão da realidade e a solução de problemas do cotidiano.' },
      { n: 5, desc: 'Modelar e resolver problemas que envolvem variáveis socioeconômicas ou técnico-científicas, usando representações algébricas.' },
      { n: 6, desc: 'Interpretar informações de natureza científica e social obtidas da leitura de gráficos e tabelas, realizando previsão de tendência, extrapolação, interpolação e interpretação.' },
      { n: 7, desc: 'Compreender o caráter aleatório e não determinístico dos fenômenos naturais e sociais e utilizar instrumentos adequados para medidas, determinação de amostras e cálculos de probabilidade para interpretar informações de variáveis apresentadas em uma distribuição estatística.' },
    ]

    const mathSkillsList = [
      { compN: 1, skills: [
        { code: 'H1', desc: 'Reconhecer, no contexto social, diferentes significados e representações dos números e operações — naturais, inteiros, racionais ou reais.' },
        { code: 'H2', desc: 'Identificar padrões numéricos ou princípios de contagem.' },
        { code: 'H3', desc: 'Resolver situação-problema envolvendo conhecimentos numéricos.' },
        { code: 'H4', desc: 'Avaliar a razoabilidade de um resultado numérico na construção de argumentos sobre afirmações quantitativas.' },
        { code: 'H5', desc: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos numéricos.' },
      ]},
      { compN: 2, skills: [
        { code: 'H6', desc: 'Interpretar a localização e a movimentação de pessoas/objetos no espaço tridimensional e sua representação no espaço bidimensional.' },
        { code: 'H7', desc: 'Identificar características de figuras planas ou espaciais.' },
        { code: 'H8', desc: 'Resolver situação-problema que envolva conhecimentos geométricos de espaço e forma.' },
        { code: 'H9', desc: 'Utilizar conhecimentos geométricos de espaço e forma na seleção de argumentos propostos como solução de problemas do cotidiano.' },
      ]},
      { compN: 3, skills: [
        { code: 'H10', desc: 'Identificar relações entre grandezas e unidades de medida.' },
        { code: 'H11', desc: 'Utilizar a noção de escalas na leitura de representação de situação do cotidiano.' },
        { code: 'H12', desc: 'Resolver situação-problema que envolva medidas de grandezas.' },
        { code: 'H13', desc: 'Avaliar o resultado de uma medição na construção de um argumento consistente.' },
        { code: 'H14', desc: 'Avaliar proposta de intervenção na realidade utilizando conhecimentos geométricos relacionados a grandezas e medidas.' },
      ]},
      { compN: 4, skills: [
        { code: 'H15', desc: 'Identificar a relação de dependência entre grandezas.' },
        { code: 'H16', desc: 'Resolver situação-problema envolvendo a variação de grandezas, direta ou inversamente proporcionais.' },
        { code: 'H17', desc: 'Analisar informações envolvendo a variação de grandezas como recurso para a construção de argumentação.' },
        { code: 'H18', desc: 'Avaliar propostas de intervenção na realidade envolvendo variação de grandezas.' },
      ]},
      { compN: 5, skills: [
        { code: 'H19', desc: 'Identificar representações algébricas que expressem a relação entre grandezas.' },
        { code: 'H20', desc: 'Interpretar gráfico cartesiano que represente relações entre grandezas.' },
        { code: 'H21', desc: 'Resolver situação-problema cuja modelagem envolva conhecimentos algébricos.' },
        { code: 'H22', desc: 'Utilizar conhecimentos algébricos/geométricos como recurso para a construção de argumentação.' },
        { code: 'H23', desc: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos algébricos.' },
      ]},
      { compN: 6, skills: [
        { code: 'H24', desc: 'Utilizar informações expressas em gráficos ou tabelas para fazer inferências.' },
        { code: 'H25', desc: 'Resolver problema com dados apresentados em tabelas ou gráficos.' },
        { code: 'H26', desc: 'Analisar informações expressas em gráficos ou tabelas como recurso para a construção de argumentos.' },
      ]},
      { compN: 7, skills: [
        { code: 'H27', desc: 'Calcular medidas de tendência central ou de dispersão de um conjunto de dados expressos em tabelas de frequência, gráficos ou textos.' },
        { code: 'H28', desc: 'Resolver situação-problema que envolva conhecimentos de estatística e probabilidade.' },
        { code: 'H29', desc: 'Utilizar conhecimentos de estatística e probabilidade como recurso para a construção de argumentação.' },
        { code: 'H30', desc: 'Avaliar propostas de intervenção na realidade utilizando conhecimentos de estatística e probabilidade.' },
      ]},
    ]

    for (const comp of mathComps) {
      const [c] = await sql`
        INSERT INTO enem_competencies (area_id, number, description)
        VALUES (${areaMatematica.id}, ${comp.n}, ${comp.desc})
        ON CONFLICT DO NOTHING RETURNING id
      `
      if (c) {
        const compSkills = mathSkillsList.find(s => s.compN === comp.n)?.skills || []
        for (const sk of compSkills) {
          await sql`
            INSERT INTO enem_skills (competency_id, code, description)
            VALUES (${c.id}, ${sk.code}, ${sk.desc})
            ON CONFLICT DO NOTHING
          `
        }
      }
    }

    // ── CIÊNCIAS DA NATUREZA ──
    const natureComps = [
      { n: 1, desc: 'Compreender as ciências naturais e as tecnologias a elas associadas como construções humanas, percebendo seus papéis nos processos de produção e no desenvolvimento econômico e social da humanidade.' },
      { n: 2, desc: 'Identificar a presença e aplicar as tecnologias associadas às ciências naturais em diferentes contextos.' },
      { n: 3, desc: 'Associar intervenções que resultam em degradação ou conservação ambiental a processos produtivos e sociais e a instrumentos ou ações científico-tecnológicos.' },
      { n: 4, desc: 'Compreender interações entre organismos e ambiente, em particular aquelas relacionadas à saúde humana, relacionando conhecimentos científicos, aspectos culturais e condicionantes ambientais.' },
      { n: 5, desc: 'Entender métodos e procedimentos próprios das ciências naturais e aplicá-los em diferentes contextos.' },
      { n: 6, desc: 'Apropriar-se de conhecimentos da física para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.' },
      { n: 7, desc: 'Apropriar-se de conhecimentos da química para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.' },
      { n: 8, desc: 'Apropriar-se de conhecimentos da biologia para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.' },
    ]

    const natureSkills = [
      { compN: 1, skills: [
        { code: 'H1', desc: 'Reconhecer características ou propriedades de fenômenos ondulatórios ou oscilatórios, relacionando-os a seus usos em diferentes contextos.' },
        { code: 'H2', desc: 'Associar a solução de problemas de comunicação, transporte, saúde ou outro, com o correspondente desenvolvimento científico e tecnológico.' },
        { code: 'H3', desc: 'Confrontar interpretações científicas com interpretações baseadas no senso comum, ao longo do tempo ou em diferentes culturas.' },
        { code: 'H4', desc: 'Avaliar propostas de intervenção no ambiente, considerando a qualidade da vida humana ou medidas de conservação, recuperação ou utilização sustentável da biodiversidade.' },
      ]},
      { compN: 2, skills: [
        { code: 'H5', desc: 'Dimensionar circuitos ou dispositivos elétricos de uso cotidiano.' },
        { code: 'H6', desc: 'Relacionar informações para compreender manuais de instalação ou utilização de aparelhos ou sistemas tecnológicos de uso comum.' },
        { code: 'H7', desc: 'Selecionar testes de controle, parâmetros ou patrões para reconhecimento de material ou produto, com base em características físico-químicas.' },
      ]},
      { compN: 3, skills: [
        { code: 'H8', desc: 'Identificar etapas em processos de obtenção, transformação, utilização ou reciclagem de recursos naturais, energéticos ou matérias-primas, considerando processos biológicos, químicos ou físicos neles envolvidos.' },
        { code: 'H9', desc: 'Compreender a importância dos ciclos biogeoquímicos ou do fluxo de energia para a vida, ou da ação de agentes ou fenômenos que podem causar alterações nesses processos.' },
        { code: 'H10', desc: 'Analisar perturbações ambientais, identificando fontes, transporte e/ou destino dos poluentes ou prevendo efeitos em sistemas naturais, produtivos ou sociais.' },
        { code: 'H11', desc: 'Reconhecer benefícios, limitações e aspectos éticos da biotecnologia, considerando estruturas e processos biológicos envolvidos.' },
        { code: 'H12', desc: 'Avaliar impactos ambientais decorrentes de atividades produtivas ou econômicas, considerando interesses contraditórios.' },
      ]},
      { compN: 4, skills: [
        { code: 'H13', desc: 'Reconhecer mecanismos de transmissão da vida, prevendo ou explicando a manifestação de características dos seres vivos.' },
        { code: 'H14', desc: 'Identificar padrões de herança e/ou expressão gênica, relacionando-os a processos biológicos, químicos e físicos.' },
        { code: 'H15', desc: 'Relacionar informações sobre diferentes formas de transmissão de doenças, hábitos de higiene e saneamento básico.' },
        { code: 'H16', desc: 'Compreender o papel da evolução na diversidade biológica e nas interações entre organismos e ambiente.' },
      ]},
      { compN: 5, skills: [
        { code: 'H17', desc: 'Relacionar informações apresentadas em diferentes formas de linguagem e representação usadas nas ciências físicas, químicas ou biológicas, como texto discursivo, gráficos, tabelas, relações matemáticas ou linguagem simbólica.' },
        { code: 'H18', desc: 'Relacionar propriedades físicas, químicas ou biológicas de produtos, sistemas ou procedimentos tecnológicos às finalidades a que se destinam.' },
        { code: 'H19', desc: 'Avaliar métodos, processos ou procedimentos das ciências naturais que contribuam para diagnosticar ou solucionar problemas de ordem social, econômica ou ambiental.' },
      ]},
      { compN: 6, skills: [
        { code: 'H20', desc: 'Caracterizar causas ou efeitos dos movimentos de partículas, substâncias, objetos ou corpos celestes.' },
        { code: 'H21', desc: 'Utilizar leis físicas e/ou químicas para interpretar processos naturais ou tecnológicos inseridos no cotidiano e nos processos de produção.' },
        { code: 'H22', desc: 'Compreender fenômenos decorrentes da interação entre a radiação e a matéria em suas manifestações em processos naturais ou tecnológicos.' },
        { code: 'H23', desc: 'Avaliar possibilidades de geração, uso ou transformação de energia em ambientes específicos, considerando implicações éticas, ambientais, sociais e/ou econômicas.' },
      ]},
      { compN: 7, skills: [
        { code: 'H24', desc: 'Utilizar códigos e nomenclatura da química para caracterizar materiais, substâncias ou transformações químicas.' },
        { code: 'H25', desc: 'Caracterizar materiais ou substâncias, identificando etapas, rendimentos ou implicações biológicas, sociais, econômicas ou ambientais de sua obtenção ou produção.' },
        { code: 'H26', desc: 'Avaliar implicações sociais, ambientais e/ou econômicas na produção ou no uso de diferentes materiais e substâncias.' },
        { code: 'H27', desc: 'Avaliar propostas de intervenção no meio ambiente aplicando conhecimentos químicos, observando riscos e benefícios.' },
      ]},
      { compN: 8, skills: [
        { code: 'H28', desc: 'Associar características adaptativas dos organismos com seu modo de vida ou com seus limites de distribuição em diferentes ambientes.' },
        { code: 'H29', desc: 'Interpretar experimentos ou técnicas que utilizam seres vivos, analisando implicações para o ambiente, a saúde, a produção de alimentos ou matérias-primas.' },
        { code: 'H30', desc: 'Avaliar propostas de alcance individual ou coletivo, identificando aquelas que visam à preservação e à implementação da saúde individual, coletiva ou do ambiente.' },
      ]},
    ]

    for (const comp of natureComps) {
      const [c] = await sql`
        INSERT INTO enem_competencies (area_id, number, description)
        VALUES (${areaNatureza.id}, ${comp.n}, ${comp.desc})
        ON CONFLICT DO NOTHING RETURNING id
      `
      if (c) {
        const compSkills = natureSkills.find(s => s.compN === comp.n)?.skills || []
        for (const sk of compSkills) {
          await sql`
            INSERT INTO enem_skills (competency_id, code, description)
            VALUES (${c.id}, ${sk.code}, ${sk.desc})
            ON CONFLICT DO NOTHING
          `
        }
      }
    }

    // ── CIÊNCIAS HUMANAS ──
    const humanComps = [
      { n: 1, desc: 'Compreender elementos culturais que constituem identidades.' },
      { n: 2, desc: 'Compreender as transformações dos espaços geográficos como produto das relações socioeconômicas e culturais de poder.' },
      { n: 3, desc: 'Compreender a produção e o papel histórico das instituições sociais, políticas e econômicas, associando-as às práticas dos diferentes grupos e atores sociais.' },
      { n: 4, desc: 'Entender as transformações técnicas e tecnológicas e seu impacto nos processos de produção, no desenvolvimento do conhecimento e na vida social.' },
      { n: 5, desc: 'Utilizar os conhecimentos históricos para compreender e valorizar os fundamentos da cidadania e da democracia, favorecendo uma atuação consciente do indivíduo na sociedade.' },
      { n: 6, desc: 'Compreender a sociedade e a natureza, reconhecendo suas interações no espaço em diferentes contextos históricos e geográficos.' },
    ]

    const humanSkills = [
      { compN: 1, skills: [
        { code: 'H1', desc: 'Interpretar historicamente e/ou geograficamente fontes documentais acerca de aspectos da cultura.' },
        { code: 'H2', desc: 'Analisar a produção da memória pelas sociedades humanas.' },
        { code: 'H3', desc: 'Associar as manifestações culturais do presente aos seus processos históricos.' },
        { code: 'H4', desc: 'Comparar pontos de vista expressos em diferentes fontes sobre determinado aspecto da cultura.' },
        { code: 'H5', desc: 'Identificar as manifestações ou representações da diversidade do patrimônio cultural e artístico em diferentes sociedades.' },
      ]},
      { compN: 2, skills: [
        { code: 'H6', desc: 'Interpretar mapas e gráficos sobre a organização do espaço geográfico.' },
        { code: 'H7', desc: 'Analisar a ação de estados e atores sociais e suas diferentes concepções de territorialidade.' },
        { code: 'H8', desc: 'Analisar a ação dos estados e atores sociais no processo de ocupação e transformação da natureza.' },
        { code: 'H9', desc: 'Comparar o significado histórico-geográfico das organizações políticas e socioeconômicas em escala local, regional ou mundial.' },
        { code: 'H10', desc: 'Reconhecer a dinâmica da organização dos movimentos sociais e a importância da participação da coletividade na transformação da realidade histórico-geográfica.' },
      ]},
      { compN: 3, skills: [
        { code: 'H11', desc: 'Identificar registros de práticas de grupos sociais no tempo e no espaço.' },
        { code: 'H12', desc: 'Analisar o papel da cultura e das práticas culturais na constituição da identidade.' },
        { code: 'H13', desc: 'Analisar a atuação dos movimentos sociais que contribuíram para mudanças ou rupturas em processos de disputa pelo poder.' },
        { code: 'H14', desc: 'Comparar diferentes pontos de vista sobre a atuação dos estados e dos atores sociais.' },
        { code: 'H15', desc: 'Avaliar criticamente conflitos culturais, sociais, políticos, econômicos ou ambientais ao longo da história.' },
      ]},
      { compN: 4, skills: [
        { code: 'H16', desc: 'Identificar registros sobre o papel das técnicas e tecnologias na organização do trabalho e/ou da vida social.' },
        { code: 'H17', desc: 'Analisar o papel da tecnologia na organização do trabalho e/ou da vida social.' },
        { code: 'H18', desc: 'Analisar diferentes formas de organização do trabalho e de produção em diferentes contextos.' },
        { code: 'H19', desc: 'Reconhecer as transformações técnicas e tecnológicas que determinam as várias formas de uso e apropriação dos espaços rural e urbano.' },
      ]},
      { compN: 5, skills: [
        { code: 'H20', desc: 'Analisar as lutas sociais e conquistas obtidas no que se refere às mudanças nas legislações ou nas políticas públicas.' },
        { code: 'H21', desc: 'Identificar o papel dos meios de comunicação na construção da vida social.' },
        { code: 'H22', desc: 'Analisar as lutas sociais e conquistas obtidas no que se refere às mudanças nas legislações ou nas políticas públicas.' },
        { code: 'H23', desc: 'Analisar a importância dos valores éticos na estruturação política das sociedades.' },
        { code: 'H24', desc: 'Relacionar cidadania e democracia na organização das sociedades.' },
        { code: 'H25', desc: 'Identificar estratégias que promovam formas de inclusão social.' },
      ]},
      { compN: 6, skills: [
        { code: 'H26', desc: 'Interpretar diferentes representações gráficas e cartográficas dos espaços geográficos.' },
        { code: 'H27', desc: 'Identificar as características de diferentes processos naturais e seus efeitos sobre a ocupação do território.' },
        { code: 'H28', desc: 'Reconhecer a função dos recursos naturais na produção do espaço geográfico, relacionando-os com as mudanças provocadas pelas atividades humanas.' },
        { code: 'H29', desc: 'Reconhecer a função dos recursos naturais na produção do espaço geográfico, relacionando-os com as mudanças provocadas pelas atividades humanas.' },
        { code: 'H30', desc: 'Avaliar as relações entre preservação e degradação da vida no planeta nas diferentes escalas.' },
      ]},
    ]

    for (const comp of humanComps) {
      const [c] = await sql`
        INSERT INTO enem_competencies (area_id, number, description)
        VALUES (${areaHumanas.id}, ${comp.n}, ${comp.desc})
        ON CONFLICT DO NOTHING RETURNING id
      `
      if (c) {
        const compSkills = humanSkills.find(s => s.compN === comp.n)?.skills || []
        for (const sk of compSkills) {
          await sql`
            INSERT INTO enem_skills (competency_id, code, description)
            VALUES (${c.id}, ${sk.code}, ${sk.desc})
            ON CONFLICT DO NOTHING
          `
        }
      }
    }

    console.log('✅ Competências e Habilidades inseridas.\n')

    // ── 5. Resumo ─────────────────────────────────────────────────
    const stats = await sql`
      SELECT 
        (SELECT COUNT(*) FROM enem_areas) AS areas,
        (SELECT COUNT(*) FROM enem_competencies) AS competencias,
        (SELECT COUNT(*) FROM enem_skills) AS habilidades,
        (SELECT COUNT(*) FROM enem_cognitive_axes) AS eixos
    `
    console.log('📊 Resumo:')
    console.log(`  Áreas:          ${stats[0].areas}`)
    console.log(`  Competências:   ${stats[0].competencias}`)
    console.log(`  Habilidades:    ${stats[0].habilidades}`)
    console.log(`  Eixos Cognitivos: ${stats[0].eixos}`)
    console.log('\n✅ Schema ENEM configurado com sucesso!')

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n❌ Erro: ${msg}`)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

main()
