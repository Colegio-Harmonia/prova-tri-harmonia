CREATE TABLE IF NOT EXISTS "ai_operations" (
  "id" serial PRIMARY KEY NOT NULL,
  "operation" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" text NOT NULL,
  "attempt" smallint NOT NULL,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "total_tokens" integer,
  "duration_ms" integer,
  "error_code" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_operations_operation_created_at_idx" ON "ai_operations" ("operation", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_operations_status_created_at_idx" ON "ai_operations" ("status", "created_at");
