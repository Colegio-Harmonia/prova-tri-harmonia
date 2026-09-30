CREATE TABLE IF NOT EXISTS "curriculum_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "academic_year" integer NOT NULL CHECK (academic_year BETWEEN 2020 AND 2100),
  "segment" text NOT NULL CHECK (segment IN ('anos-iniciais','anos-finais','ensino-medio')),
  "grade_year" integer NOT NULL CHECK (grade_year BETWEEN 1 AND 9),
  "subject" text NOT NULL,
  "bimester" smallint NOT NULL CHECK (bimester BETWEEN 1 AND 4),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_plans_scope_unique" ON "curriculum_plans" ("academic_year","segment","grade_year","subject","bimester");
CREATE INDEX IF NOT EXISTS "curriculum_plans_year_idx" ON "curriculum_plans" ("academic_year","bimester");

CREATE TABLE IF NOT EXISTS "curriculum_plan_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "curriculum_plans"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL CHECK (version_number > 0),
  "status" text DEFAULT 'rascunho' NOT NULL CHECK (status IN ('rascunho','em_revisao','aprovado','encerrado')),
  "source" text DEFAULT 'interno' NOT NULL CHECK (source IN ('interno','planilha','copia')),
  "source_reference" text,
  "source_hash" text,
  "copied_from_version_id" integer REFERENCES "curriculum_plan_versions"("id"),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "reviewed_by" integer REFERENCES "users"("id"),
  "approved_by" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "approved_at" timestamp,
  "closed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_plan_versions_number_unique" ON "curriculum_plan_versions" ("plan_id","version_number");
CREATE INDEX IF NOT EXISTS "curriculum_plan_versions_status_idx" ON "curriculum_plan_versions" ("status","updated_at");

CREATE TABLE IF NOT EXISTS "curriculum_plan_units" (
  "id" serial PRIMARY KEY NOT NULL,
  "version_id" integer NOT NULL REFERENCES "curriculum_plan_versions"("id") ON DELETE CASCADE,
  "position" integer NOT NULL CHECK (position >= 0),
  "title" text NOT NULL,
  "content" text,
  "objectives" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_plan_units_position_unique" ON "curriculum_plan_units" ("version_id","position");

CREATE TABLE IF NOT EXISTS "curriculum_plan_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" integer NOT NULL REFERENCES "curriculum_plan_units"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "description" text,
  "position" integer NOT NULL CHECK (position >= 0),
  "target_mastery_percent" smallint DEFAULT 100 NOT NULL CHECK (target_mastery_percent BETWEEN 0 AND 100),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_plan_skills_code_unique" ON "curriculum_plan_skills" ("unit_id","code");
CREATE INDEX IF NOT EXISTS "curriculum_plan_skills_code_idx" ON "curriculum_plan_skills" ("code");

CREATE TABLE IF NOT EXISTS "curriculum_plan_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "curriculum_plans"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "responsibility" text DEFAULT 'responsavel' NOT NULL CHECK (responsibility IN ('responsavel','colaborador')),
  "assigned_by" integer NOT NULL REFERENCES "users"("id"),
  "assigned_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_plan_assignments_user_unique" ON "curriculum_plan_assignments" ("plan_id","user_id");
CREATE INDEX IF NOT EXISTS "curriculum_plan_assignments_user_idx" ON "curriculum_plan_assignments" ("user_id");

CREATE TABLE IF NOT EXISTS "curriculum_plan_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "version_id" integer NOT NULL REFERENCES "curriculum_plan_versions"("id") ON DELETE CASCADE,
  "from_status" text CHECK (from_status IS NULL OR from_status IN ('rascunho','em_revisao','aprovado','encerrado')),
  "to_status" text NOT NULL CHECK (to_status IN ('rascunho','em_revisao','aprovado','encerrado')),
  "changed_by" integer NOT NULL REFERENCES "users"("id"),
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "curriculum_plan_status_history_version_idx" ON "curriculum_plan_status_history" ("version_id","created_at");
