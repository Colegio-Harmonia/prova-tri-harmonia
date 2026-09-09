CREATE TABLE IF NOT EXISTS "ai_model_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "purpose" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "input_cost_microusd_per_million" integer,
  "output_cost_microusd_per_million" integer,
  "image_cost_microusd" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_model_profiles_purpose_enabled_idx" ON "ai_model_profiles" ("purpose", "enabled");
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN IF NOT EXISTS "model_profile_id" integer;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN IF NOT EXISTS "estimated_cost_microusd" integer;
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'text_generation', 'deepseek', 'deepseek-v4-flash', true
WHERE NOT EXISTS (SELECT 1 FROM "ai_model_profiles" WHERE "purpose" = 'text_generation' AND "enabled" = true);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'image_generation', 'gemini', 'gemini-2.5-flash-image', true
WHERE NOT EXISTS (SELECT 1 FROM "ai_model_profiles" WHERE "purpose" = 'image_generation' AND "enabled" = true);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'image_validation', 'gemini', 'gemini-2.5-flash', true
WHERE NOT EXISTS (SELECT 1 FROM "ai_model_profiles" WHERE "purpose" = 'image_validation' AND "enabled" = true);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'text_generation', 'anthropic', 'claude-sonnet-4-5', false
WHERE NOT EXISTS (SELECT 1 FROM "ai_model_profiles" WHERE "provider" = 'anthropic' AND "model" = 'claude-sonnet-4-5');
