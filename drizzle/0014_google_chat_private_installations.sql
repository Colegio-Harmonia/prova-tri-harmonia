CREATE TABLE IF NOT EXISTS "google_chat_installations" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer REFERENCES "users"("id"),
  "chat_user_id" text NOT NULL UNIQUE,
  "space_name" text NOT NULL UNIQUE,
  "connect_token_hash" text NOT NULL UNIQUE,
  "connect_token_expires_at" timestamp NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "connected_at" timestamp,
  "removed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_chat_installations_user_id_unique" ON "google_chat_installations" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_chat_installations_active_user_idx" ON "google_chat_installations" ("user_id", "active");
