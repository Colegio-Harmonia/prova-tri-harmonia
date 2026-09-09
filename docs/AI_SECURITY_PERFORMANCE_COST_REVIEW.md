# Revisao de Seguranca, Desempenho e Custos de IA

**Data:** 17/07/2026
**Subtarefa:** 25

Esta revisao cobre os fluxos que enviam conteudo para IA:

- geracao inicial de prova;
- regeneracao completa de prova;
- troca de uma questao;
- sugestao de nota para resposta discursiva;
- classificacao `SOLO_OBSERVED` de resposta discursiva.

## Seguranca e privacidade

O sistema nao envia nome do aluno para a IA nos fluxos revisados. Para reduzir
risco quando o proprio texto da resposta trouxer dados pessoais, foi criado
`prepareStudentAnswerForAi()` em `src/lib/ai/promptSafety.ts`.

Antes de enviar resposta de aluno para IA, o helper:

- remove e-mails;
- remove CPF em formatos comuns;
- remove telefones em formatos comuns;
- normaliza espacos;
- limita o texto a `AI_MAX_STUDENT_ANSWER_CHARS` ou 4000 caracteres por
  padrao.

O helper foi aplicado em:

- `src/lib/gemini/gradeSuggestion.ts`;
- `src/lib/pedagogical/soloObservedClassificationService.ts`.

## Desempenho

A rota de sugestao de notas usava `Promise.all` para todas as respostas
discursivas pendentes. Isso podia abrir varias chamadas simultaneas para IA na
mesma correcao.

Agora `src/app/api/exams/[examId]/corrections/[correctionId]/suggest/route.ts`
processa sugestoes em lotes com concorrencia maxima 2.

## Custos

Controles existentes preservados:

- provas geradas por IA continuam limitadas a 15 questoes;
- `questionCount` pode ser 0 quando a prova usa apenas banco ENEM;
- respostas estruturadas da IA continuam com no maximo 2 tentativas de reparo;
- chamadas ao provedor mantem timeout de 120 segundos;
- sugestao de nota nao sobrescreve sugestao ja existente nem nota final.

Controles adicionados:

- limite de tamanho para resposta de aluno enviada a IA;
- redacao basica de dados pessoais no texto de resposta;
- limite de concorrencia para sugestoes de nota.

## Integridade pedagogica

A regeneracao completa de prova foi alinhada com a geracao inicial e com a troca
de uma questao:

- apos regenerar questoes por IA, persiste `DOK` e `SOLO_EXPECTED` no motor;
- usa `replaceExisting:true` para substituir classificacoes correntes nao
  protegidas;
- registra `createdBy`, `modelProvider`, `modelName` e `promptVersion`.

O servico `persistGeneratedQuestionClassifications()` agora repassa `createdBy`
para `suggest()`, garantindo autoria/auditoria nas classificacoes criadas.

## Riscos residuais

- Redacao de dados pessoais e heuristica, nao DLP completo.
- Prompts de geracao ainda incluem planejamento curricular completo necessario
  para produzir prova contextualizada.
- `DEEPSEEK_API_KEY` continua sendo segredo operacional de servidor e nao deve
  aparecer em logs, respostas de API ou documentacao publica.
- Estimativa exata de valor monetário por token continua dependente da tabela
  vigente do provedor. A Fase 8.2 passa a registrar os tokens retornados, mas
  não converte uso em moeda nem atribui custo a aluno ou professor.

## Encaminhamento da Fase 8

A Subtarefa 8.1 registrou em `docs/fase-08-ia.md` o contrato para
transparência, intervenção humana, privacidade e telemetria. A próxima entrega
deve armazenar apenas metadados operacionais (modelo, duração, tentativas,
tokens retornados e falha), nunca prompts, respostas brutas ou dados de aluno.
