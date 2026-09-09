ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE ("google_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
