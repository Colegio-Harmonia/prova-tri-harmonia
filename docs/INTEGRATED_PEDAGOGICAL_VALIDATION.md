# Validacao Integrada do Motor Pedagogico

**Data:** 17/07/2026
**Subtarefa:** 24

Este documento descreve o gate integrado criado para validar o Motor de
Classificacoes Pedagogicas.

## Comando

```bash
npm run validate-pedagogical-engine
```

O script carrega `DATABASE_URL` de `.env.local` quando a variavel ainda nao
esta definida.

## O que bloqueia

O script encerra com codigo `1` quando encontra falha em invariantes que nao
podem ser aceitos em producao:

- catalogo sem `DOK`, `SOLO_EXPECTED` e `SOLO_OBSERVED` completos;
- mais de uma classificacao corrente para o mesmo item e taxonomia;
- confianca fora do intervalo `0..1`;
- classificacao sem codigo principal;
- `SOLO_EXPECTED` usando `PRE_ESTRUTURAL`;
- `SOLO_OBSERVED` aplicado a resposta objetiva.

## O que gera aviso

Alguns testes dependem de amostra real ja existente. Eles geram `WARN` quando a
base nao tem dados suficientes, mas nao impedem deploy:

- classificacao de questoes geradas;
- classificacao de respostas corrigidas;
- multiplas taxonomias no mesmo item;
- eventos de auditoria;
- importacao ENEM com eixo cognitivo;
- questoes historicas de IA sem metadados pedagogicos;
- fluxos de revisao com classificacoes `aprovada`, `rejeitada` ou
  `desatualizada`;
- existencia de provas e correcoes antigas.

## Cobertura dos testes obrigatorios

- Criacao de taxonomia: validada pelo catalogo esperado.
- Criacao de categoria: validada pela contagem ativa por taxonomia.
- Classificacao de questao: validada por `generated_exam_question`.
- Classificacao de resposta: validada por `exam_correction_answer`.
- Multiplas taxonomias no mesmo item: validada por item com DOK e
  `SOLO_EXPECTED`.
- Versionamento e substituicao: validado por unicidade de corrente e amostra de
  status/versionamento quando existir.
- Aprovacao e rejeicao: validado por amostra de status quando existir.
- Auditoria: validada por contagem em `pedagogical_classification_audit`.
- Confianca: validada pelo intervalo `0..1`.
- Classificacao principal: validada por `classification_code`.
- Classificacao secundaria: nao implementada no modelo atual; o motor v1 usa uma
  classificacao principal por taxonomia.
- Importacao: validada por `imported_question_classifications` com eixo INEP.
- Geracao por IA: validada por payload pedagogico estruturado em questoes novas,
  com `WARN` para provas historicas sem esse metadado.
- Resposta invalida da IA: coberta pela Subtarefa 15 em
  `structuredRepair.ts`; o gate integrado valida o resultado persistido.
- Idempotencia: validada indiretamente por seed idempotente e unicidade de
  corrente; reexecutar o script nao altera dados.
- Rollback de migration: validado historicamente na Subtarefa 04; nao e
  executado contra producao.
- Compatibilidade com dados existentes: validada por leitura de provas e
  correcoes existentes.
- Preservacao de classificacao humana: validada pela regra de unicidade de
  corrente e amostra de status humana quando existir.
- Separacao entre `SOLO_EXPECTED` e `SOLO_OBSERVED`: validada por proibicao de
  `PRE_ESTRUTURAL` no esperado e por proibicao de observado em objetiva.

## Uso operacional

Este comando deve ser executado depois do build remoto e antes de avancar para
a proxima subtarefa. Se houver `FAIL`, corrigir antes de deployar ou avancar.
Se houver apenas `WARN`, registrar a amostra no log de teste e seguir.
