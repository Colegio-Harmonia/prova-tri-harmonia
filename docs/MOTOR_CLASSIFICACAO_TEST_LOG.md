# Test log — Motor de Classificações Pedagógicas

Registro de validações pós-deploy do ciclo automático iniciado em 17/07/2026.

## Subtarefa 20 — Dashboard dos Eixos Cognitivos do INEP

**Data/hora:** 17/07/2026, após deploy da versão `8eabb9a` + handoff
`7558195`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- rota pública `/desempenho`;
- processo PM2 `prova-tri`;
- fonte de dados dos eixos INEP.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'docker exec prova-tri-postgres psql -U prova_tri -d prova_tri -c "select ax.code, ax.name, count(c.*)::int as classified from enem_cognitive_axes ax left join imported_question_classifications c on c.enem_cognitive_axis_id = ax.id and c.source = '\''enem'\'' group by ax.code, ax.name order by ax.code;"'
```

**Resultados:**

- `npm run build`: sucesso; `/desempenho` compilado como rota dinâmica.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` sem atualização após o deploy; últimas linhas de
  erro eram anteriores ao restart.
- Banco: os 5 eixos existem com classificações ENEM:
  - `CA`: 276;
  - `CF`: 1231;
  - `DL`: 290;
  - `EP`: 46;
  - `SP`: 846.

**Conclusão:** Subtarefa 20 validada em produção. Liberado iniciar
automaticamente a Subtarefa 21.

## Subtarefa 21 — Matriz Bloom x DOK

**Data/hora:** 17/07/2026, após deploy da versão `9d4481a` + handoff
`0b75299`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- rota pública `/desempenho`;
- processo PM2 `prova-tri`;
- fonte de dados Bloom x DOK.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'docker exec prova-tri-postgres psql -U prova_tri -d prova_tri -c "select q->> '\''bloomLevel'\'' as bloom, q#>> '\''{pedagogicalClassification,dok,categoryCode}'\'' as dok, count(*)::int as items from exam_corrections ec join generated_exams ge on ge.id = ec.exam_id cross join jsonb_array_elements(ge.generation_payload->'\''questions'\'') q where ec.status = '\''revisado'\'' group by bloom, dok order by bloom, dok;"'
```

**Resultados:**

- `npm run build`: sucesso; `/desempenho` compilado como rota dinâmica.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` sem atualização após o deploy; últimas linhas de
  erro eram anteriores ao restart.
- Banco: há 6 correções revisadas e 72 links questão-correção; a consulta
  confirmou células com DOK disponível no payload:
  - `analisar x DOK_2`: 4 itens;
  - `analisar x DOK_3`: 2 itens;
  - `aplicar x DOK_2`: 18 itens.
- Itens antigos sem DOK estruturado aparecem com DOK vazio na consulta e ficam
  fora da matriz, comportamento esperado.

**Conclusão:** Subtarefa 21 validada em produção. Liberado iniciar
automaticamente a Subtarefa 22.

## Subtarefa 22 — Análise SOLO

**Data/hora:** 17/07/2026, após deploy da versão `162eda5` + handoff
`8b77238`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- rota pública `/desempenho`;
- processo PM2 `prova-tri`;
- fonte de dados `SOLO_EXPECTED` e `SOLO_OBSERVED`.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'docker exec prova-tri-postgres psql -U prova_tri -d prova_tri -c "select t.code as taxonomy, pc.classifiable_type, pc.classification_code, count(*)::int as items from pedagogical_classifications pc join pedagogical_taxonomies t on t.id = pc.taxonomy_id where t.code in ('\''SOLO_EXPECTED'\'', '\''SOLO_OBSERVED'\'') and pc.is_current = true group by t.code, pc.classifiable_type, pc.classification_code order by taxonomy, pc.classification_code;"'
ssh eduardo@192.168.1.218 'docker exec prova-tri-postgres psql -U prova_tri -d prova_tri -c "select count(*)::int as reviewed_discursive_answers from exam_corrections ec cross join jsonb_array_elements(ec.answers) answer where ec.status = '\''revisado'\'' and answer->>'\''type'\'' = '\''descritiva'\'';"'
```

**Resultados:**

- `npm run build`: sucesso; `/desempenho` compilado como rota dinâmica.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` sem atualização após o deploy; últimas linhas de
  erro eram anteriores ao restart.
- Banco: há `SOLO_EXPECTED` corrente para questões geradas:
  - `MULTIESTRUTURAL`: 9;
  - `RELACIONAL`: 3;
  - `UNIESTRUTURAL`: 3.
- Banco: há 30 respostas discursivas revisadas, mas nenhuma classificação
  `SOLO_OBSERVED` corrente retornada na consulta. A UI deve exibir o bloco
  observado como sem dados nesta amostra, sem confundir isso com
  `SOLO_EXPECTED`.

**Conclusão:** Subtarefa 22 validada em produção. Liberado iniciar
automaticamente a Subtarefa 23.

## Subtarefa 23 — Perfil cognitivo do aluno

**Data/hora:** 17/07/2026, após deploy da versão `a584796` + handoff
`e684a55`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- rota pública `/desempenho`;
- processo PM2 `prova-tri`;
- fonte de dados para perfis por aluno.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'docker exec prova-tri-postgres psql -U prova_tri -d prova_tri -c "select student_name, count(*)::int as corrections from exam_corrections where status = '\''revisado'\'' group by student_name order by student_name;"'
```

**Resultados:**

- `npm run build`: sucesso; `/desempenho` compilado como rota dinâmica.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` sem atualização após o deploy; últimas linhas de
  erro eram anteriores ao restart.
- Banco: há 3 alunos com correções revisadas para alimentar
  `cognitiveProfiles`:
  - Antonella Rodrigues Arsani: 3 correções;
  - Marcella Arsani: 2 correções;
  - Marcella Rodrigues Arsani: 1 correção.

**Conclusão:** Subtarefa 23 validada em produção. Liberado iniciar
automaticamente a Subtarefa 24.

## Subtarefa 24 — Testes integrados e validação pedagógica

**Data/hora:** 17/07/2026, após deploy da versão `5916451` + handoff
`4ad2f61`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- processo PM2 `prova-tri`;
- rota pública `/desempenho`;
- gate integrado `npm run validate-pedagogical-engine`;
- logs de erro PM2 após deploy.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run validate-pedagogical-engine'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'stat -c "%y %s" /home/eduardo/.pm2/logs/prova-tri-error.log'
```

**Resultados:**

- `npm run build`: sucesso; `/desempenho` compilado como rota dinâmica.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` com último `mtime` em `17:53:10 -0300`, anterior
  ao teste pós-deploy atual; sem erro novo observado.
- Validador integrado: `11 pass`, `3 warn`, `0 fail`.
- `PASS`: catálogo `DOK=4`, `SOLO_EXPECTED=4`, `SOLO_OBSERVED=5`; nenhuma
  duplicidade corrente; confiança válida; classificação principal presente;
  questões geradas com `DOK=15` e `SOLO_EXPECTED=15`; 15 itens com múltiplas
  taxonomias; 30 eventos de auditoria; `SOLO_EXPECTED` sem `PRE_ESTRUTURAL`;
  `SOLO_OBSERVED` não aplicado em objetiva; 2689 classificações ENEM com eixo;
  dados existentes compatíveis (`generated_exams=21`, `exam_corrections=30`).
- `WARN`: 0 classificações correntes de resposta, porque a amostra atual ainda
  não possui `SOLO_OBSERVED` persistido; 234 questões históricas de IA sem
  metadado pedagógico estruturado; 0 amostras com status `aprovada`,
  `rejeitada` ou `desatualizada`.

**Conclusão:** Subtarefa 24 validada em produção. Não houve `FAIL`; os `WARN`
são lacunas de amostra/histórico antigo já documentadas. Liberado iniciar
automaticamente a Subtarefa 25.

## Subtarefa 25 — Segurança, desempenho e custos de IA

**Data/hora:** 17/07/2026, após deploy da versão `f4f9c55` + handoff
`7ef70ce`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- processo PM2 `prova-tri`;
- rota pública `/desempenho`;
- gate integrado do motor pedagógico;
- logs de erro PM2 após deploy.

**Comandos executados:**

```text
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run validate-pedagogical-engine'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'stat -c "%y %s" /home/eduardo/.pm2/logs/prova-tri-error.log'
```

**Resultados:**

- `npm run build`: sucesso; rotas de API de geração/regeneração/correção
  compiladas.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` com último `mtime` em `17:53:10 -0300`, anterior
  ao teste pós-deploy atual; sem erro novo observado.
- Validador integrado: `11 pass`, `3 warn`, `0 fail`, mesmo resultado esperado
  da Subtarefa 24.
- Teste de chamada real ao provedor de IA não foi executado para evitar custo e
  criação/regeneração artificial de prova em produção; a validação aplicada foi
  build/type-check remoto, inspeção de rotas, gate de banco e ausência de erro
  pós-restart.

**Conclusão:** Subtarefa 25 validada em produção. Não houve `FAIL`; liberado
iniciar automaticamente a Subtarefa 26.

## Subtarefa 26 — Documentação técnica, pedagógica e operacional

**Data/hora:** 17/07/2026, após deploy da versão `24902b0` + handoff
`d120bc9`.

**Escopo validado:**

- build remoto em `/home/eduardo/prova-tri`;
- processo PM2 `prova-tri`;
- rota pública `/desempenho`;
- gate integrado do motor pedagógico;
- logs de erro PM2 após deploy;
- presença da documentação final no deploy.

**Comandos executados:**

```text
rsync -avz --exclude node_modules --exclude .next --exclude .git --exclude .env.local /Users/earsani/Desktop/prova-tri/ eduardo@192.168.1.218:/home/eduardo/prova-tri/
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run build'
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 restart prova-tri'
ssh eduardo@192.168.1.218 'cd /home/eduardo/prova-tri && npm run validate-pedagogical-engine'
curl -I -L -sS https://prova.colegioharmonia.com.br/desempenho
ssh eduardo@192.168.1.218 '/home/eduardo/simulador-enem/node_modules/.bin/pm2 status prova-tri'
ssh eduardo@192.168.1.218 'stat -c "%y %s" /home/eduardo/.pm2/logs/prova-tri-error.log'
```

**Resultados:**

- `npm run build`: sucesso.
- PM2: `prova-tri` online após restart.
- HTTP: `/desempenho` respondeu com `307` para login e `200` na página de
  login, comportamento esperado para sessão anônima.
- Logs: `prova-tri-error.log` com último `mtime` em `17:53:10 -0300`, anterior
  ao teste pós-deploy atual; sem erro novo observado.
- Validador integrado: `11 pass`, `3 warn`, `0 fail`, mesmo resultado esperado
  das Subtarefas 24 e 25.
- Documentação final sincronizada:
  `docs/MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md`.

**Conclusão:** Subtarefa 26 validada em produção. As Subtarefas 00-26 do Motor
de Classificações Pedagógicas estão concluídas.
