# Sistema Gerador de Provas — Colégio Harmonia

Este é o arquivo raiz. Regras aqui valem para TODOS os segmentos.
Cada segmento tem seu próprio CLAUDE.md com as especificidades (matriz de
referência, nº de alternativas, disciplinas) em:

- `/anos-iniciais/CLAUDE.md` → 2º, 3º, 4º, 5º ano (Fundamental 1)
- `/anos-finais/CLAUDE.md` → 6º, 7º, 8º, 9º ano (Fundamental 2)
- `/ensino-medio/CLAUDE.md` → 1º, 2º e 3º ano (Ensino Médio) — 3º ano liberado
  na UI mas sem planilha configurada ainda, ver `src/config/gradeSheets.ts`.

---

## ⚠️ Trabalho em andamento agora: Motor de Classificações Pedagógicas

Se você é uma sessão de IA nova retomando este projeto, leia primeiro
**[`docs/HANDOFF_MOTOR_CLASSIFICACAO.md`](docs/HANDOFF_MOTOR_CLASSIFICACAO.md)**
— tem o estado exato de onde parou (Subtarefas 00-03 concluídas, próxima é a
04) e o que fazer a seguir. O pedido original completo (26 subtarefas, todas
as regras) está salvo em
[`docs/MOTOR_CLASSIFICACAO_PEDAGOGICA_SPEC.md`](docs/MOTOR_CLASSIFICACAO_PEDAGOGICA_SPEC.md).

---

## Estado atual do projeto (leia isto primeiro — orientação rápida pra qualquer sessão nova)

**O que é**: gerador de provas com IA pro Colégio Harmonia, cruzando Bloom ×
BNCC × matriz oficial (SAEB no Fundamental, ENEM no Ensino Médio), com
fluxo de revisão humana antes de qualquer prova virar documento final.

**Stack**: Next.js 15 (App Router) + React 19, Drizzle + Postgres (container Docker
`prova-tri-postgres`, porta 5434), Auth.js (Credentials + JWT, sem OAuth
real ainda), DeepSeek pra geração de texto (trocado do Gemini por custo,
14/07/2026 — ver `src/lib/gemini/llmClient.ts`). Deploy: Docker Compose;
os serviços `web`, `worker`, `ocr-worker` e `postgres` são definidos em
`docker-compose.yml`. PM2 não faz parte da infraestrutura atual.

**Já construído e funcionando:**
- Leitura de currículo das planilhas Google Sheets reais (uma por
  ano/série, uma aba por disciplina) — resolução de aba fuzzy/override,
  sinônimo de cabeçalho, parsing de Habilidades (3 formatos) e Objetivos
  (inferência de Bloom por verbo). Ver seção "Fonte de dados" abaixo.
- Geração de prova via IA (DeepSeek): proporção fixa 60/40
  objetiva/descritiva, Bloom e BNCC por questão, nunca inventa código BNCC
  quando a planilha não tem.
- **SAEB** (Fundamental): matriz oficial pra Língua Portuguesa/Matemática
  (2º/5º/9º ano exatos, D1-D37-ish + H1-H10 no 2º ano), Ciências
  Humanas (via História/Geografia) e Ciências da Natureza (via Ciências)
  — 5º/9º ano exatos, ambas eixo-do-conhecimento × eixo-cognitivo. 3º/4º/
  6º/7º/8º ano usam a matriz do ano de referência mais próximo, sempre
  `approximate:true`. Ver `src/lib/sheets/bnccSaebMap.ts` +
  `src/config/saebApplicability.ts`. Disciplinas sem matriz oficial
  (Inglês, Artes, Ed. Física, Filosofia) corretamente ficam sem SAEB.
- **Banco real do ENEM** (só Ensino Médio — SAEB não libera item completo,
  por isso não existe equivalente no Fundamental): 2.689 questões reais
  importadas, classificadas por habilidade oficial H1-H30 (~99% via
  microdados, matching de posição+gabarito), eixo cognitivo e nível de
  Bloom via IA (DeepSeek, 100% de cobertura nos dois — Bloom reclassificado
  2x, a 1ª leva com prompt que confundia texto de apoio com a pergunta).
  Tela de geração deixa escolher quantas questões do banco entram (campo
  numérico + filtros de Bloom/Habilidade/Eixo, auto-seleciona as N
  melhores) e quantas a IA gera, somando 12-15 no total.
- **Fluxo de revisão**: rascunho → atribuído → em_andamento → aprovado →
  impresso → aplicado → corrigido (`EXAM_STATUSES` em `db/schema.ts`).
  Coordenação atribui, revisor (professor ou coordenação) revisa, aprovar
  dispara geração dos 3 documentos Google Docs. Notificação por Google
  Chat ao atribuir (`src/lib/notifications/googleChat.ts`).
- **Revisão por questão** (`/gerar/[id]/revisar`): marcador de Adequação
  (adequada/inadequada) e Dificuldade (fácil/adequada/difícil) — duas
  escalas independentes —, comentário livre, botão "Trocar só essa
  questão" (regenera 1 via `buildSingleQuestionPrompt`, sem tocar o resto
  da prova; não vale pra questões reais do banco ENEM), e adicionar
  imagem/gráfico/mapa por questão com 3 fontes possíveis: busca automática
  (Wikimedia → gráfico determinístico via QuickChart se os dados
  numéricos estiverem no texto → geração por IA como último recurso,
  precisa de crédito no Gemini) ou **importar por URL** (professor cola um
  link que já achou — essencial pro Fundamental, onde IA raramente
  reproduz um mapa/gráfico temático específico com fidelidade; tem guard
  básico contra SSRF e valida que o link é imagem de verdade).
- **Geração dos 3 documentos** (Google Docs, `src/lib/docs/`): Prova
  (sem gabarito/BNCC visível), Gabarito, Mapa da prova (tabela de
  cobertura). A4 forçado, template com logo.
- **Dashboards**: `/dashboard` tem estatísticas gerais (por segmento/
  série/disciplina/Bloom) e um bloco só do banco ENEM (por área/ano,
  fonte de classificação, competência, eixos cognitivos, matriz
  área×Bloom). Gráficos de barra viraram ApexCharts (client-side,
  interativo) — gráficos de PROVA continuam via QuickChart porque
  precisam virar imagem estática pro documento, ApexCharts não roda fora
  do navegador sem Puppeteer (avaliado e descartado por peso).
- **`/status`**: tabela de acompanhamento de todas as provas (coordenação)
  ou só as atribuídas (professor), com filtros e paginação.
- **Integração Google Classroom**: login institucional via Google OAuth
  (convive com login por senha) em `/login`; `/turmas` lista as turmas do
  professor; `/turmas/[courseId]` importa o roster de alunos pra dentro de
  uma prova aplicada e lança as notas corrigidas de volta pro Classroom
  (cria a atividade automaticamente na primeira vez). Correção por aluno
  em `/gerar/[examId]/corrigir`, com nota sugerida por IA (DeepSeek) pras
  questões descritivas — resposta ainda é transcrita manualmente (sem
  OCR). Ver seção detalhada "Integração Classroom" mais abaixo neste
  arquivo pra histórico completo das decisões.

**Pendências conhecidas / dívida técnica:**
- Geração de imagem por IA (`imageGenerate.ts`, Gemini) depende de
  crédito na conta Gemini — o usuário está recarregando (em andamento,
  15/07/2026). Sem crédito, cai silenciosamente pro próximo fallback (ou
  falha se Wikimedia também não achar nada) — isso é esperado, não é bug.
- `src/db/client.ts` PRECISA manter `export const db = new Proxy(...)`
  síncrono — ver regra 6 da seção de git/deploy abaixo, não reintroduzir
  o `getDb()` assíncrono sem migrar os ~17 call sites primeiro.
- `.env.local` NUNCA pode ser incluído no rsync de deploy — ver regra 5
  abaixo, já causou incidente real.
- Existe um `EnemDashboard.tsx.bak` órfão (não rastreado pelo git) na
  pasta do dashboard — sobra de uma edição antiga, inofensivo, pode
  apagar quando for mexer por perto.

**Ainda não construído (roadmap, precisa confirmar com o usuário antes de
começar)**: pipeline de correção via n8n (OMR pra objetivas, OCR+IA pra
descritivas) e análise de desempenho por competência — ver seção própria
no fim deste arquivo, já documentada em detalhe mas zero código escrito.

**Concluído (16-17/07/2026) — Integração Classroom + separação de
perfil**: plano em fases, uma subtarefa por vez, sinal verde do usuário
entre cada uma (ver `docs/MVP_GERACAO_PROVAS.md`, **atualizado
17/07/2026** com o estado completo incluindo Classroom/RBAC/correção/
analytics — não é mais só "o MVP anterior a essa fase"). Todas as 6
subtarefas (0-5) fechadas e testadas — detalhes de cada uma logo abaixo.
Decisão de modelagem confirmada: **aluno nunca faz login na
plataforma** — não ganha registro em `users`, é só listado (nome/e-mail
via Classroom API) na hora de lançar nota, quando essa etapa for
construída. `users.role` (**atualizado na Subtarefa 6**: ganhou um 3º
valor, `direcao`, com a mesma permissão de superusuário que
`coordenacao` — ver `src/lib/auth/roles.ts`) continua sem
mudança de enum. Subtarefa 1 (login Google OAuth institucional +
`googleId`/`passwordHash` nullable em `users`) implementada — ver
`src/auth/auth.ts`. Como aluno nunca tem sessão, o gate de rota existente
em `middleware.ts` (qualquer usuário logado = staff) já cumpre o
requisito de "só professor/coordenação acessa o Dashboard de Provas", sem
precisar de checagem de role adicional.

**Subtarefa 1 concluída e testada (16/07/2026) — acesso público via
domínio próprio**: `prova-tri` agora também é acessível em
`https://prova.colegioharmonia.com.br` (além do `http://192.168.1.218:3010`
de sempre, que continua funcionando na LAN). Necessário porque o Google
OAuth recusa redirect URI com IP puro. Como ficou montado:
- **DNS**: registro **A** simples no Route53 (`prova.colegioharmonia.com.br`
  → IP público do servidor, hoje `186.200.18.70` — **se for IP dinâmico,
  precisa de DDNS**, ainda não confirmado se é fixo).
- **TLS**: Caddy (`/etc/caddy/Caddyfile`) na porta 443, certificado real
  da Let's Encrypt via **TLS-ALPN-01** (não HTTP-01) — a porta 80 do
  servidor já pertence a outro serviço de produção existente
  (`financeiro.service`, "Dashboard Financeiro Harmonia") e **não pode
  ser tocada**. Config relevante: `{ auto_https disable_redirects }` +
  `tls { issuer acme { disable_http_challenge } }` no bloco do site —
  sem isso o Caddy tenta bindar a porta 80 e falha ao subir.
- **Roteador**: port-forward 443→192.168.1.218:443 (UniFi Network) — a 80
  não precisou de forward já que a validação do certificado não usa HTTP.
- Existe uma zona `colegioharmonia.com.br` (domínio raiz, não o
  subdomínio) criada por engano na Cloudflare durante essa investigação
  — nunca teve os nameservers trocados no Route53, então não afeta nada
  em produção, mas ficou órfã lá (pode apagar quando lembrar). **Não é
  usada nem necessária** — a Cloudflare bloqueia (painel E API) criar
  zona só de subdomínio de um domínio já registrado em outro lugar,
  então esse caminho foi abandonado em favor do Caddy direto.

⚠️ **Mudanças em `.env.local` exigem recriar os serviços afetados**. Após
validar o arquivo no servidor, execute `docker compose up -d --build` e
confirme o estado com `docker compose ps`. Nunca versionar o arquivo nem
copiá-lo para uma imagem Docker.

⚠️ **Auth.js v5 não lê `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
automaticamente** — essa é convenção do NextAuth v4. O v5 só autodetecta
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`. Como o projeto já usa a nomenclatura
v4-style nos envs (por consistência com o resto do `.env.local`), o
provider precisa receber `clientId`/`clientSecret` explicitamente em
`src/auth/auth.ts` — não confiar na autodetecção pra nenhum provider OAuth
novo que for adicionado.

**Subtarefa 2 concluída e testada (16/07/2026) — turmas do Classroom**:
`/turmas` lista as turmas do professor logado (`courses.list?teacherId=me`,
`src/lib/classroom/classroomClient.ts`). Alunos deliberadamente **não**
listados aqui (fora de escopo — só entram na Subtarefa 4, quando lançar
nota realmente precisa deles).

**Subtarefa 3: já estava pronta antes desse plano começar** — verificado,
não construído nada novo. `EXAM_STATUSES` já tinha `impresso`/`aplicado`,
`/api/exams/[examId]/status` já validava as transições, a tela de revisão
já tinha os botões, `/status` já tinha os badges. Confirmado com um caso
real em produção (prova #7) que já passou pelo ciclo completo antes.

**Subtarefa 4 concluída e testada (16/07/2026) — correção por aluno**:
`/gerar/[examId]/corrigir`. Nota sugerida por IA é **real** (DeepSeek,
`src/lib/gemini/gradeSuggestion.ts`, usa `expectedAnswer`/`gradingCriteria`
já salvos na prova) — só a resposta transcrita é manual (sem OCR, isso
ainda é trabalho futuro do pipeline n8n). Objetiva corrigida
deterministicamente (compara letra transcrita com gabarito), nunca por IA.

Divergência real do plano original, corrigida no mesmo dia: cadastrar
aluno um por um inviabiliza corrigir uma turma inteira. Como a integração
Classroom já existia (Subtarefa 2), a correção agora importa o roster
inteiro de uma vez:
- Novo escopo `classroom.rosters.readonly` (listar curso e listar aluno
  são permissões **separadas** no Google — precisou de outra
  reautorização).
- `generatedExams.classroomCourseId` vincula a prova a uma turma (setado
  na hora de corrigir, não na geração — a prova pode ser gerada antes de
  saber em qual turma vai ser aplicada).
- `examCorrections.classroomStudentId` guarda o userId do Classroom
  quando o aluno vem do roster (nulo em entrada manual) — vai ser
  necessário na Subtarefa 5 pra devolver a nota (`studentSubmissions` é
  endereçada por esse id).
- **`/turmas/[courseId]` é o hub de ações da turma** (feedback direto do
  usuário: o lugar natural pra importar/lançar nota é a turma, não a tela
  de uma prova específica) — importa o roster pra qualquer prova
  aplicada/corrigida dessa turma. "Criar atividade" e "Lançar nota"
  aparecem como cards desabilitados ali, reservados pra Subtarefa 5.

⚠️ **Token de sessão renovado via `refresh_token` NUNCA ganha escopo
novo** — só reemite o que já tinha sido concedido na autorização original.
Depois de qualquer deploy que adicione escopo do Google (ex:
`classroom.rosters.readonly` adicionado depois de `classroom.courses.
readonly` já estar em uso), sessões já logadas continuam com o escopo
antigo até fazer logout+login de verdade — `pedir consentimento de novo`
não é automático só por trocar `GOOGLE_SCOPES` no código. Erro real do
Google nesse caso: `403 PERMISSION_DENIED`, `reason:
ACCESS_TOKEN_SCOPE_INSUFFICIENT` — detectado em
`isInsufficientScopeError()` (`classroomClient.ts`) e tratado como
`reauth_required` (mesma UI de "reconectar" já usada pra token expirado),
não como erro genérico.

**Subtarefa 5 concluída e testada (17/07/2026) — lançamento de nota no
Classroom**: card "Lançar notas no Classroom" em `/turmas/[courseId]`.
Fluxo de 1 clique só (decisão confirmada com o usuário): cria o
`courseWork` na primeira vez (`generatedExams.classroomCourseWorkId`
reaproveita depois, não duplica), preenche `assignedGrade` de todo aluno
"Revisado" com `classroomStudentId`, tenta devolver. Pede confirmação
explícita antes de executar (nota fica visível pro aluno imediatamente,
sem estado de rascunho intermediário). Novo escopo
`classroom.coursework.students` (escrita — mais sensível que os
anteriores).

⚠️ **`studentSubmissions.return` falha com `400 FAILED_PRECONDITION`
quando o aluno nunca "entregou" nada digitalmente no Classroom** — é
exatamente o caso de toda prova em papel corrigida aqui (a submissão fica
parada em `state: CREATED`, `:return` exige `TURNED_IN`). Confirmado
direto na API antes de decidir o fix (17/07/2026): o `assignedGrade` via
`patch` grava certinho e já fica visível no caderno do professor mesmo
sem o `:return` funcionar — então esse erro específico é **engolido em
`patchAndReturnGrade()`** (`classroomClient.ts`), não propagado como
falha pro relatório do usuário. Se `:return` falhar por outro motivo
(não `FAILED_PRECONDITION`), aí sim é erro real e aparece no relatório.

---

## Módulo de Gestão Pedagógica (Subtarefas 6+, 17/07/2026)

Segunda fase de plano, mesmo protocolo de sinal verde por subtarefa.

**Subtarefa 6 concluída e testada (17/07/2026) — RBAC de 3 níveis**:
`users.role` virou `enum('professor', 'coordenacao', 'direcao')` — mantido
em português minúsculo (consistente com o resto do schema), não renomeado
pro `TEACHER`/`COORDINATOR`/`DIRECTOR` do texto do plano original (decisão
confirmada com o usuário). Sem migration de dado: `role` é `text` puro,
sem CHECK constraint real no Postgres.

- `src/lib/auth/roles.ts`: `isStaffSuperuser(role)` — Direção tem
  exatamente a mesma visão de superusuário que Coordenação em todo o
  sistema. Os ~11 pontos que comparavam `role === 'coordenacao'`
  diretamente agora usam esse helper — nunca adicionar uma checagem nova
  de permissão comparando a string 'coordenacao' direto, sempre passar
  pelo helper, senão Direção fica de fora silenciosamente.
- O filtro "professor só vê as próprias provas" (`/api/exams`) **já
  existia** desde 14/07/2026 — só ampliado pra cobrir direção também.
- `/usuarios` (só coordenacao/direcao, gate em 3 camadas: nav link
  escondido, `redirect()` no `page.tsx`, 403 na API): lista todos os
  usuários, cadastra e-mail `@colegioharmonia.com.br` novo (sem senha —
  login só via Google), edita cargo/ativo inline. Superusuário não pode
  desativar a própria conta por essa tela (trava anti-lockout).
- `lastLoginAt` existia na tabela desde o início do projeto mas nunca
  era escrito em lugar nenhum — agora atualizado de verdade em todo
  login (senha ou Google), porque a tela de usuários precisava disso
  pra fazer sentido.

⚠️ **Falha de segurança real corrigida na Subtarefa 7 (17/07/2026)** —
descoberta auditando o pedido do plano de "Erro 403 pra prova de terceiro
via URL": 7 rotas (`GET /api/exams/[examId]` + `regenerate`,
`review-note`, `toggle-image`, `request-image`, `import-image`,
`regenerate-question`) só checavam "está logado", nunca "essa prova é
sua". Qualquer professor autenticado conseguia **ver e editar** prova de
colega só sabendo o ID numérico (sequencial, fácil de adivinhar) — não
era só falta de feature, dava pra realmente alterar questão/imagem de
prova alheia. Corrigido com `src/lib/exams/authorizeExamAccess.ts`
(`isOwner = createdBy === eu || assignedTo === eu`, superusuário sempre
passa) aplicado nas 7 rotas. **Qualquer rota nova de prova precisa passar
por esse helper**, não reimplementar a checagem ad-hoc.

**Subtarefa 7 concluída e testada (17/07/2026) — dashboard por role +
correção da falha acima**: o painel com filtro por Professor/Turma/
Disciplina que o plano pedia **já existia** em `/status` (segment/
gradeYear/subject/assignedTo) — nada novo construído aí. O que era
novo: `/dashboard` (rota de pouso pós-login) agora é sensível a role —
coordenação/direção continuam vendo as métricas do colégio inteiro,
professor vê direto "Minhas Provas" (atribuídas a ele) + "Minhas Turmas"
(reaproveita `MinhasTurmas.tsx`), nunca métrica do colégio inteiro.
"Criar prova já selecionando o professor" continua em 2 passos (gerar →
atribuir, fluxo que já existia) — mesmo resultado final, não unificado
numa tela só.

**Subtarefa 8 concluída e testada (17/07/2026) — notificações Google
Chat direcionadas**: Gatilho 1 (coordenação atribui prova → avisa
professor, `sendChatAssignmentNotification`) **já existia** de fase
anterior do projeto — nada novo aí. Gatilho 2 (professor lança nota →
avisa coordenação/direção) é novo: `sendChatGradesReturnedNotification()`
em `src/lib/notifications/googleChat.ts`, chamado a partir de
`return-grades/route.ts` sempre que `granted > 0`. Manda **DM individual
pra cada coordenação/direção ativo** (exceto quem disparou a ação) — não
existe um espaço de grupo compartilhado configurado no Workspace, então
não dá pra mandar 1 mensagem só pra um "espaço da coordenação". Mesmo
padrão de impersonação via domain-wide delegation do Gatilho 1, sempre
best-effort (nunca derruba a resposta da API se o Chat falhar).

**Subtarefa 9 concluída e testada (17/07/2026) — analytics de desempenho,
módulo completo (6-9)**: `GET /api/analytics/performance` + página
`/desempenho`, no menu pra todo mundo (conteúdo muda por cargo, mesma
rota de API). Decisão confirmada: **sem tabela `metricas_desempenho`
persistida** — agrega na hora sobre `exam_corrections` + `generated_exams`,
mesmo padrão de `/api/stats/dashboard`/`/api/stats/enem`. Só conta
correção com `status:'revisado'` (nota incompleta não entra na média).
Professor sempre restrito às próprias provas (`assignedTo`), mesmo
forçando outro filtro na query string. Coordenação/Direção ganham filtro
comparativo por professor/disciplina/série/segmento. Cruza nota com
`bloomLevel` de cada questão — fecha o objetivo de "análise de desempenho
por competência" que já estava documentado como roadmap desde o início
do projeto. "Erros comuns" virou `topMissedQuestions` (top 10 objetivas
por taxa de erro, mínimo 3 respostas pra entrar — evita % instável com
amostra pequena).

Com isso, as 4 subtarefas do módulo de Gestão Pedagógica (6-9) estão
concluídas e testadas — RBAC de 3 níveis, correção de uma falha real de
acesso, dashboard por cargo, notificações direcionadas, e analytics de
desempenho.

**Gatilho 3 (17/07/2026, fora do plano original, pedido em conversa)** —
"Avisar coordenação que terminei a revisão": lacuna real descoberta
testando o fluxo — a revisão não tem um fim formal no state machine (só
coordenação/direção aprova), então coordenação só sabia que uma revisão
terminou olhando `/status` manualmente. Botão na tela de revisão, visível
só pro professor atribuído, manda DM pra coordenação/direção
(`sendChatReviewReadyNotification`) e marca
`generatedExams.reviewReadyNotifiedAt`.

⚠️ **Todos os 3 gatilhos de Chat ficaram quebrados em produção até
17/07/2026 sem ninguém perceber** — erro real: `Developer permission
settings do not support this action`. Causa: o **Google Chat API app**
(Google Cloud Console → APIs & Services → Google Chat API →
Configuration) estava com o status desativado/"Draft" — nesse estado só
consegue mandar mensagem pro próprio desenvolvedor, não pra qualquer
usuário do domínio. O usuário reativou e confirmou recebimento real
(testado via `sendChatReviewReadyNotification` direto, `{"sent":1,
"failed":0}`). Como o envio de Chat é sempre best-effort (nunca derruba a
ação principal, só loga `console.warn`), esse tipo de falha **não aparece
pra ninguém** a menos que alguém cheque `pm2 logs` ou repare ativamente
que a notificação não chegou — se isso voltar a acontecer, o primeiro
lugar pra checar é essa mesma tela de Configuration do Chat API, não o
código.

**Novo status `revisao_concluida` (17/07/2026)** — feedback direto: o
botão de avisar coordenação só mandava a notificação, sem mudar nada
visível no painel (continuava "Em andamento" mesmo com a revisão já
concluída). Corrigido com um status novo de verdade entre `em_andamento`
e `aprovado` — ver comentário completo do fluxo em `EXAM_STATUSES`
(`schema.ts`). A rota separada `notify-review-done` foi removida (a
notificação agora é parte da transição `concluir_revisao` em
`status/route.ts`, mesmo padrão que `atribuir` já usava).

⚠️ **`rsync` sem `--delete` nunca remove arquivo apagado localmente do
servidor** — descoberto de novo nesse mesmo commit: apaguei
`notify-review-done/route.ts` localmente, mas o deploy normal (sem
`--delete`) deixou o arquivo órfão no servidor, e o build remoto continuou
compilando a rota antiga (inofensivo aqui porque nada mais chamava, mas
podia não ser). **Sempre que um deploy remover um arquivo**, ou usar
`rsync --delete` (com cuidado — respeita os mesmos excludes de sempre:
`node_modules`, `.next`, `.git`, `.env.local`) ou apagar o arquivo
manualmente no servidor via `ssh ... rm`, como foi feito aqui.

⚠️ **`drizzle-kit generate`/`migrate` estão quebrados neste projeto**
(descoberto 16/07/2026): `drizzle/meta/_journal.json` só tem entrada da
migration 0000, mas existe um `0001_add_uq_classification.sql` no
diretório sem entrada correspondente no journal nem snapshot próprio —
gera erro "`drizzle/meta/0000_snapshot.json` data is malformed" e trava
(hang, sem sair) ao rodar `generate`. Causa provável: 0001 foi criado à
mão numa sessão anterior (o SQL dele é literalmente idêntico à última
linha de 0000 — redundante, não fazia falta). **Workaround usado até
alguém consertar a cadeia de journal/snapshot**: escrever a migration SQL
à mão (seguindo o padrão de `0001_*.sql`) e aplicar direto via `psql
"$DATABASE_URL" -f drizzle/000X_nome.sql`, tanto local quanto produção —
não confiar em `npm run db:migrate` até isso ser corrigido.

---

## Disciplina de git e deploy (regra obrigatória)

Este projeto roda em paralelo por mais de uma sessão de IA (local e no
servidor remoto) — sem controle de versão, uma sessão destrutiva já apagou
`src/` inteiro sem aviso (13/07-14/07/2026, `rm -rf` durante debug de build
travado, sem verificar se o `git checkout` de recuperação realmente
funcionou antes de seguir em frente). Pra isso não se repetir:

1. **Commitar no git local antes de qualquer deploy** (sync pro servidor +
   restart do PM2) — mesmo commit pequeno, mesmo "wip". Só documentado
   *depois* do incidente não ajuda: o commit precisa existir *antes* da
   mudança arriscada, não depois.
2. **Nunca rodar `rm -rf` num diretório de código (`src/`, `scripts/`, etc.)
   como parte de debug** sem antes confirmar que existe um commit recente
   pra recuperar, e sem validar que o comando de recuperação (`git
   checkout`/`git restore`) funcionou de verdade antes de prosseguir para
   outra tentativa.
3. **Documentar decisões arquiteturais não-óbvias no CLAUDE.md do
   segmento certo**, à medida que são tomadas — não só em retrospecto.
4. O repositório git deste projeto vive em `/Users/earsani/Desktop/prova-tri/.git`
   (escopado só ao projeto). Nunca inicializar/usar um `.git` que cubra a
   pasta inteira do usuário (`/Users/earsani`) — isso já aconteceu uma vez
   por acidente e arrisca versionar SSH keys/credenciais de outros
   projetos junto.
5. **`rsync` de deploy sempre precisa excluir `.env.local`** (além de
   `node_modules`, `.next`, `.git`). Incidente real (15/07/2026): um sync
   sem esse exclude sobrescreveu o `.env.local` de produção com a versão
   local (placeholder de dev, sem `DEEPSEEK_API_KEY`/`GOOGLE_SERVICE_
   ACCOUNT_KEY_PATH`/etc. reais), derrubando a geração de prova por IA até
   ser percebido e corrigido manualmente com os valores lidos de volta do
   processo PM2 em produção (`pm2 env <id>`). `.env.local` é
   por-ambiente — nunca deve viajar do local pro servidor nem vice-versa.
6. **`src/db/client.ts` precisa manter o `export const db = new Proxy(...)`
   síncrono.** Um commit anterior (8c8fc72) trocou pra um `getDb()`
   assíncrono (dynamic import do driver `postgres`, pra evitar penalidade
   de transpile no Node 22) mas removeu o Proxy sem atualizar os ~17
   arquivos que fazem `import { db }` direto — isso quebrou `npm run
   build` silenciosamente até ser descoberto e revertido (15/07/2026). Se
   alguém quiser reintroduzir o dynamic import por performance, precisa
   primeiro migrar todos os call sites pra `await getDb()`, não só trocar
   o client.
7. **Remoto Git configurado em 18/07/2026**:
   `https://github.com/Colegio-Harmonia/prova-tri.git` (privado — criado
   originalmente em `eduarsani/prova-tri` e transferido no mesmo dia para a
   organização `Colegio-Harmonia`, habilitando proteção de branch via plano
   Team), com o histórico local completo preservado (sem reescrever nada —
   merge com o README inicial criado pelo GitHub,
   `--allow-unrelated-histories`). Branches `main` (produção, protegida),
   `develop` (homologação, protegida) e `feature/frontend-reconstruction`
   (branch ativa da reconstrução) existem no remoto. Fluxo completo de
   branches, Pull Request, checklist de push/merge/deploy e
   proteção de `main` documentado em `docs/git-workflow.md` — consultar
   antes de commitar/dar push numa sessão nova. Regra 4 acima (nunca um
   `.git` cobrindo a pasta inteira do usuário) continua valendo; o
   repositório do projeto agora tem backup remoto além de existir só
   localmente.
8. **Infraestrutura em `192.168.1.218` é legado temporário** — migração
   futura para uma VPS externa (ainda não definida) está prevista. Código
   novo não deve gravar IP/porta/domínio/diretório hardcoded; tratar como
   configuração por ambiente. Ver "Infraestrutura: legado atual e destino
   futuro" em `docs/deployment.md` e `docs/git-workflow.md`.

## Metodologia (comum a todos os segmentos)

⚠️ **Fonte normativa dos critérios de classificação pedagógica**: ver
[`PEDAGOGICAL_CLASSIFICATION.md`](./PEDAGOGICAL_CLASSIFICATION.md) (raiz
do projeto, criado 17/07/2026, Subtarefa 00 do "Motor de Classificações
Pedagógicas"). Esse documento é a fonte oficial de critérios pra Bloom,
BNCC, Eixos Cognitivos do INEP (já implementados) e DOK/SOLO_EXPECTED/
SOLO_OBSERVED (normatizados, ainda não implementados em banco/código) —
inclusive exemplos reais calibrados do sistema, rubrica de confiança e
processo de aprovação. Qualquer trabalho futuro em classificação
pedagógica (prompt de IA, revisão humana, dashboard, auditoria) deve
consultar esse manual antes de decidir um critério novo, não decidir
ad-hoc. As regras abaixo (Bloom × BNCC × matriz oficial) continuam
válidas — o manual novo as documenta em detalhe, não as substitui.

Toda prova cruza **3 referenciais**:

1. **Taxonomia de Bloom** — nível cognitivo de cada questão (Lembrar,
   Compreender, Aplicar, Analisar, Avaliar, Criar).
2. **BNCC** — habilidade específica (código, ex: EF05MA07).
3. **Matriz de referência oficial do segmento** (varia — ver CLAUDE.md do
   segmento):
   - Anos iniciais → Matriz SAEB 5º ano
   - Anos finais → Matriz SAEB 9º ano
   - Ensino Médio → Matriz de Referência do ENEM

⚠️ **Regra crítica de integridade**: a Matriz SAEB oficial cobre apenas
Língua Portuguesa e Matemática (+ Ciências da Natureza no 9º ano desde 2021).
Ela NÃO tem descritores para História, Geografia ou Inglês. Nessas
disciplinas, o cruzamento é apenas **Bloom x BNCC** — nunca inventar
descritor SAEB para disciplina que não tem matriz oficial. O mapa da prova
deve deixar esse campo em branco/"N/A" nesses casos, não preenchido.

## Fonte de dados

Estrutura real confirmada: **uma planilha por ano/série**, com **uma aba por
disciplina** dentro do mesmo arquivo. Cada CLAUDE.md de segmento lista o
caminho do arquivo de cada ano (ver `Planilhas por ano` em
`/anos-iniciais/CLAUDE.md`, `/anos-finais/CLAUDE.md` e
`/ensino-medio/CLAUDE.md`).

**Importante**: cada aba não é um banco de habilidades atômico — é um
**cronograma/plano de curso** organizado por bimestre e capítulo. Colunas
reais:

`Data Início Programada | Data Fim Programada | Data Realizada Capítulo |
Status Cronograma | Ano | Bimestre | Título do capítulo | Conteúdos-foco |
Habilidades | Objetivos | Aulas bimestrais | Professor`

As colunas relevantes pra gerar prova são: `Bimestre`/`Trimestre`, `Título
do capítulo`, `Habilidades` e `Objetivos`. As demais são controle de
cronograma, ignorar na geração.

⚠️ A estrutura de colunas varia levemente entre abas/anos — confirmado que
pelo menos uma aba usa `Bimestre` + `Aulas bimestrais` enquanto outra usa
`Bimestre` + `Trimestre` + `Aulas bimestrais` + `Aulas trimestrais`
simultaneamente, e uma aba de Inglês usa `Unidade` no lugar de `Trimestre`
e nem tem coluna `Objetivos`. **A ordem das colunas também varia** — já
vimos abas com `Conteúdos-foco → Habilidades → Objetivos` e outras com
`Habilidades → Objetivos → Conteúdos-foco`. Por isso o parsing **nunca
pode ser por posição/índice de coluna** — sempre localizar a coluna pelo
nome do cabeçalho antes de ler os dados. Antes de processar uma aba nova,
sempre checar o cabeçalho real em vez de assumir que é idêntico ao de
outra aba/ano já visto.

⚠️ **Coluna "Habilidades" pode estar vazia (ou a disciplina inteira sem
BNCC mapeada).** Confirmado em Inglês (5º ano), no placeholder `SAE +`
(8º ano) e na ausência total da coluna em Sociologia (1º EM). **Decisão
confirmada**: seguir gerando prova normalmente nesses casos, nunca
inventar ou supor um código BNCC, até a escola corrigir a planilha na
fonte. Comportamento obrigatório quando faltar BNCC pro capítulo
selecionado:
1. Sinalizar ao usuário que aquele capítulo/disciplina não tem BNCC
   mapeada na planilha.
2. Gerar a questão baseada no conteúdo disponível (Título do capítulo +
   Conteúdos-foco), mas deixar o campo BNCC do mapa da prova como
   "não mapeado na planilha de origem" — não como um código genérico
   inventado.
3. Recomendar à coordenação pedagógica preencher a coluna Habilidades
   daquela aba, já que sem isso o cruzamento com Bloom/SAEB/ENEM fica
   comprometido para essa disciplina especificamente.

### Códigos de agrupamento de ano confirmados até agora
O código BNCC agrupa anos de forma diferente por componente — não assumir
que é sempre "2 anos por código":
| Prefixo visto | Anos agrupados | Componente confirmado |
|---|---|---|
| EF12 | 1º-2º | Educação Física |
| EF35 | 3º-5º | Educação Física |
| EF15 | 1º-5º (ciclo todo) | Arte |
| EF67 | 6º-7º | Educação Física |
| EF89 | 8º-9º | Educação Física |
| EF07 | 7º (ano único) | Geografia |
| EF08 | 8º (ano único) | Geografia |

Ou seja, Geografia usa código por ano individual (`EF07GE`, `EF08GE`),
enquanto Educação Física e Arte agrupam pares/ciclos de anos. Ao processar
uma disciplina nova, não assumir o padrão de agrupamento — extrair o
prefixo real de cada código encontrado no texto.

⚠️ **Ensino Médio usa formato de código totalmente diferente**: não é
`EF` + ano + componente, é `EM13` + sigla de área (`CNT`, `LGG`, `MAT`,
`CHS`) + competência + habilidade (ex: `EM13CNT201`). Ver detalhes em
`/ensino-medio/CLAUDE.md`. O regex de extração precisa reconhecer os dois
formatos (`EF...` e `EM13...`) dependendo do segmento sendo processado.

### Sinônimos de nome de coluna
O nome do cabeçalho varia entre abas — mapear por sinônimo, não assumir
nome fixo:
| Papel da coluna | Nomes já vistos |
|---|---|
| Título do capítulo | `Título do capítulo`, `Capítulos` |
| Conteúdo | `Conteúdos-foco`, `Conteúdos` |
| Habilidades BNCC | `Habilidades` (nome estável até agora) |
| Objetivos de aprendizagem | `Objetivos` (**pode não existir** na aba — ver abaixo) |
| Divisão do período | `Bimestre`, `Trimestre`, `Unidade` (podem coexistir ou aparecer sozinhas) |
| Carga horária | `Aulas`, `Aulas bimestrais`, `Aulas trimestrais` |

A coluna `Objetivos` **não existe em todas as abas** (confirmado ausente em
Inglês e em Geografia 8º/9º). Quando não existir, gerar a questão com base
em `Título do capítulo`/`Capítulos` + `Conteúdos-foco`/`Conteúdos` apenas,
e inferir Bloom pelos verbos que aparecerem nesses campos (mais raro) ou,
na ausência de verbo claro, tratar como nível Lembrar/Compreender por
padrão e sinalizar no mapa da prova que o nível foi estimado sem base em
"Objetivos" explícitos.

### Parsing da coluna "Habilidades" — 3 formatos confirmados
A coluna pode vir em formatos diferentes até dentro do mesmo segmento —
checar qual formato está em uso antes de extrair:

1. **Código + descrição completa, concatenados**: `(EF12EF01) Experimentar
   e fruir...(EF12EF02) Explicar...`. Extrair por regex de código entre
   parênteses, cada ocorrência com o texto até o próximo código ou o fim
   da célula.
2. **Só códigos soltos, sem descrição**: `EF08GE01 EF08GE03 EF08GE04`
   (sem parênteses, separados por espaço ou quebra de linha). Extrair só
   os códigos via regex de padrão (`EF\d{2,3}[A-Z]{2,4}\d{2,3}`, sem exigir
   parênteses). Nesse caso **não existe descrição da habilidade na
   planilha** — se for preciso o texto completo da habilidade (ex: pra
   citar no mapa da prova ou pra gerar a questão com precisão), buscar a
   descrição oficial na BNCC pelo código, não inventar.
3. **Placeholder de conteúdo externo não mapeado** (ex: `SAE +`): não é um
   código BNCC, é um sinalizador de que aquele capítulo vem de material do
   sistema de ensino (SAE) e ainda não foi associado a habilidades BNCC
   nessa planilha. Tratar como habilidade "não mapeada" — mesmo
   comportamento já definido para célula vazia (sinalizar, não inventar
   código).

### Linhas vazias
Algumas planilhas têm linhas finais completamente vazias (datas
preenchidas mas sem Ano/Bimestre/conteúdo) — pular essas linhas
silenciosamente, não tratar como erro.

### Status Cronograma — não usar como filtro automático (decisão confirmada)
A coluna `Status Cronograma` às vezes vem preenchida com valores reais
(`Concluído (Em dia)`, `Não realizado`, etc.), mas **não deve ser usada
como filtro automático de conteúdo da prova**. O filtro de período/conteúdo
continua sendo manual, por bimestre/trimestre/unidade informado pelo
usuário na hora de gerar a prova.

### Parsing da coluna "Objetivos" e inferência de Bloom
A coluna "Objetivos" é texto corrido com frases separadas por ponto, cada
uma geralmente começando com um verbo. **Não existe coluna de nível de
Bloom** — precisa ser inferido pelo verbo dominante de cada frase, usando
a tabela abaixo como referência:

| Nível de Bloom | Verbos comuns nos objetivos |
|---|---|
| Lembrar | identificar, listar, nomear, reconhecer |
| Compreender | explicar, descrever, compreender, interpretar |
| Aplicar | aplicar, utilizar, executar, vivenciar, praticar |
| Analisar | comparar, diferenciar, analisar, planejar e utilizar estratégias |
| Avaliar | avaliar, justificar, discutir a importância de |
| Criar | criar, elaborar, produzir, propor, planejar e produzir alternativas |

⚠️ Nem toda frase da coluna Objetivos é cognitiva — várias são do domínio
atitudinal/afetivo (ex: "reconhecer e **valorizar** as diferenças
individuais", "respeitar os colegas"). Essas servem de contexto pedagógico
mas **não devem virar questão de prova cobrando nível de Bloom** — usar só
as frases com verbo cognitivo claro como base pra gerar questão.

### Descritor SAEB — não vem na planilha
A planilha não tem coluna de descritor SAEB (faz sentido, é plano de
curso, não banco alinhado ao SAEB). Onde a disciplina/ano tiver matriz
SAEB oficial (ver regra no topo deste arquivo — só LP/Matemática/Ciências
9º), usar a tabela de correspondência em
`/referencias/matriz-saeb-bncc.md` para preencher esse campo no mapa da
prova. Essa tabela cruza por **tópico/eixo** (não por descritor exato em
todos os casos) e está marcada como aproximação onde aplicável — seguir a
regra de honestidade descrita lá: nunca apresentar uma correspondência
aproximada como se fosse exata.

## Estrutura da prova (regra fixa)

- **Quantidade de questões**: 12 a 15 por prova.
- **Proporção de tipos**: 60% objetiva (múltipla escolha) / 40% descritiva
  (aberta), sempre arredondando para o inteiro mais próximo respeitando o
  mínimo de 40% descritiva.
  - Exemplo com 15 questões: 9 objetivas + 6 descritivas.
  - Exemplo com 12 questões: 7 objetivas (58%, arredondar pra baixo se
    passar de 60%) + 5 descritivas — na dúvida, priorizar não ultrapassar
    60% objetiva.
- **Nº de alternativas nas objetivas**: definido por segmento (ver CLAUDE.md
  do segmento).
- **Distribuição por nível de Bloom**: evitar concentrar tudo em
  "Lembrar/Compreender". Buscar espalhar pelos níveis presentes na planilha
  de habilidades daquele recorte, com pelo menos 1 questão em nível mais alto
  (Analisar/Avaliar/Criar) quando a habilidade permitir.
- **Nenhuma questão de definição nua, nem em nível Lembrar** (regra
  confirmada 16/07/2026, pedido direto, exemplos reais abaixo). Mesmo
  questões de nível Lembrar (Bloom) ou que testem o eixo cognitivo
  "Dominar Linguagens" (ENEM — vocabulário/notação/classificação técnica)
  NUNCA devem ser "o que é X" / "qual a definição de Y" isolado — sempre
  contextualizar numa situação real onde o aluno precisa aplicar o
  conceito/classificação pra responder. Vale pra qualquer disciplina, não
  só Matemática (foi onde o problema apareceu primeiro). Exemplos reais de
  referência (usados literalmente no prompt de geração, ver
  `buildContextualizationInstruction` em `promptBuilder.ts`):

  *Ruim:* "O que é um triângulo obtusângulo?"
  *Bom:* "Um estudante de arquitetura está analisando a estrutura
  metálica de um telhado. Ao observar um dos triângulos que compõem a
  sustentação, ele nota que a medida de um de seus ângulos internos é
  igual a 110°. Com base estritamente na classificação dos triângulos
  quanto às medidas de seus ângulos internos, esse triângulo é
  classificado como: [alternativas]"

  *Ruim:* "Qual é a condição de existência de um triângulo?"
  *Bom:* "Um artesão de joias recebeu uma encomenda para criar um
  pingente de ouro no formato triangular. Para confeccionar a peça, ele
  dispõe de três filetes rígidos de metal com os seguintes comprimentos:
  5 cm, 8 cm e 15 cm. a) Explique se o artesão conseguirá ou não
  construir o pingente triangular utilizando exatamente esses três
  filetes. b) Descreva qual é a propriedade geométrica (regra) que
  determina se três segmentos de reta podem ou não formar um triângulo."

  Ver também: disciplinas interpretativas (História, Geografia,
  Filosofia, Sociologia, Língua Portuguesa/Literatura — ver
  `config/interpretiveSubjects.ts`) têm um reforço adicional específico
  pra níveis Analisar/Avaliar/Criar (supportText obrigatório e
  substancial) — essa regra de contextualização é complementar e mais
  ampla, aplicando a toda disciplina em qualquer nível de Bloom.

## Três entregáveis por prova gerada

Toda geração de prova produz **3 documentos**:

### 1. Prova (para impressão)
- Cabeçalho fixo, topo esquerdo: logo do Colégio Harmonia.
- Campos do cabeçalho: Nome do aluno | Nome do professor | Turma | Data |
  Disciplina.
- Questões numeradas sequencialmente, objetivas antes das descritivas (ou
  intercaladas — definir preferência).
- Espaço de resposta adequado: linhas para descritivas, alternativas
  A/B/C/D (ou A-E) claramente formatadas para objetivas.
- Sem gabarito nem indicação de habilidade/BNCC visível no corpo da prova.

### 2. Gabarito
- Documento separado.
- Lista numerada com a resposta correta de cada objetiva.
- Para descritivas: resposta esperada / critérios de correção resumidos
  (não uma redação completa, um guia de correção).

### 3. Mapa da prova
- Tabela cruzando, por questão:
  `Nº questão | Disciplina | Código BNCC | Habilidade (resumo) | Nível de
  Bloom | Descritor da matriz de referência (SAEB ou ENEM, "N/A" se não
  aplicável) | Tipo (objetiva/descritiva)`
- Serve para o professor conferir cobertura curricular antes de aplicar.

## Fluxo de geração (passo a passo)

1. Perguntar/confirmar: segmento, ano, disciplina(s), nº de questões (12-15).
2. Abrir a planilha do ano pedido e ir na aba da disciplina solicitada.
3. Extrair as habilidades BNCC da coluna "Habilidades" (parsing por
   código) e as frases cognitivas da coluna "Objetivos" (inferindo Bloom
   pela tabela de verbos), filtrando pelo(s) bimestre(s) já cursado(s) se
   for prova bimestral, ou pelo ano todo se for prova final/diagnóstica.
4. Selecionar habilidades cobrindo múltiplos níveis de Bloom.
5. Gerar as questões respeitando proporção 60/40 e nº de alternativas do
   segmento.
6. Gerar os 3 documentos (prova, gabarito, mapa).
7. Validar: nenhuma questão descritiva com gabarito tipo "múltipla escolha",
   nenhum descritor SAEB preenchido em disciplina sem matriz oficial,
   contagem de questões bate com o solicitado.

## Template visual
- Design system: usar o **Design System do Colégio Harmonia** já em uso no
  site institucional — cor primária verde `#008649`, fonte Roboto, grid de
  8px, custom properties CSS. Aplicar essa identidade nos elementos que
  fazem sentido em documento impresso (cores de destaque, tipografia,
  cabeçalho), respeitando que impressão em P&B/tons de cinza é comum em
  escola — não depender só da cor pra diferenciar elementos.
- Logo: `/assets/logo-harmonia.png` — logo recebido (triângulo verde +
  texto "Colégio Harmonia" em cinza, fundo transparente/branco). É um logo
  quadrado com ícone acima do texto — no cabeçalho da prova (topo
  esquerdo), usar em tamanho compacto; se o layout do cabeçalho precisar
  de algo mais horizontal, redimensionar mantendo proporção em vez de
  distorcer.
- Formato de saída: **Google Docs**. Os 3 entregáveis (prova, gabarito,
  mapa da prova) são gerados como documentos Google Docs.
- **Formato de impressão: A4**, obrigatório — configurar layout de página
  do Google Docs pra A4 antes de finalizar, não deixar no padrão Carta
  (Letter) que é o default em algumas contas.

## Ilustração das questões (mapas, charges, imagens, gráficos)

Toda questão que precisar de apoio visual — mapas, charges (tirinhas/
charges políticas), gráficos, imagens ilustrativas, diagramas — deve
receber esse apoio. Duas fontes possíveis:

1. **Criar a imagem/ilustração original** (gráficos, diagramas, mapas
   esquemáticos simples, imagens geradas) — preferível sempre que possível,
   porque evita qualquer problema de direito autoral.
2. **Buscar na internet** — usado principalmente pra **charges e mapas
   reais** (ex: charge de um jornal sobre um tema de atualidade,
   mapa-múndi político oficial).

⚠️ **Atenção a direitos autorais em charges**: charges de jornal costumam
ser obra autoral registrada de um chargista específico (ex: Angeli,
Laerte, Latuff), protegida por direitos autorais mesmo em uso escolar —
uso educacional em sala de aula tem uma tolerância maior, mas **reproduzir
a charge inteira em um documento impresso distribuído aos alunos** já é
uma zona mais sensível do que só exibir em tela na aula. Nesses casos:
- Preferir charges de bancos de imagem com licença aberta ou domínio
  público quando disponível.
- Quando a charge específica for importante pedagogicamente (ex: prova
  sobre um tema de atualidade que uma charge famosa ilustrou bem) e não
  houver alternativa livre de direitos, considerar: (a) descrever a cena
  da charge em texto para a questão em vez de reproduzir a imagem, ou
  (b) linkar/referenciar a fonte original em vez de embutir a imagem no
  documento, dependendo de como a prova será aplicada.
- Mapas político-administrativos básicos (contorno do Brasil, divisão de
  estados/regiões) normalmente não têm essa restrição — são dados
  geográficos, não obra autoral — mas mapas temáticos elaborados por
  terceiros (ex: infográfico de jornal) têm a mesma lógica de cautela das
  charges.

**Para disciplinas exatas** (Matemática, Física, Química): questões com
apoio visual (gráficos, figuras geométricas, diagramas) podem ser criadas
originalmente, ou **aproveitadas de bancos de questões de currículo**
(bancos de questões de sistemas de ensino, livros didáticos adotados,
material de apoio da escola) quando a escola já tiver esse acesso
licenciado — não extrair de fontes que a escola não tenha licença de uso.

---

## Próxima etapa (objetivo, ainda não iniciado): correção + análise de desempenho

Decisão confirmada (14-15/07/2026) sobre como o fluxo de correção vai
funcionar quando essa etapa começar — documentado aqui antes de
implementar, pra não se perder entre sessões:

**Captura**: cartão-resposta físico (não tela/formulário) — o mais fiel à
experiência real do ENEM, já que o objetivo central do Ensino Médio é
treino para o ENEM. Objetivas são marcadas em folha de respostas separada
(bolinhas), como no exame oficial.

**Pipeline de correção**:
1. Escola escaneia os cartões-resposta e as folhas de descritivas,
   sobe pro Google Drive (pasta já usada pelo sistema).
2. **n8n** orquestra o pipeline inteiro a partir daí — não faz a leitura
   óptica nem a correção por IA sozinho, ele *conecta* os serviços:
   - Trigger: novo arquivo na pasta de scans do Drive.
   - Objetivas: chama um serviço de leitura óptica (OMR) pra ler as
     bolinhas marcadas, casa contra o gabarito já salvo em
     `generated_exams.generation_payload` (correção determinística, sem
     IA — não precisa, já é objetiva).
   - Descritivas: chama OCR pra digitalizar a resposta manuscrita, manda
     pro modelo de IA (mesmo provedor já configurado — hoje DeepSeek, ver
     `src/lib/gemini/llmClient.ts`) junto com `expectedAnswer` e
     `gradingCriteria` da questão (já gerados e salvos desde a criação da
     prova) — pede nota sugerida + justificativa.
   - Grava tudo de volta no prova-tri via um endpoint novo, notifica o
     professor responsável no Google Chat (integração já existe).
3. **A nota da IA pra descritiva é sempre sugestão, nunca final** — mesmo
   princípio já seguido no resto do projeto (nunca inventar código BNCC,
   nunca aprovar imagem sozinho): o professor revisa e confirma numa tela
   de correção dentro do prova-tri antes da nota virar definitiva.

**Análise de desempenho**: uma vez com nota + acerto/erro por questão
salvos, cruzar contra a classificação que já existe por questão (BNCC,
Bloom, habilidade da matriz ENEM, eixo cognitivo) pra mostrar não só "nota
X" mas "errou mais em Compreender Fenômenos" ou "dominou Álgebra mas não
Geometria" — o objetivo declarado é análise de desempenho por competência,
não só nota final.

**Ainda não decidido/construído**: schema de respostas por aluno, escolha
do serviço de OMR, tela de revisão de correção, tela de análise de
desempenho. Consultar o usuário antes de começar a construir qualquer
parte disso.

⚠️ **Atualização 17/07/2026**: "tela de revisão de correção" e "tela de
análise de desempenho" **já foram construídas**, mas por um caminho
diferente do descrito acima — não via n8n/OMR/OCR de cartão físico
escaneado, e sim via importação de roster do Google Classroom + correção
manual (resposta digitada, não escaneada) + `/desempenho` (analytics em
tempo real, ver `docs/MVP_GERACAO_PROVAS.md`, seções 2.9, 3 e 4). O
**schema de respostas por aluno** também já existe (`exam_corrections`).
O que continua não construído de verdade é só a **leitura óptica (OMR)
de cartão-resposta físico escaneado** — o pipeline n8n descrito acima
inteiro. Ver Pendência 9 em `docs/MVP_GERACAO_PROVAS.md`: as duas
abordagens de captura de resposta (papel escaneado via OMR vs. digitação
manual via Classroom) ainda não foram formalmente reconciliadas — não
construir o pipeline n8n sem revisitar se ele ainda é necessário dado
que o caminho Classroom já resolve o caso de uso na prática.

---

## Motor de Classificações Pedagógicas (17/07/2026, em andamento)

Novo plano, protocolo de subtarefas mais rígido que os anteriores
(formato fixo de anúncio/conclusão pedido pelo usuário — ver histórico
da conversa se precisar reproduzir o formato exato). Objetivo: ampliar
BNCC/Bloom/Eixos Cognitivos do INEP (já implementados) com DOK, SOLO
_EXPECTED, SOLO_OBSERVED, análises cruzadas, perfil cognitivo do aluno e
recomendações pedagógicas — 26 subtarefas ao todo, uma de cada vez, sinal
verde do usuário entre cada uma.

- **Subtarefa 00 concluída**: `PEDAGOGICAL_CLASSIFICATION.md` (raiz) —
  manual normativo de critérios pra todas as taxonomias, com exemplos
  reais calibrados do sistema. Ver o próprio arquivo pra detalhes.
- **Subtarefa 01 concluída**: `docs/MVP_GERACAO_PROVAS.md` atualizado
  (estava parado desde 16/07, antes de Classroom/RBAC/correção/
  analytics) — agora serve tanto de referência técnica geral quanto de
  mapa de arquitetura pra extensão com as taxonomias novas. Achado
  relevante: **não existe suíte de testes automatizada no projeto** — a
  seção 20 do pedido do motor exige testes pra tudo que for construído
  daqui pra frente, será a primeira suíte real do projeto.
- **Subtarefa 02 concluída**: `docs/ARQUITETURA_MOTOR_CLASSIFICACAO.md` —
  documento de decisão arquitetural. Decisões principais: módulo novo em
  `src/lib/pedagogical/` (só é chamado, nunca chama módulo de domínio);
  4 tabelas novas, nenhuma migra dado existente —
  `imported_question_classifications` **fica intocada de propósito**
  (já tem dado oficial do INEP em produção, motor novo é estritamente
  aditivo); classificação endereça "coisa classificável" via
  `classifiable_type` + `classifiable_id` + `classifiable_sub_id`
  (nullable) — resolve o problema real de que questão de prova gerada e
  resposta de correção são elementos de array JSONB, não linhas com PK
  própria, sem normalizar `generation_payload`/`exam_corrections.answers`
  (proibido pelo pedido). Rubrica de confiança em arquivo de config
  (`src/config/pedagogicalConfidence.ts`), mesmo padrão de
  `saebApplicability.ts`, não tabela nova.
- **Subtarefa 03 concluída**: `docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md`
  — modelo definitivo das 4 tabelas (coluna/tipo/nullable/índice
  completos), com SQL bruto e Drizzle TS prontos pra Subtarefa 04/05
  usarem sem redecidir nada. Pendências da Subtarefa 02 fechadas:
  `is_current` entra no schema (evita recalcular precedência em toda
  leitura); `classifiable_type` final é `imported_question` \|
  `generated_exam_question` \| `exam_correction_answer`; índice único
  **parcial** (`WHERE is_current = true`) confirmado suportado pela
  versão do Drizzle já instalada (lido direto do `.d.ts`, não suposto) —
  vira garantia de banco, não só disciplina de código, contra 2
  classificações "correntes" pro mesmo item/taxonomia ao mesmo tempo.
  Validado com dado real (a questão do cilindro do exam #21, já
  calibrada em `PEDAGOGICAL_CLASSIFICATION.md`). **Postgres de produção
  confirmado nesta subtarefa: 16.14** — `NULLS NOT DISTINCT` (Postgres
  15+) incluído no índice, cobrindo corretamente o caso do
  `classifiable_sub_id` nullable (`imported_question`) também.
- **Subtarefa 04 concluída (17/07/2026)**:
  `drizzle/0007_pedagogical_classification_engine.sql` criada manualmente
  com o SQL da seção 5.1 de
  `docs/MODELO_DADOS_MOTOR_CLASSIFICACAO.md`, seguindo o workaround já
  documentado porque `drizzle-kit generate/migrate` continua quebrado.
  Reversibilidade validada em dev local via `psql "$DATABASE_URL"`:
  apply completo, conferência das 4 tabelas novas, rollback manual
  (`DROP TABLE` em ordem audit → classifications → categories →
  taxonomies), confirmação de retorno a zero tabelas e reapply limpo.
  Depois disso, a mesma migration foi aplicada em produção no servidor
  `192.168.1.218` via `cat drizzle/0007_pedagogical_classification_engine.sql
  | docker exec -i prova-tri-postgres psql -U prova_tri -d prova_tri`, e
  as 4 tabelas foram confirmadas no Postgres 16.14 de produção. Nenhum
  build/restart de app foi necessário porque a subtarefa alterou só
  schema; próxima etapa do motor passa a ser a **Subtarefa 05**
  (entidades/models/repositories em `src/db/schema.ts` ou módulo
  equivalente, seguindo o TS já fechado no documento de modelo de dados).
- **Subtarefa 05 concluída (17/07/2026)**: `src/db/schema.ts` agora expõe
  os models Drizzle das 4 tabelas novas (`pedagogicalTaxonomies`,
  `pedagogicalCategories`, `pedagogicalClassifications`,
  `pedagogicalClassificationAudit`) e as constantes tipadas de domínio
  (`CLASSIFIABLE_TYPES`, `CLASSIFICATION_SOURCES`,
  `CLASSIFICATION_STATUSES`, `CLASSIFICATION_AUDIT_ACTIONS`). O código
  segue o schema aplicado na migration 0007, incluindo `real` pra
  `confidence`, índice parcial com `.where(sql...)`, FK auto-referenciada
  de `supersedes_id` com `AnyPgColumn` e FKs para `users`. Não foi criada
  camada de serviço nesta subtarefa: isso fica para a **Subtarefa 07**,
  conforme o roadmap original. Próxima etapa antes disso é a **Subtarefa
  06** (catálogo/seed idempotente de taxonomias e categorias).
- **Subtarefa 06 concluída (17/07/2026)**:
  `src/lib/pedagogical/catalog.ts` define o catálogo normativo inicial do
  motor, com `manualVersion: "1.0"` e 3 taxonomias: `DOK`,
  `SOLO_EXPECTED` e `SOLO_OBSERVED`. `SOLO_EXPECTED` inclui apenas
  `UNIESTRUTURAL`, `MULTIESTRUTURAL`, `RELACIONAL` e
  `ABSTRATO_AMPLIADO`; `PRE_ESTRUTURAL` existe só em `SOLO_OBSERVED`,
  conforme o manual. O script `scripts/seed-pedagogical-taxonomies.ts`
  faz upsert idempotente em `pedagogical_taxonomies` e
  `pedagogical_categories`, exposto via `npm run
  seed-pedagogical-taxonomies`; ele carrega `DATABASE_URL` de
  `.env.local` quando a variável não veio do ambiente, porque scripts
  `tsx` fora do Next não carregam esse arquivo automaticamente. A próxima
  etapa é a **Subtarefa 07**
  (camada de serviços para criação, substituição, aprovação e consulta de
  classificações).
- **Subtarefa 07 concluída (17/07/2026)**:
  `src/lib/pedagogical/classificationService.ts` centraliza as regras de
  domínio do motor: `suggest`, `approve`, `reject`, `supersede`,
  `getCurrent`, `getFullClassification` e `getHistory`. A camada preserva
  classificações aprovadas contra sobrescrita automática: nova sugestão
  criada sobre classificação aprovada entra com `is_current:false`; só
  aprovação humana ou `supersede` explícito troca a classificação corrente.
  Quando uma classificação passa a ser corrente, o serviço desativa as
  demais correntes do mesmo item/taxonomia antes de ativar a nova, mantendo
  a garantia do índice único parcial. Todas as mutações relevantes gravam
  `pedagogical_classification_audit`. `getFullClassification` retorna por
  código da taxonomia (`DOK`, `SOLO_EXPECTED`, `SOLO_OBSERVED`) para evitar
  colisão entre categorias com o mesmo código. APIs internas ficam para a
  **Subtarefa 08**.
- **Subtarefa 08 concluída (17/07/2026)**: criadas APIs internas em
  `/api/pedagogical/classifications` para consultar/criar sugestões, e
  subrotas por classificação para `approve`, `reject`, `supersede` e
  `history`. Os handlers validam entrada com Zod, exigem usuário
  autenticado e delegam regras de domínio para
  `classificationService.ts` (não duplicar regra de `is_current`,
  status, versionamento ou auditoria nas rotas). Contratos e validações
  documentados em `docs/API_MOTOR_CLASSIFICACAO.md`. Próxima etapa:
  **Subtarefa 09** (versionamento das classificações, sem sobrescrever
  histórico).
- **Subtarefa 09 concluída (17/07/2026)**: versionamento fechado na camada
  de serviço sem sobrescrever histórico. `classificationService.ts` agora
  expõe `getVersionChain()` para percorrer a cadeia `supersedes_id` da
  versão mais nova para as versões antigas, com proteção contra ciclo, e
  `markOutdatedByManualVersion()` para marcar classificações correntes de
  uma versão antiga do manual como `desatualizada`/`is_current:false`,
  registrando auditoria `outdated`. O endpoint de histórico passou a
  retornar `versionChain`, e foi criado
  `POST /api/pedagogical/classifications/outdated` para desatualização por
  mudança de versão do manual. Banco não precisou de migration porque os
  status/actions são `text` puro; só a constante TS de ações de auditoria
  ganhou `outdated`. Próxima etapa: **Subtarefa 10** (auditoria).
- **Subtarefa 10 concluída (17/07/2026)**: auditoria centralizada em
  `src/lib/pedagogical/auditService.ts`. Toda gravação de
  `pedagogical_classification_audit` agora passa por
  `recordClassificationAudit()`, e leitura de histórico passa por
  `getClassificationAuditHistory()`. `classificationService.ts` não insere
  mais diretamente na tabela de auditoria; ele delega os eventos
  `created`, `approved`, `rejected`, `superseded` e `outdated` para o
  serviço de auditoria. Contrato documentado em
  `docs/API_MOTOR_CLASSIFICACAO.md`. Próxima etapa: **Subtarefa 11**
  (mecanismo de revisão humana).
- **Subtarefa 11 concluída (17/07/2026)**: mecanismo de revisão humana criado
  sem UI nova. `classificationService.ts` agora expõe `beginReview()`,
  `getReviewQueue()`, `getClassificationPrecedence()` e
  `requiresHumanReview()`. O status `em_revisao` protege a classificação
  corrente contra sobrescrita por nova sugestão automática, do mesmo modo que
  `aprovada`; `approve()` e `reject()` passam a aceitar somente
  classificações `sugerida` ou `em_revisao`. Criadas as rotas internas
  `POST /api/pedagogical/classifications/:classificationId/review` e
  `GET /api/pedagogical/classifications/review-queue`. A rubrica de confiança
  configurável foi materializada em `src/config/pedagogicalConfidence.ts`.
  Próxima etapa: **Subtarefa 12** (integrar classificação de questões
  importadas do ENEM em modo de simulação e amostra).
- **Subtarefa 12 concluída (17/07/2026)**: integração inicial de questões
  importadas do ENEM criada em modo de simulação/amostra. O serviço
  `src/lib/pedagogical/importedEnemClassificationService.ts` seleciona
  amostras de `imported_questions`, propõe `DOK` e `SOLO_EXPECTED` e nunca
  cria `SOLO_OBSERVED`. O script
  `npm run classify-imported-enem-sample` roda em dry-run por padrão; gravação
  real exige `APPLY=true` e usa `classificationService.suggest()`, preservando
  auditoria, versionamento e precedência. A tabela legada
  `imported_question_classifications` permanece intocada. Contrato operacional
  documentado em `docs/ENEM_IMPORT_CLASSIFICATION.md`. Próxima etapa:
  **Subtarefa 13** (integrar classificação de questões existentes sem lote
  total).
- **Subtarefa 13 concluída (17/07/2026)**: integração inicial de questões
  existentes em `generated_exams.generation_payload.questions[]` criada em
  modo de simulação/amostra. O serviço
  `src/lib/pedagogical/existingQuestionClassificationService.ts` endereça cada
  questão como `generated_exam_question` + `examId` + `question.number` e
  propõe apenas `DOK` e `SOLO_EXPECTED`. O script
  `npm run classify-existing-questions-sample` roda em dry-run por padrão;
  gravação real exige `APPLY=true`, limita a amostra e não substitui
  classificação corrente existente. A heurística comum foi extraída para
  `src/lib/pedagogical/questionHeuristics.ts`. Próxima etapa:
  **Subtarefa 14** (integrar geração de novas questões com metadados
  pedagógicos estruturados).
- **Subtarefa 14 concluída (17/07/2026)**: geração de novas questões integrada
  a metadados pedagógicos estruturados. `ExamQuestion` agora exige
  `pedagogicalClassification` com `dok` e `soloExpected`, cada um com categoria,
  confiança, justificativa e evidência próprias. `promptBuilder.ts` instrui o
  DeepSeek a preencher esses campos; `examSchema.ts` valida a estrutura; e
  `generatedQuestionClassificationService.ts` persiste sugestões `DOK` e
  `SOLO_EXPECTED` no motor para questões `source:"ia"` após a criação da prova
  ou troca de questão. Questões `enem_bank` recebem o bloco no payload para
  manter o schema consistente, mas não são gravadas por esse fluxo no motor.
  Próxima etapa: **Subtarefa 15** (validação e reparo das respostas da IA com
  registro de falhas e limite de tentativas).
- **Subtarefa 15 concluída (17/07/2026)**: validação/reparo de respostas
  estruturadas da IA centralizados em `src/lib/gemini/structuredRepair.ts`.
  O helper `generateValidatedStructuredContent()` chama o LLM, valida com Zod,
  aplica validação semântica opcional, registra cada tentativa inválida em log,
  faz reparo limitado por prompt (`maxAttempts=2` por padrão) e lança
  `StructuredGenerationError` quando a resposta continua inválida. Aplicado em
  geração de prova, regeneração, troca de questão e sugestão de nota
  discursiva. As rotas de geração agora retornam erro 502 específico com
  `issues` em vez de persistir payload inválido. Documentado em
  `docs/AI_RESPONSE_VALIDATION_REPAIR.md`. Próxima etapa: **Subtarefa 16**
  (SOLO_OBSERVED em respostas discursivas).
- **Subtarefa 16 concluída (17/07/2026)**: `SOLO_OBSERVED` implementado para
  respostas discursivas revisadas. A rota
  `PATCH /api/exams/[examId]/corrections/[correctionId]` chama
  `persistSoloObservedForCorrection()` quando a correção transita de
  `pendente` para `revisado`. O endereço no motor é
  `exam_correction_answer` + `exam_corrections.id` + `questionNumber`; questões
  objetivas e respostas vazias são ignoradas. As sugestões usam fonte `AI`,
  status `sugerida`, validação/reparo via `structuredRepair`, e preservam
  classificações correntes `aprovada`/`em_revisao`. Falha de classificação não
  desfaz a correção; retorna `warnings`. Documentado em
  `docs/SOLO_OBSERVED_CORRECTION.md`. Próxima etapa: **Subtarefa 17**
  (dashboard Bloom).
- **Subtarefa 17 concluída (17/07/2026)**: dashboard Bloom implementado em
  `/desempenho`. `GET /api/analytics/performance` agora retorna
  `bloomDashboard` com quantidade de itens, acertos equivalentes, percentual
  de acerto, média, tamanho da amostra, nível de confiança e evolução por
  período (`academicYear.bimester`). Objetivas contam como 10/0; discursivas
  usam `finalGrade`, evitando binarizar respostas abertas. A UI mostra aviso
  de amostra insuficiente quando há menos de 6 itens por nível. Documentado em
  `docs/BLOOM_DASHBOARD.md`. Próxima etapa: **Subtarefa 18** (dashboard DOK).
- **Subtarefa 18 concluída (17/07/2026)**: dashboard DOK implementado em
  `/desempenho`. A API cruza correções revisadas com classificações correntes
  `DOK` do motor (`generated_exam_question` + `examId` + `questionNumber`) e
  usa fallback do payload da questão quando a linha ainda não existe no motor.
  O painel exibe taxa de acerto, itens, acertos equivalentes, confiança,
  evolução por período e distribuição por disciplina. `DOK_4` fica oculto
  quando não há item classificado nesse nível. Documentado em
  `docs/DOK_DASHBOARD.md`. Próxima etapa: **Subtarefa 19** (dashboard BNCC).
- **Subtarefa 19 concluída (17/07/2026)**: dashboard BNCC implementado em
  `/desempenho`. A API usa `generation_payload.questions[].bnccCodes`,
  `bnccStatus` e `bnccSummary` como fonte, sem migrar BNCC para o motor
  genérico. O painel exibe habilidades mapeadas, itens vinculados, itens sem
  BNCC, agrupamentos por componente curricular e ano/série, além de lista de
  habilidades com taxa de desempenho, acertos equivalentes, confiança,
  evolução por período e status pedagógico (`dominio`, `desenvolvimento`,
  `intervencao`, `amostra_insuficiente`). Unidade temática não é inventada:
  aparece como não informada enquanto o payload não trouxer esse campo
  estruturado. Documentado em `docs/BNCC_DASHBOARD.md`. Próxima etapa:
  **Subtarefa 20** (dashboard dos Eixos Cognitivos do INEP).
- **Subtarefa 20 concluída (17/07/2026)**: dashboard dos Eixos Cognitivos do
  INEP implementado em `/desempenho`. A API cruza respostas revisadas com
  questões `source:"enem_bank"` do payload da prova e busca o eixo em
  `imported_question_classifications.enem_cognitive_axis_id` +
  `enem_cognitive_axes`, exibindo sempre DL, CF, SP, CA e EP com código,
  nome completo, descrição, taxa de desempenho, itens, acertos equivalentes,
  confiança, evolução por período e distribuição por disciplina. Questões
  geradas por IA com `saeb.source:"enem"` não entram porque não têm eixo
  estruturado no payload atual; o painel não infere eixo para evitar dado
  pedagógico fabricado. Documentado em
  `docs/INEP_COGNITIVE_AXIS_DASHBOARD.md`. Próxima etapa: **Subtarefa 21**
  (matriz Bloom x DOK).
- **Subtarefa 21 concluída (17/07/2026)**: matriz Bloom x DOK implementada em
  `/desempenho`. A API retorna `bloomDokMatrix`, cruzando `bloomLevel` do
  payload com DOK corrente do motor pedagógico, usando fallback do payload
  quando necessário. Cada célula mostra quantidade de itens, percentual de
  desempenho, acertos equivalentes, confiança e marcação de amostra baixa
  quando há menos de 3 itens, para evitar conclusão pedagógica indevida.
  Documentado em `docs/BLOOM_DOK_MATRIX.md`. Próxima etapa:
  **Subtarefa 22** (análise SOLO, separando esperado de observado).
- **Subtarefa 22 concluída (17/07/2026)**: análise SOLO implementada em
  `/desempenho`. A API retorna `soloDashboard` com `SOLO_EXPECTED` das
  atividades separado de `SOLO_OBSERVED` das respostas discursivas. O esperado
  busca classificação corrente do motor para `generated_exam_question` e usa
  fallback do payload; o observado busca `exam_correction_answer` no motor e
  nunca inclui objetivas. A UI mostra contagens, níveis, percentual, média,
  confiança e amostra baixa sem apresentar SOLO_EXPECTED como desempenho
  observado. Documentado em `docs/SOLO_DASHBOARD.md`. Próxima etapa:
  **Subtarefa 23** (perfil cognitivo do aluno).
- **Subtarefa 23 concluída (17/07/2026)**: perfil cognitivo por aluno
  implementado em `/desempenho`. A API retorna `cognitiveProfiles`, agrupado
  por `studentName`, com média, amostra, períodos, disciplinas, confiança,
  pontos fortes, pontos em desenvolvimento, BNCC com domínio/intervenção,
  profundidade DOK sustentada, eixos INEP quando existirem e limitações. As
  conclusões usam regras transparentes e linguagem de amostra, evitando rótulos
  permanentes. Documentado em `docs/COGNITIVE_PROFILE.md`. Próxima etapa:
  **Subtarefa 24** (testes integrados e validação pedagógica).
- **Subtarefa 24 concluída (17/07/2026)**: criado o gate integrado
  `npm run validate-pedagogical-engine` em
  `scripts/validate-pedagogical-engine.ts`. O script consulta o banco e valida
  catálogo/categorias, corrente única, confiança, classificação principal,
  classificação de questão e resposta, múltiplas taxonomias no mesmo item,
  auditoria, importação ENEM, geração IA e separação entre `SOLO_EXPECTED` e
  `SOLO_OBSERVED`. Invariantes estruturais retornam `FAIL`; ausência de
  amostra histórica retorna `WARN`. Documentado em
  `docs/INTEGRATED_PEDAGOGICAL_VALIDATION.md`. Próxima etapa:
  **Subtarefa 25** (segurança, desempenho e custos de IA).
- **Subtarefa 25 concluída (17/07/2026)**: revisão de segurança, desempenho e
  custos de IA documentada em `docs/AI_SECURITY_PERFORMANCE_COST_REVIEW.md`.
  Respostas de aluno enviadas à IA agora passam por sanitização básica
  (`prepareStudentAnswerForAi`) com redacao de e-mail/CPF/telefone e limite de
  tamanho; sugestoes de nota rodam com concorrencia maxima 2; regeneracao
  completa de prova passou a persistir `DOK`/`SOLO_EXPECTED`; autoria
  (`createdBy`) passou a ser registrada nas classificacoes geradas. Próxima
  etapa: **Subtarefa 26** (documentação técnica, pedagógica e operacional).
- **Subtarefa 26 concluída (17/07/2026)**: documentação final consolidada em
  `docs/MOTOR_CLASSIFICACAO_DOCUMENTACAO_FINAL.md`, reunindo mapa técnico,
  critérios pedagógicos, operação diária, deploy/teste, verificação em UI,
  segurança/custo de IA, limites conhecidos e checklist para manutenção. Com
  isso, as Subtarefas 00-26 do Motor de Classificações Pedagógicas estão
  concluídas.
