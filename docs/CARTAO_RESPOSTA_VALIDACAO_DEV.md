# Validação DEV — cartão-resposta escaneado

**Data:** 27/07/2026<br>
**Origem:** `develop` no merge `b722d96` (PR #225)<br>
**Ambiente:** `http://192.168.1.218:3011`, processo `prova-tri-dev`, banco isolado `prova_tri_dev`<br>
**Produção:** não alterada.

## Publicação controlada

- A candidata isolada recebeu `npm ci`, lint, TypeScript e 94 testes Vitest aprovados.
- O build completo concluiu no servidor com `BUILD_ID 5UXQZnjDhUrXKqIgyi7Kr`. A primeira tentativa foi encerrada por pressão de memória enquanto havia processos gráficos pesados no host; a repetição limitada concluiu sem alterar o processo DEV ativo.
- O arquivo `.env.local` do DEV permaneceu com o mesmo hash antes e depois do corte.
- As migrations aditivas `0020` a `0025` foram aplicadas exclusivamente em `prova_tri_dev`, após backup recuperável. Foram confirmadas as seis tabelas do fluxo e as quatro colunas de decisão docente.
- Rollback de diretório: `/home/eduardo/prova-tri-dev-rollback-pre-scan-20260727-1450`. Backup do banco DEV: `/home/eduardo/prova-tri-dev-db-backup-pre-scan-20260727.sql`.

## Smokes pós-corte

| Verificação | Resultado |
| --- | --- |
| `GET /login` | `200` |
| `GET /gerar/1/corrigir/scans` sem sessão | `307` para login |
| `GET /api/exams/1/scan-review-queue` sem sessão | `307` |
| endpoint interno de conteúdo sem HMAC | `401` |
| PM2 `prova-tri-dev` e `prova-tri-dev-worker` | online |
| log de erro web após corte | sem entrada nova; a última é histórica de 22/07 |

## Aceite visual que já é possível

Com login de professor/coordenador, abra uma prova aplicada, como a **31**, em:

`/gerar/31/corrigir/scans`

A página e os controles carregam autenticados. Como o banco DEV ainda não tem upload de scan, ela mostrará a fila vazia — isso valida navegação, proteção e estado vazio, não a leitura de uma folha real.

## Configuração privada complementar

Em 27/07/2026, a raiz privada de scans foi configurada no DEV. O cliente de serviço do ProvaTRI confirmou acesso à pasta e permissão para criar arquivos; o identificador continua exclusivamente no `.env.local`, fora do Git e desta documentação.

## Atualização: importação de várias páginas

Em 27/07/2026, o merge `fe46944` (PR #229) foi publicado somente em DEV. A
interface passou a aceitar várias imagens do scanner na mesma seleção. Elas são
enviadas sequencialmente para o endpoint já validado, portanto cada página
mantém hash, auditoria e objeto privado próprios. Se uma página falhar, as
demais continuam e a interface informa o arquivo afetado.

- Causa do erro anterior corrigida: o reset do formulário ocorria depois de um
  `await`, quando a referência transitória do evento já não estava disponível.
- Candidata isolada: instalação limpa, lint, TypeScript, 94 testes e build
  completo aprovados; `BUILD_ID xjDePon76PSGjhCg4qpQw`.
- Corte atômico com retorno disponível em
  `/home/eduardo/prova-tri-dev-rollback-pre-scan-multiple-20260727-1624`.
- Pós-corte: `/login` respondeu `200`; a tela e o `POST` de scans sem sessão
  responderam `307` para login; PostgreSQL e os processos DEV permaneceram
  online. O processo de produção não foi reiniciado.

### Teste visual solicitado

1. Entre no DEV como professor/coordenador e abra
   `/gerar/31/corrigir/scans`.
2. No seletor de arquivos, marque ao mesmo tempo as imagens JPG de cada página
   da prova (por exemplo, os dois arquivos do scanner).
3. O botão exibirá a quantidade selecionada; durante o envio, mostrará
   `Arquivando 1 de 2…`, depois `Arquivando 2 de 2…`.
4. Ao terminar, cada página deverá aparecer em **Arquivos importados** com
   estado **Arquivado com segurança**.
5. Escolha **Enviar para processamento** em apenas um arquivo. O retorno deve
   confirmar que o envio entrou em processamento; nesta etapa ainda não haverá
   leitura de bolhas, OCR ou nota.

## Estado do despacho DEV em 27/07/2026

`N8N_SCAN_WEBHOOK_URL`, `N8N_SCAN_SHARED_SECRET` e o token de autenticação
nativo do webhook estão configurados somente no ambiente DEV. O workflow do
n8n respondeu `200` a um corpo sintético autenticado e `403` ao mesmo corpo
sem token. O próximo teste é visual, com um único arquivo arquivado; nenhuma
imagem de aluno foi usada na validação automática.
