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

## O que a teia não faz

- Não usa pré-requisito curricular ("A é base para B"): o sistema não tem essa
  informação e ela não é inventada. É o próximo passo natural, com sugestão
  da IA e aprovação da coordenação, no mesmo padrão do Motor de Classificação.
- Não é diagnóstico: correlação entre colegas não prova causa.
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
