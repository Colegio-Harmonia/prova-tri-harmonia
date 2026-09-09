# Questões Existentes — Motor de Classificações Pedagógicas

**Data:** 17/07/2026
**Subtarefa:** 13

Este documento descreve a integração inicial das questões já existentes em
provas geradas (`generated_exams.generation_payload.questions[]`) com o Motor
de Classificações Pedagógicas.

## 1. Endereçamento

Cada questão existente é endereçada sem normalizar nova tabela:

```text
classifiable_type = generated_exam_question
classifiable_id = generated_exams.id
classifiable_sub_id = questions[].number
```

Esse formato preserva a decisão arquitetural atual: `generation_payload`
continua sendo a fonte de verdade das questões da prova.

## 2. Escopo

A Subtarefa 13 cobre apenas:

- `DOK`;
- `SOLO_EXPECTED`.

Não cria:

- `SOLO_OBSERVED`, porque depende de resposta do aluno;
- Bloom novo;
- BNCC nova;
- Eixo cognitivo novo.

Bloom, BNCC e SAEB já existentes no `generation_payload` são usados apenas
como evidência auxiliar para a sugestão inicial.

## 3. Serviço

Arquivo:

```text
src/lib/pedagogical/existingQuestionClassificationService.ts
```

Função principal:

```ts
classifyExistingGeneratedQuestionSample(params)
```

Parâmetros:

- `limit`: quantidade máxima de questões, padrão `5`, máximo `25`.
- `examId`: restringe a uma prova específica.
- `subject`: restringe por disciplina.
- `segment`: restringe por segmento.
- `status`: restringe por status da prova.
- `includeEnemBank`: inclui questões de banco ENEM dentro de provas geradas;
  padrão `true`.
- `apply`: quando `true`, grava sugestões no motor.

## 4. Script operacional

Comando:

```bash
npm run classify-existing-questions-sample
```

Simulação padrão:

```bash
LIMIT=5 npm run classify-existing-questions-sample
```

Simulação de uma prova específica:

```bash
EXAM_ID=21 LIMIT=10 npm run classify-existing-questions-sample
```

Simulação filtrada:

```bash
SEGMENT=ensino-medio SUBJECT=Matemática LIMIT=5 npm run classify-existing-questions-sample
```

Gravação controlada:

```bash
APPLY=true EXAM_ID=21 LIMIT=5 npm run classify-existing-questions-sample
```

## 5. Segurança operacional

- O script roda em dry-run por padrão.
- Gravação exige `APPLY=true`.
- O serviço limita a no máximo 25 questões por execução.
- Classificação corrente existente nunca é substituída por este script.
- Gravações usam `classificationService.suggest()`, preservando auditoria,
  versionamento e regras de precedência.
- Lote total continua fora do escopo.

## 6. Heurística inicial

A heurística compartilhada vive em:

```text
src/lib/pedagogical/questionHeuristics.ts
```

Ela propõe `DOK` e `SOLO_EXPECTED` a partir de:

- texto da questão;
- texto de apoio;
- alternativas;
- resposta esperada;
- critérios de correção;
- Bloom já presente no payload;
- tipo da questão (`objetiva` ou `descritiva`).

Essa heurística é uma ponte operacional segura para amostra. Ela não substitui
classificação por IA estruturada futura nem revisão humana.

## 7. Próxima etapa

A Subtarefa 14 deve integrar a geração de novas questões com metadados
pedagógicos estruturados já na saída da IA.
