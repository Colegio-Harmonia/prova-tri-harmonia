# Cartão-resposta — plano de paridade DEV → produção

**Registro em:** 28/07/2026  
**Escopo:** promover o fluxo de cartões-resposta e scans validado em DEV para
produção, mantendo os dados de alunos e imagens em armazenamento privado.

## Linha de base verificada

| Ambiente | Código | Banco de scans | Configuração de scans |
| --- | --- | --- | --- |
| Produção | `e8ca2b0` | nenhuma tabela `exam_scan_*` | ausente |
| DEV | candidato `b00520a` | migrations `0020`–`0025` aplicadas | Drive privado e webhook configurados |

O candidato acrescenta 53 arquivos e seis migrations. Em DEV foram conferidas
as cinco tabelas de scans e as colunas de artefatos/revisão introduzidas pelas
migrations finais. Não houve alteração em produção durante esse diagnóstico.

## Pré-requisitos antes de habilitar o uso docente em produção

1. Criar ou confirmar uma pasta **privada de produção** no Google Drive para
   scans e configurar `SCAN_DRIVE_ROOT_FOLDER_ID`.
2. Definir um `SCAN_STAGING_DIR` gravável, fora de diretório público e com
   limpeza operacional documentada.
3. Criar credencial Header Auth e token exclusivos de produção no n8n; não
   reutilizar o token do DEV.
4. Configurar `N8N_SCAN_WEBHOOK_URL`, `N8N_SCAN_SHARED_SECRET` e
   `N8N_SCAN_WEBHOOK_TOKEN` somente no `.env.local` de produção, com permissão
   restrita. Segredos não entram em Git, logs ou documentação.
5. Fazer um despacho visual bem-sucedido em DEV com a sessão de professor.

Enquanto esses itens não estiverem concluídos, a promoção de código pode deixar
o fluxo de scans indisponível em produção, mas não deve ser apresentado como
recurso operacional aos professores.

## Provisionamento inativo registrado em 28/07/2026

Os pré-requisitos técnicos foram preparados sem reiniciar a aplicação de
produção nem ativar o uso docente:

- `SCAN_DRIVE_ROOT_FOLDER_ID` aponta para a raiz privada já validada no DEV;
- `SCAN_STAGING_DIR` foi criado fora da árvore pública com permissão `0700`;
- as três variáveis de integração n8n foram criadas somente no `.env.local` de
  produção, com valores exclusivos daquele ambiente;
- o workflow `ProvaTRI - Scanner privado (PROD)`, ID `20JUNOm2qHQaop7G`, foi
  criado no n8n com credencial Header Auth própria e permanece **inativo**.

Os valores, tokens, hashes e caminhos de credenciais não são registrados aqui.
O provisionamento isolado não torna a funcionalidade publicada: a ativação só
ocorre depois do corte de código, migrations, smokes e teste controlado.

## Publicação técnica em produção — 28/07/2026

O corte foi realizado a partir de `main` no commit `ac52717`, após build em
diretório candidato isolado. Foi criado dump PostgreSQL verificável antes da
migração e mantido rollback de aplicação em
`/home/eduardo/prova-tri-rollback-pre-scan-20260728-0933`.

As migrations `0020`–`0025` foram aplicadas em transação única. Após o corte,
`prova-tri` e `prova-tri-worker` permaneceram online; `/login` respondeu
`200` local e publicamente, e `/dashboard` e a tela de scans responderam `307`
sem sessão. O workflow PROD do n8n foi ativado e respondeu `200` para um
despacho sintético autenticado e `403` ao mesmo corpo sem token.

O fluxo ainda não lê bolhas, não executa OCR/HTR e não atribui nota. A primeira
validação operacional pendente é um upload e despacho controlado por professor
autenticado; até essa etapa, a entrega ao n8n deve ser entendida como entrada
segura de fila, não como correção concluída.

## Roteiro de promoção

1. Mesclar o candidato em `develop`, revalidar build e smokes DEV e promover
   `develop` para `main` por pull request.
2. No servidor de produção, criar backup datado do diretório da aplicação e
   dump consistente do banco antes da migration.
3. Aplicar `0020_exam_sheet_assignments.sql` até
   `0025_exam_scan_reading_review.sql`, nessa ordem, com `ON_ERROR_STOP` e
   transação única.
4. Instalar dependências a partir do lockfile, construir em diretório candidato
   isolado e só então fazer o corte atômico.
5. Reiniciar somente `prova-tri` e `prova-tri-worker`; verificar que ambos
   ficam online.
6. Validar `/login` com `200`, rotas protegidas com redirecionamento para
   login sem sessão e a tela de correção autenticada com uma prova de teste.
7. Fazer um único upload e despacho controlado, confirmando que Drive e n8n
   registram referências privadas, sem URL pública, QR ou imagem no histórico
   de execução.

## Rollback

Se o corte de aplicação falhar, restaurar imediatamente o diretório anterior e
reiniciar os processos de produção. Antes de qualquer dado real de scan entrar
na nova estrutura, o dump do banco permite retornar ao estado anterior. Após
uso com dados reais, rollback de schema exige migração reversa específica; não
se deve apagar tabelas de scans sem preservar os registros privados e a
auditoria.

## Evidência DEV já obtida

- build remoto concluído;
- cinco testes de autenticação passaram;
- lint dos arquivos modificados passou;
- webhook do n8n respondeu `200` com token e `403` sem token;
- produção permaneceu sem reinício durante a validação.
