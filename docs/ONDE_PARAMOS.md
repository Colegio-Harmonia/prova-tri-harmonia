# Onde paramos — leia isto primeiro

> Documento vivo. **Toda sessão (humana, Claude, Codex/GPT) que terminar um
> bloco de trabalho atualiza este arquivo no mesmo PR do código.**
> Última atualização: 30/09/2026, noite (Blocos 4 a 8 em produção).

## 1. Fonte da verdade

| O quê | Onde |
| --- | --- |
| Repositório oficial | `https://github.com/Colegio-Harmonia/prova-tri-harmonia` |
| Branch de produção | `main` (único branch ativo) |
| Árvore que roda em produção | servidor `192.168.1.218`, `/home/eduardo/prova-tri`, em `main` sincronizado com `origin/main` |
| Deploy | Docker Compose. Para mudança só de app: `docker compose up -d --build web` (recria só o web; workers de geração/OCR não reiniciam). A imagem é construída da árvore de trabalho do servidor |
| Banco | container `prova-tri-postgres`; migrations em `drizzle/`, aplicadas à mão (`psql -f`), ver CLAUDE.md |
| CI | GitHub Actions `Quality`, em PR e push para `main`: lint, typecheck, vitest com cobertura, regressão (contratos por regex em `scripts/test-*`), build e orçamento de bundle |

**Repositório antigo `Colegio-Harmonia/prova-tri`: somente arquivo histórico.**
Não tem histórico em comum com o oficial e parou por volta de agosto/2026
(migration 0029). Não abrir PR nem fazer deploy a partir dele. O trabalho não
commitado que existia no Mac foi preservado no branch
`arquivo/wip-mac-2026-09-30` desse repositório antigo.

## 2. Regras para não perder trabalho de novo

1. **Nada fica rodando em produção sem commit.** Até 30/09/2026 havia 186
   arquivos (inclusive migrations já aplicadas) só na árvore do servidor.
2. Toda mudança vai em branch `feature/*`, `fix/*` ou `docs/*`, com PR para
   `main`, CI verde antes do merge, e este arquivo atualizado no mesmo PR.
3. Antes de mexer no servidor, rode `git status --short` e
   `git log --oneline -5`: mais de um agente de IA trabalha nessa árvore.
4. Cópias locais da árvore de produção **não são fonte de verdade**. Para
   trabalhar localmente, clone o repositório oficial.
5. Migration nova entra no mesmo PR que o código que depende dela.
6. Contratos de regressão (`scripts/test-*`) verificam trechos de código por
   regex: ao redesenhar uma tela, atualize o contrato para o arquivo novo em
   vez de apagar a verificação.
7. Orçamento de bundle (`scripts/test-performance-budget.ts`) é catraca: não
   subir limite sem registrar dívida em `docs/tech-debt.md`.
8. `.env.local` nunca vai para o git nem viaja entre máquinas. Chave nova em
   produção exige recriar o container.

## 3. Estado verificado em 30/09/2026 (fim do dia)

- `main` = merge 76ae9f1 (PR #12), CI verde, publicado em produção.
- Produção: `prova-tri-web` saudável; `TYPESAFE_API_KEY` carregada; migrations
  **até 0046** aplicadas (0046 aplicada à mão via `psql` antes do deploy do
  Bloco 8); 50 habilidades salvas em `curriculum_plan_skills`, todas com
  descrição (backfill do texto oficial BNCC aplicado).
- Suíte: 77 arquivos / 373 testes, incluindo 3 de integração com Postgres
  real em memória (PGlite).
- Dívida aberta relevante: **TD-018** (bundle de `/desempenho` 133,6 KiB,
  meta 125; `/desempenho/relatorio` 124,9, meta 120; `/gerar/[id]/revisar`
  139,1, meta 130), ver `docs/tech-debt.md`. As duas últimas estão a menos
  de 1 KiB do limite: qualquer acréscimo nelas exige code-splitting antes.

## 4. Relato dos branches de 30/09/2026 (todos mergeados em `main` e apagados)

### PR #1 — `feature/consolidacao-producao-2026-09-30`
Versionou os 186 arquivos que rodavam em produção sem commit (migrations
0033–0045, pipeline de geração, fila de scans/OCR, auth, relatórios e
planejamento). Para o CI passar: 2 contratos de regressão desatualizados
foram apontados para as telas atuais (TD-015 resolvida), cores fixas
viraram tokens em 5 telas e o orçamento de bundle de 3 rotas foi registrado
como TD-018.

### PR #2 — `feature/jev-verificacao-habilidades-planejamento`
Na prévia de `/planejamento` ("Conferir planilha"), cada habilidade com
descrição digitada na planilha é comparada ao texto oficial do código pelo
**Jev** (TypeSafe, pergunta Noul): ≥ 0,8 "Confere com a BNCC"; ≤ 0,2 "Não
confere com o código" (mostra o texto oficial); entre elas "Conferir". Não
bloqueia a importação e falha aberta (sem chave ou com erro vira "não
verificado"). Código: `src/lib/curriculum/skillDescriptionCheck.ts`; rota
`POST /api/curriculum/plans/preview`, separada de `/api/curriculum/preview`
para não pesar em `/gerar` e `/atividades`. Texto oficial vem de
`api.bncc.dev` (`src/lib/curriculum/bnccDescriptions.ts`). Teste de
calibração: 74/74 casos sintéticos certos.

### PR #3 — `feature/bloco-4-dominio-individual`
`GET /api/curriculum/student-mastery`. Aproveitamento por habilidade =
pontos obtidos ÷ possíveis, com peso da questão e nota parcial das
discursivas; `itemCount` (questões distintas) e `assessmentCount` (provas
distintas). Níveis: `sem_evidencia`, `evidencia_insuficiente`,
`em_desenvolvimento`, `proximo_do_dominio`, `dominio`. Regras em
`MASTERY_RULES` (`src/lib/curriculum/studentMastery.ts`): menos de 3 itens =
evidência insuficiente; domínio exige ≥ 80%, ≥ 4 itens e ≥ 2 avaliações,
senão `proximo_do_dominio` com `limitedBySample: true`. Consolidação por
disciplina/bimestre e por disciplina no ano.

### PR #4 — `feature/bloco-5-graficos-relatorio`
Gráficos no relatório individual (`/desempenho/relatorio`), em SVG próprio
sem biblioteca, carregados sob demanda: teia por disciplina com meta de
100%, teia por habilidade, marcadores por formato (círculo cheio = dominada,
triângulo = em desenvolvimento, círculo vazado = não avaliada, tracejado =
preliminar), tabela de evidências ao lado, filtro ano/bimestre, mapa de
calor para teias com mais de 12 eixos ou visão anual, interpretação textual
e impressão com todas as disciplinas. Arquivos:
`src/lib/curriculum/masteryCharts.ts` e `MasterySection`, `MasteryCharts`,
`MasteryRadar` em `src/app/(app)/desempenho/relatorio/`. Corrigiu a
impressão do relatório individual, que saía em branco (classe
`.print-report` em `globals.css`).

### PR #5 — `feature/bloco-6-evolucao`
`GET /api/curriculum/trajectory` (aluno: `studentId`/`student`; turma:
`classroomCourseId`). Motor puro em `src/lib/curriculum/trajectory.ts`
(`TRAJECTORY_RULES`): comparação entre bimestres; habilidades que
avançaram/estáveis/regrediram (≥ 10 p.p. e ≥ 2 itens por lado, por aluno na
turma), senão "sem base"; decomposição "variação total = mesmas habilidades
+ efeito da troca de conteúdo"; cobertura acumulada do planejamento;
intervenções com resultado antes/depois da data de registro (descritivo,
não causal). Carregamento de evidências compartilhado em
`src/lib/curriculum/masteryData.ts` (a rota do Bloco 4 também usa). UI:
seção "Evolução ao longo do ano" no relatório do aluno e página
`/desempenho/trajetoria`, com botão "Trajetória da turma" em `/turmas/[id]`.

### PR #7 — `feature/relatorio-individual-abas`
Relatório individual (`/desempenho/relatorio`) dividido em abas: **Resumo**
(indicadores, pontos fortes/para acompanhar, próximos passos, limitações),
**Habilidades** (gráficos do Bloco 5, domínio e destaques BNCC), **Evolução**
(trajetória do Bloco 6) e **Avaliações** (contexto, evidência, tabela por
avaliação). Aba ativa na URL (`?aba=`), navegação por setas/Home/End, barra
fixa no topo ao rolar. Na impressão/PDF saem todas as abas, cada uma com seu
título. Componente: `src/app/(app)/desempenho/relatorio/ReportTabs.tsx`.
Bundle da página: 124,9/125 KiB (sem folga — próximo acréscimo precisa de
code-splitting, ver TD-018).

### PR #8 — `fix/reforco-variacao-bloom`
O CI do `main` falhou após o PR #7 por um teste instável (~17%) do reforço
ENEM, sem relação com as abas. Defeito real em `distributeAcrossSkills`
(`src/lib/reinforcement/selectQuestions.ts`): a variação de Bloom só
procurava alternativa na fila de um ano por vez e repetia o nível quando
aquele ano não tinha outro. Agora a ordem sorteada por ano é mantida e uma
passada garante nível diferente enquanto houver no banco. 0 falhas em 100
execuções.

### PR #9 — `fix/versionar-rota-cobertura`
A regra `coverage/` do `.gitignore` ignorava `src/app/api/curriculum/coverage/`:
a rota do painel de cobertura existia só no servidor. Regra passou a
`/coverage/` e a rota entrou no repositório.

### PR #10 — `feature/bloco-7-planejamento-interno` (Bloco 7)
Planejamento pedagógico interno (Prova TRI como fonte oficial).
- `/planejamento`: lista com filtros (professor vê só os atribuídos),
  "Novo planejamento" (do zero), "Copiar ano anterior" (versões aprovadas →
  rascunhos do ano seguinte, com responsáveis, sem sobrescrever), "Encerrar
  bimestre" e aba "Importar planilha" (a importação agora recusa criar versão
  se já houver rascunho/revisão aberto).
- `/planejamento/[id]`: editor de unidades, conteúdos, objetivos e
  habilidades (código, descrição — em branco usa o texto oficial — e meta),
  responsáveis, histórico, exportação CSV (`;` + BOM) e PDF
  (`/planejamento/[id]/imprimir`).
- Fluxo: rascunho → em revisão (professor/gestão) → aprovado ou devolvido com
  justificativa (gestão) → encerrado (gestão). Aprovado/encerrado não se edita:
  alteração = nova versão com o conteúdo oficial, que passa por revisão. Após
  encerrar o bimestre, só a gestão abre nova versão, com justificativa.
- Versão oficial = aprovada/encerrada mais recente; cobertura e relatórios
  usam a oficial, ou a mais recente quando ainda não há aprovada (2026).
- Código: `planningPolicy.ts` (regras puras), `planningService.ts` (todas as
  escritas), `planningRoute.ts`, rotas em `src/app/api/curriculum/plans/**`
  e `plan-versions/**`. Teste de integração com Postgres real em memória
  (`planningService.integration.test.ts`, PGlite como devDependency).
- Entrega operacional (criar e aprovar 2027) fica com a coordenação — ver
  Pendências.

### PR #12 — `feature/bloco-8-operacao-institucional` (Bloco 8)
Reaberto do #11, que o GitHub fechou ao apagar o branch base (Bloco 7).
Liga planejamento, avaliação e intervenção. Migration
`drizzle/0046_planning_operations.sql` (intervenções ganham
`skill_codes`/`bimester`; nova tabela `pedagogical_decision_log`) **já
aplicada em produção** em 30/09, antes do deploy. Em outro ambiente, aplicar
antes de subir o código: sem ela, intervenções e trajetória quebram.
1. Aviso na revisão da prova (`/gerar/[id]/revisar`) quando ela não cobre
   habilidades planejadas do bimestre (server component, sem JS extra).
   API: `GET /api/exams/[id]/plan-coverage`.
2. Habilidades ainda não avaliadas no bimestre: seção "Operação do bimestre"
   em `/planejamento/[id]` (cobertura + aproveitamento da turma por habilidade).
3. Sugestões: "avaliar" (planejadas sem evidência) e "retomar" (turma < 60%
   com ≥ 2 itens por aluno, sem intervenção aberta), com atalho para
   registrar intervenção já preenchida. Pré-preencher `/gerar`/`/atividades`
   com as habilidades ainda não existe (as telas escolhem por capítulo).
4. Intervenções ligadas a habilidades (`skillCodes`); na trajetória (Bloco
   6) o antes/depois passa a olhar só essas habilidades.
5. Indicadores: aba "Indicadores" em `/planejamento` (professor: seus
   planejamentos; gestão: escola, por segmento e disciplina) — aprovação,
   cobertura do planejado, intervenções abertas/atrasadas.
   API: `GET /api/curriculum/indicators`.
6. Histórico de decisões (`pedagogical_decision_log`): criação, edição (com
   habilidades +/−), transições, responsáveis, cópia de ano, intervenções.
- Código: `operations.ts` (puro), `operationsData.ts`, `decisionLog.ts`.
  Testes de integração com PGlite usando `src/test/pgliteDb.ts`, que aplica
  as migrations e completa as colunas que `schema.ts` declara e a cadeia de
  migrations não cria.

### Decisão 30/09/2026 — regra de domínio individual
Mantida a regra rigorosa (≥ 80% em ≥ 4 questões de ≥ 2 avaliações), com o
nome explícito **"Domínio no bimestre"** (e **"Domínio no ano"** na visão
anual dos gráficos, onde os bimestres se somam). Lembrete fixo da regra
(`src/components/pedagogy/MasteryRuleReminder.tsx`, texto gerado de
`MASTERY_RULES`) no topo da aba Habilidades do relatório individual, para
todos os perfis e também na impressão. Não mudar a regra sem nova decisão
pedagógica.

### Validação com dados reais (só leitura, agregados, 30/09/2026)
- 1.786 correções revisadas, 322 alunos, 83 turmas, 14.563 respostas com
  BNCC, 0 linhas inválidas.
- **Nenhum aluno ou turma tem correção em mais de um bimestre ainda**: a
  comparação do Bloco 6 só aparece com dados reais a partir do próximo
  bimestre corrigido; até lá a tela explica isso.

## 5. Pendências (em ordem)

1. Painel `/desempenho` (visão BNCC) usa **outra regra** também chamada
   "Domínio": ≥ 80% com ≥ 3 respostas somando todos os alunos
   (`bnccDevelopmentStatus` em `api/analytics/performance/route.ts`). É leitura
   coletiva, diferente do domínio individual. Decidir se renomeia (ex.:
   "Domínio da turma") para não confundir com "Domínio no bimestre" — a rota
   está no limite do orçamento de bundle (TD-018).
2. **Entrega do Bloco 7 (ação da coordenação na tela):** criar e aprovar o
   planejamento de 2027 em `/planejamento`. Os planejamentos de 2026 foram
   importados e nunca aprovados, então "Copiar ano anterior" vai pular todos;
   para 2027, criar do zero ou importar a planilha de 2027, revisar e aprovar.
3. Auditoria de relatórios (`docs/AUDITORIA_RELATORIOS_2026-09-29.md`):
   - Etapa 1: conferir os aceites com dados reais (2/2 = 100%, homônimos
     separados, PDF reproduz o recorte, motivo correto para ausência de ENEM).
   - Etapa 2: filtros para professor, chave segmento+série, manter filtros
     com recorte vazio, contagens honestas (alunos/questões/respostas).
   - Etapas 3 e 4 (coordenação/escola, ENEM ampliado): não iniciadas.
4. TD-018: code-splitting para voltar as 3 rotas às metas de bundle.
5. Conferir no navegador, logado: relatório individual (abas, gráficos,
   evolução, PDF), trajetória de uma turma, `/planejamento` (lista, editor,
   fluxo de revisão, exportação, operação do bimestre, indicadores) e o aviso
   de cobertura na revisão da prova. A validação de 30/09 foi por testes
   (inclusive integração com PGlite), prévias renderizadas e dados
   agregados, não pela tela logada.
6. Sugestões de avaliação/retomada do Bloco 8 levam a `/gerar` e
   `/atividades`, que ainda escolhem conteúdo por capítulo da planilha: falta
   aceitar habilidades BNCC pré-preenchidas.

## 6. Já entregue antes de 30/09 (frente de relatórios, Codex/GPT 29–30/09)

- Intervenções pedagógicas (ação, responsável, prazo, status) por
  série/disciplina: `drizzle/0044_*`, `src/app/api/analytics/interventions/`,
  bloco em `src/app/(app)/desempenho/DesempenhoPanel.tsx`.
- Planejamento curricular versionado (rascunho → em_revisao → aprovado →
  encerrado): `drizzle/0045_*`, `src/lib/curriculum/planningPolicy.ts`.
- Página `/planejamento` (só coordenação/direção): importação da planilha e
  painel de cobertura BNCC (`src/app/(app)/planejamento/`,
  `src/app/api/curriculum/{plans/import,coverage}`).
- P0 da auditoria tratados no código: perfil identificado por
  `classroomStudentId` (fallback: nome), link do relatório individual levando
  o recorte do painel, validação de correção incompleta
  (`src/lib/corrections/{examCompletion,gradeValidation}.ts`).

## 7. Branches do repositório antigo com trabalho não mergeado

Consultar antes de reimplementar qualquer coisa. Pode ser que o código já
exista no oficial, que foi copiado da árvore do servidor.

| Branch (repo `prova-tri`) | Assunto |
| --- | --- |
| `codex/ai-governance` | governança de IA |
| `codex/enem-text-integrity` | integridade de texto ENEM |
| `codex/security-first5` | correções de segurança |
| `codex/fase-8-transparencia` | transparência de IA |
| `codex/batch-all-scan-transcriptions` | transcrição de scans em lote |
| `claude/prova-tri-enem-filters-1b1c86`, `claude/peaceful-austin-3a95f4` | filtros/rótulos ENEM no reforço |
| `hotfix/question-image-proxy` | proxy de imagem de questão |
| `arquivo/wip-mac-2026-09-30` | snapshot do WIP do Mac (21/09 + auditoria) |

## 8. Como atualizar este documento

Ao terminar uma sessão: registre o que foi feito em "Relato dos branches",
atualize "Estado verificado" e "Pendências", ajuste a data no topo e faça
commit no mesmo PR do código.
