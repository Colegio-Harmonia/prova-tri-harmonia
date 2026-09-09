# Dashboard Bloom

**Data:** 17/07/2026
**Subtarefa:** 17

Este documento descreve o primeiro dashboard cognitivo incremental do motor:
desempenho por Taxonomia de Bloom.

## Onde aparece

O dashboard fica na página existente:

```text
/desempenho
```

Arquivo principal:

```text
src/app/(app)/desempenho/DesempenhoPanel.tsx
```

API:

```text
GET /api/analytics/performance
```

## Métrica

Para cada resposta corrigida e revisada:

- questão objetiva: `isCorrect=true` vale 10, `false` vale 0;
- questão discursiva: usa `finalGrade` em escala 0-10;
- percentual de acerto por Bloom = `soma(score) / (itens * 10)`;
- acertos equivalentes = `soma(score) / 10`.

Essa escolha evita tratar discursivas como binárias e deixa explícito que
“acerto” em discursiva é proporcional à nota final.

## Campos exibidos

Para cada nível:

- quantidade de questões;
- acertos equivalentes;
- percentual de acerto;
- média em escala 0-10;
- tamanho da amostra;
- nível de confiança;
- evolução recente por período.

## Confiança

Regra operacional inicial:

- `alta`: 15 ou mais itens;
- `media`: 6 a 14 itens;
- `baixa`: menos de 6 itens.

Quando a amostra é inferior a 6 itens, a interface exibe aviso para não tirar
conclusões fortes.

## Evolução

A evolução usa período derivado da prova:

```text
academicYear.bimester
```

Exemplo: `2026.3`.

## Fora do escopo

- Dashboard DOK.
- Dashboard BNCC.
- Eixos Cognitivos do INEP.
- Matriz Bloom x DOK.
- Perfil cognitivo individual do aluno.
