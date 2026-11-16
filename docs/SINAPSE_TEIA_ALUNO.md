# Sinapse — teia de habilidades do aluno

**Data:** 16/11/2026
**Onde:** `/desempenho/relatorio?aluno=…&aba=teia`

## Objetivo

Mostrar, para um aluno, numa só imagem:

1. o que ele domina e o que está em desenvolvimento;
2. qual dificuldade é a **raiz** (não explicada por outra anterior);
3. quais habilidades **ainda não avaliadas** correm risco por herdarem essas
   dificuldades.

## Dados

| Peça | Fonte |
|---|---|
| Nó | Linha de `calculateStudentMastery` (código BNCC × bimestre), com todas as habilidades planejadas no ano das disciplinas em que o aluno foi avaliado |
| Domínio | Mesmo cálculo e mesmas regras de amostra do Bloco 4 (`MASTERY_RULES`) |
| Retomada | Mesmo código BNCC planejado de novo num bimestre seguinte (peso 0,9) |
| Correlação observada | Colegas do mesmo ano/segmento/série/disciplina, dentro do escopo de quem consulta |

Só entram correções `revisado`, com presença, de `exam_kind = 'prova'`
(`evidenceConditions`). Professor vê só as próprias provas, tanto para o aluno
quanto para os colegas usados nas correlações.

## Regras (`src/lib/curriculum/skillNetwork.ts`)

- **Fraqueza** de uma habilidade avaliada = `(80 − aproveitamento) / 80`, só
  quando a leitura é possível (em desenvolvimento, próximo do domínio ou
  domínio). Evidência insuficiente vale 0 e não propaga.
- **Correlação**: para cada aluno, resíduo = aproveitamento na habilidade −
  aproveitamento geral do aluno no recorte. Isso evita confundir "aluno bom vai
  bem em tudo" com ligação entre conteúdos. Ligação só com ≥ 6 alunos em comum e
  r ≥ 0,4; no máximo 3 por habilidade. Bimestres diferentes dão uma seta do
  anterior para o posterior; no mesmo bimestre a ligação não tem sentido.
- **Risco** de habilidade sem evidência = `1 − Π(1 − peso × força da fonte)`.
  Uma fonte também sem evidência repassa 85% do próprio risco, só se for
  anterior. A partir de 0,45 o risco é alto; a partir de 0,22, moderado.
- **Raiz**: habilidade em desenvolvimento sem nenhuma anterior, também em
  desenvolvimento, ligada a ela.

## Pré-requisitos curriculares (16/11/2026)

Terceiro tipo de ligação: "A é base para B". Fica em
`curriculum_skill_prerequisites` (migration `0056`, aditiva) e é mantido em
**Planejamento › Pré-requisitos**.

- **Sugestão por IA** (`POST /api/curriculum/prerequisites/suggest`, contexto de
  IA `curriculum/prerequisites`, temperatura 0,2): para cada habilidade
  planejada de uma série, a IA escolhe até 3 bases **só entre as habilidades da
  mesma disciplina planejadas antes**: até duas séries atrás, ou a mesma série
  em bimestre anterior. Código fora dessa lista, repetido, força inválida ou
  justificativa com menos de 20 caracteres é descartado
  (`prerequisiteSuggestions.ts`). Uma chamada a cada 6 habilidades.
- **Sem sobrescrever decisão**: um par por linha (índice único). Por padrão a
  sugestão pula a habilidade que já tem qualquer registro, então uma rejeição
  nunca volta como sugestão nova.
- **Revisão** (`PATCH /api/curriculum/prerequisites/:id`): aprovar, rejeitar e
  ajustar a força (essencial 0,9 · importante 0,7 · apoio 0,5). Numa
  sugestão, a força muda só na tela até alguém clicar em Aprovar.
- **Cadastro direto** (`POST /api/curriculum/prerequisites`): já nasce
  aprovado. Os dois códigos precisam estar no planejamento e a base não pode
  ser de série posterior.
- **Permissão**: ler é de qualquer usuário autenticado; sugerir, revisar e
  cadastrar é só de coordenação/direção (`isStaffSuperuser`, checado no
  serviço).
- **Na Teia**: só o que está `aprovada`. A ligação vai da ocorrência mais
  recente da base, até o bimestre da habilidade e inclusive de série anterior,
  à habilidade. Uma base de outra série entra na visão da disciplina atual
  para mostrar de onde vem a dificuldade. Pré-requisito no mesmo bimestre
  também define a raiz.

**Antes de publicar**: aplicar `drizzle/0056_curriculum_skill_prerequisites.sql`
(o código lê a tabela). Sem ela, a Teia e a aba Pré-requisitos quebram ao
consultar.

## O que a teia não faz

- Não é diagnóstico: correlação entre colegas não prova causa, e
  pré-requisito aprovado é uma hipótese pedagógica da escola, não regra da BNCC.
- A IA não cria pré-requisito entre disciplinas diferentes.
- No começo do ano, com poucas provas corrigidas, quase só há retomadas. Por
  isso a tela abre na **Linha do tempo** quando há menos ligações que metade dos
  nós.

## Tela

`SkillNetworkSection.tsx`: Teia (força calculada fora da tela e desenhada com
posições fixas, mesma escala em x e y) ou Linha do tempo (coluna por bimestre).
Cores vêm dos tokens de `globals.css` e redesenham quando o tema muda. Abaixo do
gráfico ficam o detalhe da habilidade clicada (com link para criar atividade de
recuperação), as raízes e o que está em risco. As listas trazem o mesmo conteúdo
em texto. O componente só monta com a aba visível (o gráfico precisa da largura
real do quadro).
