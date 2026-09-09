# Subtarefa 4.1 - Modelo de Decisão da Gestão

## Escopo

- Centralizar o contrato tipado do dashboard de gestão, sem alterar a URL ou o
  payload de `GET /api/stats/dashboard`.
- Criar seletores puros para resumo, pendência operacional e distribuições
  ordenadas.
- Manter a transformação de dados fora dos componentes visuais antes da
  reconstrução incremental do dashboard.

## Critérios de Aceite

- O mesmo payload gera o mesmo resumo e a mesma prioridade operacional.
- Revisões concluídas têm precedência sobre imagens pendentes por refletirem
  uma decisão explícita do fluxo atual.
- Ausência de pendência retorna estado neutro, sem inferir risco ou evolução.
- Ordenação e rótulos de Bloom são determinísticos e cobertos por teste.

## Limites

- Nenhuma API, tabela, autenticação ou regra de autorização é alterada.
- Os seletores não inferem período, coorte, desempenho de aluno ou causalidade.

## Validação e Encerramento

- Teste de seletores, contratos existentes, lint, TypeScript e build local
  aprovados em 20/07/2026.
- Deploy DEV do commit `1d62e04` aprovado: build remoto completo, login em
  200, dashboard e API de estatísticas anônimos em 307, processo online e log
  sem erro novo.
- Não há comportamento visual novo nesta subtarefa; a inspeção autenticada é
  aplicável à reconstrução visual a partir da 4.2.
