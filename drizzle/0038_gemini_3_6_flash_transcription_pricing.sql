-- Atualiza precificacao do Gemini 3.6 Flash para scan_transcription
-- Valores ate 31/12/2026: US$ 0,375 entrada e US$ 1,875 saida por 1M tokens.
UPDATE ai_model_profiles
   SET input_cost_microusd_per_million = 375000,
       output_cost_microusd_per_million = 1875000,
       image_cost_microusd = NULL,
       updated_at = now()
 WHERE purpose = 'scan_transcription' AND provider = 'gemini' AND model = 'gemini-3.6-flash';
