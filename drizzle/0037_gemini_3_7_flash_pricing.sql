-- Gemini 3.7 Flash para geração de provas e atividades em texto.
-- Mantido desativado até a gestão selecioná-lo como modelo principal.
-- Valores introdutórios em micros de USD por 1 milhão de tokens, válidos
-- até 31/12/2026: US$ 0,75 entrada e US$ 3,75 saída.
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
  'gemini',
  'gemini-3.7-flash',
  false,
  750000,
  3750000
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_model_profiles
  WHERE purpose = 'text_generation'
    AND provider = 'gemini'
    AND model = 'gemini-3.7-flash'
);
