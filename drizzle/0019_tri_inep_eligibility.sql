-- TRI INEP depende dos itens reais da prova, não do rótulo SAE.
-- O painel SAE externo não usa generated_exams e não participa deste fluxo.
-- Aplicar depois da migration 0016.

-- Remove o legado que confundia um simulado interno com o painel externo SAE.
UPDATE "generated_exams"
SET "assessment_kind" = 'padrao'
WHERE "assessment_kind" = 'sae_enem';

-- Recalcula o método dos registros já existentes pela origem efetiva das
-- questões. A presença de qualquer item enem_bank ativa o fluxo TRI; na
-- correção, itens sem a/b/c oficiais continuam sendo descartados e o
-- resultado mostra a cobertura ou o fallback para percentual.
UPDATE "generated_exams"
SET "scoring_method" = CASE
  WHEN "generation_payload"->'questions' @> '[{"type":"objetiva","source":"enem_bank"}]'::jsonb THEN 'tri'
  ELSE 'percentual'
END;
