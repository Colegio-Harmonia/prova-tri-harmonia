# Constituição do Projeto

## Missão

Reconstruir o front-end do Prova-TRI como uma plataforma educacional premium, preservando integralmente o comportamento contratado pelo backend atual. O sistema em produção é a referência funcional; a nova interface é uma migração progressiva, nunca uma reescrita cega.

## Limites inegociáveis

- Não alterar rotas, métodos HTTP, formatos de request/response, códigos de erro ou regras de autorização sem uma decisão registrada e aprovação humana.
- Não alterar banco, migrations, autenticação, scopes Google ou variáveis de ambiente nesta frente de reconstrução.
- Não expor chaves, tokens, dados de alunos ou conteúdo de `.env.local` em código, logs, documentos ou commits.
- Não substituir uma tela existente até que a alternativa tenha sido validada com o mesmo perfil de usuário e fluxo manual correspondente.
- Manter português do Brasil em textos de produto; manter código, nomes de arquivos e contratos técnicos em inglês quando essa já for a convenção local.

## Arquitetura de migração

O front-end novo vive em camadas, de fora para dentro: `src/app` (rotas e composição), `src/features` (casos de uso e telas por domínio), `src/components` (design system), `src/lib` (clientes e adaptadores) e `src/types` (contratos compartilhados). Componentes não fazem autorização, SQL, nem conhecem segredos. Adaptadores de API preservam o contrato existente e normalizam erros para a UI.

## Ritmo de execução

Uma subtarefa por vez. Cada subtarefa começa com impacto e critério de aceite escritos, termina com documentação, testes e relatório, e para para aprovação humana. Melhorias descobertas fora do escopo vão para `docs/tech-debt.md`.

## Fonte de verdade

- Comportamento existente: código de `src/app/api`, `src/auth`, `src/db` e fluxos em produção.
- Contratos públicos atuais: `docs/api-map.md`.
- Decisões de longo prazo: `docs/decisions.md`.
- Cronograma e aprovações: `docs/roadmap.md`.
- Instruções operacionais específicas: arquivos desta pasta `.ai/`.
