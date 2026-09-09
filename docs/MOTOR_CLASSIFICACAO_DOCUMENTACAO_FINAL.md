# Motor de Classificacoes Pedagogicas - Documentacao Final

**Data:** 17/07/2026
**Subtarefa:** 26
**Status:** subprojeto concluido

Este guia consolida a documentacao tecnica, pedagogica e operacional do Motor
de Classificacoes Pedagogicas.

## 1. Visao geral

O motor adiciona uma camada extensivel de classificacoes pedagogicas ao
Prova-TRI sem quebrar os fluxos existentes de geracao, aplicacao, correcao,
ENEM, dashboards e usuarios.

Taxonomias cobertas:

- Bloom: ja vinha no payload da questao e alimenta dashboards.
- BNCC: ja vinha do curriculo/payload e alimenta dashboards.
- Eixos Cognitivos do INEP: fonte oficial no banco ENEM.
- DOK: novo no motor generico.
- `SOLO_EXPECTED`: novo no motor generico para desenho da atividade.
- `SOLO_OBSERVED`: novo no motor generico para resposta discursiva real.

## 2. Documentos principais

- Manual pedagogico normativo: `PEDAGOGICAL_CLASSIFICATION.md`.
- Arquitetura: `docs/ARQUITETURA_MOTOR_CLASSIFICACAO.md`.
- Modelo de dados: `docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md`.
- API interna: `docs/API_MOTOR_CLASSIFICACAO.md`.
- Validacao integrada: `docs/INTEGRATED_PEDAGOGICAL_VALIDATION.md`.
- Seguranca/desempenho/custos de IA:
  `docs/AI_SECURITY_PERFORMANCE_COST_REVIEW.md`.
- Log de validacoes e deploys: `docs/MOTOR_CLASSIFICACAO_TEST_LOG.md`.

Dashboards:

- Bloom: `docs/BLOOM_DASHBOARD.md`.
- DOK: `docs/DOK_DASHBOARD.md`.
- BNCC: `docs/BNCC_DASHBOARD.md`.
- Eixos INEP: `docs/INEP_COGNITIVE_AXIS_DASHBOARD.md`.
- Bloom x DOK: `docs/BLOOM_DOK_MATRIX.md`.
- SOLO: `docs/SOLO_DASHBOARD.md`.
- Perfil cognitivo do aluno: `docs/COGNITIVE_PROFILE.md`.

Integrações:

- ENEM: `docs/ENEM_IMPORT_CLASSIFICATION.md`.
- Questoes existentes: `docs/EXISTING_QUESTION_CLASSIFICATION.md`.
- Geracao nova por IA: `docs/GENERATED_QUESTION_PEDAGOGICAL_METADATA.md`.
- Reparo/validacao de resposta de IA:
  `docs/AI_RESPONSE_VALIDATION_REPAIR.md`.
- Gate reversível de fidelidade DOK/SOLO e recursos visuais:
  `docs/GATE_FIDELIDADE_PEDAGOGICA.md`.
- SOLO_OBSERVED na correcao:
  `docs/SOLO_OBSERVED_CORRECTION.md`.

## 3. Implementacao tecnica

Tabelas novas:

- `pedagogical_taxonomies`;
- `pedagogical_categories`;
- `pedagogical_classifications`;
- `pedagogical_classification_audit`.

Migration:

```text
drizzle/0007_pedagogical_classification_engine.sql
```

Schema Drizzle:

```text
src/db/schema.ts
```

Modulo principal:

```text
src/lib/pedagogical/
```

Responsabilidades:

- `catalog.ts`: catalogo inicial de taxonomias/categorias.
- `classificationService.ts`: criar, consultar, revisar, aprovar, rejeitar,
  substituir e versionar classificacoes.
- `auditService.ts`: auditoria centralizada.
- `generatedQuestionClassificationService.ts`: persiste DOK e SOLO_EXPECTED de
  questoes geradas por IA.
- `existingQuestionClassificationService.ts`: classifica amostra de questoes ja
  existentes.
- `importedEnemClassificationService.ts`: classifica amostra ENEM.
- `soloObservedClassificationService.ts`: persiste SOLO_OBSERVED em respostas
  discursivas corrigidas.

## 4. Regras pedagogicas criticas

- DOK mede profundidade de raciocinio, nao dificuldade.
- `SOLO_EXPECTED` mede a estrutura esperada da atividade.
- `SOLO_OBSERVED` mede a estrutura demonstrada na resposta real do aluno.
- `PRE_ESTRUTURAL` existe apenas em `SOLO_OBSERVED`.
- Questoes objetivas nunca recebem `SOLO_OBSERVED`.
- Classificacao aprovada ou em revisao humana nao deve ser sobrescrita por IA.
- Dashboards devem sinalizar amostra baixa e nao transformar amostra pequena em
  conclusao definitiva.

## 5. Operacao diaria

Validar motor:

```bash
npm run validate-pedagogical-engine
```

Semear catalogo inicial:

```bash
npm run seed-pedagogical-taxonomies
```

Classificar amostra ENEM sem gravar:

```bash
npm run classify-imported-enem-sample
```

Classificar amostra de questoes existentes sem gravar:

```bash
npm run classify-existing-questions-sample
```

Para gravar nas amostras, usar `APPLY=true` conscientemente. Nao rodar em massa
sem estimar volume, custo, tempo e impacto pedagogico.

## 6. Deploy e teste padrao

Fluxo usado neste subprojeto:

```text
rsync -avz --exclude node_modules --exclude .next --exclude .git --exclude .env.local /Users/earsani/Desktop/prova-tri/ eduardo@192.168.1.218:/home/eduardo/prova-tri/
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run validate-pedagogical-engine'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
```

Resultado esperado:

- build remoto sem erro;
- PM2 `prova-tri` online;
- `/desempenho` redireciona usuario anonimo para login (`307`) e login responde
  `200`;
- validador integrado com `0 fail`;
- log PM2 sem novo erro depois do restart.

## 7. Como conferir na interface

Pagina:

```text
/desempenho
```

O que procurar:

- cards gerais de media, maior/menor nota e provas corrigidas;
- painel Bloom;
- painel DOK;
- painel BNCC;
- painel Eixos Cognitivos INEP;
- matriz Bloom x DOK;
- analise SOLO separando esperado e observado;
- perfil cognitivo por aluno com amostra, confianca e limitacoes.

Observacao: nao existe visao do aluno nesta entrega. O perfil cognitivo e
operacional para professor/coordenacao/direcao.

## 8. Seguranca e custo de IA

- `DEEPSEEK_API_KEY` deve ficar apenas no servidor.
- Respostas de aluno enviadas a IA passam por `prepareStudentAnswerForAi()`,
  com redacao basica de e-mail, CPF e telefone.
- Respostas longas sao truncadas por `AI_MAX_STUDENT_ANSWER_CHARS`, padrao
  4000 caracteres.
- Sugestoes de nota rodam com concorrencia maxima 2.
- O sistema nao deve executar chamada real de IA em teste de rotina apenas para
  validar deploy, pois isso gera custo e pode criar artefato artificial.

## 9. Limites conhecidos

- Classificacao secundaria nao foi implementada no modelo v1; a regra atual e
  uma classificacao principal por taxonomia.
- `SOLO_OBSERVED` depende de respostas discursivas corrigidas e pode aparecer
  vazio quando ainda nao ha amostra persistida.
- Questoes historicas geradas antes da Subtarefa 14 podem nao ter metadados
  pedagogicos no payload; o motor preserva compatibilidade e sinaliza `WARN`.
- BNCC continua fora do motor generico, usando `generation_payload` e dados de
  curriculo.
- Eixos INEP confiaveis continuam restritos a questoes `source:"enem_bank"`.

## 10. Checklist para mudancas futuras

- Atualizar `PEDAGOGICAL_CLASSIFICATION.md` antes de mudar criterio pedagogico.
- Criar migration reversivel se houver alteracao estrutural de banco.
- Nao adicionar coluna rigida para nova taxonomia.
- Usar `classificationService.ts`; nao manipular `is_current`, status ou
  auditoria diretamente em rotas.
- Rodar `npm run validate-pedagogical-engine` depois de qualquer mudanca.
- Registrar teste em `docs/MOTOR_CLASSIFICACAO_TEST_LOG.md`.
- Se houver deploy, validar build remoto, PM2, HTTP e logs.
