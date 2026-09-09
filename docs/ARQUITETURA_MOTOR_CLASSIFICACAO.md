# Arquitetura do Motor de Classificações Pedagógicas — Documento de Decisão

**Data:** 17/07/2026
**Subtarefa:** 02 do Motor de Classificações Pedagógicas (só design — zero migration, zero código)
**Depende de:** `PEDAGOGICAL_CLASSIFICATION.md` (critérios pedagógicos) e `docs/MVP_GERACAO_PROVAS.md` (estado real do sistema, Subtarefas 00/01)

---

## 1. Objetivo deste documento

Decidir **como** o motor vai ser construído antes de escrever a primeira migration. Três decisões concretas, cada uma com trade-off real, não uma escolha óbvia:

1. Onde o módulo vive no projeto e quem pode depender de quem.
2. Como uma "classificação" aponta pra uma "coisa classificável" quando nem toda coisa classificável é uma linha de tabela com PK própria.
3. O que migrar/reaproveitar do que já existe (`imported_question_classifications`) vs. o que construir do zero.

---

## 2. Restrições que já eliminam algumas opções

Direto do pedido original, seção 6 ("Regras gerais de implementação") e seção 1 ("Objetivo geral"):

- **Não pode quebrar** banco de questões, importação ENEM, geração por IA, aplicação, correção, dashboards, relatórios, integrações, APIs, dado já cadastrado.
- **Nunca colunas rígidas** — nenhuma taxonomia nova pode virar campo novo em `ExamQuestion` (`examSchema.ts`) ou em `imported_question_classifications`.
- **Nunca espalhar prompt de classificação** em vários arquivos.
- **Extensível** pra taxonomias futuras (Marzano, Fink, Anderson/Krathwohl, rubricas próprias) **sem coluna nova na tabela principal de questões**.

Essas 4 restrições, juntas, eliminam a opção mais simples (adicionar `dokLevel`, `soloExpected` etc. como campos novos em `ExamQuestion` e em `imported_question_classifications`) — mesmo sendo tecnicamente a forma mais rápida de implementar, ela viola a restrição de "nunca colunas rígidas" explicitamente, então nem entra como opção candidata.

---

## 3. Decisão 1 — Localização do módulo e fronteira de dependência

### Onde vive

```
src/lib/pedagogical/
  types.ts                    -- tipos TS compartilhados (Taxonomy, Category, Classification, ClassifiableType)
  taxonomyService.ts          -- CRUD de taxonomia/categoria
  classificationService.ts    -- criar/consultar/aprovar/rejeitar/substituir, regras de precedência
  auditService.ts             -- grava trilha de auditoria (nunca deleta)
  confidenceRubric.ts         -- limites de confiança (consome src/config/pedagogicalConfidence.ts)
  prompts/
    dokPrompt.ts
    soloExpectedPrompt.ts
    soloObservedPrompt.ts
    bloomPrompt.ts             -- futuro: se Bloom migrar pro motor novo (ver seção 6)
```

Segue exatamente a convenção já em uso (`src/lib/classroom/`, `src/lib/corrections/`, `src/lib/auth/`, `src/lib/gemini/`) — pasta por domínio, arquivos por responsabilidade, nome de arquivo em inglês (código), conteúdo/comentário em português (mesmo padrão do resto do projeto).

**Nome do módulo em prosa/documentação**: "Motor de Classificações Pedagógicas" (português, como o resto da documentação do projeto). **Nome de pasta/import**: `pedagogical` (inglês, como todo o resto do código) — não `classificacao-pedagogica`, pra não misturar convenção dentro de `src/lib/`.

### Fronteira de dependência (regra de ouro)

```
                    ┌─────────────────────────┐
                    │  src/lib/pedagogical/    │   ← núcleo, sem dependência de domínio
                    │  (taxonomia, categoria,  │
                    │   classificação, auditoria)│
                    └───────────▲─────────────┘
                                │  chamado por, nunca chama
        ┌───────────────┬──────┴──────┬────────────────┬─────────────────┐
        │               │             │                │                 │
  promptBuilder.ts  enemBankMerge.ts  CorrigirExam.tsx  DesempenhoPanel  scripts/import-enem.ts
  (geração)          (importação)     (correção)        (dashboard)      (importação em lote)
```

`src/lib/pedagogical/*` **nunca importa** de `src/lib/gemini/examSchema.ts`, `src/lib/gemini/promptBuilder.ts`, `src/app/api/exams/**`, ou qualquer componente React. Os módulos de domínio (geração, importação, correção, dashboard) é que importam do motor, passando os dados que já têm (texto da questão, resposta do aluno) e recebendo de volta uma classificação — nunca o inverso. Isso satisfaz literalmente a restrição da seção 8 do pedido ("a lógica pedagógica não deverá ficar diretamente acoplada ao modelo de questão, ao dashboard, ao provedor de IA, ao fluxo de importação, ao fluxo de correção").

O **provedor de IA** (`llmClient.ts`, hoje DeepSeek) continua vivendo em `src/lib/gemini/` — o motor pedagógico **usa** `generateStructuredContent()` (já existe, já é agnóstico de conteúdo, só manda prompt e valida schema), mas não o redefine nem duplica. Isso evita 2 problemas: (a) duplicar a lógica de retry/validação que `llmClient.ts` já tem, (b) criar 2 pontos de configuração de modelo/token/thinking pra manter sincronizados.

---

## 4. Decisão 2 — Endereçamento polimórfico (o problema real)

O pedido original (seção 9.3) sugere:

```
classifiable_type
classifiable_id
```

Isso funciona bem quando toda "coisa classificável" é uma linha de tabela com PK própria (ex: `imported_questions.id`). **Não é o caso de 2 dos 3 tipos que este motor precisa suportar hoje:**

| Tipo classificável | É uma linha de tabela com PK própria? | Endereço real |
|---|---|---|
| Questão do banco ENEM (`imported_questions`) | ✅ Sim | `imported_questions.id` |
| Questão de prova gerada (`generated_exams.generation_payload.questions[]`) | ❌ Não — é um elemento de array dentro de 1 coluna JSONB | `generated_exams.id` + `questionNumber` (2 partes) |
| Resposta discursiva de aluno (`exam_corrections.answers[]`) | ❌ Não — mesma situação | `exam_corrections.id` + `questionNumber` (2 partes) |

### Decisão: `classifiable_id` + `classifiable_sub_id` (nullable)

```ts
classifiable_type: text        // 'imported_question' | 'generated_exam_question' | 'exam_correction_answer'
classifiable_id: integer       // PK da linha-dona (imported_questions.id | generated_exams.id | exam_corrections.id)
classifiable_sub_id: integer   // NULL pra imported_question (endereço já é único); questionNumber pros outros 2
```

Alternativas descartadas e por quê:

- **Normalizar `generation_payload.questions[]` numa tabela `exam_questions` própria com PK real** — resolveria o endereçamento de forma "mais limpa", mas contradiz diretamente a pendência 7 já documentada (`generation_payload` é fonte de verdade única, JSONB não normalizado, decisão deliberada do projeto) e é uma refatoração ampla não pedida ("não realizar refatorações amplas sem necessidade", seção 6). Descartada.
- **`classifiable_id` como string composta** (ex: `"21:3"` pra examId 21, questão 3) — funciona, mas perde tipagem/indexação numérica e obriga parsing manual em toda query. Pior que 2 colunas separadas sem ganho real.
- **Uma tabela de classificação por tipo** (`imported_question_classifications`, `exam_question_classifications`, `exam_answer_classifications`) — evita a coluna nullable, mas tripla o número de tabelas, tripla a superfície de `classificationService.ts` (precisa saber qual tabela usar por tipo), e vai contra a extensibilidade pedida ("novas taxonomias não devem exigir nova coluna" — o espírito da regra é o mesmo pra "nova tabela por tipo classificável"). Descartada.

`classifiable_sub_id` nullable é a opção que resolve o problema real sem violar nenhuma restrição e sem inventar estrutura nova pra cada tipo.

---

## 5. Decisão 3 — O que migrar vs. o que construir do zero

### `imported_question_classifications` **não é migrada, não é tocada**

Ela já está em produção com 2.689 questões, ~99% classificadas oficialmente contra microdados reais do INEP (`enemClassificationSource:'oficial'`). Ela não é polimórfica — é dedicada a `imported_questions` — porque foi construída antes deste motor existir, pra um problema mais estreito (classificar só o banco ENEM). Migrar esses dados pra tabela genérica nova:

- arrisca o dado oficial (qualquer erro de migration corrompe a única fonte de verdade da classificação real do INEP);
- não traz benefício real agora (o motor novo não precisa que dados antigos estejam no formato novo pra funcionar — ele pode simplesmente não conhecer essas classificações, que continuam servidas por onde já são servidas hoje: `/api/enem-bank/search`, `/api/enem-bank/skills`, os dashboards de banco ENEM);
- viola "não realizar refatorações amplas sem necessidade" e "preservar integralmente as funcionalidades existentes".

**Decisão**: o motor novo é **estritamente aditivo**. Bloom/Eixo Cognitivo/BNCC continuam exatamente onde estão hoje (`imported_question_classifications`, `generation_payload.questions[].bloomLevel/bnccCodes`). DOK, SOLO_EXPECTED e SOLO_OBSERVED — que não existem em lugar nenhum ainda — nascem direto na tabela genérica nova, pra qualquer tipo classificável (incluindo `imported_question`, se um dia o sistema quiser DOK pras questões do banco ENEM também).

Consequência aceita e documentada: por um tempo, a classificação completa de uma questão do banco ENEM vai estar **espalhada em 2 lugares** (Bloom/Eixo/BNCC em `imported_question_classifications`; DOK/SOLO, se vierem a existir pra ENEM, no motor novo). Isso é o preço de não arriscar o dado oficial — uma view/join na camada de serviço (`classificationService.ts` pode expor uma função `getFullClassification(type, id)` que busca dos 2 lugares e devolve um objeto unificado) resolve isso pro consumidor, sem exigir migration.

---

## 6. Modelo de dados conceitual (proposta — sem migration ainda, Subtarefa 03 confirma/ajusta)

### 6.1 `pedagogical_taxonomies`

```
id                serial PK
code              text unique       -- 'DOK', 'SOLO_EXPECTED', 'SOLO_OBSERVED', futuramente 'MARZANO' etc.
name              text
description       text
manual_version    text              -- versão do PEDAGOGICAL_CLASSIFICATION.md em que essa taxonomia foi normatizada
is_active         boolean default true
created_at        timestamp
updated_at        timestamp
```

### 6.2 `pedagogical_categories`

```
id                serial PK
taxonomy_id        integer FK -> pedagogical_taxonomies.id
code              text              -- 'DOK_1', 'RELACIONAL', etc.
name              text
description       text
order             smallint
metadata          jsonb nullable    -- espaço livre pra rubrica/exemplos sem precisar de coluna nova
is_active         boolean default true
created_at        timestamp
updated_at        timestamp
unique(taxonomy_id, code)
```

### 6.3 `pedagogical_classifications`

```
id                    serial PK
classifiable_type     text      -- ver seção 4
classifiable_id        integer
classifiable_sub_id    integer nullable
taxonomy_id            integer FK -> pedagogical_taxonomies.id
category_id            integer FK -> pedagogical_categories.id
classification_code    text      -- cópia desnormalizada de category.code, pra query rápida sem join
is_primary             boolean default true   -- principal vs. secundária (seção 9.5 do pedido)
confidence             real nullable          -- 0.00-1.00, ver rubrica seção 8
source                 text      -- 'AI' | 'TEACHER' | 'PEDAGOGICAL_REVIEW' | 'ENEM_IMPORT' | 'MANUAL_IMPORT' | 'SYSTEM_RULE' | 'OFFICIAL_SOURCE'
status                 text      -- 'sugerida' | 'em_revisao' | 'aprovada' | 'rejeitada' | 'substituida' | 'desatualizada'
explanation            text nullable
evidence               text nullable
manual_version         text nullable   -- versão do PEDAGOGICAL_CLASSIFICATION.md usada nesta classificação específica
model_provider          text nullable   -- 'deepseek'
model_name              text nullable   -- 'deepseek-v4-flash'
prompt_version          text nullable
version                integer default 1
supersedes_id           integer nullable FK -> pedagogical_classifications.id (self)
is_current             boolean default true   -- desnormalizado: false quando substituída, evita subquery de precedência em toda leitura
created_by              integer nullable FK -> users.id
approved_by             integer nullable FK -> users.id
approved_at             timestamp nullable
created_at              timestamp
updated_at              timestamp

index (classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id, is_current)
```

Todos os campos `text` de enum (`classifiable_type`, `source`, `status`) seguem a convenção já confirmada no projeto (`users.role`, `generated_exams.status`): **`text` puro, sem CHECK constraint real no Postgres**, enum só em TypeScript. Consistente, e permite adicionar um `classifiable_type` novo (ex: `'redacao'`, `'projeto'`) sem migration — só código.

`is_current` é a única coluna proposta aqui que **não** está explicitamente no pedido original — adicionada como otimização pragmática (evita calcular precedência via subquery toda vez que o dashboard/relatório pede "a classificação atual"). Alternativa sem ela: a query de leitura sempre filtra `status NOT IN ('substituida','rejeitada')` e ordena por precedência + `created_at DESC LIMIT 1`. Ambas funcionam; `is_current` só é mais rápida. Decisão final (com ou sem essa coluna) fica pra Subtarefa 03/04, registrada aqui como opção, não como obrigatória.

### 6.4 `pedagogical_classification_audit`

```
id                serial PK
classification_id  integer FK -> pedagogical_classifications.id
action             text        -- 'created' | 'approved' | 'rejected' | 'edited' | 'superseded'
previous_value      jsonb nullable
new_value           jsonb nullable
reason              text nullable
performed_by        integer nullable FK -> users.id
created_at          timestamp default now()
```

**Nunca UPDATE em `pedagogical_classifications` que apague informação, nunca DELETE.** "Editar" uma classificação aprovada, na prática, cria uma nova linha com `supersedes_id` apontando pra anterior, marca a anterior `status:'substituida'`/`is_current:false`, e grava 1 linha em `pedagogical_classification_audit` com `action:'superseded'`. Isso é responsabilidade da camada de serviço (`classificationService.ts`), não de trigger de banco — mantém a lógica de negócio visível em código, testável, consistente com o resto do projeto (nenhuma outra tabela do sistema usa trigger/stored procedure hoje).

---

## 7. Camada de serviços (proposta de contrato, sem implementação ainda)

```ts
// classificationService.ts

async function suggest(params: {
  classifiableType: ClassifiableType
  classifiableId: number
  classifiableSubId?: number
  taxonomyCode: string
  categoryCode: string
  confidence: number
  source: ClassificationSource
  explanation: string
  evidence?: string
  manualVersion: string
  modelProvider?: string
  modelName?: string
  promptVersion?: string
}): Promise<Classification>
// Cria uma classificação status:'sugerida'. Nunca sobrescreve uma já aprovada
// pro mesmo (classifiableType, classifiableId, classifiableSubId, taxonomyCode)
// — se já existe uma aprovada, a nova sugestão fica isolada com
// is_current:false até alguém decidir substituir explicitamente (regra L do
// manual: "nunca sobrescrever classificação aprovada").

async function approve(classificationId: number, approvedBy: number): Promise<Classification>
async function reject(classificationId: number, reason: string, performedBy: number): Promise<Classification>
async function supersede(oldClassificationId: number, newParams: SuggestParams, performedBy: number): Promise<Classification>

async function getCurrent(classifiableType, classifiableId, classifiableSubId, taxonomyCode): Promise<Classification | null>
async function getFullClassification(classifiableType, classifiableId, classifiableSubId?): Promise<Record<string, Classification>>
// Retorna TODAS as taxonomias correntes pra 1 item classificável — pro caso
// de imported_question, também consulta imported_question_classifications
// (Bloom/Eixo/BNCC) e funde no mesmo objeto de retorno (ver seção 5).

async function getHistory(classificationId: number): Promise<AuditEntry[]>
```

Todas as funções fazem a checagem de precedência (seção L do manual) e nunca deletam — `approve`/`reject`/`supersede` sempre gravam em `pedagogical_classification_audit` antes de retornar.

---

## 8. Rubrica de confiança — onde vive

```ts
// src/config/pedagogicalConfidence.ts
export const CONFIDENCE_THRESHOLDS = {
  autoApprove: 0.90,     // >= isso: aceita automaticamente (sujeito a amostragem)
  reviewOptional: 0.75,  // >= isso: aceita, mas sinaliza pra revisão oportunista
  reviewRequired: 0.60,  // >= isso: bloqueia uso em relatório com peso até revisão humana
  // < reviewRequired: nunca aprova automaticamente
} as const
```

Arquivo de configuração centralizado, mesmo padrão já usado em `src/config/saebApplicability.ts` (hardcoded mas centralizado, não espalhado). **Não** uma tabela de configuração no banco — não foi pedido admin-UI pra ajustar isso em runtime, e criar infraestrutura pra isso agora seria antecipar um requisito que não existe. Se um dia for pedido ajuste em runtime sem deploy, migrar esse arquivo pra uma tabela `pedagogical_config` é uma mudança pequena e isolada, não um retrabalho grande.

---

## 9. Integração com módulos existentes (fronteira de chamada)

| Módulo existente | Como vai chamar o motor | Quando (subtarefa futura) |
|---|---|---|
| `scripts/classify-existing-questions-sample.ts` (questões já geradas) | Chama `suggest()` com `classifiableType:'generated_exam_question'` em amostra/dry-run para DOK/SOLO_EXPECTED | Subtarefa 13 concluída em modo simulação/amostra |
| `promptBuilder.ts` + `generatedQuestionClassificationService.ts` (geração de prova nova) | Schema/prompt exigem `pedagogicalClassification`; depois de salvar a prova, persiste DOK/SOLO_EXPECTED com `classifiableType:'generated_exam_question'` | Subtarefa 14 concluída |
| `scripts/classify-imported-enem-sample.ts` (amostra ENEM) | Chama `suggest()` com `classifiableType:'imported_question'` — só pra DOK/SOLO_EXPECTED (taxonomias novas); Bloom/Eixo continuam como estão | Subtarefa 12 concluída em modo simulação/amostra |
| `CorrigirExam.tsx` / rota de correção (resposta discursiva) | Chama `suggest()` com `classifiableType:'exam_correction_answer'` pra SOLO_OBSERVED, só quando há resposta analisável (regra da seção G do manual) | Subtarefa 16 |
| `DesempenhoPanel.tsx` / `/api/analytics/performance` | Chama `getFullClassification()`/`getCurrent()` pra cruzar nota com DOK/SOLO nos dashboards novos (Bloom já é lido direto de `generation_payload`, sem mudança) | Subtarefas 17-23 |
| Tela de revisão humana (nova, ainda não desenhada) | Chama `getReviewQueue()`, `beginReview()`, `approve()`, `reject()` e `supersede()` | Subtarefa 11 fechou serviço/API; UI futura |

Nenhuma dessas integrações é construída nesta subtarefa — só a fronteira está definida, pra cada subtarefa futura saber exatamente onde plugar.

Atualização da Subtarefa 11: o mecanismo de revisão humana foi implementado
sem UI. `em_revisao` é estado protegido contra sobrescrita por sugestão
automática; `approve()`/`reject()` só operam sobre `sugerida` ou `em_revisao`;
e `getClassificationPrecedence()` formaliza a ordem humano aprovado → fonte
oficial validada → IA revisada → automático não revisado.

---

## 10. O que fica explicitamente para a Subtarefa 03 (não decidido aqui)

1. **Confirmação final do modelo de dados** — este documento propõe, a Subtarefa 03 ("modelar entidades e relacionamentos, apresentar o modelo antes de implementar") formaliza com nomes de coluna definitivos, tipos exatos, índices.
2. **`is_current` entra ou não** — opção registrada na seção 6.3, decisão final pendente.
3. **Nome exato dos `classifiable_type`** — usei `'imported_question'`, `'generated_exam_question'`, `'exam_correction_answer'` como proposta; confirmar antes de virar string persistida (mudar depois de ter dado gravado é migration, mudar antes é só decisão).
4. **Se Bloom eventualmente migra pro motor novo** — hoje Bloom vive em 2 lugares (`generation_payload.questions[].bloomLevel` e `imported_question_classifications.bloom_level`), nenhum dos dois no motor novo. Não decidido se algum dia isso muda — mencionado só pra registrar que a pasta `prompts/bloomPrompt.ts` na estrutura da seção 3 é especulativa, não uma decisão tomada.

---

## 11. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Tabela polimórfica genérica demais, difícil de indexar bem | Índice composto proposto na seção 6.3 cobre a query mais comum ("classificação atual de X"); se performance for problema real depois, resolver com índice adicional, não redesenho. |
| `classifiable_sub_id` nullable é fácil de esquecer de preencher (bug silencioso) | Camada de serviço (`suggest()`) exige `classifiableSubId` como parâmetro obrigatório em TypeScript quando `classifiableType` não é `'imported_question'` — validação de tipo em compile-time, não em runtime. Decisão de tipagem exata fica pra Subtarefa 03/05. |
| Duplicação de fonte de verdade (Bloom em 2 lugares) confundir consulta futura | `getFullClassification()` (seção 7) é o único ponto que precisa saber dessa duplicação — todo o resto do sistema consome um objeto já unificado. |
| Subtarefas futuras decidirem sozinhas migrar `imported_question_classifications` "pra ficar tudo num lugar só" | Decisão desta subtarefa (seção 5) registrada explicitamente como **não fazer sem nova avaliação** — não é um "ainda não", é uma recomendação ativa contra migrar sem motivo forte. |

---

## 12. Resumo executivo (pra quem não vai ler o documento inteiro)

- Módulo novo em `src/lib/pedagogical/`, só é chamado, nunca chama módulo de domínio.
- 4 tabelas novas (`pedagogical_taxonomies`, `pedagogical_categories`, `pedagogical_classifications`, `pedagogical_classification_audit`) — nenhuma delas migra ou toca dado existente.
- Classificação aponta pra "coisa classificável" via `classifiable_type` + `classifiable_id` + `classifiable_sub_id` (nullable) — resolve o problema real de que questão de prova gerada e resposta de correção são elementos de array JSONB, não linhas com PK própria.
- `imported_question_classifications` fica exatamente como está — o motor novo é aditivo, nunca substitui o que já funciona com dado oficial do INEP.
- Confiança configurável em arquivo de config (não banco), mesmo padrão de `saebApplicability.ts`.
- Nenhuma migration, nenhuma linha de código de produção alterada nesta subtarefa.
