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
