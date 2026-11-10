# Recuperação e versionamento — 10/11/2026

## Problema e escopo

O `main` do repositório oficial ficou em `ee89fd7` (05/10), enquanto a árvore
do servidor acumulou 254 arquivos alterados ou novos de código, testes,
migrações e documentação. O snapshot `abd6093` preserva essa árvore antes dos
ajustes de validação. Capturas/PDFs de `output/`, credenciais, dados e builds
ficam fora do Git. O branch de recuperação é
`codex/snapshot-producao-20261110`, com PR para `main`.

Esta recuperação não restaura, migra ou apaga o banco em produção e não
reinicia os serviços existentes. Mudanças necessárias para passar nas
verificações ficam em commits posteriores ao snapshot, para revisão separada.

## Backup e restauração

Backup completo local, com diretório restrito ao proprietário:
`/home/eduardo/prova-tri-arquivo/recuperacao-20261110-091202`.

- `workspace.tar.gz`: pasta inteira, inclusive `.git` e configuração local.
- `external-files.tar.gz`: arquivos de leitura e credenciais montados de fora
  da pasta. **Contém material confidencial; nunca colocar no GitHub.**
- `database.dump`: backup consistente via `pg_dump -Fc`, com dados.
- `database-schema.sql`: estrutura do banco, sem proprietários e permissões.
- `runtime-images.tar.gz`: imagens exatas do site, geração, leitura/OCR,
  desenho técnico e Postgres.
- `runtime-manifest.json`: imagem e montagem por serviço, sem variáveis secretas.
- `backup-integrity.json`: tamanhos e hashes SHA-256 para conferir integridade.
- `restore-verification.txt`: resultado do teste de restauração isolado.

O dump foi restaurado com `pg_restore --exit-on-error --no-owner
--no-privileges` em outro Postgres, com banco `prova_tri_restore`, sem rede
externa e sem conectar ao banco de produção. Foram conferidas 46 tabelas
públicas, 684 provas no instante do backup e a coluna `enem_skills`.
O banco do site continuou recebendo novas provas normalmente.

Para recuperação real em outro servidor, verificar os hashes, carregar as
imagens com `docker load`, extrair os arquivos em diretório novo com acesso
restrito e restaurar o dump em banco novo. Conferir referências dos arquivos,
configurações e acesso antes de apontar a aplicação para esse ambiente.
Nunca usar a produção existente como destino de um teste de restauração.

## Preparar banco vazio

A cadeia antiga de SQL e o journal do Drizzle são incompletos; não apagar nem
reescrever esse histórico para fazer uma implantação passar. O comando
`db:migrate` agora recusa execução automática e explica a alternativa.

A baseline `drizzle/bootstrap/20261110-schema.sql` contém somente estrutura:
tabelas, sequências, índices, constraints, funções e triggers. Não contém
usuários, provas, chaves ou dados do catálogo. Corresponde à estrutura
restaurada, que contém todas as colunas declaradas em `src/db/schema.ts`.

Para um banco **novo e vazio**, configurar `DATABASE_URL` localmente e usar:

```bash
npm run db:bootstrap -- --database nome_do_banco_novo
```

O comando confirma o nome do banco, recusa tabelas/objetos existentes e
executa a criação em uma transação. Foi verificado criando 46 tabelas em
`prova_tri_bootstrap` e recusando a segunda execução. Dados e catálogos
devem vir do backup ou dos processos de cadastro/importação do projeto.
Em banco existente, cada alteração incremental continua exigindo revisão da
estrutura real e backup; esta baseline não é uma migração para produção.

## Publicações futuras

Usar `npm run deploy:production`, após PR aprovado/incorporado e verificações
`Quality` verdes. O script recusa branch diferente de `main`, alterações
locais, arquivos sem registro e divergência com `origin/main`.

A imagem recebe o nome `prova-tri:<commit>` e o identificador
`org.opencontainers.image.revision`. Site e workers de geração, leitura e
OCR recebem a mesma imagem. O script não migra nem recria o banco.

Registrar a imagem anterior de cada serviço antes de publicar. Em reversão,
selecionar a imagem anterior explicitamente com `PROVA_TRI_IMAGE` e recriar
somente os serviços envolvidos com `--no-build --no-deps`; não restaurar o
banco para desfazer uma publicação de código. Conferir login, fluxo autenticado,
logs e filas após qualquer troca. Planejar a troca quando os jobs em execução
puderem terminar e usar o período de encerramento gracioso do Compose.

## Planejamento ENEM / PR #47

O branch `feature/enem-matriz-planejamento-em` parte do mesmo `main` antigo.
Dos 34 arquivos do PR, 12 já coincidem com o snapshot; os outros têm ajustes
posteriores. A consolidação preserva a versão atual e incorpora a ancestralidade
do branch ENEM por merge, após comparar as diferenças e executar os testes.
O PR de recuperação deve ser incorporado com **merge commit**, para que os
commits do ENEM continuem ancestrais de `main`; não usar squash ou rebase.
Assim o trabalho já incorporado não precisa ser reaplicado a partir do
branch antigo.
