# Diretrizes de Experiência do Usuário

## Perfis

| Perfil | Objetivo principal | Necessidade de UX |
| --- | --- | --- |
| Professor | gerar, revisar o que lhe foi atribuído, corrigir e acompanhar turma | fluxo orientado, próxima ação visível e poucos cliques |
| Coordenação | atribuir, aprovar, acompanhar cobertura e intervenção | visão de exceções, filtros e segurança em ações de impacto |
| Direção | analisar resultados e governança | visão sintética, comparável e explicável sem permitir operações acidentais |

## Padrões obrigatórios

- Cabeçalho de página com título, contexto e ações primárias.
- Breadcrumb para páginas profundas como revisão, correção e turma.
- Filtros persistem durante a sessão quando não conflitam com permissões.
- Formulários longos mostram progresso, validação junto ao campo e preservam trabalho não enviado quando possível.
- Comandos que podem demorar mostram atividade e impedem clique duplicado.
- Erros de integração indicam se o usuário deve tentar novamente, reconectar Google ou falar com suporte.
- Um painel de desempenho jamais atribui causalidade pedagógica a uma amostra insuficiente.

## Critérios verificáveis

Cada tela migrada deve ter um caminho de teclado documentado, estados vazios/erro e uma verificação em viewport móvel. Cada ação que produz efeito externo precisa de confirmação, resposta de sucesso e recuperação de falha.
