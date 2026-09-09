# Integração ENEM — Motor de Classificações Pedagógicas

**Data:** 17/07/2026
**Subtarefa:** 12

Este documento descreve a primeira integração entre questões importadas do
ENEM (`imported_questions`) e o Motor de Classificações Pedagógicas.

## 1. Objetivo

Classificar uma amostra pequena de questões reais do ENEM no motor novo,
endereçando cada item como:

```text
classifiable_type = imported_question
classifiable_id = imported_questions.id
classifiable_sub_id = NULL
```

Nesta subtarefa, a integração cobre apenas:

- `DOK`;
- `SOLO_EXPECTED`.

`SOLO_OBSERVED` fica explicitamente fora: ele depende de resposta produzida
pelo aluno, não da questão.

## 2. Princípios de segurança

- O script roda em simulação por padrão.
- Nenhuma execução padrão altera o banco.
- Gravação real exige `APPLY=true`.
- O limite máximo do serviço é 25 questões por execução.
- Classificação corrente existente é ignorada por padrão.
- A tabela legada `imported_question_classifications` não é alterada.

## 3. Serviço

Arquivo:

```text
src/lib/pedagogical/importedEnemClassificationService.ts
```

Função principal:

```ts
classifyImportedEnemSample(params)
```

Parâmetros:

- `limit`: tamanho da amostra, padrão `5`, máximo `25`.
- `year`: filtra por ano do ENEM.
- `discipline`: filtra por área/disciplina (`linguagens`, `matematica`,
  `ciencias-natureza`, `ciencias-humanas`).
- `apply`: quando `true`, grava sugestões no motor novo.
- `includeExisting`: quando `true`, inclui itens com classificação corrente
  apenas para comparação; por padrão eles são ignorados.

## 4. Script operacional

Comando:

```bash
npm run classify-imported-enem-sample
```

Simulação com amostra:

```bash
LIMIT=3 npm run classify-imported-enem-sample
```

Simulação filtrada:

```bash
LIMIT=5 YEAR=2023 DISCIPLINE=matematica npm run classify-imported-enem-sample
```

Gravação controlada:

```bash
APPLY=true LIMIT=3 YEAR=2023 npm run classify-imported-enem-sample
```

## 5. Regra de sugestão inicial

A Subtarefa 12 não implementa chamada de IA nem lote total. Ela cria uma
ponte operacional segura para amostra, com heurística conservadora:

- `DOK_3`: quando há evidência de escolha estratégica, proposta, intervenção,
  avaliação ou eixo ENEM associado a construção de argumentação/proposta.
- `DOK_2`: quando há aplicação/análise de conceito, cálculo, relação, gráfico,
  tabela ou comparação.
- `DOK_1`: fallback conservador para reconhecimento direto.
- `SOLO_EXPECTED RELACIONAL`: derivado de `DOK_3`.
- `SOLO_EXPECTED MULTIESTRUTURAL`: derivado de `DOK_2`.
- `SOLO_EXPECTED UNIESTRUTURAL`: derivado de `DOK_1`.

Essa regra não substitui revisão humana. As classificações gravadas entram
como sugestões auditáveis com:

```text
source = ENEM_IMPORT
model_provider = system
model_name = enem-sample-heuristic
prompt_version = enem-import-sample-v1
```

Atualização da Subtarefa 13: a heurística comum foi extraída para
`src/lib/pedagogical/questionHeuristics.ts` e passou a ser compartilhada com a
classificação de questões já existentes em provas geradas.

## 6. Fora do escopo

- Rodar lote total.
- Chamar IA para classificar todos os itens.
- Criar UI de revisão.
- Migrar Bloom, eixo cognitivo, habilidade ENEM ou BNCC para o motor novo.
- Alterar `imported_question_classifications`.
- Criar `SOLO_OBSERVED` para questões.

## 7. Próxima etapa

A Subtarefa 13 deve integrar classificações de questões existentes de forma
mais ampla, ainda sem executar lote total sem validação.
