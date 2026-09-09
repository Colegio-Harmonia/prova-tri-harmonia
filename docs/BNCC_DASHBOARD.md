# Dashboard BNCC

**Data:** 17/07/2026
**Subtarefa:** 19

Este documento descreve o dashboard de desempenho por BNCC.

## Onde aparece

O dashboard fica em:

```text
/desempenho
```

API:

```text
GET /api/analytics/performance
```

## Fonte da classificação

A BNCC permanece no payload histórico da prova:

```text
generated_exams.generation_payload.questions[].bnccCodes
generated_exams.generation_payload.questions[].bnccStatus
generated_exams.generation_payload.questions[].bnccSummary
```

Essa decisão segue a arquitetura do motor pedagógico: o motor novo é aditivo e
não migra Bloom, BNCC ou Eixos Cognitivos do INEP para as tabelas genéricas.

## Métrica

Para cada resposta corrigida e revisada:

- questão objetiva: `isCorrect=true` vale 10, `false` vale 0;
- questão discursiva: usa `finalGrade` em escala 0-10;
- taxa de desempenho por habilidade = `soma(score) / (itens vinculados * 10)`;
- acertos equivalentes = `soma(score) / 10`.

Quando uma questão possui mais de um código BNCC, ela entra uma vez em cada
habilidade vinculada. Por isso o total de itens vinculados pode ser maior que
o número de respostas corrigidas.

## Campos exibidos

O painel exibe:

- quantidade de habilidades BNCC mapeadas;
- quantidade de itens vinculados a habilidades;
- quantidade de itens sem BNCC mapeada;
- desempenho por componente curricular;
- desempenho por ano/série;
- lista de habilidades ordenada por maior necessidade de atenção;
- taxa de desempenho, itens, acertos equivalentes, confiança e evolução por
  período.

## Status pedagógico

Regra operacional inicial:

- `dominio`: 80% ou mais, com pelo menos 3 itens vinculados;
- `desenvolvimento`: 60% a 79%, com pelo menos 3 itens vinculados;
- `intervencao`: abaixo de 60%, com pelo menos 3 itens vinculados;
- `amostra_insuficiente`: menos de 3 itens vinculados.

A ordenação prioriza primeiro habilidades em intervenção, depois habilidades
em desenvolvimento, depois domínio e, por último, amostras insuficientes.

## Unidade temática

O payload atual salva código BNCC e resumo (`bnccSummary`), mas não salva a
unidade temática como campo estruturado. A interface não inventa esse dado:
exibe `Unidade temática: não informada no payload atual`.

Para agrupar por unidade temática de forma confiável, será necessário persistir
esse campo na geração futura ou enriquecer os códigos BNCC a partir de uma
fonte oficial versionada.

## Confiança

O nível de confiança segue a mesma regra operacional dos dashboards Bloom e
DOK:

- `alta`: 15 ou mais itens;
- `media`: 6 a 14 itens;
- `baixa`: menos de 6 itens.

Para status pedagógico, a amostra mínima é mais conservadora: 3 itens
vinculados. Abaixo disso, a habilidade fica como `amostra_insuficiente` mesmo
que o percentual seja alto ou baixo.

## Fora do escopo

- Buscar unidade temática oficial por código BNCC.
- Reclassificar ou migrar BNCC para as tabelas do motor pedagógico.
- Dashboard dos Eixos Cognitivos do INEP.
- Matriz Bloom x DOK.
- Perfil cognitivo individual do aluno.
