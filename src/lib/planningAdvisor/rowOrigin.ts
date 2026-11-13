/**
 * Unidades lidas do Planejamento da Prova TRI recebem rowIndex a partir deste
 * valor (bimestre × offset + posição); linhas da planilha ficam abaixo. Fica
 * num módulo sem banco porque o analisador também roda no navegador.
 */
export const PLAN_ROW_OFFSET = 10_000_000
