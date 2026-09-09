/**
 * Descritores oficiais do SAEB (Matriz clássica), transcritos direto dos
 * PDFs oficiais do INEP (15/07/2026):
 *   - download.inep.gov.br/.../Matriz_de_Referencia_de_Lingua_Portuguesa.pdf
 *   - download.inep.gov.br/.../Matriz_de_Referencia_de_Matematica.pdf
 * Confirmado contra os microdados reais do SAEB 2023 (TS_ITEM.csv) — os
 * códigos aqui são os mesmos usados nas provas de verdade (maioria
 * "matriz clássica" D1-D37ish; existe também uma camada "Novo SAEB",
 * ainda em expansão, com códigos H/numéricos que não estão cobertos
 * aqui ainda).
 *
 * IMPORTANTE: o código Dn **não é estável entre séries** — D7 no 5º ano
 * é "conflito gerador do enredo", D7 no 9º ano é "tese de um texto". Por
 * isso os descritores são indexados por série, nunca reaproveitados entre
 * 5º e 9º só porque o número bate.
 *
 * Alimenta o prompt do Gemini/DeepSeek (Fase 2) pra que a IA escolha UM
 * descritor específico por questão, com o texto oficial exato — não só
 * um "tópico" genérico como antes. A responsabilidade de nunca inventar
 * um descritor pra disciplina/série sem matriz oficial continua em
 * config/saebApplicability.ts (o gate mecânico).
 */

export type SaebDescriptor = { code: string; text: string; topicId: string; topicLabel: string }

const LP_5: SaebDescriptor[] = [
  { code: 'D1', text: 'Localizar informações explícitas em um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D3', text: 'Inferir o sentido de uma palavra ou expressão.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D4', text: 'Inferir uma informação implícita em um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D6', text: 'Identificar o tema de um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D11', text: 'Distinguir um fato da opinião relativa a esse fato.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D5', text: 'Interpretar texto com auxílio de material gráfico diverso (propagandas, quadrinhos, foto etc.).', topicId: 'II', topicLabel: 'Implicações do suporte/gênero/enunciador' },
  { code: 'D9', text: 'Identificar a finalidade de textos de diferentes gêneros.', topicId: 'II', topicLabel: 'Implicações do suporte/gênero/enunciador' },
  { code: 'D15', text: 'Reconhecer diferentes formas de tratar uma informação na comparação de textos que tratam do mesmo tema, em função das condições em que ele foi produzido e daquelas em que será recebido.', topicId: 'III', topicLabel: 'Relação entre textos' },
  { code: 'D2', text: 'Estabelecer relações entre partes de um texto, identificando repetições ou substituições que contribuem para a continuidade de um texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D7', text: 'Identificar o conflito gerador do enredo e os elementos que constroem a narrativa.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D8', text: 'Estabelecer relação causa/consequência entre partes e elementos do texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D12', text: 'Estabelecer relações lógico-discursivas presentes no texto, marcadas por conjunções, advérbios etc.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D13', text: 'Identificar efeitos de ironia ou humor em textos variados.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D14', text: 'Identificar o efeito de sentido decorrente do uso da pontuação e de outras notações.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D10', text: 'Identificar as marcas linguísticas que evidenciam o locutor e o interlocutor de um texto.', topicId: 'VI', topicLabel: 'Variação linguística' },
]

const LP_9: SaebDescriptor[] = [
  { code: 'D1', text: 'Localizar informações explícitas em um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D3', text: 'Inferir o sentido de uma palavra ou expressão.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D4', text: 'Inferir uma informação implícita em um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D6', text: 'Identificar o tema de um texto.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D14', text: 'Distinguir um fato da opinião relativa a esse fato.', topicId: 'I', topicLabel: 'Procedimentos de leitura' },
  { code: 'D5', text: 'Interpretar texto com auxílio de material gráfico diverso (propagandas, quadrinhos, foto etc.).', topicId: 'II', topicLabel: 'Implicações do suporte/gênero/enunciador' },
  { code: 'D12', text: 'Identificar a finalidade de textos de diferentes gêneros.', topicId: 'II', topicLabel: 'Implicações do suporte/gênero/enunciador' },
  { code: 'D20', text: 'Reconhecer diferentes formas de tratar uma informação na comparação de textos que tratam do mesmo tema, em função das condições em que ele foi produzido e daquelas em que será recebido.', topicId: 'III', topicLabel: 'Relação entre textos' },
  { code: 'D21', text: 'Reconhecer posições distintas entre duas ou mais opiniões relativas ao mesmo fato ou ao mesmo tema.', topicId: 'III', topicLabel: 'Relação entre textos' },
  { code: 'D2', text: 'Estabelecer relações entre partes de um texto, identificando repetições ou substituições que contribuem para a continuidade de um texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D7', text: 'Identificar a tese de um texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D8', text: 'Estabelecer relação entre a tese e os argumentos oferecidos para sustentá-la.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D9', text: 'Diferenciar as partes principais das secundárias em um texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D10', text: 'Identificar o conflito gerador do enredo e os elementos que constroem a narrativa.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D11', text: 'Estabelecer relação causa/consequência entre partes e elementos do texto.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D15', text: 'Estabelecer relações lógico-discursivas presentes no texto, marcadas por conjunções, advérbios etc.', topicId: 'IV', topicLabel: 'Coerência e coesão no processamento do texto' },
  { code: 'D16', text: 'Identificar efeitos de ironia ou humor em textos variados.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D17', text: 'Reconhecer o efeito de sentido decorrente do uso da pontuação e de outras notações.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D18', text: 'Reconhecer o efeito de sentido decorrente da escolha de uma determinada palavra ou expressão.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D19', text: 'Reconhecer o efeito de sentido decorrente da exploração de recursos ortográficos e/ou morfossintáticos.', topicId: 'V', topicLabel: 'Relações entre recursos expressivos e efeitos de sentido' },
  { code: 'D13', text: 'Identificar as marcas linguísticas que evidenciam o locutor e o interlocutor de um texto.', topicId: 'VI', topicLabel: 'Variação linguística' },
]

const MT_5: SaebDescriptor[] = [
  { code: 'D1', text: 'Identificar a localização/movimentação de objeto em mapas, croquis e outras representações gráficas.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D2', text: 'Identificar propriedades comuns e diferenças entre poliedros e corpos redondos, relacionando figuras tridimensionais com suas planificações.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D3', text: 'Identificar propriedades comuns e diferenças entre figuras bidimensionais pelo número de lados, pelos tipos de ângulos.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D4', text: 'Identificar quadriláteros observando as posições relativas entre seus lados (paralelos, concorrentes, perpendiculares).', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D5', text: 'Reconhecer a conservação ou modificação de medidas dos lados, do perímetro, da área em ampliação e/ou redução de figuras poligonais usando malhas quadriculadas.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D6', text: 'Estimar a medida de grandezas utilizando unidades de medida convencionais ou não.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D7', text: 'Resolver problemas significativos utilizando unidades de medida padronizadas como km/m/cm/mm, kg/g/mg, l/ml.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D8', text: 'Estabelecer relações entre unidades de medida de tempo.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D9', text: 'Estabelecer relações entre o horário de início e término e/ou o intervalo da duração de um evento ou acontecimento.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D10', text: 'Num problema, estabelecer trocas entre cédulas e moedas do sistema monetário brasileiro, em função de seus valores.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D11', text: 'Resolver problema envolvendo o cálculo do perímetro de figuras planas, desenhadas em malhas quadriculadas.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D12', text: 'Resolver problema envolvendo o cálculo ou estimativa de áreas de figuras planas, desenhadas em malhas quadriculadas.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D13', text: 'Reconhecer e utilizar características do sistema de numeração decimal, tais como agrupamentos e trocas na base 10 e princípio do valor posicional.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D14', text: 'Identificar a localização de números naturais na reta numérica.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D15', text: 'Reconhecer a decomposição de números naturais nas suas diversas ordens.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D16', text: 'Reconhecer a composição e a decomposição de números naturais em sua forma polinomial.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D17', text: 'Calcular o resultado de uma adição ou subtração de números naturais.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D18', text: 'Calcular o resultado de uma multiplicação ou divisão de números naturais.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D19', text: 'Resolver problema com números naturais, envolvendo diferentes significados da adição ou subtração: juntar, alteração de um estado inicial (positiva ou negativa), comparação e mais de uma transformação (positiva ou negativa).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D20', text: 'Resolver problema com números naturais, envolvendo diferentes significados da multiplicação ou divisão: multiplicação comparativa, idéia de proporcionalidade, configuração retangular e combinatória.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D21', text: 'Identificar diferentes representações de um mesmo número racional.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D22', text: 'Identificar a localização de números racionais representados na forma decimal na reta numérica.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D23', text: 'Resolver problema utilizando a escrita decimal de cédulas e moedas do sistema monetário brasileiro.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D24', text: 'Identificar fração como representação que pode estar associada a diferentes significados.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D25', text: 'Resolver problema com números racionais expressos na forma decimal envolvendo diferentes significados da adição ou subtração.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D26', text: 'Resolver problema envolvendo noções de porcentagem (25%, 50%, 100%).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D27', text: 'Ler informações e dados apresentados em tabelas.', topicId: 'IV', topicLabel: 'Tratamento da Informação' },
  { code: 'D28', text: 'Ler informações e dados apresentados em gráficos (particularmente em gráficos de colunas).', topicId: 'IV', topicLabel: 'Tratamento da Informação' },
]

const MT_9: SaebDescriptor[] = [
  { code: 'D1', text: 'Identificar a localização/movimentação de objeto em mapas, croquis e outras representações gráficas.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D2', text: 'Identificar propriedades comuns e diferenças entre figuras bidimensionais e tridimensionais, relacionando-as com as suas planificações.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D3', text: 'Identificar propriedades de triângulos pela comparação de medidas de lados e ângulos.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D4', text: 'Identificar relação entre quadriláteros por meio de suas propriedades.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D5', text: 'Reconhecer a conservação ou modificação de medidas dos lados, do perímetro, da área em ampliação e/ou redução de figuras poligonais usando malhas quadriculadas.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D6', text: 'Reconhecer ângulos como mudança de direção ou giros, identificando ângulos retos e não-retos.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D7', text: 'Reconhecer que as imagens de uma figura construída por uma transformação homotética são semelhantes, identificando propriedades e/ou medidas que se modificam ou não se alteram.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D8', text: 'Resolver problema utilizando propriedades dos polígonos (soma de seus ângulos internos, número de diagonais, cálculo da medida de cada ângulo interno nos polígonos regulares).', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D9', text: 'Interpretar informações apresentadas por meio de coordenadas cartesianas.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D10', text: 'Utilizar relações métricas do triângulo retângulo para resolver problemas significativos.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D11', text: 'Reconhecer círculo/circunferência, seus elementos e algumas de suas relações.', topicId: 'I', topicLabel: 'Espaço e Forma' },
  { code: 'D12', text: 'Resolver problema envolvendo o cálculo de perímetro de figuras planas.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D13', text: 'Resolver problema envolvendo o cálculo de área de figuras planas.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D14', text: 'Resolver problema envolvendo noções de volume.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D15', text: 'Resolver problema utilizando relações entre diferentes unidades de medida.', topicId: 'II', topicLabel: 'Grandezas e Medidas' },
  { code: 'D16', text: 'Identificar a localização de números inteiros na reta numérica.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D17', text: 'Identificar a localização de números racionais na reta numérica.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D18', text: 'Efetuar cálculos com números inteiros, envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D19', text: 'Resolver problema com números naturais, envolvendo diferentes significados das operações (adição, subtração, multiplicação, divisão, potenciação).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D20', text: 'Resolver problema com números inteiros envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D21', text: 'Reconhecer as diferentes representações de um número racional.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D22', text: 'Identificar fração como representação que pode estar associada a diferentes significados.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D23', text: 'Identificar frações equivalentes.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D24', text: 'Reconhecer as representações decimais dos números racionais como uma extensão do sistema de numeração decimal, identificando a existência de "ordens" como décimos, centésimos e milésimos.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D25', text: 'Efetuar cálculos que envolvam operações com números racionais (adição, subtração, multiplicação, divisão, potenciação).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D26', text: 'Resolver problema com números racionais envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D27', text: 'Efetuar cálculos simples com valores aproximados de radicais.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D28', text: 'Resolver problema que envolva porcentagem.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D29', text: 'Resolver problema que envolva variação proporcional, direta ou inversa, entre grandezas.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D30', text: 'Calcular o valor numérico de uma expressão algébrica.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D31', text: 'Resolver problema que envolva equação do 2º grau.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D32', text: 'Identificar a expressão algébrica que expressa uma regularidade observada em seqüências de números ou figuras (padrões).', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D33', text: 'Identificar uma equação ou inequação do 1º grau que expressa um problema.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D34', text: 'Identificar um sistema de equações do 1º grau que expressa um problema.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D35', text: 'Identificar a relação entre as representações algébrica e geométrica de um sistema de equações do 1º grau.', topicId: 'III', topicLabel: 'Números e Operações/Álgebra e Funções' },
  { code: 'D36', text: 'Resolver problema envolvendo informações apresentadas em tabelas e/ou gráficos.', topicId: 'IV', topicLabel: 'Tratamento da Informação' },
  { code: 'D37', text: 'Associar informações apresentadas em listas e/ou tabelas simples aos gráficos que as representam e vice-versa.', topicId: 'IV', topicLabel: 'Tratamento da Informação' },
]

/**
 * 2º ano LP — matriz própria do SAEB (Avaliação de Alfabetização), com
 * eixos do conhecimento em vez de "tópicos" como 5º/9º:
 *   - Apropriação do Sistema de Escrita Alfabética (H1-H3)
 *   - Leitura (H4-H9)
 *   - Produção textual (H10)
 * Fonte: "Matriz de Referência 2º ano EF (LP+MT)" + "Descrição das
 * Habilidades de LP - 2º ano" (INEP, 2025), baixados 15/07/2026.
 * Confirmado contra TS_ITEM.csv real (2023): H1.1,H1.2,H10,H2.1,H2.2,
 * H3.1,H3.2,H4,H5,H6,H7,H8,H9 — bate com os subcódigos abaixo.
 */
const LP_2: SaebDescriptor[] = [
  { code: 'H1.1', text: 'Relacionar fonema com sua representação escrita.', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H1.2', text: 'Relacionar sílaba com sua representação escrita.', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H2.1', text: 'Ler palavras formadas por sílabas canônicas (consoante-vogal).', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H2.2', text: 'Ler palavras formadas por sílabas não canônicas (V, CVC, CCV, CVV).', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H3.1', text: 'Escrever palavras formadas exclusivamente por sílabas canônicas.', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H3.2', text: 'Escrever palavras formadas por sílabas não canônicas.', topicId: 'ASEA', topicLabel: 'Apropriação do Sistema de Escrita Alfabética' },
  { code: 'H4', text: 'Ler frases simples na ordem direta e na voz ativa (sujeito, predicado, complementos verbais e adjuntos adnominais e adverbiais).', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H5', text: 'Localizar informações explícitas no início, meio ou fim de textos curtos, que circulam nos campos da vida social dos quais a criança participa, compostos por períodos simples ou orações coordenadas por meio de vírgula ou de conjunções.', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H6', text: 'Reconhecer a finalidade de textos próprios dos campos da vida social dos quais a criança participa.', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H7', text: 'Inferir assunto em textos não literários que circulam nos campos da vida social dos quais a criança participa.', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H8', text: 'Inferir informação em texto verbal com base em pistas textuais localizadas ou no sentido global do texto.', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H9', text: 'Inferir informação em texto que articula linguagem verbal e não verbal com base no sentido global do texto (cartaz, publicidade, tirinhas, entre outros próprios para o 2º ano do EF).', topicId: 'LEITURA', topicLabel: 'Leitura' },
  { code: 'H10', text: 'Escrever texto atendendo à proposta de produção textual, com coesão e coerência, adequado ao gênero, ao propósito comunicativo e às convenções da escrita (grafia, pontuação, segmentação).', topicId: 'PRODUCAO', topicLabel: 'Produção textual' },
]

/**
 * 2º ano Matemática — organizado por Eixo do conhecimento (Números,
 * Álgebra, Geometria, Grandezas e medidas, Probabilidade e estatística) x
 * Eixo cognitivo (1 = Compreender e aplicar conceitos/procedimentos,
 * 2 = Resolver problemas e argumentar). Mesma fonte do LP_2.
 */
const MT_2: SaebDescriptor[] = [
  { code: '2N1.1', text: 'Reconhecer e/ou construir a sequência dos números naturais em ordem crescente ou decrescente a partir de uma dada posição.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.2', text: 'Ler e/ou escrever números naturais.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.3', text: 'Identificar a decomposição de um número natural, em sua forma polinomial, considerando as ordens (unidades, dezenas, centenas).', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.4', text: 'Comparar e/ou ordenar números naturais.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.5', text: 'Reconhecer a composição e/ou decomposição de números naturais nas suas diversas ordens.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.6', text: 'Associar a representação numérica das quantidades até a ordem das centenas.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.7', text: 'Reconhecer termos como "dobro", "metade", "triplo" e "terço" associados a diferentes significados.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N1.8', text: 'Identificar diferentes representações de um mesmo número natural.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N2.1', text: 'Resolver problema com números naturais envolvendo diferentes significados da adição ou subtração: juntar, alteração de um estado inicial, comparação.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N2.2', text: 'Resolver problema com números naturais envolvendo diferentes significados da multiplicação ou divisão: adição de parcelas iguais, ideia de metade/dobro.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2N2.3', text: 'Resolver problema utilizando a contagem de dinheiro em situações de compra, venda e troco, no contexto do sistema monetário brasileiro.', topicId: 'NUMEROS', topicLabel: 'Números' },
  { code: '2A1.1', text: 'Identificar regularidades em sequências numéricas.', topicId: 'ALGEBRA', topicLabel: 'Álgebra' },
  { code: '2A1.2', text: 'Identificar regularidades em sequências de figuras (padrões figurais).', topicId: 'ALGEBRA', topicLabel: 'Álgebra' },
  { code: '2A1.3', text: 'Reconhecer a ideia de igualdade/equilíbrio em uma sentença matemática.', topicId: 'ALGEBRA', topicLabel: 'Álgebra' },
  { code: '2A1.4', text: 'Completar uma sequência numérica ou figural seguindo a regularidade observada.', topicId: 'ALGEBRA', topicLabel: 'Álgebra' },
  { code: '2G1.1', text: 'Identificar a localização/movimentação de objeto em mapas, croquis e outras representações gráficas simples.', topicId: 'GEOMETRIA', topicLabel: 'Geometria' },
  { code: '2G1.2', text: 'Reconhecer figuras geométricas espaciais (bola, caixa, pirâmide, cone) em objetos do cotidiano.', topicId: 'GEOMETRIA', topicLabel: 'Geometria' },
  { code: '2G1.3', text: 'Reconhecer e/ou nomear figuras geométricas planas (quadrado, retângulo, triângulo, círculo).', topicId: 'GEOMETRIA', topicLabel: 'Geometria' },
  { code: '2G2.1', text: 'Resolver problema envolvendo a comparação de formas geométricas planas e espaciais.', topicId: 'GEOMETRIA', topicLabel: 'Geometria' },
  { code: '2M1.1', text: 'Estimar e/ou comparar comprimentos utilizando unidades de medida não convencionais ou convencionais.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.2', text: 'Estimar e/ou comparar massas utilizando unidades de medida não convencionais ou convencionais.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.3', text: 'Estimar e/ou comparar capacidades utilizando unidades de medida não convencionais ou convencionais.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.4', text: 'Identificar o horário de início e/ou término de um evento em relógio digital ou analógico.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.5', text: 'Reconhecer as relações entre unidades de tempo (dia, semana, mês, ano).', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.6', text: 'Reconhecer cédulas e moedas do sistema monetário brasileiro.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M1.7', text: 'Estabelecer trocas entre cédulas e moedas do sistema monetário brasileiro, em função de seus valores.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M2.1', text: 'Resolver problema envolvendo a comparação de medidas de comprimento, massa ou capacidade.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M2.2', text: 'Resolver problema envolvendo a duração de um evento ou intervalo de tempo.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2M2.3', text: 'Resolver problema envolvendo o sistema monetário brasileiro em situações de compra, venda e troco.', topicId: 'GRANDEZAS', topicLabel: 'Grandezas e medidas' },
  { code: '2E1.1', text: 'Ler informações e dados apresentados em listas simples.', topicId: 'PROBEST', topicLabel: 'Probabilidade e estatística' },
  { code: '2E1.2', text: 'Ler informações e dados apresentados em tabelas simples.', topicId: 'PROBEST', topicLabel: 'Probabilidade e estatística' },
  { code: '2E1.3', text: 'Ler informações e dados apresentados em gráficos de colunas simples.', topicId: 'PROBEST', topicLabel: 'Probabilidade e estatística' },
  { code: '2E2.1', text: 'Resolver problema envolvendo informações apresentadas em listas, tabelas ou gráficos de colunas simples.', topicId: 'PROBEST', topicLabel: 'Probabilidade e estatística' },
]

/**
 * Ciências Humanas (5º/9º ano) — matriz do SAEB agrega o conteúdo de
 * História + Geografia num único teste interdisciplinar. Eixo do
 * conhecimento (1-6) x Eixo cognitivo (A. Reconhecimento e Recuperação,
 * B. Compreensão e Análise, C. Avaliação e Proposição) — código é
 * "{eixo}.0/{cognitivo}{eixo}" no microdado real (ex: "3.0/B3"), mas o
 * texto do descritor é o mesmo pros dois anos (só o peso/proporção varia,
 * não a definição do eixo). Fonte: "Matrizes de Referência do Saeb:
 * Ciências da Natureza e Ciências Humanas" (INEP, 24/02/2025).
 * Aplicável a História e Geografia (as duas disciplinas escolares que
 * compõem Ciências Humanas no currículo do Colégio Harmonia).
 */
const CH_EIXOS: { num: number; label: string }[] = [
  { num: 1, label: 'Tempo e espaço: fontes e formas de representação' },
  { num: 2, label: 'Natureza e questões socioambientais' },
  { num: 3, label: 'Culturas, identidades e diversidades' },
  { num: 4, label: 'Poder, Estado e instituições' },
  { num: 5, label: 'Cidadania, Direitos Humanos e movimentos sociais' },
  { num: 6, label: 'Relações de trabalho, produção e circulação' },
]
const CH_COGNITIVOS: { letter: 'A' | 'B' | 'C'; label: string }[] = [
  { letter: 'A', label: 'Reconhecimento e Recuperação' },
  { letter: 'B', label: 'Compreensão e Análise' },
  { letter: 'C', label: 'Avaliação e Proposição' },
]
function buildChDescriptors(): SaebDescriptor[] {
  return CH_EIXOS.flatMap((eixo) =>
    CH_COGNITIVOS.map((cog) => ({
      code: `${cog.letter}${eixo.num}`,
      text: `Eixo cognitivo ${cog.letter} (${cog.label}) aplicado ao eixo do conhecimento "${eixo.label}".`,
      topicId: `EIXO${eixo.num}`,
      topicLabel: eixo.label,
    })),
  )
}
const CH_5: SaebDescriptor[] = buildChDescriptors()
const CH_9: SaebDescriptor[] = buildChDescriptors()

/**
 * Ciências da Natureza (5º/9º ano) — Eixo do conhecimento (1. Matéria e
 * energia, 2. Vida e evolução, 3. Terra e universo) x Eixo cognitivo
 * (A. baixa complexidade/reconhecer, B. média complexidade/relacionar-
 * analisar, C. alta complexidade/avaliar-propor). Fonte: "Matriz de
 * Referência de Ciências da Natureza do Saeb" (INEP, maio/2020) — inclui
 * a descrição completa de cada eixo cognitivo, resumida abaixo.
 */
const CN_EIXOS: { num: number; label: string; text: string }[] = [
  { num: 1, label: 'Matéria e energia', text: 'materiais, suas propriedades e transformações físicas/químicas, fontes e formas de energia, conservação e transferência de energia' },
  { num: 2, label: 'Vida e evolução', text: 'a vida como fenômeno natural e social, características e necessidades dos seres vivos, corpo humano, saúde, biomas e ecossistemas' },
  { num: 3, label: 'Terra e universo', text: 'origem e evolução do universo e do Sistema Solar, fenômenos físicos e astronômicos do planeta Terra, sustentabilidade socioambiental' },
]
const CN_COGNITIVOS: { letter: 'A' | 'B' | 'C'; label: string }[] = [
  { letter: 'A', label: 'baixa complexidade: reconhecer, identificar, descrever conceitos básicos em contextos simples e familiares' },
  { letter: 'B', label: 'média complexidade: explicar padrões, interpretar informações científicas, analisar processos e procedimentos experimentais' },
  { letter: 'C', label: 'alta complexidade: deduzir, inferir, justificar escolhas, avaliar e propor soluções para problemas complexos' },
]
function buildCnDescriptors(): SaebDescriptor[] {
  return CN_EIXOS.flatMap((eixo) =>
    CN_COGNITIVOS.map((cog) => ({
      code: `${cog.letter}${eixo.num}`,
      text: `Eixo cognitivo ${cog.letter} (${cog.label}) aplicado ao eixo "${eixo.label}" (${eixo.text}).`,
      topicId: `EIXO${eixo.num}`,
      topicLabel: eixo.label,
    })),
  )
}
const CN_5: SaebDescriptor[] = buildCnDescriptors()
const CN_9: SaebDescriptor[] = buildCnDescriptors()

export const LP_DESCRIPTORS: Record<'2' | '5' | '9', SaebDescriptor[]> = { '2': LP_2, '5': LP_5, '9': LP_9 }
export const MATEMATICA_DESCRIPTORS: Record<'2' | '5' | '9', SaebDescriptor[]> = { '2': MT_2, '5': MT_5, '9': MT_9 }
export const CH_DESCRIPTORS: Record<'5' | '9', SaebDescriptor[]> = { '5': CH_5, '9': CH_9 }
export const CN_DESCRIPTORS: Record<'5' | '9', SaebDescriptor[]> = { '5': CN_5, '9': CN_9 }

/**
 * Retorna a lista completa de descritores oficiais (código + texto exato)
 * pra a disciplina/série — usada no prompt pra a IA escolher UM descritor
 * específico por questão, não só um tópico genérico.
 *
 * `gradeYear` é arredondado pro ano de referência da matriz oficial mais
 * próxima: LP/Matemática têm matriz própria pro 2º ano (exata, não
 * aproximada) além de 5º/9º; 3º/4º ano NÃO têm matriz própria publicada
 * pelo INEP (o SAEB testa oficialmente só 2º, 5º e 9º ano) — arredondam
 * pro 5º ano como aproximação, mesmo padrão já usado pra 6º-8º -> 9º.
 * Ciências Humanas (História/Geografia) e Ciências da Natureza (Ciências)
 * só têm referência oficial em 5º e 9º ano — mesmo arredondamento.
 */
export function getSaebDescriptorsForSubject(subject: string, gradeYear: number): SaebDescriptor[] | null {
  const normalized = subject.trim().toLowerCase()
  const referenceGrade = gradeYear <= 5 ? '5' : '9'

  if (normalized === 'matemática') {
    return MATEMATICA_DESCRIPTORS[gradeYear === 2 ? '2' : referenceGrade]
  }
  if (normalized === 'língua portuguesa' || normalized === 'português') {
    return LP_DESCRIPTORS[gradeYear === 2 ? '2' : referenceGrade]
  }
  if (normalized === 'história' || normalized === 'geografia') {
    return CH_DESCRIPTORS[referenceGrade]
  }
  if (normalized === 'ciências' || normalized === 'ciencias') {
    return CN_DESCRIPTORS[referenceGrade]
  }
  return null
}

// ENEM áreas — the code embeds the área directly (EM13<AREA>...).
export const ENEM_AREAS: Record<string, string> = {
  CNT: 'Ciências da Natureza e suas Tecnologias',
  LGG: 'Linguagens, Códigos e suas Tecnologias',
  MAT: 'Matemática e suas Tecnologias',
  CHS: 'Ciências Humanas e suas Tecnologias',
}

export function getEnemAreaFromCode(code: string): string | null {
  const match = code.match(/^EM13([A-Z]{3,4})/)
  if (!match) return null
  return ENEM_AREAS[match[1]] ?? null
}
