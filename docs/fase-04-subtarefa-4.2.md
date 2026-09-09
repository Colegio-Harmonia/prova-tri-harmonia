# Subtarefa 4.2 - Resumo e Atenção da Gestão

## Escopo

- Apresentar o resumo institucional de provas, questões, cobertura BNCC e
  revisões concluídas com unidade e contexto acumulado.
- Destacar somente a primeira pendência operacional verificável: revisões
  concluídas ou, na ausência delas, imagens ainda não aprovadas.
- Direcionar a ação para a rota existente de provas, sem alterar o fluxo.

## Critérios de Aceite

- Coordenação identifica o volume e a pendência atual sem depender de gráfico.
- O aviso não afirma evolução, gravidade ou desempenho de aluno.
- Os valores são acessíveis em texto, funcionam em 320 px e preservam a rota
  `/status`.

## Limites

- Não altera API, banco, autenticação, RBAC, contratos ou dashboard do
  professor.

## Validação Técnica

- Renderização estática, seletores, contratos existentes, lint, TypeScript e
  build local aprovados em 20/07/2026.
- Deploy DEV do commit `c2bd846` aprovado: build remoto completo, login em
  200, dashboard e API de estatísticas anônimos em 307, processo online e log
  sem erro novo.
- Resta validar visualmente, como gestão autenticada, o texto acumulado, os
  quatro indicadores, a pendência e o acesso a `/status` em 320 px e desktop.
