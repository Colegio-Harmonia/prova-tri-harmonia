# Dashboard DOK

**Data:** 17/07/2026
**Subtarefa:** 18

Este documento descreve o dashboard de desempenho por DOK (Depth of
Knowledge).

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

A API busca classificações correntes no motor pedagógico:

```text
classifiable_type = generated_exam_question
classifiable_id = generated_exams.id
classifiable_sub_id = questions[].number
taxonomyCode = DOK
is_current = true
```

Se a classificação ainda não estiver persistida no motor, a API usa fallback
do payload da questão (`pedagogicalClassification.dok.categoryCode`) para
preservar dados gerados pela IA na Subtarefa 14.

## Métrica

Para cada resposta corrigida e revisada:

- questão objetiva: `isCorrect=true` vale 10, `false` vale 0;
- questão discursiva: usa `finalGrade` em escala 0-10;
- taxa de acerto por DOK = `soma(score) / (itens * 10)`;
- acertos equivalentes = `soma(score) / 10`.

## Campos exibidos

Para cada nível DOK:

- quantidade de itens;
- acertos equivalentes;
- taxa de acerto;
- tamanho da amostra;
- nível de confiança;
- evolução por período;
- distribuição por disciplina.

## DOK 4

DOK 4 só aparece quando houver itens classificados nesse nível. Quando não há
amostra DOK 4, a interface mostra uma nota explicando que isso é esperado em
provas comuns, porque DOK 4 normalmente exige projeto, investigação ou
produção extensa.

## Confiança

Mesma regra operacional inicial do dashboard Bloom:

- `alta`: 15 ou mais itens;
- `media`: 6 a 14 itens;
- `baixa`: menos de 6 itens.

Quando a amostra é inferior a 6 itens, a interface exibe aviso para não tirar
conclusões fortes.

## Fora do escopo

- Dashboard BNCC.
- Eixos Cognitivos do INEP.
- Matriz Bloom x DOK.
- Perfil cognitivo individual do aluno.
