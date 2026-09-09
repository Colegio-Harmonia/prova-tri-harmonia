# Handoff — Motor de Classificações Pedagógicas (retomar aqui)

> Criado em 17/07/2026 porque a sessão de IA em uso ficou sem tokens no meio do
> projeto. Este arquivo existe pra uma sessão nova (mesma IA ou outra) retomar
> sem perder o contexto acumulado. Ele **não substitui** os outros documentos —
> só aponta pra eles e diz exatamente onde parou.

## Onde está o projeto

- Pasta local de trabalho: `/Users/earsani/Desktop/prova-tri`
- Deploy de produção: `/home/eduardo/prova-tri` no servidor `192.168.1.218`
  (acesso via `sshpass -p 'Xpto3355' ssh eduardo@192.168.1.218` — ver
  `CLAUDE.md` raiz pra todo o resto do fluxo de deploy: rsync, build, PM2).
- Repositório git normal, branch única, sem PRs — commits direto.

## O que é este subprojeto

"Motor de Classificações Pedagógicas": expandir as classificações que o
sistema já faz (BNCC, Bloom, Eixos Cognitivos do INEP) com DOK, SOLO_EXPECTED,
SOLO_OBSERVED, análises cruzadas, perfil cognitivo do aluno e recomendações
pedagógicas. É um pedido do usuário, formalmente especificado em 26
subtarefas, com um protocolo rígido de comunicação (uma subtarefa por vez,
anúncio → implementação → testes → documentação → conclusão → aguardar sinal
verde do usuário antes da próxima).

**O pedido original completo (as 26 subtarefas, todas as regras, todos os
critérios pedagógicos) está salvo integralmente em
[`docs/MOTOR_CLASSIFICACAO_PEDAGOGICA_SPEC.md`](./MOTOR_CLASSIFICACAO_PEDAGOGICA_SPEC.md).
Leia esse arquivo primeiro — ele é a fonte da verdade do que foi pedido,
inclusive o formato exato dos blocos de anúncio/conclusão (seção 4) e a lista
completa de subtarefas 00-26 (seção 19).**

## Estado atual: Subtarefas 00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 e 26 concluídas

| Subtarefa | Entregável | Commit |
|---|---|---|
| 00 | [`PEDAGOGICAL_CLASSIFICATION.md`](../PEDAGOGICAL_CLASSIFICATION.md) (raiz) — manual normativo de critérios (Bloom, DOK, Eixos INEP, BNCC, SOLO_EXPECTED, SOLO_OBSERVED), com exemplos reais calibrados do banco de produção | `ccf64b9` |
| 01 | [`docs/MVP_GERACAO_PROVAS.md`](./MVP_GERACAO_PROVAS.md) — mapa de arquitetura atual do sistema todo, atualizado (estava desatualizado desde antes do Classroom/RBAC/correção/analytics) | `50bfc7c` |
| 02 | [`docs/ARQUITETURA_MOTOR_CLASSIFICACAO.md`](./ARQUITETURA_MOTOR_CLASSIFICACAO.md) — decisão arquitetural do módulo novo | `3f569cc` |
| 03 | [`docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md`](./MODELO_DADOS_MOTOR_CLASSIFICACAO.md) — modelo de dados definitivo (4 tabelas, SQL + Drizzle TS prontos) | `1aa4fb4` |
| 04 | [`drizzle/0007_pedagogical_classification_engine.sql`](../drizzle/0007_pedagogical_classification_engine.sql) — migration manual reversível das 4 tabelas, validada localmente com rollback e aplicada em produção em 17/07/2026 | `fae8188` |
| 05 | [`src/db/schema.ts`](../src/db/schema.ts) — models Drizzle e constantes tipadas para as 4 tabelas do motor pedagógico | `696175e` |
| 06 | [`src/lib/pedagogical/catalog.ts`](../src/lib/pedagogical/catalog.ts) + [`scripts/seed-pedagogical-taxonomies.ts`](../scripts/seed-pedagogical-taxonomies.ts) — catálogo inicial e seed idempotente de taxonomias/categorias | `aed1cd7` + `ef55293` |
| 07 | [`src/lib/pedagogical/classificationService.ts`](../src/lib/pedagogical/classificationService.ts) — camada de serviços para sugerir, aprovar, rejeitar, substituir, consultar e auditar classificações | `a9c8018` |
| 08 | [`docs/API_MOTOR_CLASSIFICACAO.md`](./API_MOTOR_CLASSIFICACAO.md) + rotas `/api/pedagogical/classifications/**` — APIs internas com validação Zod e delegação para o serviço | `b6ff235` |
| 09 | `getVersionChain()` + `markOutdatedByManualVersion()` em [`src/lib/pedagogical/classificationService.ts`](../src/lib/pedagogical/classificationService.ts), endpoint `/outdated` e contrato atualizado | `8c8e9df` + `739e2cf` |
| 10 | [`src/lib/pedagogical/auditService.ts`](../src/lib/pedagogical/auditService.ts) — auditoria centralizada para eventos do motor pedagógico | `4d449f3` |
| 11 | [`src/config/pedagogicalConfidence.ts`](../src/config/pedagogicalConfidence.ts) + revisão humana em [`src/lib/pedagogical/classificationService.ts`](../src/lib/pedagogical/classificationService.ts) e rotas `/review` + `/review-queue` | `e115a32` |
| 12 | [`src/lib/pedagogical/importedEnemClassificationService.ts`](../src/lib/pedagogical/importedEnemClassificationService.ts) + [`scripts/classify-imported-enem-sample.ts`](../scripts/classify-imported-enem-sample.ts) — integração ENEM em simulação/amostra para `DOK` e `SOLO_EXPECTED` | `2f77c21` |
| 13 | [`src/lib/pedagogical/existingQuestionClassificationService.ts`](../src/lib/pedagogical/existingQuestionClassificationService.ts) + [`scripts/classify-existing-questions-sample.ts`](../scripts/classify-existing-questions-sample.ts) — integração de questões existentes em provas geradas, em simulação/amostra | `90a5654` |
| 14 | [`src/lib/gemini/examSchema.ts`](../src/lib/gemini/examSchema.ts) + [`src/lib/pedagogical/generatedQuestionClassificationService.ts`](../src/lib/pedagogical/generatedQuestionClassificationService.ts) — geração de novas questões com metadados pedagógicos estruturados | `5c37baa` |
| 15 | [`src/lib/gemini/structuredRepair.ts`](../src/lib/gemini/structuredRepair.ts) + [`docs/AI_RESPONSE_VALIDATION_REPAIR.md`](./AI_RESPONSE_VALIDATION_REPAIR.md) — validação/reparo limitado de respostas estruturadas da IA antes da persistência | `64574d2` |
| 16 | [`src/lib/pedagogical/soloObservedClassificationService.ts`](../src/lib/pedagogical/soloObservedClassificationService.ts) + [`docs/SOLO_OBSERVED_CORRECTION.md`](./SOLO_OBSERVED_CORRECTION.md) — SOLO_OBSERVED para respostas discursivas revisadas, nunca para objetivas | `9004933` |
| 17 | [`src/app/(app)/desempenho/DesempenhoPanel.tsx`](../src/app/(app)/desempenho/DesempenhoPanel.tsx) + [`docs/BLOOM_DASHBOARD.md`](./BLOOM_DASHBOARD.md) — dashboard Bloom com amostra, acertos equivalentes, percentual, confiança e evolução | `f57ce2f` |
| 18 | [`src/app/api/analytics/performance/route.ts`](../src/app/api/analytics/performance/route.ts) + [`docs/DOK_DASHBOARD.md`](./DOK_DASHBOARD.md) — dashboard DOK com taxa de acerto, itens, evolução e distribuição por disciplina | `e2b840d` |
| 19 | [`src/app/(app)/desempenho/DesempenhoPanel.tsx`](../src/app/(app)/desempenho/DesempenhoPanel.tsx) + [`docs/BNCC_DASHBOARD.md`](./BNCC_DASHBOARD.md) — dashboard BNCC com habilidades, itens vinculados, agrupamento por componente/série e status pedagógico | `710b7fa` |
| 20 | [`src/app/api/analytics/performance/route.ts`](../src/app/api/analytics/performance/route.ts) + [`docs/INEP_COGNITIVE_AXIS_DASHBOARD.md`](./INEP_COGNITIVE_AXIS_DASHBOARD.md) — dashboard dos Eixos Cognitivos do INEP com DL/CF/SP/CA/EP, nomes completos, desempenho e evolução | `8eabb9a` |
| 21 | [`src/app/(app)/desempenho/DesempenhoPanel.tsx`](../src/app/(app)/desempenho/DesempenhoPanel.tsx) + [`docs/BLOOM_DOK_MATRIX.md`](./BLOOM_DOK_MATRIX.md) — matriz Bloom x DOK com quantidade de itens, percentual, confiança e aviso de amostra baixa por célula | `9d4481a` |
| 22 | [`src/app/api/analytics/performance/route.ts`](../src/app/api/analytics/performance/route.ts) + [`docs/SOLO_DASHBOARD.md`](./SOLO_DASHBOARD.md) — análise SOLO com `SOLO_EXPECTED` das atividades separado de `SOLO_OBSERVED` das respostas discursivas | `162eda5` |
| 23 | [`src/app/(app)/desempenho/DesempenhoPanel.tsx`](../src/app/(app)/desempenho/DesempenhoPanel.tsx) + [`docs/COGNITIVE_PROFILE.md`](./COGNITIVE_PROFILE.md) — perfil cognitivo por aluno com amostra, confiança, pontos fortes/desenvolvimento e limitações | `a584796` |
| 24 | [`scripts/validate-pedagogical-engine.ts`](../scripts/validate-pedagogical-engine.ts) + [`docs/INTEGRATED_PEDAGOGICAL_VALIDATION.md`](./INTEGRATED_PEDAGOGICAL_VALIDATION.md) — gate integrado de validação pedagógica com `PASS`/`WARN`/`FAIL` para invariantes do motor | `5916451` |
| 25 | [`src/lib/ai/promptSafety.ts`](../src/lib/ai/promptSafety.ts) + [`docs/AI_SECURITY_PERFORMANCE_COST_REVIEW.md`](./AI_SECURITY_PERFORMANCE_COST_REVIEW.md) — revisão de segurança/desempenho/custos de IA, sanitização de resposta de aluno, limite de concorrência e persistência pedagógica na regeneração | `f4f9c55` |
| 26 | [`docs/MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md`](./MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md) — documentação técnica, pedagógica e operacional consolidada, com operação, deploy/teste, limites e checklist de manutenção | `24902b0` |

Decisões já fechadas (não redecidir, só aplicar):

- Módulo novo vive em `src/lib/pedagogical/` (só é chamado por código de
  domínio, nunca chama código de domínio — sentido único de dependência).
- 4 tabelas novas: `pedagogical_taxonomies`, `pedagogical_categories`,
  `pedagogical_classifications`, `pedagogical_classification_audit`. SQL
  completo (`CREATE TABLE` + índices + rollback) e Drizzle TS já escritos em
  `docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md` seção 5.
- `imported_question_classifications` (tabela existente, com dado oficial do
  INEP) **fica intocada** — o motor novo é estritamente aditivo, não migra
  nem generaliza essa tabela.
- Endereçamento polimórfico: `classifiable_type` (`imported_question` \|
  `generated_exam_question` \| `exam_correction_answer`) +
  `classifiable_id` + `classifiable_sub_id` (nullable, pra elementos de
  array JSONB que não têm PK própria).
- Índice único parcial confirmado válido: Postgres de produção é **16.14**
  (`NULLS NOT DISTINCT` funciona, Postgres 15+).
- Rubrica de confiança em `src/config/pedagogicalConfidence.ts` (arquivo de
  config, não tabela), mesmo padrão de `src/config/saebApplicability.ts`.
- Próximo número de migration: **`drizzle/0007_...`** (0000-0006 já existem,
  ver `drizzle/`).
- A Subtarefa 24 criou o primeiro gate automatizado do subprojeto:
  `npm run validate-pedagogical-engine`. Ele valida invariantes do banco e
  emite `FAIL` para bloqueios reais e `WARN` para ausência de amostra.

## Próximo passo exato

O subprojeto Motor de Classificações Pedagógicas está concluído nas Subtarefas
00-26. Próximos passos devem ser definidos pelo usuário fora deste roadmap.

- A migration `drizzle/0007_pedagogical_classification_engine.sql` já existe,
  foi testada localmente e aplicada em produção.
- Os models Drizzle já existem em `src/db/schema.ts`.
- O catálogo inicial e o seed idempotente já existem; `PRE_ESTRUTURAL` fica
  somente em `SOLO_OBSERVED`, nunca em `SOLO_EXPECTED`.
- A camada de serviço já centraliza regras de corrente (`is_current`),
  versionamento (`supersedes_id`), status e auditoria; as APIs da Subtarefa
  08 devem chamar esse serviço, não duplicar regras.
- As APIs internas já existem e estão documentadas em
  `docs/API_MOTOR_CLASSIFICACAO.md`.
- O versionamento já preserva histórico via `supersedes_id`, `version`,
  `getVersionChain()` e desatualização por versão de manual.
- A auditoria já está centralizada em `auditService.ts`; rotas/componentes não
  devem inserir auditoria diretamente.
- A revisão humana já existe sem UI: `beginReview()` coloca classificação em
  `em_revisao`, `getReviewQueue()` lista fila revisável, `approve()`/`reject()`
  só aceitam `sugerida` ou `em_revisao`, e `em_revisao` não é sobrescrita por
  sugestão automática.
- A integração ENEM da Subtarefa 12 já existe em modo amostra:
  `npm run classify-imported-enem-sample`. Por padrão é dry-run; gravação real
  exige `APPLY=true`.
- A tabela `imported_question_classifications` continua intocada; o motor novo
  grava apenas em `pedagogical_classifications`.
- A integração de questões existentes da Subtarefa 13 já existe em modo
  amostra: `npm run classify-existing-questions-sample`. Por padrão é dry-run;
  gravação real exige `APPLY=true`.
- Questões existentes em provas geradas são endereçadas como
  `generated_exam_question` + `generated_exams.id` + `questions[].number`.
- A geração de novas questões da Subtarefa 14 já exige
  `pedagogicalClassification` no schema da IA e persiste `DOK`/`SOLO_EXPECTED`
  no motor para questões `source:"ia"`.
- A Subtarefa 15 centralizou validação/reparo de respostas estruturadas da IA
  em `src/lib/gemini/structuredRepair.ts`. O gate valida com Zod, roda
  validação semântica opcional, registra tentativas inválidas no log, limita
  reparo por prompt e impede persistência quando a IA continua inválida.
- A Subtarefa 16 classifica `SOLO_OBSERVED` apenas em respostas discursivas
  revisadas (`exam_correction_answer` + `exam_corrections.id` +
  `questionNumber`). Objetivas e respostas vazias são ignoradas; falhas de IA
  não bloqueiam a correção.
- A Subtarefa 17 expandiu `/desempenho` com dashboard Bloom: quantidade de
  itens, acertos equivalentes, percentual, média, confiança por tamanho de
  amostra e evolução por ano/bimestre.
- A Subtarefa 18 expandiu `/desempenho` com dashboard DOK, buscando
  classificações correntes do motor e usando fallback do payload quando
  necessário. DOK 4 só aparece quando houver item classificado nesse nível.
- A Subtarefa 19 expandiu `/desempenho` com dashboard BNCC. A API usa
  `generation_payload.questions[].bnccCodes`, `bnccStatus` e `bnccSummary`
  como fonte, porque BNCC continua fora do motor genérico. O painel mostra
  habilidades mapeadas, itens vinculados, itens sem BNCC, agrupamento por
  componente curricular e ano/série, evolução por período e status pedagógico
  (`dominio`, `desenvolvimento`, `intervencao`, `amostra_insuficiente`).
  Unidade temática aparece como não informada porque esse campo ainda não
  existe estruturado no payload atual.
- A Subtarefa 20 expandiu `/desempenho` com dashboard dos Eixos Cognitivos do
  INEP. A fonte confiável atual são questões `source:"enem_bank"` presentes em
  correções revisadas, com eixo buscado em
  `imported_question_classifications.enem_cognitive_axis_id` +
  `enem_cognitive_axes`. Questões geradas por IA com `saeb.source:"enem"` não
  entram, porque não têm eixo estruturado no payload; o painel não inventa eixo.
- A Subtarefa 21 expandiu `/desempenho` com matriz Bloom x DOK. A API cruza
  `bloomLevel` do payload com DOK corrente do motor/fallback do payload, e cada
  célula mostra itens, percentual, acertos equivalentes, confiança e amostra
  baixa quando houver menos de 3 itens. Não gera conclusão automática para
  célula com amostra insuficiente.
- A Subtarefa 22 expandiu `/desempenho` com análise SOLO. A API retorna
  `SOLO_EXPECTED` das atividades separado de `SOLO_OBSERVED` das respostas
  discursivas. `SOLO_EXPECTED` usa classificação corrente de
  `generated_exam_question` ou fallback do payload; `SOLO_OBSERVED` usa
  classificação corrente de `exam_correction_answer` e nunca inclui objetivas.
- A Subtarefa 23 expandiu `/desempenho` com perfil cognitivo por aluno,
  agrupado por `studentName`. O perfil mostra amostra, confiança, período,
  disciplinas, pontos fortes, pontos em desenvolvimento, BNCC com domínio ou
  intervenção, profundidade DOK sustentada, eixos INEP quando houver e
  limitações. Não usa rótulos permanentes.
- A Subtarefa 24 criou `npm run validate-pedagogical-engine`, um gate integrado
  que consulta o banco e valida catálogo, categoria, corrente única, confiança,
  classificação principal, classificação de questão/resposta, múltiplas
  taxonomias, auditoria, importação ENEM, geração IA e separação
  `SOLO_EXPECTED`/`SOLO_OBSERVED`. Falhas estruturais retornam `FAIL`; lacunas
  de amostra histórica retornam `WARN`.
- A Subtarefa 25 reduziu exposição/custo de IA: respostas de aluno passam por
  redacao básica antes do envio à IA, respostas longas são truncadas,
  sugestões de nota rodam com concorrência máxima 2, regeneração completa
  persiste classificações pedagógicas e `createdBy` passou a ser registrado
  nas classificações de questões geradas.
- A Subtarefa 26 consolidou a documentação técnica, pedagógica e operacional em
  `docs/MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md`.
- Hotfix pós-teste manual da prova 25 (17/07/2026): a rota `/status` já
  permitia `concluir_revisao` para coordenação/direção, mas a UI escondia o
  botão em `em_andamento` quando a própria coordenação/direção era o usuário
  atribuído. A tela agora usa a mesma regra do backend (`canActOnOwnStep`).
- Continuar usando o protocolo rígido de uma subtarefa por vez, com anúncio,
  implementação, testes, documentação, conclusão e espera por sinal verde do
  usuário antes da próxima.

## Protocolo de trabalho (resumo — ler a seção 4 do spec pra formato exato)

Regra original do usuário: uma subtarefa por vez, com anúncio, implementação,
testes, documentação, conclusão e espera por sinal verde antes da próxima.

Regra atualizada pelo usuário em 17/07/2026, a partir da Subtarefa 20:
executar em modo automático. Para cada subtarefa: iniciar → implementar →
documentar → commitar → deployar → testar pós-deploy → documentar o teste →
se funcionou, iniciar automaticamente a próxima; se deu erro, corrigir e
repetir o ciclo antes de avançar. Continuar uma subtarefa por vez.

## Outras pendências gerais do projeto (fora deste subprojeto, não esquecer)

- OMR (leitura óptica de cartão-resposta físico escaneado via n8n) nunca foi
  construído e não foi formalmente reconciliado com o pipeline de correção via
  Google Classroom que já existe e já resolve o caso de uso na prática — não
  construir sem revisitar se ainda é necessário. Ver `CLAUDE.md` raiz, seção
  "Próxima etapa... correção + análise de desempenho" e Pendência 9 em
  `docs/MVP_GERACAO_PROVAS.md`.
- Local `tsc`/`npm run build` trava indefinidamente neste sandbox — não é bug
  de código, o build remoto (`ssh` no servidor) sempre funciona normal e é o
  gate real antes de reiniciar o PM2.

## Prompt pronto pra colar numa sessão de IA nova

```
Estou continuando o projeto "Motor de Classificações Pedagógicas" dentro do
repositório prova-tri (pasta local /Users/earsani/Desktop/prova-tri, deploy
em /home/eduardo/prova-tri no servidor 192.168.1.218). Uma sessão anterior de
IA ficou sem tokens no meio do trabalho.

Leia primeiro, nesta ordem:
1. CLAUDE.md (raiz do projeto) — contexto geral do sistema e do que já foi
   feito, inclusive a seção "Motor de Classificações Pedagógicas".
2. docs/HANDOFF_MOTOR_CLASSIFICACAO.md — resumo do estado exato deste
   subprojeto e o que fazer a seguir.
3. docs/MOTOR_CLASSIFICACAO_PEDAGOGICA_SPEC.md — o pedido original completo
   (26 subtarefas, todas as regras, o formato exato de comunicação exigido).
4. Os 3 documentos já produzidos: PEDAGOGICAL_CLASSIFICATION.md (raiz),
   docs/ARQUITETURA_MOTOR_CLASSIFICACAO.md,
   docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md.

As Subtarefas 00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 e 26 estão concluídas e
documentadas. A Subtarefa 04 criou e aplicou a migration `0007`; a
Subtarefa 05 adicionou os models Drizzle e constantes tipadas em
`src/db/schema.ts`; a Subtarefa 06 criou o catálogo inicial e o seed
idempotente das taxonomias/categorias; a Subtarefa 07 criou a camada de
serviços em `src/lib/pedagogical/classificationService.ts`; a Subtarefa 08
criou APIs internas e documentou contratos em `docs/API_MOTOR_CLASSIFICACAO.md`;
a Subtarefa 09 fechou versionamento sem sobrescrever histórico; a Subtarefa
10 centralizou auditoria em `src/lib/pedagogical/auditService.ts`; a Subtarefa
11 criou o mecanismo de revisão humana e a fila interna de revisão; a Subtarefa
12 criou integração ENEM em simulação/amostra para DOK e SOLO_EXPECTED; a
Subtarefa 13 criou integração de questões existentes em provas geradas, também
em simulação/amostra; a Subtarefa 14 integrou novas gerações de IA com
metadados pedagógicos estruturados e persistência no motor; a Subtarefa 15
centralizou validação/reparo limitado das respostas estruturadas da IA; a
Subtarefa 16 adicionou SOLO_OBSERVED para respostas discursivas corrigidas; a
Subtarefa 17 criou o dashboard Bloom em `/desempenho`; a Subtarefa 18 criou
o dashboard DOK na mesma página; a Subtarefa 19 criou o dashboard BNCC na
mesma página; a Subtarefa 20 criou o dashboard dos Eixos Cognitivos do INEP
na mesma página; a Subtarefa 21 criou a matriz Bloom x DOK; a Subtarefa 22
criou a análise SOLO separando esperado de observado; a Subtarefa 23 criou
o perfil cognitivo por aluno; a Subtarefa 24 criou o gate integrado
`npm run validate-pedagogical-engine`; a Subtarefa 25 revisou segurança,
desempenho e custos de IA; a Subtarefa 26 consolidou a documentação final em
`docs/MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md`.

Siga o protocolo atualizado pelo usuário em 17/07/2026: modo automático, uma
subtarefa por vez, com início → implementação → documentação → git → deploy →
teste pós-deploy → documentação do teste. Se funcionou, iniciar automaticamente
a próxima; se deu erro, corrigir antes de avançar. Neste roadmap, não há
próxima subtarefa: 00-26 estão concluídas.
```
