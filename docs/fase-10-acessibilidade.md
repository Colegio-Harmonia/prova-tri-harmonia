# Fase 10 - Acessibilidade

## Objetivo

Melhorar os fluxos críticos do Prova-TRI para teclado, foco, leitor de tela,
contraste e redução de movimento, sem alterar contratos de API, banco,
permissões ou regras pedagógicas.

## Escopo entregue

- Mantido foco global visível e respeito a `prefers-reduced-motion`.
- Nomeados os filtros de desempenho para tecnologias assistivas e convertidas
  as visões da página em navegação semântica com página atual anunciada.
- Adicionados estados `status` e `alert` para carregamentos, erros e mudança
  de perfil de IA.
- Associados rótulos aos campos de importação CSV, seleção de modelos,
  vinculação de turma e correção manual de respostas/notas/feedback.
- Informado o estado expandido dos cartões de correção.
- Incluída legenda e escopo de coluna na tabela desktop de status.
- Nomeadas as ações de ativar e desativar usuários para leitor de tela.

## Limites conhecidos

- Este ciclo não substitui uma auditoria completa com leitor de tela real em
  todos os papéis. A Fase 11 deve acrescentar testes de UI/E2E.
- Não houve alteração nos dados, nos conteúdos gerados por IA, no cálculo de
  notas nem no comportamento de importação.

## Pendência operacional transferida para a Fase 11

- A validação autenticada de teclado e leitor de tela em produção precisa ser
  feita por uma conta de produção autorizada, nos dois temas e com redução de
  movimento. Não há defeito conhecido nem bloqueio de publicação: a limitação
  foi a recusa deliberada da credencial exclusiva de DEV no banco de produção.
- A Subtarefa 11.4 transformará o roteiro manual em regressão de interface e
  registrará a evidência humana de produção. Até lá, o roteiro abaixo continua
  sendo a fonte de validação operacional.

## Verificação automatizada

`npm run test:accessibility-contract` protege os invariantes semânticos desta
fase. O comando deve acompanhar lint, checagem TypeScript e build em toda
promoção.

## Resultado de entrega

- **DEV, 23/07/2026:** candidato isolado e ambiente ativo passaram contrato de
  acessibilidade, lint, TypeScript, build, orçamento de bundle e regressão de
  tabelas. Login por credenciais chegou a dashboard, desempenho, status,
  geração, IA e API analítica autenticados em `200`.
- **Produção, 23/07/2026:** candidato isolado passou a mesma bateria; login
  local e HTTPS público responderam `200`, enquanto dashboard, desempenho e
  status sem sessão responderam `307`. O processo PM2 permaneceu online.
- **Limite de produção:** a credencial de teste usada no DEV foi recusada pelo
  banco de produção com `CredentialsSignin`. Por isso, o teste visual
  autenticado de leitor de tela e teclado em produção não é alegado; ele deve
  ser executado por uma conta de produção autorizada seguindo o roteiro abaixo.

## Roteiro manual autenticado

1. Em `/desempenho`, use `Tab` até cada filtro e até as cinco visões; confirme
   que o foco fica visível e que Enter abre a visão selecionada.
2. Em `/status`, navegue por filtros, links de prova e paginação só pelo
   teclado; confirme que a tabela não perde contexto ao usar leitor de tela.
3. Em `/gerar/:id/corrigir`, expanda um aluno e preencha uma resposta objetiva
   e uma discursiva apenas com teclado; confirme que cada campo anuncia seu
   propósito.
4. Em `/ia`, altere e pause um perfil; confirme que o carregamento é
   anunciado e que o seletor tem nome identificável.
5. Repita os fluxos com tema escuro e com redução de movimento do sistema
   ativada.
