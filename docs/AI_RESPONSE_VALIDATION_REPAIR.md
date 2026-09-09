# Validação e Reparo de Respostas da IA

**Data:** 17/07/2026
**Subtarefa:** 15

Este documento registra o gate de validação/reparo criado para respostas
estruturadas da IA antes de qualquer persistência no sistema.

## Objetivo

DeepSeek garante apenas JSON sintaticamente válido via
`response_format:{type:"json_object"}`. Ele não garante que a resposta siga o
schema esperado nem que cumpra regras semânticas do sistema, como quantidade de
alternativas, proporção 60/40 ou presença de `pedagogicalClassification`.

A Subtarefa 15 centraliza essa proteção em:

```text
src/lib/gemini/structuredRepair.ts
```

## Comportamento

`generateValidatedStructuredContent()` executa:

1. chamada ao LLM com schema JSON;
2. validação Zod;
3. validação semântica opcional;
4. reparo por prompt quando houver erro;
5. limite explícito de tentativas;
6. descarte da resposta se continuar inválida;
7. log de cada falha de tentativa no servidor.

O padrão atual é `maxAttempts = 2`: uma geração inicial e uma tentativa de
reparo. O limite pode ser ajustado por call site se necessário, mas não deve
ser removido.

## Onde é usado

- `POST /api/exams/generate`: geração de prova inteira.
- `POST /api/exams/[examId]/regenerate`: regeneração de prova inteira.
- `POST /api/exams/[examId]/regenerate-question`: troca de uma questão.
- `suggestGrade()`: sugestão de nota para questão discursiva.

## Erro controlado

Quando o limite é atingido, o helper lança `StructuredGenerationError` com:

- contexto do call site;
- número de tentativas;
- últimos problemas de validação.

As rotas de geração retornam `502` com mensagem específica e `issues`, em vez
de salvar payload parcialmente inválido.

## Relação com o motor pedagógico

A validação estrutural de `pedagogicalClassification` continua em
`examSchema.ts`. A validação/reparo da Subtarefa 15 garante que o payload só
chegue em `persistGeneratedQuestionClassifications()` se tiver passado pelo
schema e pela validação semântica de prova/questão.

## Fora do escopo

- Criar tabela de falhas de IA.
- Retentar indefinidamente.
- Corrigir conteúdo pedagógico manualmente.
- Implementar `SOLO_OBSERVED`.
- Criar dashboards novos.
