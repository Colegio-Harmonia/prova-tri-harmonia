-- GPT-5 Mini para geração de texto. Mantido desativado: a troca do modelo
-- principal é uma decisão explícita da gestão no painel de IA.
-- Tarifas em micros de USD por 1 milhão de tokens (US$ 0,25 / US$ 2,00).
INSERT INTO ai_model_profiles (
  purpose,
  provider,
  model,
  enabled,
  input_cost_microusd_per_million,
  output_cost_microusd_per_million
)
SELECT
  'text_generation',
  'openai',
  'gpt-5-mini',
  false,
  250000,
  2000000
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_model_profiles
  WHERE purpose = 'text_generation'
    AND provider = 'openai'
    AND model = 'gpt-5-mini'
);
