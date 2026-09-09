-- Claude é usado aqui como visão/controle de qualidade, não como gerador.
INSERT INTO "ai_model_profiles" ("purpose", "provider", "model", "enabled")
SELECT 'image_validation', 'anthropic', 'claude-sonnet-4-5', false
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_profiles"
  WHERE "purpose" = 'image_validation' AND "provider" = 'anthropic' AND "model" = 'claude-sonnet-4-5'
);
