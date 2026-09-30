-- deepseek-v4-flash é o identificador de compatibilidade que hoje atende
-- pelo DeepSeek V4.1 Flash: US$ 0,15 de entrada e US$ 0,60 de saída por
-- 1M de tokens. Os valores são armazenados em micros de USD.
UPDATE ai_model_profiles
SET input_cost_microusd_per_million = 150000,
    output_cost_microusd_per_million = 600000,
    updated_at = now()
WHERE purpose = 'text_generation'
  AND provider = 'deepseek'
  AND model IN ('deepseek-v4-flash', 'deepseek-v4.1-flash');

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
  'deepseek',
  'deepseek-v4-flash',
  false,
  150000,
  600000
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_model_profiles
  WHERE purpose = 'text_generation'
    AND provider = 'deepseek'
    AND model = 'deepseek-v4-flash'
);
