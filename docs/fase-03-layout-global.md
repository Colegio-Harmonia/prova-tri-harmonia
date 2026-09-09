# Fase 3 - Layout Global

## Subtarefa 3.1 - Shell Harmonia

### Escopo

- Adotar a marca oficial do Colégio Harmonia no Prova-TRI: ícone, logotipos,
  Roboto, verde `#008649`, grafite `#3C424F`, superfícies, bordas, raios e
  elevação definidos no material fornecido.
- Substituir a barra de links horizontal por navegação contextual do produto:
  sidebar em desktop, cabeçalho com menu expansível em telas estreitas,
  breadcrumb e rodapé compacto.
- Preservar os destinos existentes e a regra de autorização que mostra
  **Usuários** apenas para coordenação e direção.

### Responsividade e versionamento mobile

A versão mobile faz parte do mesmo código, branch, Pull Request, deploy e
registro de testes desta subtarefa. Não existe uma versão paralela do produto.

| Faixa | Comportamento do shell |
| --- | --- |
| 320 a 767 px | cabeçalho compacto, menu expansível, breadcrumb com rolagem horizontal e conteúdo com espaçamento de 16 px |
| 768 a 1023 px | mesmo menu compacto, conteúdo com espaçamento de 24 px |
| 1024 px ou mais | sidebar fixa de 288 px, conteúdo centralizado em até 1200 px e navegação sempre visível |

### Critérios de aceite

- Logo/ícone, tipografia e tokens Harmonia aparecem no shell autenticado.
- Navegação funciona por teclado, informa a página atual e não depende de
  hover para acesso a ações essenciais.
- Cada rota existente permanece acessível para os mesmos papéis.
- Em 320 px não há rolagem horizontal causada pelo shell; em desktop, a
  sidebar não cobre conteúdo.
- Tema explícito claro/escuro da Fase 2 continua funcional; os novos tokens
  mantêm seus equivalentes semânticos.

### Fora do escopo

- Recriar as telas de negócio, tabelas ou formulários internos.
- Alterar APIs, banco, autenticação, regras de papel ou dados pedagógicos.
- Publicar em produção antes da validação humana do DEV.

### Validação DEV

O commit `3c9e21f` foi publicado no DEV interno em 20/07/2026. A instalação
limpa, os testes de contrato existentes, lint, TypeScript, auditoria de
produção e build das 26 páginas passaram. O processo `prova-tri-dev` está
online em `3011`; `/login` respondeu 200, `/dashboard` anônimo respondeu
307 e `/brand/harmonia-icon.png` respondeu como PNG.

O processo de produção não foi reiniciado durante a entrega no DEV. A inspeção
visual autenticada foi validada pelo responsável antes da promoção: shell em
desktop e mobile, menu, breadcrumb, item ativo e regra de visibilidade de
**Usuários** por papel.

### Produção v0.3.0

O commit `17f44d0` foi publicado em produção em 20/07/2026 após candidato
isolado. O build gerou 26 páginas; login público respondeu 200, dashboard
anônimo respondeu 307 e o asset oficial de marca respondeu PNG em 200.
O processo `prova-tri` reiniciou limpo; DEV permaneceu online. Rollback:
`/home/eduardo/prova-tri-rollback-pre-17f44d0`.

## Subtarefa 3.2 - Listagens Responsivas

### Escopo

- Manter tabelas completas em desktop e apresentar cartões equivalentes em
  telas abaixo de 768 px para as rotas **Provas** e **Usuários**.
- Organizar filtros e criação de usuário em uma coluna em telas estreitas,
  preservando rótulos associados aos controles e áreas de toque de 40 px.
- Preservar o mesmo contrato de consulta, paginação, alteração de cargo,
  ativação de conta, acesso à revisão e links de documentos.

### Critérios de aceite

- Nenhuma informação ou ação das tabelas fica apenas no desktop.
- A rota Provas não exige rolagem horizontal para ler metadados, status,
  imagens ou documentos no celular.
- A rota Usuários mantém edição de cargo e estado da conta no celular.
- APIs, banco, autorização e dados não são alterados.

## Subtarefa 3.3 - Acessibilidade do Shell

### Escopo

- Disponibilizar atalho de teclado para saltar diretamente ao conteúdo
  principal em todas as rotas autenticadas.
- Identificar programaticamente a região principal para navegação por
  teclado e leitores de tela.
- Preservar a navegação atual, papéis, rotas e comportamento visual.

## Subtarefa 3.4 - Formulários Responsivos

- Fluxo de geração reorganizado para uma coluna em telas estreitas.
- Filtros do banco ENEM passam a ocupar uma coluna no celular e três no
  desktop.
- Botões primários e ações de consulta mantêm área mínima de toque.

## Subtarefa 3.5 - Navegação Móvel e Foco

- O menu móvel anuncia seu estado aberto ou fechado por `aria-expanded`.
- A tecla `Escape` fecha o painel e devolve o foco ao botão que o abriu.
- Ao selecionar uma rota, o painel móvel é fechado antes da navegação.

## Encerramento da Fase 3

- Subtarefas 3.1 a 3.5 aceitas pelo responsável em 20/07/2026.
- Produção v0.3.3 publicada no commit `f939d83` após candidato isolado e
  corte atômico.
- Rollback disponível em `/home/eduardo/prova-tri-rollback-pre-f939d83`.
