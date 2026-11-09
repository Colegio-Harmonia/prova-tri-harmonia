# Ensino Médio — 1º e 2º ano

> Regras gerais (proporção 60/40, 3 entregáveis, fluxo) estão no
> `/CLAUDE.md` raiz. Este arquivo só traz o que é específico deste segmento.

## Alternativas
- Questões objetivas: **5 alternativas (A-E)**, padrão ENEM — confirmado.

## Matriz de referência
- **Matriz de Referência do ENEM** (Competências e Habilidades por área).
- 4 áreas de conhecimento do ENEM:
  - Linguagens, Códigos e suas Tecnologias
  - Matemática e suas Tecnologias
  - Ciências da Natureza e suas Tecnologias
  - Ciências Humanas e suas Tecnologias
- Diferente do SAEB (que usa "descritor"), o ENEM usa **Competência de
  área (C1-C7 aprox.) + Habilidade (H1-H30 aprox., variando por área)**.
  No mapa da prova, o campo equivalente ao "descritor SAEB" dos outros
  segmentos vira **Competência + Habilidade ENEM**.

### Formato do código BNCC do Ensino Médio — confirmado
`EM13` + sigla da área (3-4 letras) + dígito da competência + dígito(s) da
habilidade. Ex: `EM13CNT201` = Ensino Médio, área CNT (Ciências da
Natureza), competência 2, habilidade 01. Siglas de área vistas/esperadas:
`CNT` (Ciências da Natureza), `LGG` (Linguagens), `MAT` (Matemática),
`CHS` (Ciências Humanas). Igual ao Fundamental, a coluna Habilidades pode
vir em formato **código solto sem descrição** (confirmado em Biologia 2º
ano: `EM13CNT201 EM13CNT202 EM13CNT301...`) — aplicar a mesma regra de
parsing e de "não inventar descrição" documentada no `/CLAUDE.md` raiz.

### Cruzamento BNCC↔ENEM — mais direto que o SAEB
Como o próprio código BNCC do EM já embute a área (`CNT`, `LGG`, `MAT`,
`CHS`), o cruzamento com a área do ENEM é **quase automático por
correspondência de sigla** — muito mais confiável que o cruzamento com
SAEB no Fundamental. O que ainda exige aproximação é o nível de
**Competência/Habilidade específica do ENEM** (C1-C7/H1-H30), que não vem
na sigla BNCC e precisa de julgamento pedagógico sobre qual competência
ENEM aquele conteúdo mais se aproxima — sinalizar como aproximação no mapa
da prova, mesma regra de honestidade usada no cruzamento SAEB.

### Planejamento pela Matriz do ENEM — coluna "Habilidades ENEM" (09/11/2026)
Disciplinas do EM podem ser planejadas direto pela Matriz do ENEM
(Competência:Habilidade), como vem no material do Inglês do 1º ano
(`C2:H5 (Unesp-2022)`, uma linha por questão do material). Como funciona:
- **Planejamento interno** (`/planejamento`, caminho usado hoje pelo Inglês
  do EM — a geração por planilha dessas séries falha por aba ambígua): campo
  "Habilidades ENEM" por unidade, coluna `curriculum_plan_units.enem_skills`
  (migration 0048), mesmo formato e mesmo parser da planilha.
- **Planilha**: coluna opcional `Habilidades ENEM` (sinônimos em
  `headerResolver.ts`: `Matriz ENEM`, `ENEM`, `Habilidades INEP`…). Se a
  aba não tiver essa coluna, códigos `C<n>:H<n>` colados dentro de
  `Habilidades` também são lidos. BNCC e ENEM convivem, um não substitui
  o outro.
- **Leitura** (`src/lib/sheets/enemSkillsParser.ts`): aceita `C2:H5`,
  `C2-H5`, `C2 H5`; o texto entre parênteses vira `sources` (origem da
  questão do material); repetição vira `count` = peso do capítulo. O par
  C:H é validado contra a fronteira oficial da área
  (`src/config/enemMatrix.ts`); par inexistente (ex: `C2:H14`) vai pra
  `invalid` e vira aviso pra corrigir a planilha, nunca é corrigido por
  palpite.
- **Geração (pipeline unificado, 1 chamada por questão)**: a habilidade
  ENEM de cada questão é escolhida **por código**, não pela IA —
  `pickTargetEnemSkill()` (`src/lib/exams/targetSkills.ts`) faz rodízio
  ponderado suave pelo peso do planejamento (H5×8, H7×1… → H5, H5, H7,
  H5…), mesmo padrão do `pickTargetSkills` da BNCC. Ela entra no prompt
  como "HABILIDADE ENEM-ALVO" (`buildSkillBlock`, `unifiedRunner.ts`) e
  `finalize.ts` grava `saeb = { source:'enem', value:'C2:H5 — <descrição>',
  approximate:false }`. Sem planejamento ENEM, `saeb` continua
  `applicable:false` como antes. Substituição de questão mantém a
  habilidade ENEM da original (`targetEnemCode`); reparo de BNCC pelo Jev
  preserva o `saeb` da questão.
- **Validação** (`examValidator.ts`, `checkEnemSkill`): código planejado e
  válido vira `"C2:H5 — <descrição>"` com `approximate:false`; fora do
  planejamento ou inexistente na matriz fica `approximate:true` com aviso
  pro revisor.
- Capítulo sem BNCC mas com habilidades ENEM **não** gera o aviso "BNCC
  não mapeada" — o capítulo está mapeado, só por outra matriz.
- Ainda não feito: painel de desempenho por habilidade ENEM em
  `/desempenho` (hoje só eixo cognitivo de questão do banco) e pré-seleção
  automática do filtro de habilidade do banco ENEM (o filtro é de seleção
  única).

### ⚠️ Disciplina sem coluna "Habilidades" — caso real confirmado
Confirmado que pelo menos uma disciplina (Sociologia, 1º ano) **não tem a
coluna Habilidades na aba**, nem vazia — ela não existe na estrutura. Nesse
caso: gerar a prova com base em `Capítulo`/`Número`/`Conteúdos-foco`
normalmente, mas o campo BNCC/ENEM do mapa da prova fica "não mapeado nesta
aba" para todas as questões dessa disciplina — sem exceção, mesmo que
pareça óbvio qual seria a competência aproximada. Recomendar à coordenação
pedagógica avaliar se vale adicionar essa coluna nas disciplinas de
Ciências Humanas que ainda não têm.

## Disciplinas suportadas
`[preencher — tipicamente todas as da BNCC do Novo Ensino Médio: Língua
Portuguesa, Matemática, Física, Química, Biologia, História, Geografia,
Filosofia, Sociologia, Inglês]`

## Planilhas por ano (1 arquivo, abas por disciplina)
| Ano | Google Drive (fileId) |
|---|---|
| 1º ano EM | `19E7BrZz3wmVXH_FyvYDVh4rjQ69pSJ6zsmOarzlv6CY` |
| 2º ano EM | `1MOlNNuXE6BMVgmH0Faw9q4GwyJDICIXx4yxXnKv7nnw` |

Nomenclatura das abas: **cada aba tem o nome exato da disciplina** (ex:
aba "Sociologia", aba "Biologia").

Formato de cada aba: ver `Fonte de dados` no `/CLAUDE.md` raiz (cronograma
por bimestre/capítulo, parsing de Habilidades e Objetivos). Atenção:
confirmado que pelo menos uma disciplina (Sociologia) não tem coluna
Habilidades — ver regra de fallback no root.

Atenção: a BNCC do Novo Ensino Médio é organizada por Competências Gerais +
área de conhecimento, não por componente curricular fechado como no
Fundamental — então dentro de cada aba, o mapeamento disciplina→área do
ENEM pode não ser 1:1 (ex: uma aba de "Ciências Humanas" pode misturar
História, Geografia, Filosofia e Sociologia). Confirmar como as abas estão
nomeadas quando o arquivo for compartilhado.

Atenção: a BNCC do Novo Ensino Médio é organizada por Competências Gerais +
área de conhecimento, não por componente curricular fechado como no
Fundamental — então dentro de cada planilha de série, a coluna
`disciplina` pode precisar de uma coluna extra `area_conhecimento` pra
mapear certo pra competência ENEM correspondente.

## Observações pedagógicas
- Questões objetivas devem seguir o estilo ENEM: texto-base/contexto
  (gráfico, tirinha, trecho, situação-problema) antes do comando —
  evitar pergunta seca de decoreba.
- Distribuição de Bloom deve pender para Aplicar/Analisar/Avaliar — nível
  Lembrar deve ser minoria nesse segmento, coerente com o próprio desenho
  do ENEM (que testa raciocínio, não memorização pura).
- Questões descritivas podem incluir 1 questão modelo "redação curta"
  (mini dissertativa) por prova quando a disciplina for Linguagens,
  aproximando da lógica da competência de escrita do ENEM — mas sem virar
  substituto da redação oficial da escola.
