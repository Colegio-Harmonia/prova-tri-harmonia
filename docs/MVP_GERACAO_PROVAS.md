# Arquitetura do Sistema — Prova-TRI

> Criado 16/07/2026 no fechamento do MVP original; atualizado 17/07/2026
> (Subtarefa 01 do "Motor de Classificações Pedagógicas") pra refletir a
> integração Classroom, RBAC de 3 níveis, correção/lançamento de nota e
> analytics de desempenho — tudo isso construído *depois* do snapshot
> original. Este documento existe pra qualquer alteração futura não
> quebrar o que já está funcional, e agora também serve de mapa de
> arquitetura pra extensão do sistema com novas taxonomias pedagógicas
> (DOK, SOLO — ver `PEDAGOGICAL_CLASSIFICATION.md`). Se algo aqui divergir
> do código real no futuro, o código manda — atualize este arquivo junto
> com a mudança, não depois.

## 1. Visão geral da arquitetura

- **Stack**: Next.js 14 (App Router), TypeScript, Tailwind. Drizzle ORM +
  PostgreSQL (container Docker `prova-tri-postgres`, porta `5434`).
  Auth.js v5 (Credentials + JWT, sessão sem adapter de banco).
- **IA de geração de texto**: DeepSeek (`deepseek-v4-flash`), API REST
  compatível com OpenAI (`https://api.deepseek.com/chat/completions`).
  Sem `responseSchema` real no servidor — o schema esperado vai embutido
  como texto no prompt, e a validação de estrutura acontece via Zod no
  lado do prova-tri (`examSchema.ts` + `examValidator.ts`). `thinking`
  fica **ligado** (`{type:'enabled'}`, `max_tokens: 32768`) — importante:
  desligar isso quebra o raciocínio em conteúdo que exige regra cuidadosa
  (ver Pendências, item "thinking do DeepSeek").
- **Deploy**: servidor caseiro `192.168.1.218:3010`, processo gerenciado
  via PM2 (binário em `/home/eduardo/simulador-enem/node_modules/.bin/pm2`,
  não há pm2 global). Sem CI/CD — deploy é manual: `rsync` (**sempre**
  excluindo `node_modules`, `.next`, `.git`, `.env.local`) → `npm run
  build` → `pm2 restart prova-tri`.
- **Google Workspace**: um único service account
  (`paee-987@paee-497017.iam.gserviceaccount.com`, chave em
  `/home/eduardo/harmohub/credentials/service-account.json`) usado pra
  Sheets (leitura de currículo), Drive (staging de imagens, pasta raiz
  configurável) e Docs (geração dos 3 documentos finais).
- **Login**: Credentials (email/senha via `bcryptjs`) **e** Google OAuth
  institucional (domínio `@colegioharmonia.com.br`, sem autocadastro —
  só quem já existe em `users` consegue entrar) convivem — `passwordHash`
  nullable pra contas só-Google. Domínio público próprio
  `https://prova.colegioharmonia.com.br` via Caddy (TLS-ALPN-01,
  ver CLAUDE.md).
- **Google Classroom**: 3 escopos incrementais (`classroom.courses.
  readonly`, `classroom.rosters.readonly`, `classroom.coursework.
  students`) via o mesmo login Google — lista turmas, importa roster de
  aluno, cria atividade e lança/devolve nota. Access/refresh token do
  professor ficam na sessão JWT (nunca no banco), com renovação
  automática ~1min antes de expirar.
- **Google Chat**: notificações privadas por conversa individual do app; ver
  `docs/google-chat-notificacoes.md`.
  (impersona o destinatário pra abrir uma DM bot) — 3 gatilhos, ver
  seção 3.

## 2. Schema do banco de dados

Duas origens: tabelas definidas no Drizzle (`src/db/schema.ts`) e uma
tabela criada via SQL bruto fora do Drizzle (`imported_questions`, feita
por `scripts/import-enem.ts` — não tem migration Drizzle formal).

### 2.1 `users`
| Coluna | Tipo | Observação |
|---|---|---|
| id | serial PK | |
| name, email (unique) | text | |
| password_hash | text **nullable** | Nullable desde 16/07 — conta só-Google não tem senha. |
| google_id | text unique, nullable | `sub` do provider Google, setado no primeiro login OAuth. |
| role | `text`, enum TS `coordenacao` \| `professor` \| `direcao` | **Sem CHECK constraint real no Postgres** — é `text` puro, o enum é só tipagem Drizzle/TS (confirmado, importante: adicionar um 4º valor no futuro não precisa de migration). Direção tem exatamente a mesma permissão de superusuário que Coordenação em todo o sistema — ver `src/lib/auth/roles.ts`, `isStaffSuperuser()`. **Nunca comparar a string `'coordenacao'` direto num call site novo — sempre usar esse helper.** |
| active | boolean | Desativação lógica (nunca DELETE, por causa de FKs em `generated_exams`). Bloqueia login nos dois métodos (Credentials e Google). Superusuário não pode desativar a própria conta (trava anti-lockout em `/api/users/[id]`). |
| created_at, last_login_at | timestamp | `last_login_at` **é escrito de verdade** desde 17/07 (antes existia na tabela mas nunca era atualizado em lugar nenhum). |

Gerenciamento via UI em `/usuarios` (só coordenacao/direcao — gate em 3
camadas: nav link escondido, `redirect()` no `page.tsx`, 403 na API) —
cadastra e-mail `@colegioharmonia.com.br` novo (sem senha, login só
Google), edita cargo/ativo inline. Bootstrap inicial de conta continua
via `scripts/create-user.ts` (agora aceita `--role direcao` também).

**Aluno nunca tem linha em `users`** — decisão confirmada explicitamente:
aluno não loga na plataforma, é só listado via Classroom API na hora de
lançar nota (ver `exam_corrections.classroom_student_id`, seção 2.9).

### 2.2 `generated_exams` (tabela central)
| Coluna | Tipo | Observação |
|---|---|---|
| id | serial PK | |
| created_by | FK → users | |
| segment | enum `anos-iniciais`\|`anos-finais`\|`ensino-medio` | |
| grade_year | integer | Série (1-9, ou 1-3 no EM). |
| academic_year | integer | Ano letivo (2026...) — **distinto** de grade_year, existe pra reaproveitar o sistema ano após ano. |
| subject | text | Nome da disciplina (string livre, bate com `config/subjects.ts`). |
| bimester | integer nullable | |
| question_count, objective_count, discursive_count | integer | Contagens re-derivadas sempre do `generation_payload`, nunca confiadas cegamente. |
| enem_bank_question_ids | integer[] nullable | IDs de `imported_questions` escolhidos manualmente na tela de geração (só Ensino Médio). |
| status | enum, ver `EXAM_STATUSES` abaixo | Máquina de estados do ciclo de vida. |
| generation_payload | **jsonb** (não normalizado) | A prova inteira mora aqui — ver seção 2.5. Fonte de verdade única. |
| unmapped_warnings | jsonb | Array de strings — avisos de BNCC não mapeado, avisos de validação estrutural, etc. |
| drive_folder_id, prova_doc_id/url, gabarito_doc_id/url, mapa_doc_id/url | text nullable | Preenchidos só depois de aprovada (geração dos 3 documentos). |
| assigned_to, assigned_by | FK → users | |
| assigned_at, chat_notified_at, reviewed_at, printed_at, applied_at, corrected_at, created_at, finalized_at | timestamp | Trilha de auditoria do fluxo. |
| review_ready_notified_at | timestamp nullable | Quando o atribuído avisou (Gatilho 3 do Chat) que terminou a revisão — também é o momento da transição `em_andamento → revisao_concluida`, não só um log. |
| classroom_course_id | text nullable | Vincula a prova a uma turma real do Classroom — setado na hora de corrigir (`/turmas/[courseId]`), não na geração (a prova pode existir antes de se saber em qual turma vai ser aplicada). |
| classroom_coursework_id | text nullable | ID da atividade criada no Classroom pra lançar nota — criada 1x só (primeiro "Lançar notas"), reaproveitada depois. |

**`EXAM_STATUSES`** (`src/db/schema.ts`, também `text` puro sem CHECK constraint):
```
rascunho → atribuido → em_andamento → revisao_concluida → aprovado → impresso → aplicado → corrigido
```
- `atribuir`/`aprovar`/`marcar_impresso`: só coordenação/direção.
- `iniciar_revisao`/`concluir_revisao`/`marcar_aplicado`/`marcar_corrigido`: o atribuído OU coordenação/direção.
- A tela de revisão deve espelhar essa regra: se coordenação/direção atribuir
  a prova para si, também precisa ver o botão `concluir_revisao` em
  `em_andamento`. Hotfix aplicado em 17/07/2026 após teste manual na prova 25.
- `revisao_concluida` foi adicionado 17/07 — antes disso o botão de "avisar
  que terminei a revisão" só mandava notificação sem mudar o status
  visível, e o painel ficava mostrando "Em andamento" indefinidamente.
  Agora é uma transição de status de verdade (`concluir_revisao`), que
  também dispara a notificação de Chat pra coordenação/direção — o envio
  do Chat vive dentro do handler dessa transição em `status/route.ts`,
  mesmo padrão que `atribuir` já usa.
- `aprovado` (que agora exige vir de `revisao_concluida`, não mais de
  `em_andamento` direto) dispara a geração dos 3 documentos Google Docs
  (síncrono, dentro da própria rota de status).
- **Regenerar prova inteira** só é permitido em `rascunho`. **Trocar 1
  questão**, **mexer em imagens** e **anotar review** são permitidos em
  `rascunho`, `atribuido`, `em_andamento` **e `revisao_concluida`** —
  travam só a partir de `aprovado`.

### 2.3 `curriculum_tab_overrides`
Escape hatch manual: quando o fuzzy-match de nome de aba falha (nome real
da aba diverge do nome da disciplina), a coordenação pode gravar aqui a
correspondência exata sem precisar de deploy. Chave: `segment + grade_year
+ subject` → `sheet_tab_name`.

### 2.4 `curriculum_enrichment`
Conteúdo extra extraído de PDFs (Programação Trimestral, Manual do
Professor) casado por `chapterTitle` normalizado (tira numeração,
lowercase) — usado pra enriquecer o prompt de geração além do que a
planilha de cronograma já trazia. Populado por scripts batch
(`scripts/02_load_enrichment*.ts`), não por fluxo de usuário.

### 2.5 Estrutura do `generation_payload` (JSONB, não é tabela — é o formato de `ExamQuestion[]`)
Schema completo em `src/lib/gemini/examSchema.ts` (Zod). Por questão:

```ts
{
  number: number
  source: 'ia' | 'enem_bank'       // 'enem_bank' = questão real, nunca regenerada/editada por IA
  enemBankRef: { questionId, year } | null
  type: 'objetiva' | 'descritiva'
  bloomLevel: 'lembrar'|'compreender'|'aplicar'|'analisar'|'avaliar'|'criar'
  statement: string                 // pode conter $...$ (LaTeX, ver seção 5)
  supportText: string | null
  alternatives: { letter, text }[] | null
  correctLetter: string | null
  expectedAnswer: string | null     // só descritiva
  gradingCriteria: string | null    // só descritiva
  bnccCodes: string[]
  bnccStatus: 'mapeado' | 'nao_mapeado'
  bnccSummary: string | null
  saeb: { applicable, source: 'novo_saeb'|'classica'|'enem'|null, value, approximate }
  needsImage: boolean
  imageQuery: string | null
  image: {
    source: 'busca'|'gerada'|'grafico'|'importado'|'enem'
    driveFileId, previewUrl, approved: boolean, sourceUrl?: string
  } | null
  review: {                         // anotação do revisor, nunca preenchida pela IA
    adequacy: 'adequada'|'inadequada'|null
    difficulty: 'facil'|'adequada'|'dificil'|null
    comment: string | null
  } | null
}
```

### 2.6 ENEM — matriz de referência (tabelas Drizzle)
`enem_areas` (4 áreas) → `enem_competencies` (C1-C9 por área) →
`enem_skills` (H1-H30 por área, `code` tipo "H7", ligado a uma
competência) → `enem_cognitive_axes` (5 eixos: DL/CF/SP/CA/EP, comuns a
todas as áreas).

### 2.7 `imported_questions` (fora do Drizzle, SQL bruto)
2.689 questões reais do ENEM (2009-2023), vindas da API pública
`enem.dev`. Colunas: `id, source, year, question_index, discipline,
language, title, context, files (jsonb, URLs de imagem originais),
correct_alternative, alternatives_introduction, alternatives (jsonb),
raw_json`. Único índice relevante pra unicidade:
`(source, year, question_index, language)`.

### 2.8 `imported_question_classifications`
Liga uma `imported_questions.id` (FK textual, não FK real do Drizzle —
tabela externa) às classificações: Bloom (`bloom_level` +
`bloom_level_source`: `deepseek-v2` = IA real, `pending` = nunca
classificado), e matriz ENEM (`enem_area_id`, `enem_competency_id`,
`enem_skill_id`, `enem_cognitive_axis_id`, `enem_classification_source`:
`oficial` = via microdados INEP reais, `ai` = heurística/estimado).
Unique constraint em `(question_id, source)` — hoje `source` é sempre
`'enem'`.

### 2.9 `exam_corrections` (correção por aluno, 17/07/2026)

1 linha por (prova, aluno). **Aluno é texto livre (nome/e-mail), nunca FK
pra `users`** — decisão de modelagem confirmada (ver seção 2.1).

| Coluna | Tipo | Observação |
|---|---|---|
| id | serial PK | |
| exam_id | FK → generated_exams | |
| classroom_student_id | text nullable | `userId` opaco do Classroom quando o aluno veio de "Importar alunos da turma" — nulo em entrada manual. Necessário pra lançar nota (`studentSubmissions` é endereçada por esse id). |
| student_name, student_email | text | |
| answers | **jsonb** | Array `CorrectionAnswer[]` por questão — mesmo padrão de `generation_payload`, não normalizado. Ver estrutura abaixo. |
| status | `text`, enum `pendente` \| `revisado` | Só corrações `revisado` entram na média de `/api/analytics/performance` e são elegíveis pra lançar nota. |
| created_by | FK → users | |
| created_at, updated_at | timestamp | |
| grade_returned_at | timestamp nullable | Quando a nota desse aluno foi devolvida de verdade pro Classroom (idempotente — reenviar não duplica, a API do Google aceita patch+return de novo). |

**Estrutura de `answers[]` (`src/types/correction.ts`, `CorrectionAnswer`):**
```ts
{
  questionNumber: number
  type: 'objetiva' | 'descritiva'
  transcribedAnswer: string        // digitado manualmente — SEM OCR ainda
  correctLetter: string | null     // só objetiva, copiado do gabarito
  isCorrect: boolean | null        // só objetiva, recalculado no servidor a cada save (nunca confia no cliente)
  aiSuggestedGrade: number | null  // só descritiva, 0-10, via DeepSeek real
  aiSuggestedFeedback: string | null
  finalGrade: number | null        // 0-10, editável pelo professor
  finalFeedback: string | null
}
```

Nota final da prova (`totalGrade()`, `src/lib/corrections/totalGrade.ts`
— **única implementação, reusada em preview de tela e decisão de
servidor**) = média simples de `finalGrade` sobre **todas** as questões
(uma questão sem nota ainda conta como divisor, então só reflete o total
real quando a correção está completa).

Resposta transcrita é **sempre digitação manual** — não existe OCR
implementado. Objetiva é corrigida deterministicamente (compara letra
transcrita com gabarito), nunca por IA. Descritiva usa sugestão real de
IA (`src/lib/gemini/gradeSuggestion.ts`, DeepSeek, com `expectedAnswer`/
`gradingCriteria` já salvos na prova desde a geração) — sempre editável,
nunca autoritativa.

## 3. Fluxo de geração de prova (passo a passo real)

1. **`/gerar`** (`CurriculumPreview.tsx`): usuário escolhe segmento/série/
   disciplina/bimestre. Pra Ensino Médio, aparece o painel do banco ENEM
   (filtros Bloom/Habilidade/Eixo cognitivo + campo numérico de
   quantidade, auto-seleciona as N melhores).
2. **`POST /api/curriculum/preview`**: chama `getCurriculumForExam()`
   (`src/lib/sheets/curriculumService.ts`) — resolve a aba real da
   planilha (fuzzy-match ou `knownTabTitles`/`curriculum_tab_overrides`),
   lê todas as abas em paralelo (`Promise.all`, se a disciplina for
   "união de frentes"), parseia Habilidades/Objetivos por sinônimo de
   cabeçalho (nunca por índice de coluna — `headerResolver.ts`), anexa
   enrichment do banco. Retorna preview sem chamar IA nenhuma.
3. **`POST /api/exams/generate`**: monta o prompt (`buildExamPrompt`,
   `promptBuilder.ts` — inclui regras de Bloom/BNCC/SAEB/interpretação/
   notação matemática, ver seção 5), chama `generateStructuredContent`
   (DeepSeek), valida com Zod + `examValidator.ts` (re-deriva
   contagens, hard-override de SAEB/imagem pra disciplina sem matriz
   oficial, nunca confia no que o modelo disse sobre si mesmo), 1 retry
   automático se a validação achar problema estrutural. Mescla com
   questões do banco ENEM (`buildBankExamQuestions`,
   `enemBankMerge.ts` — baixa a imagem original da questão quando
   existe, sobe pro Drive). Persiste em `generated_exams` com
   `status:'rascunho'`.
4. **Revisão** (`/gerar/[examId]/revisar`, `RevisarExam.tsx`):
   coordenação/direção atribui (`POST /api/exams/[examId]/status`, ação
   `atribuir` — dispara Google Chat Gatilho 1), revisor faz
   `iniciar_revisao`, revisa por questão (adequação/dificuldade/
   comentário via `review-note`, troca 1 questão via
   `regenerate-question`, mexe em imagem via `toggle-image`/
   `request-image`/`import-image`), e quando termina clica "Concluir
   revisão e avisar coordenação" (ação `concluir_revisao` — muda status
   pra `revisao_concluida` **e** dispara Chat Gatilho 3 pra coordenação/
   direção, tudo na mesma transição).
5. **Aprovação**: coordenação/direção faz `aprovar` (só disponível a
   partir de `revisao_concluida`) — dispara a geração dos 3 documentos
   Google Docs (`generateExamDocs.ts` orquestra `provaDocBuilder.ts`,
   `gabaritoDocBuilder.ts`, `mapaDocBuilder.ts`).
6. **`/status`** (renomeado "Provas" no menu, rota continua `/status`):
   tabela de acompanhamento com filtros (segmento, série, ano letivo,
   bimestre, disciplina, status, atribuído) + paginação real
   (server-side, limit/offset, teto 100/página). Professor só vê as
   próprias (`assignedTo`); coordenação/direção vê tudo e pode filtrar
   por qualquer atribuído.
7. **Impressão/aplicação**: `marcar_impresso` (coordenação/direção) →
   `marcar_aplicado` (atribuído ou coordenação/direção).
8. **Correção** (`/gerar/[examId]/corrigir` ou hub em
   `/turmas/[courseId]`, só a partir de `aplicado`): importa roster de
   uma turma real do Classroom de uma vez (em vez de cadastrar aluno
   manualmente — divergência real corrigida no mesmo dia que foi
   descoberta), corrige por aluno/questão, "Salvar progresso" (mantém
   `pendente`) ou "Concluir correção" (marca `revisado`) — só correções
   `revisado` entram na média/lançamento de nota.
9. **Lançamento de nota** (`/turmas/[courseId]`, 1 clique, com
   confirmação explícita porque é ação visível pro aluno imediatamente):
   cria a atividade no Classroom (1x, `state:PUBLISHED` — obrigatório
   pra gerar 1 `StudentSubmission` por aluno matriculado), preenche
   `assignedGrade` de todo aluno `revisado` com roster vinculado, tenta
   devolver (`:return` falha esperadamente com `FAILED_PRECONDITION`
   quando o aluno nunca "entregou" nada digitalmente — prova é em
   papel, isso é engolido, não é erro real) — dispara Chat Gatilho 2
   pra coordenação/direção quando `granted > 0`.

## 4. Rotas de API (lista completa — 27 rotas)

| Rota | Método | Propósito |
|---|---|---|
| `/api/auth/[...nextauth]` | * | NextAuth handler (Credentials + Google). |
| `/api/curriculum/preview` | POST | Preview de currículo, sem IA. |
| `/api/exams/generate` | POST | Gera prova nova (IA + banco ENEM). |
| `/api/exams` | GET | Lista provas (filtros + paginação; professor auto-restrito à própria via `isStaffSuperuser`). |
| `/api/exams/filters` | GET | Valores de filtro realmente existentes (disciplinas, anos, atribuídos). |
| `/api/exams/[examId]` | GET | Detalhe de 1 prova. **Ownership check** (`authorizeExamAccess` — criador OU atribuído OU superusuário; 403 caso contrário — falha de segurança real corrigida 17/07, ver Pendências). |
| `/api/exams/[examId]/status` | POST | Transição de estado (atribuir/iniciar_revisao/**concluir_revisao**/aprovar/marcar_*). |
| `/api/exams/[examId]/regenerate` | POST | Regenera a prova inteira (só em `rascunho`). Ownership check. |
| `/api/exams/[examId]/regenerate-question` | POST | Troca 1 questão específica. Ownership check. |
| `/api/exams/[examId]/review-note` | POST | Salva adequação/dificuldade/comentário por questão. Ownership check. |
| `/api/exams/[examId]/toggle-image` | POST | Aprova/rejeita imagem já resolvida. Ownership check. |
| `/api/exams/[examId]/request-image` | POST | Busca/gera imagem manualmente (texto de busca). Ownership check. |
| `/api/exams/[examId]/import-image` | POST | Importa imagem de um link colado (guard anti-SSRF). Ownership check. |
| `/api/exams/[examId]/link-course` | POST | Vincula a prova a uma turma do Classroom (`classroomCourseId`). |
| `/api/exams/[examId]/corrections` | GET, POST | Lista correções da prova; cria correção manual de 1 aluno. |
| `/api/exams/[examId]/corrections/import` | POST | Importa o roster inteiro da turma vinculada de uma vez (idempotente). |
| `/api/exams/[examId]/corrections/[correctionId]` | PATCH, DELETE | Salva respostas/notas por questão; recalcula `isCorrect` no servidor. |
| `/api/exams/[examId]/corrections/[correctionId]/suggest` | POST | Sugestão de nota por IA (DeepSeek) pras questões descritivas ainda sem sugestão. |
| `/api/exams/[examId]/return-grades` | POST | Cria atividade (1x) + lança + tenta devolver nota de todo aluno `revisado` com roster — dispara Chat Gatilho 2. |
| `/api/enem-bank/search` | GET | Busca questões reais do banco ENEM (filtros). |
| `/api/enem-bank/skills` | GET | Lista habilidades oficiais por área (popula dropdown). |
| `/api/stats/dashboard` | GET | Estatísticas gerais (todas as provas), inclui `revisao_concluida` no `byStatus`. |
| `/api/stats/enem` | GET | Estatísticas do banco ENEM (10 queries paralelas). |
| `/api/analytics/performance` | GET | Desempenho por disciplina/série/Bloom/professor, calculado na hora (sem tabela pré-agregada) sobre `exam_corrections` + `generated_exams`. Professor sempre restrito à própria (mesmo forçando filtro na query string); coordenação/direção libera comparativo por professor. |
| `/api/classroom/courses` | GET | Turmas do professor logado, via o access token dele (Google Classroom API). |
| `/api/users` | GET | Lista usuários — `?all=1` (só superusuário) traz todos incl. inativos, pra tela `/usuarios`. |
| `/api/users` | POST | Cadastra usuário novo (só superusuário, só e-mail `@colegioharmonia.com.br`). |
| `/api/users/[id]` | PATCH | Edita nome/cargo/ativo (só superusuário; não pode desativar a própria conta). |

## 5. Peças especiais do pipeline de geração

- **SAEB/ENEM** (`bnccSaebMap.ts` + `saebApplicability.ts`): matriz oficial
  hardcoded (nunca inferida pela IA) — LP/Matemática exatas em 2º/5º/9º
  ano, Ciências Humanas (História/Geografia)/Natureza (Ciências) exatas em
  5º/9º, todo o resto aproximado pro ano de referência mais próximo com
  `approximate:true` explícito. Disciplinas sem matriz oficial (Inglês,
  Artes, Ed. Física, Filosofia no Fundamental) sempre `applicable:false`
  — nunca inventado, com hard-override no validator.
- **Interpretação/contextualização** (`promptBuilder.ts`): regra universal
  proíbe questão de definição nua mesmo em nível Lembrar; reforço extra
  pra disciplinas interpretativas (História/Geografia/Filosofia/
  Sociologia/Português/Literatura) exigindo `supportText` substancial em
  Analisar/Avaliar/Criar. No Ensino Médio, injeta exemplares reais do
  banco ENEM como referência de estilo.
- **Imagens** (`questionImageService.ts`): 4 fontes possíveis —
  `grafico` (QuickChart, determinístico, quando o pedido tem dados
  numéricos), `busca` (Wikimedia Commons), `gerada` (IA/Gemini, precisa
  de crédito — ver Pendências), `importado`/`enem` (upload direto, com
  guard anti-SSRF pra links de professor). Nunca auto-aprovada.
- **Fórmulas matemáticas** (`src/lib/math/latexRender.ts`): texto marcado
  `$...$` vira imagem tipografada via `latex.codecogs.com` (serviço
  gratuito, sem IA nenhuma — renderização é determinística). Tela de
  revisão usa a URL direto; documento final baixa e sobe pro Drive com
  proporção real (`latexImageCache.ts`). Gabarito ainda não tem esse
  pipeline — só tira os delimitadores e mostra o LaTeX cru como texto.
- **Sugestão de nota por IA** (`src/lib/gemini/gradeSuggestion.ts`): só
  pra questões descritivas na correção, usa `expectedAnswer`/
  `gradingCriteria` já salvos desde a geração da prova + a resposta
  transcrita do aluno, pede nota 0-10 + justificativa — nunca
  autoritativa, mesmo princípio de "IA sugere, humano decide" seguido em
  todo o resto do sistema (BNCC não mapeado, imagem não auto-aprovada,
  agora nota também).
- **RBAC** (`src/lib/auth/roles.ts`): `isStaffSuperuser(role)` é o único
  ponto que decide se `coordenacao`/`direcao` têm acesso de superusuário
  — usado em ~15 call sites. Regra de ouro: nunca comparar a string
  `'coordenacao'` direto num código novo, sempre passar por esse helper,
  senão `direcao` fica de fora silenciosamente.
- **Ownership de prova** (`src/lib/exams/authorizeExamAccess.ts`): "é sua
  prova" = você criou (`createdBy`) OU foi atribuída a você
  (`assignedTo`) OU você é superusuário. Aplicado em 7 rotas desde 17/07
  (antes, qualquer usuário logado podia ver/editar prova de terceiro só
  sabendo o ID — falha de segurança real, ver Pendências).
- **Google Classroom** (`src/lib/classroom/classroomClient.ts`):
  `listMyCourses`, `listStudentsInCourse`, `createCourseWork`,
  `listSubmissions`, `patchAndReturnGrade` — todos usam o access token do
  **professor logado** (nunca a service account — cursos/turmas
  pertencem à conta individual). `isInsufficientScopeError()` detecta
  quando uma sessão renovada via refresh_token não tem um escopo
  adicionado depois do login original (refresh nunca amplia escopo) e
  sinaliza reautenticação em vez de erro genérico.
- **Google Chat** (`src/lib/notifications/googleChat.ts`): 3 gatilhos —
  atribuição de prova → professor; nota lançada → coordenação/direção;
  revisão concluída → coordenação/direção. Cada alerta usa exclusivamente a
  conversa privada que o destinatário ativou no app `Prova-tri`; não existe
  webhook nem fallback para espaço compartilhado. É sempre best-effort:
  nunca derruba a ação principal se o Chat falhar.

## 6. Pendências / pontos de atenção pra futuras alterações

⚠️ **Ler antes de mexer.** Itens 1 e 9 da versão anterior deste documento
(decisão de `role`, OAuth do Google) **foram resolvidos** — ver histórico
abaixo se precisar do contexto de como foram decididos.

1. **`src/db/client.ts` precisa manter o `export const db = new
   Proxy(...)` síncrono.** Um commit anterior trocou pra um `getDb()`
   assíncrono sem migrar os ~17 arquivos que fazem `import { db }`
   direto, quebrando o build silenciosamente. Não reintroduzir isso sem
   migrar todos os call sites primeiro.
2. **`.env.local` nunca pode entrar no `rsync` de deploy.** Já causou
   incidente real (sobrescreveu a `DEEPSEEK_API_KEY` de produção com um
   placeholder de dev). Sempre `--exclude .env.local`.
3. **`rsync` sem `--delete` nunca remove arquivo apagado localmente do
   servidor** — descoberto 17/07 (uma rota de API apagada localmente
   ficou órfã em produção até ser removida manualmente via `ssh rm`).
   Sempre que um deploy remover um arquivo, ou usar `rsync --delete`
   (respeitando os excludes de sempre) ou apagar manualmente no servidor.
4. **`pm2 restart` NÃO recarrega mudança em `.env.local`** — o PM2 guarda
   uma cópia própria do ambiente capturada em `pm2 start`, com
   prioridade sobre o que o Next.js leria do arquivo em runtime. Sempre
   que `.env.local` mudar em produção: `pm2 delete prova-tri && pm2
   start ecosystem.config.js && pm2 save` (não confiar em
   `--update-env`, que puxa do shell atual em vez do arquivo).
5. **`thinking` do DeepSeek precisa ficar ligado** (`llmClient.ts`).
   Desligar economiza tokens mas causa erros de raciocínio real em
   conteúdo que exige regra cuidadosa (confirmado com um caso real de
   classificação de oxítona errada). `max_tokens: 32768` já testado
   seguro pra prova de 12 questões (uso real ficou em ~9k-11k).
6. **Geração de imagem por IA (`imageGenerate.ts`, Gemini) depende de
   crédito na conta Gemini** — histórico de ficar sem saldo. Cai
   silenciosamente pro próximo fallback (ou falha se Wikimedia também não
   achar nada); isso é esperado, não é bug.
7. **Gabarito não tem pipeline de imagem inline** — fórmula matemática
   aparece como LaTeX cru (`3 \cdot 2^{n-1}`, sem tipografia) nas
   respostas esperadas de questões descritivas. Funcional, não bonito.
8. **`generation_payload` e `exam_corrections.answers` são a fonte de
   verdade — não normalizados em tabelas.** Qualquer alteração de schema
   de questão/resposta precisa ser retrocompatível com payloads já
   salvos no banco (não tem migration de JSONB histórico). **Relevante
   pro Motor de Classificações Pedagógicas**: DOK/SOLO_EXPECTED, se
   viverem dentro de `generation_payload.questions[]`, herdam essa mesma
   restrição — decisão de onde viver (dentro do JSONB vs. tabela própria
   polimórfica, ver seção 9.3 do pedido do motor) é da Subtarefa 03, não
   deste documento.
9. **Correção automatizada via cartão físico + n8n (OMR/OCR) é roadmap
   documentado, zero código construído** — arquitetura decidida mas
   nada implementado (ver `CLAUDE.md` raiz, seção "Próxima etapa"). **A
   correção via Classroom (seções 2.9 e 3 deste documento) é uma segunda
   abordagem, já construída e em produção** — as duas ainda não foram
   formalmente reconciliadas (a via Classroom cobre o caso real de uso
   atual; a via n8n/cartão físico permanece só documentada). Não
   construir a via n8n sem antes decidir se ela ainda é necessária dado
   que Classroom já resolve o caso de uso na prática.
10. **`EnemDashboard.tsx.bak`** é um arquivo órfão (gitignorado via
    `*.bak`) na pasta do dashboard — sobra de uma edição antiga,
    inofensivo, pode apagar quando for mexer por perto.
11. **`drizzle-kit generate`/`migrate` estão quebrados** — journal de
    migrations desincronizado (`drizzle/meta/_journal.json` só tem a
    entrada da migration 0000, mas existem migrations manuais depois
    dela). Trava (hang) ao rodar `generate`. Workaround em uso: escrever
    a migration SQL à mão e aplicar direto via `psql "$DATABASE_URL" -f
    drizzle/000X_nome.sql`, local e produção. Ninguém consertou a cadeia
    de journal/snapshot ainda.
12. **Google Chat exige o app ativo e uma conversa privada ativada por
    destinatário** — o app em Draft bloqueia todos os gatilhos; e, mesmo
    ativo, uma pessoa sem `Chat conectado` em `/usuarios` não deve receber
    alertas. O envio é best-effort, então falhas aparecem em `pm2 logs` e
    nunca podem cair em espaço/grupo como contingência. Primeiro lugar para
    checar se alguém não recebe: status do app no Cloud Console, service
    account do próprio app e a ativação individual registrada no sistema.
13. **Falha de segurança real, corrigida 17/07**: 7 rotas de prova
    (detalhe + regenerate/review-note/toggle-image/request-image/
    import-image/regenerate-question) não checavam ownership, só login
    — qualquer professor via/editava prova de colega sabendo o ID.
    Corrigido com `authorizeExamAccess()` (seção 5). **Qualquer rota
    nova que opere sobre uma prova específica precisa passar por esse
    helper**, não reimplementar a checagem.
14. **Não existe suíte de testes automatizados** — confirmado nesta
    subtarefa (nenhum framework de teste no `package.json`, nenhuma
    pasta de testes no projeto). Toda validação até aqui foi manual, em
    produção, com dado real. Relevante pro Motor de Classificações
    Pedagógicas: a seção 20 do pedido original exige testes pra toda a
    funcionalidade nova — será a primeira vez que o projeto ganha uma
    suíte de testes de verdade, decidir framework (Vitest é o mais
    natural pra um projeto Next.js/TS já usando Zod) é decisão da
    Subtarefa 02+, não deste levantamento.

## 7. Onde procurar cada coisa (mapa rápido)

| Preciso mexer em... | Arquivo |
|---|---|
| Prompt de geração | `src/lib/gemini/promptBuilder.ts` |
| Schema de questão/prova (Zod) | `src/lib/gemini/examSchema.ts` |
| Validação pós-geração | `src/lib/gemini/examValidator.ts` |
| Cliente do DeepSeek | `src/lib/gemini/llmClient.ts` |
| Leitura de currículo (Sheets) | `src/lib/sheets/curriculumService.ts` |
| Matriz SAEB/ENEM oficial | `src/lib/sheets/bnccSaebMap.ts`, `src/config/saebApplicability.ts` |
| Banco real do ENEM (merge na prova) | `src/lib/gemini/enemBankMerge.ts` |
| Imagens de questão | `src/lib/images/questionImageService.ts` |
| Fórmulas matemáticas | `src/lib/math/latexRender.ts`, `src/lib/docs/latexImageCache.ts` |
| Geração dos 3 documentos | `src/lib/docs/{prova,gabarito,mapa}DocBuilder.ts`, `generateExamDocs.ts` |
| Schema do banco | `src/db/schema.ts` |
| Tela de revisão | `src/app/(app)/gerar/[examId]/revisar/RevisarExam.tsx` |
| Tela de geração | `src/app/(app)/gerar/CurriculumPreview.tsx` |
| Dashboard | `src/app/(app)/dashboard/{DashboardStats,EnemDashboard,ProfessorHome}.tsx` |
| Status/acompanhamento (menu "Provas") | `src/app/(app)/status/StatusList.tsx` |
| RBAC / permissão de superusuário | `src/lib/auth/roles.ts` |
| Ownership de prova (quem pode ver/editar) | `src/lib/exams/authorizeExamAccess.ts` |
| Login Google / escopos Classroom | `src/auth/auth.ts` |
| Cliente Google Classroom | `src/lib/classroom/classroomClient.ts` |
| Notificações Google Chat (3 gatilhos) | `src/lib/notifications/googleChat.ts` |
| Correção por aluno | `src/app/(app)/gerar/[examId]/corrigir/CorrigirExam.tsx` |
| Sugestão de nota por IA | `src/lib/gemini/gradeSuggestion.ts` |
| Total/média da correção | `src/lib/corrections/totalGrade.ts` (única implementação, tela e servidor) |
| Hub de turma (importar roster, lançar nota) | `src/app/(app)/turmas/[courseId]/TurmaDetail.tsx` |
| Analytics de desempenho | `src/app/api/analytics/performance/route.ts`, `src/app/(app)/desempenho/DesempenhoPanel.tsx` |
| Gerenciar usuários | `src/app/(app)/usuarios/UsuariosList.tsx`, `src/app/api/users/**` |
| Manual de classificação pedagógica (Bloom/BNCC/DOK/SOLO) | `PEDAGOGICAL_CLASSIFICATION.md` (raiz) |

## 8. Testes (levantado na Subtarefa 01)

**Não existe suíte de testes automatizados hoje.** Confirmado via
`package.json` (nenhuma dependência de framework de teste — sem Jest,
Vitest, Playwright, `@testing-library`) e busca por pasta/arquivo de
teste no projeto (nenhum encontrado). Toda validação até aqui foi manual
em produção com dado real (padrão já estabelecido nas sessões
anteriores: script `scripts/_test_*.ts` temporário, sempre apagado
depois de usar). O Motor de Classificações Pedagógicas (seção 20 do
pedido) exige testes automatizados — será a primeira suíte real do
projeto; escolha de framework fica pra Subtarefa 02 (projeto de
arquitetura), não decidida aqui.

## 9. Documentação existente (inventário, Subtarefa 01)

| Documento | Propósito | Estado |
|---|---|---|
| `CLAUDE.md` (raiz) | Metodologia pedagógica comum (Bloom×BNCC×matriz oficial), regras de git/deploy, estado atual do projeto, histórico de decisões de todas as fases | Vivo, atualizado a cada subtarefa |
| `/anos-iniciais/CLAUDE.md`, `/anos-finais/CLAUDE.md`, `/ensino-medio/CLAUDE.md` | Especificidades por segmento (planilhas, nº de alternativas, disciplinas) | Não revisado nesta subtarefa (fora do escopo de classificação pedagógica) |
| `docs/MVP_GERACAO_PROVAS.md` (este arquivo) | Arquitetura técnica completa — schema, fluxo, rotas, pendências | Atualizado nesta subtarefa (estava desatualizado desde 16/07) |
| `PEDAGOGICAL_CLASSIFICATION.md` (raiz) | Manual normativo de critérios de classificação pedagógica (Bloom, BNCC, DOK, Eixos INEP, SOLO_EXPECTED, SOLO_OBSERVED) | Criado na Subtarefa 00 |
| `referencias/matriz-saeb-bncc.md` | Tabela de correspondência SAEB × BNCC usada por `bnccSaebMap.ts` | Não revisado nesta subtarefa |

Nenhuma lacuna crítica de documentação encontrada pras subtarefas
seguintes do Motor de Classificações Pedagógicas — a base (schema atual,
fluxo, critérios pedagógicos) está coberta pelos 2 documentos centrais
(este arquivo + `PEDAGOGICAL_CLASSIFICATION.md`).
