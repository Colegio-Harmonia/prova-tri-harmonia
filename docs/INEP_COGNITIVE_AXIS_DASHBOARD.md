# Dashboard dos Eixos Cognitivos do INEP

**Data:** 17/07/2026
**Subtarefa:** 20

Este documento descreve o dashboard de desempenho por Eixo Cognitivo do INEP.

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

A fonte confiável atual para os eixos DL/CF/SP/CA/EP é o banco de questões
reais do ENEM:

```text
generated_exams.generation_payload.questions[].source = "enem_bank"
generated_exams.generation_payload.questions[].enemBankRef.questionId
imported_question_classifications.enem_cognitive_axis_id
enem_cognitive_axes.code/name/description
```

Questões geradas por IA podem carregar `saeb.source = "enem"` e uma habilidade
ENEM no campo `saeb.value`, mas não carregam eixo cognitivo estruturado no
payload atual. O dashboard não infere esse eixo para evitar dado pedagógico
fabricado.

## Eixos exibidos

O painel exibe sempre os cinco eixos, usando o código como identificador e o
nome completo na interface:

- `DL`: Dominar Linguagens;
- `CF`: Compreender Fenômenos;
- `SP`: Enfrentar Situações-Problema;
- `CA`: Construir Argumentação;
- `EP`: Elaborar Propostas.

## Métrica

Para cada resposta corrigida e revisada ligada a uma questão `enem_bank`:

- questão objetiva: `isCorrect=true` vale 10, `false` vale 0;
- taxa de desempenho por eixo = `soma(score) / (itens * 10)`;
- acertos equivalentes = `soma(score) / 10`.

Como as questões reais do ENEM são objetivas, a métrica atual é binária por
item. A API mantém a mesma estrutura dos dashboards Bloom/DOK/BNCC para
facilitar evolução futura.

## Campos exibidos

Para cada eixo:

- código;
- nome completo;
- descrição;
- quantidade de itens;
- acertos equivalentes;
- taxa de desempenho;
- tamanho da amostra;
- nível de confiança;
- evolução por período;
- distribuição por disciplina.

## Confiança

Mesma regra operacional dos dashboards Bloom e DOK:

- `alta`: 15 ou mais itens;
- `media`: 6 a 14 itens;
- `baixa`: menos de 6 itens.

Quando a amostra é inferior a 6 itens, a interface exibe aviso para não tirar
conclusão forte.

## Itens sem eixo

O resumo também mostra `Itens ENEM sem eixo`. Esse número representa questões
`enem_bank` presentes em correções revisadas, mas sem classificação de eixo
encontrada em `imported_question_classifications`.

## Fora do escopo

- Inferir eixo INEP para questão gerada por IA sem campo estruturado.
- Criar classificação secundária de eixo.
- Migrar Eixos Cognitivos do INEP para o motor genérico.
- Matriz Bloom x DOK.
- Perfil cognitivo individual do aluno.
