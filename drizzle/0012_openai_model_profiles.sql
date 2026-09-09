-- Perfis de reserva: só se tornam ativos quando a gestão escolhe o perfil
-- no painel e configura OPENAI_API_KEY no ambiente.
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'text_generation', 'openai', 'gpt-4.1-mini', false
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_profiles"
  WHERE "purpose" = 'text_generation' AND "provider" = 'openai' AND "model" = 'gpt-4.1-mini'
);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'image_generation', 'openai', 'dall-e-3', false
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_profiles"
  WHERE "purpose" = 'image_generation' AND "provider" = 'openai' AND "model" = 'dall-e-3'
);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'image_generation', 'openai', 'chatgpt-images-2-0', false
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_profiles"
  WHERE "purpose" = 'image_generation' AND "provider" = 'openai' AND "model" = 'chatgpt-images-2-0'
);
