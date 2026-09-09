CREATE TABLE IF NOT EXISTS "curriculum_enrichment" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment" text NOT NULL,
	"grade_year" integer NOT NULL,
	"subject" text NOT NULL,
	"chapter_title" text NOT NULL,
	"bimester" integer,
	"enriched_content" text,
	"detailed_objectives" text,
	"pedagogical_notes" text,
	"source" text DEFAULT 'programacao_trimestral',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curriculum_tab_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment" text NOT NULL,
	"grade_year" integer NOT NULL,
	"subject" text NOT NULL,
	"sheet_tab_name" text NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enem_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"order" smallint NOT NULL,
	CONSTRAINT "enem_areas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enem_cognitive_axes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(4) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "enem_cognitive_axes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enem_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"number" smallint NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enem_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"competency_id" integer NOT NULL,
	"code" varchar(8) NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_exams" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" integer NOT NULL,
	"segment" text NOT NULL,
	"grade_year" integer NOT NULL,
	"subject" text NOT NULL,
	"bimester" integer,
	"question_count" integer NOT NULL,
	"objective_count" integer NOT NULL,
	"discursive_count" integer NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"generation_payload" jsonb NOT NULL,
	"unmapped_warnings" jsonb,
	"drive_folder_id" text,
	"prova_doc_id" text,
	"prova_doc_url" text,
	"gabarito_doc_id" text,
	"gabarito_doc_url" text,
	"mapa_doc_id" text,
	"mapa_doc_url" text,
	"assigned_to" integer,
	"assigned_by" integer,
	"assigned_at" timestamp,
	"chat_notified_at" timestamp,
	"reviewed_at" timestamp,
	"printed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finalized_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imported_question_classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"source" varchar(16) DEFAULT 'enem' NOT NULL,
	"bloom_level" varchar(16),
	"bloom_level_source" varchar(16) DEFAULT 'pending',
	"enem_area_id" integer,
	"enem_competency_id" integer,
	"enem_skill_id" integer,
	"enem_cognitive_axis_id" integer,
	"enem_classification_source" varchar(16) DEFAULT 'pending',
	"classified_at" timestamp,
	"classified_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'professor' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "curriculum_tab_overrides" ADD CONSTRAINT "curriculum_tab_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enem_competencies" ADD CONSTRAINT "enem_competencies_area_id_enem_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."enem_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enem_skills" ADD CONSTRAINT "enem_skills_competency_id_enem_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."enem_competencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_exams" ADD CONSTRAINT "generated_exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_exams" ADD CONSTRAINT "generated_exams_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_exams" ADD CONSTRAINT "generated_exams_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imported_question_classifications" ADD CONSTRAINT "imported_question_classifications_enem_area_id_enem_areas_id_fk" FOREIGN KEY ("enem_area_id") REFERENCES "public"."enem_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imported_question_classifications" ADD CONSTRAINT "imported_question_classifications_enem_competency_id_enem_competencies_id_fk" FOREIGN KEY ("enem_competency_id") REFERENCES "public"."enem_competencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imported_question_classifications" ADD CONSTRAINT "imported_question_classifications_enem_skill_id_enem_skills_id_fk" FOREIGN KEY ("enem_skill_id") REFERENCES "public"."enem_skills"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imported_question_classifications" ADD CONSTRAINT "imported_question_classifications_enem_cognitive_axis_id_enem_cognitive_axes_id_fk" FOREIGN KEY ("enem_cognitive_axis_id") REFERENCES "public"."enem_cognitive_axes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imported_question_classifications" ADD CONSTRAINT "imported_question_classifications_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_classification" ON "imported_question_classifications" ("question_id", "source");
