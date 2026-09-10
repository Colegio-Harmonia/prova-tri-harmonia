-- Tarifas do nível pago, em micros de USD por 1 milhão de tokens.
UPDATE ai_model_profiles
SET input_cost_microusd_per_million = 400000,
    output_cost_microusd_per_million = 1600000,
    updated_at = now()
WHERE provider = 'openai' AND model = 'gpt-4.1-mini';

UPDATE ai_model_profiles
SET input_cost_microusd_per_million = 1500000,
    output_cost_microusd_per_million = 9000000,
    updated_at = now()
WHERE provider = 'gemini' AND model = 'gemini-3.5-flash';

INSERT INTO ai_model_profiles (purpose, provider, model, enabled, input_cost_microusd_per_million, output_cost_microusd_per_million)
SELECT 'scan_transcription', 'gemini', 'gemini-3.5-flash-lite', true, 300000, 2500000
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_profiles WHERE purpose = 'scan_transcription' AND provider = 'gemini' AND model = 'gemini-3.5-flash-lite'
);
