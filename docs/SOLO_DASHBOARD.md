# Dashboard SOLO

**Data:** 17/07/2026
**Subtarefa:** 22

Este documento descreve a análise SOLO em `/desempenho`.

## Onde aparece

O painel fica em:

```text
/desempenho
```

API:

```text
GET /api/analytics/performance
```

## Separação obrigatória

O painel separa dois conceitos:

- `SOLO_EXPECTED`: estrutura de compreensão esperada no desenho da atividade;
- `SOLO_OBSERVED`: estrutura real demonstrada em uma resposta discursiva.

`SOLO_EXPECTED` nunca é apresentado como desempenho observado do aluno.

## Fonte de SOLO_EXPECTED

A API busca classificação corrente no motor pedagógico:

```text
classifiable_type = generated_exam_question
classifiable_id = generated_exams.id
classifiable_sub_id = questions[].number
taxonomyCode = SOLO_EXPECTED
is_current = true
```

Quando ainda não há classificação persistida no motor, a API usa fallback do
payload da questão:

```text
generated_exams.generation_payload.questions[].pedagogicalClassification.soloExpected.categoryCode
```

Níveis exibidos:

- `UNIESTRUTURAL`;
- `MULTIESTRUTURAL`;
- `RELACIONAL`;
- `ABSTRATO_AMPLIADO`.

`PRE_ESTRUTURAL` não existe em `SOLO_EXPECTED`, porque não se desenha uma
atividade para gerar ausência de estrutura.

## Fonte de SOLO_OBSERVED

A API busca classificação corrente no motor pedagógico:

```text
classifiable_type = exam_correction_answer
classifiable_id = exam_corrections.id
classifiable_sub_id = answers[].questionNumber
taxonomyCode = SOLO_OBSERVED
is_current = true
```

Só respostas discursivas entram no bloco observado. Questões objetivas são
ignoradas mesmo quando há acerto/erro.

Níveis exibidos:

- `PRE_ESTRUTURAL`;
- `UNIESTRUTURAL`;
- `MULTIESTRUTURAL`;
- `RELACIONAL`;
- `ABSTRATO_AMPLIADO`.

## Métrica

Para `SOLO_EXPECTED`, o score exibido é desempenho em itens desenhados para
cada nível SOLO esperado:

- objetiva: 10/0;
- discursiva: `finalGrade` em escala 0-10.

Para `SOLO_OBSERVED`, o score exibido é a nota final da resposta discursiva
classificada naquele nível observado.

Esses scores não transformam SOLO em nota. Eles apenas ajudam a visualizar a
relação entre estrutura esperada/observada e desempenho corrigido.

## Amostra

Cada nível mostra:

- quantidade de itens ou respostas;
- percentual de desempenho;
- média em escala 0-10;
- confiança;
- aviso de amostra baixa quando há menos de 3 registros.

## Fora do escopo

- Revisar/aprovar SOLO pela UI.
- Gerar recomendações automáticas.
- Perfil cognitivo individual do aluno.
- Atribuir SOLO_OBSERVED a questões objetivas.
