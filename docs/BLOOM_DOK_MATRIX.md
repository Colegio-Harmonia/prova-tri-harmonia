# Matriz Bloom x DOK

**Data:** 17/07/2026
**Subtarefa:** 21

Este documento descreve a matriz de desempenho Bloom x DOK.

## Onde aparece

A matriz fica em:

```text
/desempenho
```

API:

```text
GET /api/analytics/performance
```

## Fonte das classificações

Bloom vem do payload da questão:

```text
generated_exams.generation_payload.questions[].bloomLevel
```

DOK vem da classificação corrente do motor pedagógico:

```text
classifiable_type = generated_exam_question
classifiable_id = generated_exams.id
classifiable_sub_id = questions[].number
taxonomyCode = DOK
is_current = true
```

Quando a classificação DOK ainda não está persistida no motor, a API usa
fallback do payload da questão:

```text
generated_exams.generation_payload.questions[].pedagogicalClassification.dok.categoryCode
```

## Métrica

Para cada resposta corrigida e revisada:

- questão objetiva: `isCorrect=true` vale 10, `false` vale 0;
- questão discursiva: usa `finalGrade` em escala 0-10;
- taxa da célula = `soma(score) / (itens * 10)`;
- acertos equivalentes = `soma(score) / 10`.

Cada célula representa uma combinação:

```text
Bloom level x DOK level
```

Exemplo:

```text
Aplicar x DOK 3
```

## Campos exibidos

Cada célula mostra:

- percentual de desempenho;
- quantidade de itens;
- confiança, quando há amostra suficiente;
- alerta de amostra baixa quando há menos de 3 itens.

## Amostra insuficiente

A matriz não deve gerar conclusão pedagógica quando uma célula possui menos de
3 itens. A interface mostra `amostra baixa` nesses casos.

A regra é mais conservadora que a confiança geral dos dashboards Bloom/DOK,
porque a matriz divide a amostra em várias células pequenas.

## Interpretação

A leitura recomendada é comparar a mesma linha de Bloom entre níveis DOK.

Exemplo:

```text
Aplicar x DOK 2: 80%
Aplicar x DOK 3: 45%
```

Se ambas as células tiverem amostra suficiente, isso sugere que o aluno ou a
turma consegue aplicar procedimentos em baixa/média profundidade, mas apresenta
queda quando a tarefa exige maior profundidade cognitiva.

## Fora do escopo

- Gerar recomendações pedagógicas automáticas.
- Perfil cognitivo individual do aluno.
- Análise SOLO.
- Cruzamentos com BNCC ou Eixos Cognitivos do INEP.
