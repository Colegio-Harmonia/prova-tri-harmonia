# Política de Git

## Branches e commits

- Criar `feature/<descricao-curta-kebab-case>` para funcionalidades e `fix/<descricao-curta-kebab-case>` para correcoes, sempre a partir de `develop`.
- Nunca desenvolver diretamente em `main` ou `develop`: ambas sao branches protegidas e recebem mudancas exclusivamente por Pull Request.
- Um commit representa uma única intenção verificável. Não misturar atualização visual, alteração de contrato e ajuste de infraestrutura.
- Prefixos permitidos: `feat:`, `fix:`, `refactor:`, `style:`, `docs:`, `test:`, `perf:`, `build:`.
- Nunca incluir `.env*`, credenciais, artefatos de build, backups ou dados de produção.

## Antes de commit

1. Conferir `git diff --check` e `git status`.
2. Executar os testes aplicáveis da subtarefa.
3. Atualizar documentação, roadmap e log de teste.
4. Conferir que a mudança não alterou contrato de API, banco ou autenticação sem decisão aprovada.

## Push e revisão

O remoto oficial e `https://github.com/Colegio-Harmonia/prova-tri.git`. Todo push de `feature/*` ou `fix/*` deve resultar em Pull Request para `develop`; somente `develop` pode seguir para DEV. Nunca incluir token na URL do remoto. A aprovacao humana e obrigatoria entre subtarefas, mesmo apos deploy bem-sucedido. Ver `docs/git-workflow.md` para o fluxo completo.
