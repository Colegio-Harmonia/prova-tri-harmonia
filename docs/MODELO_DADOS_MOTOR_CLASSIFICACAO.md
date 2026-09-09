# Modelo de Dados Definitivo — Motor de Classificações Pedagógicas

**Data:** 17/07/2026
**Subtarefa:** 03 (modelagem final — ainda sem migration, sem código em produção)
**Depende de:** `docs/ARQUITETURA_MOTOR_CLASSIFICACAO.md` (Subtarefa 02, decisões de alto nível)

Este documento fecha as 4 pendências deixadas em aberto na Subtarefa 02 e entrega os blocos de
código prontos (SQL + Drizzle) pra Subtarefa 04 (migration) e Subtarefa 05 (models) consumirem
diretamente, sem precisar redecidir nada.

---

## 1. Pendências da Subtarefa 02 — resolvidas aqui

### 1.1 `is_current`: **entra no schema**

Decisão: sim, `pedagogical_classifications` ganha a coluna `is_current boolean default true`.

Justificativa: a query "qual é a classificação atual de X pra taxonomia Y" vai ser chamada por
**todo** consumidor do motor (geração, correção, dashboard) — é o caminho mais quente do sistema
inteiro. Calcular precedência via subquery (`status NOT IN (...) ORDER BY ... LIMIT 1`) a cada
chamada é evitável a custo de 1 coluna booleana mantida pela camada de serviço. O trade-off (mais 1
campo pra manter consistente) é pago 1 vez no código do `classificationService.ts` (Subtarefa 05),
não em cada consumidor.

### 1.2 Valores finais de `classifiable_type`

Confirmados os 3 já propostos, **sem alteração**:

```ts
export const CLASSIFIABLE_TYPES = [
  'imported_question',        // imported_questions.id (linha real, PK própria)
  'generated_exam_question',  // generated_exams.id + classifiable_sub_id = questionNumber
  'exam_correction_answer',   // exam_corrections.id + classifiable_sub_id = questionNumber
] as const
```

Convenção pra tipos futuros (redação, projeto, etc., quando/se existirem): nome em `snake_case`,
singular, nome da entidade-dona real do banco quando ela existir como linha própria, ou
`<entidade_dona>_<sub_elemento>` quando for endereço composto (mesmo padrão de
`exam_correction_answer`). Adicionar um valor novo aqui **não exige migration** — é só `text`, sem
CHECK constraint (ver seção 2).

### 1.3 Índice parcial de unicidade — **viável, incluído**

Confirmado no código-fonte instalado (`node_modules/drizzle-orm/pg-core/indexes.d.ts`) que esta
versão do Drizzle (0.36.4) suporta `.where()` em índice (`IndexConfig.where?: SQL`) — não é uma
suposição, é um recurso real da versão já em uso no projeto. Índice proposto na seção 3.3.

### 1.4 Tipos de coluna — definidos na seção 2, seguindo exatamente a convenção observada em
`src/db/schema.ts` (confirmado por leitura direta, não por suposição):

| Convenção observada no schema real | Onde já é usada | Aplicada aqui em |
|---|---|---|
| Enum = `text` puro, sem `pgEnum`, sem CHECK constraint | `users.role`, `generated_exams.status` | `classifiable_type`, `source`, `status`, `action` |
| `varchar(N)` só quando o valor tem tamanho conhecido e pequeno | `enemSkills.code` (`varchar(8)`), `enemCognitiveAxes.code` (`varchar(4)`) | `pedagogical_taxonomies.code`, `pedagogical_categories.code` |
| `jsonb` pra dado semi-estruturado que não justifica coluna própria | `generatedExams.generationPayload`, `examCorrections.answers` | `pedagogical_categories.metadata`, `pedagogical_classification_audit.previous_value/new_value` |
| `serial` PK, `integer` FK sem `onDelete` explícito (padrão do projeto: nunca DELETE, só desativação lógica) | toda tabela existente | todas as 4 tabelas novas |
| `timestamp` sem timezone, `defaultNow()` só em `created_at` | toda tabela existente | idem |

---

## 2. As 4 tabelas — especificação completa

### 2.1 `pedagogical_taxonomies`

| Coluna | Tipo Postgres | Nullable | Default | Observação |
|---|---|---|---|---|
| id | serial | não | — | PK |
| code | varchar(32) | não | — | `'DOK'`, `'SOLO_EXPECTED'`, `'SOLO_OBSERVED'`. **unique** |
| name | text | não | — | Nome de exibição |
| description | text | não | — | |
| manual_version | text | não | — | Versão do `PEDAGOGICAL_CLASSIFICATION.md` em que a taxonomia foi normatizada (hoje: `"1.0"`) |
| is_active | boolean | não | `true` | |
| created_at | timestamp | não | `now()` | |
| updated_at | timestamp | sim | — | |

### 2.2 `pedagogical_categories`

| Coluna | Tipo Postgres | Nullable | Default | Observação |
|---|---|---|---|---|
| id | serial | não | — | PK |
| taxonomy_id | integer | não | — | FK → `pedagogical_taxonomies.id` |
| code | varchar(32) | não | — | `'DOK_1'`, `'RELACIONAL'` |
| name | text | não | — | |
| description | text | não | — | |
| order | smallint | não | — | Ordem de exibição/complexidade crescente |
| metadata | jsonb | sim | — | Espaço livre (ex: rubrica detalhada, exemplos) sem exigir coluna nova |
| is_active | boolean | não | `true` | |
| created_at | timestamp | não | `now()` | |
| updated_at | timestamp | sim | — | |

Índice: `unique(taxonomy_id, code)`.

### 2.3 `pedagogical_classifications`

| Coluna | Tipo Postgres | Nullable | Default | Observação |
|---|---|---|---|---|
| id | serial | não | — | PK |
| classifiable_type | text | não | — | Ver seção 1.2 |
| classifiable_id | integer | não | — | PK da linha-dona |
| classifiable_sub_id | integer | **sim** | — | `NULL` pra `imported_question`; `questionNumber` pros outros 2 tipos |
| taxonomy_id | integer | não | — | FK → `pedagogical_taxonomies.id` |
| category_id | integer | não | — | FK → `pedagogical_categories.id` |
| classification_code | varchar(32) | não | — | Cópia desnormalizada de `category.code` — evita join só pra exibir o código |
| is_primary | boolean | não | `true` | Principal vs. secundária |
| confidence | real | sim | — | 0.00–1.00. `NULL` só é aceitável pra classificação humana direta (não fez sentido pontuar confiança de um professor) |
| source | text | não | — | `'AI'` \| `'TEACHER'` \| `'PEDAGOGICAL_REVIEW'` \| `'ENEM_IMPORT'` \| `'MANUAL_IMPORT'` \| `'SYSTEM_RULE'` \| `'OFFICIAL_SOURCE'` |
| status | text | não | `'sugerida'` | `'sugerida'` \| `'em_revisao'` \| `'aprovada'` \| `'rejeitada'` \| `'substituida'` \| `'desatualizada'` |
| is_current | boolean | não | `true` | Ver seção 1.1 |
| explanation | text | sim | — | |
| evidence | text | sim | — | |
| manual_version | text | sim | — | Versão do manual usada nesta classificação específica |
| model_provider | text | sim | — | `'deepseek'` |
| model_name | text | sim | — | `'deepseek-v4-flash'` |
| prompt_version | text | sim | — | |
| version | integer | não | `1` | |
| supersedes_id | integer | sim | — | FK → `pedagogical_classifications.id` (self, sem ciclo — sempre aponta pra trás) |
| created_by | integer | sim | — | FK → `users.id` |
| approved_by | integer | sim | — | FK → `users.id` |
| approved_at | timestamp | sim | — | |
| created_at | timestamp | não | `now()` | |
| updated_at | timestamp | sim | — | |

### 2.4 `pedagogical_classification_audit`

| Coluna | Tipo Postgres | Nullable | Default | Observação |
|---|---|---|---|---|
| id | serial | não | — | PK |
| classification_id | integer | não | — | FK → `pedagogical_classifications.id` |
| action | text | não | — | `'created'` \| `'approved'` \| `'rejected'` \| `'edited'` \| `'superseded'` |
| previous_value | jsonb | sim | — | Snapshot antes da ação |
| new_value | jsonb | sim | — | Snapshot depois da ação |
| reason | text | sim | — | |
| performed_by | integer | sim | — | FK → `users.id` |
| created_at | timestamp | não | `now()` | |

---

## 3. Índices

### 3.1 Lookup principal (a query mais quente do motor)

```sql
CREATE INDEX idx_pedagogical_classifications_lookup
  ON pedagogical_classifications (classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id, is_current);
```

### 3.2 Auditoria por classificação

```sql
CREATE INDEX idx_pedagogical_audit_classification
  ON pedagogical_classification_audit (classification_id);
```

### 3.3 Unicidade parcial — só 1 classificação corrente por (item, taxonomia)

```sql
CREATE UNIQUE INDEX uq_pedagogical_current_classification
  ON pedagogical_classifications (classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id)
  NULLS NOT DISTINCT
  WHERE is_current = true;
```

Garantia de banco, não só disciplina de `classificationService.ts` — se o serviço tiver um bug e
tentar marcar 2 classificações como correntes ao mesmo tempo pro mesmo item/taxonomia, o Postgres
recusa o INSERT/UPDATE. `classifiable_sub_id` é nullable (`NULL` pra `imported_question`), e por
padrão o Postgres trata `NULL` como "todo NULL é distinto de todo NULL" em índice único — sem
`NULLS NOT DISTINCT` o índice não bloquearia 2 linhas com `classifiable_sub_id IS NULL` pro mesmo
`(classifiable_type='imported_question', classifiable_id, taxonomy_id)`. **Confirmado direto no
servidor de produção (17/07/2026): Postgres 16.14** — `NULLS NOT DISTINCT` (recurso do Postgres 15+)
está disponível, incluído acima. Pendência da versão anterior deste documento **resolvida**, não
fica mais pra Subtarefa 04 checar.

Nota pro Drizzle TS (seção 5.2): esta versão do `drizzle-orm` (0.36.4) não expõe um builder
`.nullsNotDistinct()` pro índice — irrelevante na prática, porque as migrations deste projeto são
aplicadas manualmente via SQL bruto (workaround já documentado pro `drizzle-kit` quebrado), então o
SQL da seção 5.1 é a fonte de verdade real; o Drizzle-side é só tipagem de leitura/query, não gera
a DDL de fato.

---

## 4. Exemplo de dado real (validação do modelo, não hipotético)

Usando a questão real do exam #21 (cilindro, ver `PEDAGOGICAL_CLASSIFICATION.md`, seção J):

```sql
-- pedagogical_taxonomies
INSERT INTO pedagogical_taxonomies (code, name, description, manual_version)
VALUES ('DOK', 'Depth of Knowledge', 'Profundidade de raciocínio exigida (Webb)', '1.0');
-- id = 1

-- pedagogical_categories (4 níveis, mostrando só o relevante)
INSERT INTO pedagogical_categories (taxonomy_id, code, name, description, "order")
VALUES (1, 'DOK_2', 'Habilidades e conceitos', 'Procedimento de múltiplos passos, sem decisão estratégica', 2);
-- id = 12

-- pedagogical_classifications
INSERT INTO pedagogical_classifications (
  classifiable_type, classifiable_id, classifiable_sub_id,
  taxonomy_id, category_id, classification_code,
  is_primary, confidence, source, status, is_current,
  explanation, manual_version, model_provider, model_name
) VALUES (
  'generated_exam_question', 21, 2,  -- exam #21, 2ª questão descritiva (volume do cilindro)
  1, 12, 'DOK_2',
  true, 0.80, 'AI', 'sugerida', true,
  'Múltiplas etapas (calcular volume, converter unidade), mas caminho único e conhecido, sem decisão estratégica.',
  '1.0', 'deepseek', 'deepseek-v4-flash'
);
```

Isso é exatamente a classificação já calibrada manualmente no manual pedagógico (seção J) — o
modelo de dados representa esse exemplo real sem nenhum campo faltando ou sobrando.

---

## 5. Blocos de código prontos

### 5.1 SQL bruto (pra Subtarefa 04 — migration manual, mesmo padrão já usado no projeto)

```sql
CREATE TABLE IF NOT EXISTS "pedagogical_taxonomies" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"manual_version" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "pedagogical_taxonomies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedagogical_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"taxonomy_id" integer NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"order" smallint NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedagogical_classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"classifiable_type" text NOT NULL,
	"classifiable_id" integer NOT NULL,
	"classifiable_sub_id" integer,
	"taxonomy_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"classification_code" varchar(32) NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"confidence" real,
	"source" text NOT NULL,
	"status" text DEFAULT 'sugerida' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"explanation" text,
	"evidence" text,
	"manual_version" text,
	"model_provider" text,
	"model_name" text,
	"prompt_version" text,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" integer,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedagogical_classification_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"classification_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_categories" ADD CONSTRAINT "pedagogical_categories_taxonomy_id_pedagogical_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."pedagogical_taxonomies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classifications" ADD CONSTRAINT "pedagogical_classifications_taxonomy_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."pedagogical_taxonomies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classifications" ADD CONSTRAINT "pedagogical_classifications_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pedagogical_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classifications" ADD CONSTRAINT "pedagogical_classifications_supersedes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."pedagogical_classifications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classifications" ADD CONSTRAINT "pedagogical_classifications_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classifications" ADD CONSTRAINT "pedagogical_classifications_approved_by_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classification_audit" ADD CONSTRAINT "pedagogical_classification_audit_classification_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."pedagogical_classifications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedagogical_classification_audit" ADD CONSTRAINT "pedagogical_classification_audit_performed_by_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pedagogical_categories_taxonomy_code_unique" ON "pedagogical_categories" ("taxonomy_id","code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pedagogical_classifications_lookup" ON "pedagogical_classifications" ("classifiable_type","classifiable_id","classifiable_sub_id","taxonomy_id","is_current");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pedagogical_current_classification" ON "pedagogical_classifications" ("classifiable_type","classifiable_id","classifiable_sub_id","taxonomy_id") NULLS NOT DISTINCT WHERE "is_current" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pedagogical_audit_classification" ON "pedagogical_classification_audit" ("classification_id");
```

**Rollback (pra Subtarefa 04 testar reversibilidade, conforme pedido):**

```sql
DROP TABLE IF EXISTS "pedagogical_classification_audit";
DROP TABLE IF EXISTS "pedagogical_classifications";
DROP TABLE IF EXISTS "pedagogical_categories";
DROP TABLE IF EXISTS "pedagogical_taxonomies";
```

Ordem de DROP é o inverso da criação (respeitando FK) — auditoria e classificações primeiro (têm FK
pra taxonomia/categoria), depois categoria, depois taxonomia.

### 5.2 Drizzle TS (pra Subtarefa 05 — models)

```ts
import { pgTable, serial, text, varchar, smallint, integer, boolean, real, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './schema' // mesma tabela já existente

export const pedagogicalTaxonomies = pgTable('pedagogical_taxonomies', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  manualVersion: text('manual_version').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
})

export const pedagogicalCategories = pgTable('pedagogical_categories', {
  id: serial('id').primaryKey(),
  taxonomyId: integer('taxonomy_id').references(() => pedagogicalTaxonomies.id).notNull(),
  code: varchar('code', { length: 32 }).notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  order: smallint('order').notNull(),
  metadata: jsonb('metadata'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  uqTaxonomyCode: uniqueIndex('pedagogical_categories_taxonomy_code_unique').on(table.taxonomyId, table.code),
}))

// Ver seção 1.2 — manter em sincronia com CLASSIFIABLE_TYPES em types.ts
export const CLASSIFIABLE_TYPES = ['imported_question', 'generated_exam_question', 'exam_correction_answer'] as const
export const CLASSIFICATION_SOURCES = ['AI', 'TEACHER', 'PEDAGOGICAL_REVIEW', 'ENEM_IMPORT', 'MANUAL_IMPORT', 'SYSTEM_RULE', 'OFFICIAL_SOURCE'] as const
export const CLASSIFICATION_STATUSES = ['sugerida', 'em_revisao', 'aprovada', 'rejeitada', 'substituida', 'desatualizada'] as const

export const pedagogicalClassifications = pgTable('pedagogical_classifications', {
  id: serial('id').primaryKey(),
  classifiableType: text('classifiable_type', { enum: CLASSIFIABLE_TYPES }).notNull(),
  classifiableId: integer('classifiable_id').notNull(),
  classifiableSubId: integer('classifiable_sub_id'),
  taxonomyId: integer('taxonomy_id').references(() => pedagogicalTaxonomies.id).notNull(),
  categoryId: integer('category_id').references(() => pedagogicalCategories.id).notNull(),
  classificationCode: varchar('classification_code', { length: 32 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(true),
  confidence: real('confidence'),
  source: text('source', { enum: CLASSIFICATION_SOURCES }).notNull(),
  status: text('status', { enum: CLASSIFICATION_STATUSES }).notNull().default('sugerida'),
  isCurrent: boolean('is_current').notNull().default(true),
  explanation: text('explanation'),
  evidence: text('evidence'),
  manualVersion: text('manual_version'),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  promptVersion: text('prompt_version'),
  version: integer('version').notNull().default(1),
  supersedesId: integer('supersedes_id'),
  createdBy: integer('created_by').references(() => users.id),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  lookupIdx: index('idx_pedagogical_classifications_lookup')
    .on(table.classifiableType, table.classifiableId, table.classifiableSubId, table.taxonomyId, table.isCurrent),
  // Índice parcial — sintaxe .where() confirmada suportada nesta versão do
  // Drizzle (node_modules/drizzle-orm/pg-core/indexes.d.ts). Se a
  // Subtarefa 04 gerar a migration manualmente (workaround já em uso no
  // projeto pro drizzle-kit quebrado), usar o SQL bruto da seção 5.1 como
  // fonte de verdade em vez de confiar em `drizzle-kit generate` aqui.
  uqCurrent: uniqueIndex('uq_pedagogical_current_classification')
    .on(table.classifiableType, table.classifiableId, table.classifiableSubId, table.taxonomyId)
    .where(sql`${table.isCurrent} = true`),
}))

export const pedagogicalClassificationAudit = pgTable('pedagogical_classification_audit', {
  id: serial('id').primaryKey(),
  classificationId: integer('classification_id').references(() => pedagogicalClassifications.id).notNull(),
  action: text('action', { enum: ['created', 'approved', 'rejected', 'edited', 'superseded'] }).notNull(),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  reason: text('reason'),
  performedBy: integer('performed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

---

## 6. O que ainda fica pra Subtarefa 04

1. ~~Confirmar a versão do Postgres em produção~~ — **resolvido nesta mesma subtarefa**: Postgres
   16.14 confirmado direto no servidor, `NULLS NOT DISTINCT` incluído no SQL da seção 3.3/5.1.
2. **Testar rollback de verdade** (aplicar a migration da seção 5.1 num banco de teste, rodar o
   rollback da mesma seção, confirmar que volta ao estado anterior sem erro) — exigido
   explicitamente pelo pedido original ("executar testes de aplicação e rollback").
3. **Decidir se essa migration entra na cadeia quebrada do `drizzle-kit`** (ver pendência já
   documentada em `docs/MVP_GERACAO_PROVAS.md`) **ou se é aplicada manualmente via `psql`**, mesmo
   padrão já usado pra todas as migrations manuais anteriores do projeto — recomendação: manual,
   consistente com o que já é feito, não vale a pena consertar a cadeia do drizzle-kit só por causa
   desta migration.
4. Este documento **não cria a migration real** — os blocos de código da seção 5 são o material
   pronto, a Subtarefa 04 decide o nome do arquivo (`drizzle/0007_pedagogical_classification_engine.sql`
   — confirmado que `0006` é a última migration existente hoje) e efetivamente aplica.
