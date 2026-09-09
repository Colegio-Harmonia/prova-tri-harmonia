# Perfil Cognitivo do Aluno

**Data:** 17/07/2026
**Subtarefa:** 23

Este documento descreve o perfil cognitivo por aluno em `/desempenho`.

## Onde aparece

O painel fica em:

```text
/desempenho
```

API:

```text
GET /api/analytics/performance
```

## Fonte dos dados

O perfil usa apenas correções revisadas:

```text
exam_corrections.status = "revisado"
```

O escopo respeita a mesma regra de visibilidade da página:

- professor vê apenas provas atribuídas a ele;
- coordenação/direção vê a amostra filtrada.

## Agregação

O perfil é agrupado por `studentName`, porque aluno não possui login nem
registro próprio em `users`.

Para cada aluno, a API considera:

- notas revisadas;
- itens corrigidos;
- disciplinas;
- períodos (`academicYear.bimester`);
- desempenho por Bloom;
- desempenho por DOK;
- habilidades BNCC;
- eixos INEP quando houver questão `enem_bank`;
- tamanho da amostra e confiança.

## Regras de conclusão

As conclusões são geradas por regras simples e transparentes.

Ponto forte:

```text
amostra >= 2 itens e desempenho >= 75%
```

Ponto em desenvolvimento:

```text
amostra >= 2 itens e desempenho < 60%
```

BNCC com domínio:

```text
amostra >= 3 itens vinculados e desempenho >= 80%
```

BNCC para intervenção:

```text
amostra >= 3 itens vinculados e desempenho < 60%
```

Profundidade DOK sustentada:

```text
maior DOK com amostra >= 2 itens e desempenho >= 70%
```

## Limitações exibidas

Cada perfil informa limitações quando aplicável:

- amostra pequena;
- apenas uma disciplina;
- BNCC sem amostra mínima por habilidade;
- ausência de DOK;
- ausência de eixo INEP.

## Linguagem

O painel evita rótulos permanentes.

Forma correta:

```text
Na amostra analisada, houve menor desempenho em Analisar.
```

Forma proibida:

```text
O aluno não sabe analisar.
```

## Fora do escopo

- Login ou visão do aluno.
- Recomendações automáticas extensas.
- Plano individual de estudo.
- Persistência do perfil em tabela materializada.
