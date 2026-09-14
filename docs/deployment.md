# Operação de Deploy

## Processo atual

Produção é `prova.colegioharmonia.com.br`, executada por Docker Compose. O
remoto oficial é `https://github.com/Colegio-Harmonia/prova-tri-harmonia.git`;
o branch de produção é `main`. PM2 e sincronização por `rsync` não fazem parte
do processo atual.

Após validar o commit e as variáveis do servidor, publique com:

```bash
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web worker ocr-worker
```

Confirme `/login`, as rotas protegidas e os logs antes de considerar a
publicação concluída. O arquivo `.env.local` permanece exclusivamente no
servidor. Não executar `npm run db:migrate`: a cadeia do Drizzle ainda precisa
ser corrigida antes de ser usada em produção.

> Os registros abaixo são históricos de releases anteriores. Eles descrevem a
> infraestrutura PM2 já descontinuada e não devem ser usados como instrução de
> deploy.

## Infraestrutura: legado atual e destino futuro

O servidor `192.168.1.218` é **legado temporário**. Está prevista migração
futura da aplicação para uma **VPS externa, ainda não definida**. Até a
migração acontecer: preservar compatibilidade com o servidor atual, não
gravar IP/porta/domínio/diretório hardcoded em código novo (tratar como
configuração por ambiente), não alterar DNS, não configurar Vercel.

### Ambientes previstos

| Ambiente | Branch correspondente | Situação hoje |
| --- | --- | --- |
| `local` | `feature/*`, `fix/*` | Máquina de desenvolvimento, sem deploy compartilhado. |
| `development` | `develop` | DEV interno em `192.168.1.218:3011` (ver seção abaixo) — existe e foi validado em 18/07/2026. |
| `staging` | `release/*` | Ainda não existe. Pendência. |
| `production` | `main` | Hoje: `192.168.1.218:3010` + `prova.colegioharmonia.com.br` (legado temporário). Destino futuro: VPS externa, ainda não definida. |

## Política para a reconstrução

Antes de qualquer deploy funcional, registrar neste documento:

1. nome e URL do DEV;
2. branch/remoto que alimenta DEV;
3. credencial autorizada e responsável;
4. comando ou pipeline de deploy;
5. estratégia de rollback por commit/artefato;
6. smoke tests autenticados por perfil.

## Ambiente DEV interno

**Destino aprovado:** servidor `192.168.1.218`, acesso interno por
`http://192.168.1.218:3011`. O DEV usa o diretório
`/home/eduardo/prova-tri-dev`, o processo PM2 `prova-tri-dev` e o banco
`prova_tri_dev`; ele nunca aponta para o banco de produção `prova_tri`.

O arquivo versionado `ecosystem.dev.config.js` é a definição do processo. Ele
chama o binário Next diretamente em `3011`, porque o script `npm start` do
projeto fixa a porta de produção `3010`.
Segredos não são versionados: a configuração local do DEV é criada no
servidor, com `DATABASE_URL` apontando para `prova_tri_dev` e
`NEXTAUTH_URL` apontando para a URL interna. Acesso por credenciais é o
caminho de validação inicial; Google OAuth não deve ser usado enquanto a
URL interna não estiver registrada no cliente OAuth.

### Deploy DEV

1. Sincronizar o repositório para `/home/eduardo/prova-tri-dev`, excluindo
   `.git`, `node_modules`, `.next` e todos os arquivos `.env`.
2. Manter dependências próprias do DEV e gerar o build nesse diretório.
3. Aplicar schema somente no banco `prova_tri_dev`; nunca executar comandos
   de banco usando variáveis da produção.
4. Iniciar/reiniciar apenas `prova-tri-dev` com `ecosystem.dev.config.js`.
5. Executar smoke test em `/login` e nas rotas afetadas, então consultar o
   log específico `prova-tri-dev-error.log`.

### Rollback DEV

O rollback restaura o commit anterior no diretório DEV, recompila e reinicia
somente `prova-tri-dev`. O banco DEV não é compartilhado; dados de teste
podem ser recriados sem afetar produção.

## Registro da Fase 1

| Data | Versão | Ambiente | Resultado | Observação |
| --- | --- | --- | --- | --- |
| 18/07/2026 | registro historico substituido | DEV | Superado | o bloqueio inicial de DEV/remoto foi resolvido pelos registros posteriores desta tabela e por `docs/git-workflow.md` |
| 18/07/2026 | `6ac363d` | DEV interno `192.168.1.218:3011` | Aprovado | processo `prova-tri-dev`, diretório e banco `prova_tri_dev` isolados; nenhuma aplicação de produção foi reiniciada |
| 18/07/2026 | `ee33500` | DEV interno `192.168.1.218:3011` | Aprovado | fundacao do Design System compilada no DEV; somente `prova-tri-dev` foi reiniciado; login e redirecionamento de rota protegida validados |
| 18/07/2026 | `aaffead` | DEV interno `192.168.1.218:3011` | Aprovado | catalogo interno do Design System compilado no DEV; acesso anonimo direcionado diretamente a login; somente `prova-tri-dev` foi reiniciado |
| 18/07/2026 | `ba16227` | DEV interno `192.168.1.218:3011` | Aprovado | runtime Next 15.5.20/React 19.2.7 compilado no servidor; `/login` em `200` e rotas protegidas/dinâmicas em `307`; somente `prova-tri-dev` reiniciado, com produção preservada |
| 19/07/2026 | `2eae920` | DEV interno `192.168.1.218:3011` | Aprovado | dependencias corrigidas instaladas por `npm ci`; auditoria de producao em zero, build e login por senha validados; somente `prova-tri-dev` reiniciado |
| 19/07/2026 | `2b8b2b7` | DEV interno `192.168.1.218:3011` | Aprovado | preferencia de tema persistente, contraste e semantica de Input validados; somente `prova-tri-dev` reiniciado |
| 19/07/2026 | `ad0aa89` | DEV interno `192.168.1.218:3011` | Aprovado | cliente HTTP tipado e teste de contrato compilados no DEV; auditoria de producao em zero; autenticacao por credenciais e protecao de rotas confirmadas; somente `prova-tri-dev` reiniciado |
| 19/07/2026 | `adeebca` | DEV interno `192.168.1.218:3011` | Aprovado | primeira adocao do cliente HTTP no dashboard validada com login autenticado; somente `prova-tri-dev` reiniciado; producao permaneceu no mesmo processo |
| 19/07/2026 | `ad5a388` | Produção `prova.colegioharmonia.com.br` | Aprovado | PR #19 promoveu todo o `develop`; release montada e validada fora do diretório ativo, seguida de corte atômico; Next 15.5.20 online, configuração preservada pelo mesmo hash e auditoria de produção em zero |
| 19/07/2026 | `6d25638` | DEV interno `192.168.1.218:3011` | Aprovado | Fase 2.7 publicada após PR #22; candidato compilado e testado em diretório separado, troca atômica com rollback em `/home/eduardo/prova-tri-dev-rollback-pre-6d25638`, configuração DEV preservada por hash e somente `prova-tri-dev` reiniciado |
| 20/07/2026 | `50a66e2` | DEV interno `192.168.1.218:3011` | Aprovado com limite | formulário de credenciais com React Hook Form e Zod publicado; testes de contrato, build e smoke de rotas passaram; somente `prova-tri-dev` reiniciado e produção preservada; interação visual manual ainda pendente |
| 20/07/2026 | `81729d8` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Lucide e a primeira seta semântica foram publicados no dashboard do professor; testes de contrato, build e smoke de rotas passaram; somente `prova-tri-dev` reiniciado, produção preservada e inspeção visual manual pendente |
| 20/07/2026 | `0489ae7` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Framer Motion e a entrada com redução de movimento foram publicados no dashboard do professor; testes de contrato, build e smoke de rotas passaram; somente `prova-tri-dev` reiniciado, produção preservada e inspeção visual manual pendente |
| 20/07/2026 | `60fe3bf` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Recharts foi validado em Por segmento com teste de renderização e build completo; somente `prova-tri-dev` reiniciado, produção preservada e inspeção visual com dados reais pendente |
| 20/07/2026 | `3c9e21f` | DEV interno `192.168.1.218:3011` | Aprovado com limite | shell responsivo Harmonia publicado após build das 26 páginas; login em 200, dashboard anônimo em 307 e asset de marca em PNG/200; somente `prova-tri-dev` foi reiniciado, produção preservada e inspeção visual autenticada pendente |
| 20/07/2026 | `ecd005c` | Produção `prova.colegioharmonia.com.br` | Aprovado com limite | PR #30 promoveu Fases 2.7 a 2.10; candidato isolado passou antes do corte atômico, configuração preservada por hash, processo online e smoke público/local aprovados; fluxos autenticados e visuais permanecem pendentes |
| 20/07/2026 | `17f44d0` | Produção `prova.colegioharmonia.com.br` | Aprovado | release v0.3.0 do shell Harmonia validada em candidato isolado e publicada por corte atômico; HTTPS login em 200, dashboard anônimo em 307, asset de marca PNG/200, configuração preservada e DEV mantido online |
| 20/07/2026 | `5ce128f` | Produção `prova.colegioharmonia.com.br` | Aprovado com limite | release v0.3.1 da Fase 3.2; listas de provas e usuários com cartões móveis passaram pelo candidato isolado e corte atômico; login público em 200 e rotas protegidas anônimas em 307; inspeção visual autenticada pendente |
| 20/07/2026 | `0e0e3f0` | Produção `prova.colegioharmonia.com.br` | Aprovado com limite | release v0.3.2 da Fase 3.3; salto para conteúdo e alvo principal publicados por candidato isolado e corte atômico; login público em 200, processo online e rollback preservado; validação por teclado autenticada pendente |
| 20/07/2026 | `738cbaf` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Fase 3.4 compilada no servidor, build `IZduFydSPFUZHvmeS39fP`; login em 200, geração/status anônimos em 307, somente `prova-tri-dev` reiniciado, logs limpos e auditoria de produção em zero; inspeção móvel autenticada pendente |
| 20/07/2026 | `0c3fc9a` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Fase 3.5 compilada no servidor, build `o5WaEZxu93qr7xx63YbLV`; login em 200, dashboard/geração anônimos em 307, somente `prova-tri-dev` reiniciado, logs limpos e auditoria de produção em zero; teste de teclado autenticado pendente |
| 20/07/2026 | `f939d83` | Produção `prova.colegioharmonia.com.br` | Aprovado | release v0.3.3 das Fases 3.4 e 3.5; candidato isolado, corte atômico, configuração preservada por hash, login público/local em 200, dashboard em 307 e log sem erro novo; aceite visual autenticado registrado |
| 20/07/2026 | `1d62e04` | DEV interno `192.168.1.218:3011` | Aprovado | Fase 4.1 compilada no servidor; login em 200, dashboard e API de estatísticas anônimos em 307, somente `prova-tri-dev` reiniciado, logs limpos e auditoria de produção em zero; produção preservada |
| 20/07/2026 | `c2bd846` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Fase 4.2 compilada no servidor; login em 200, dashboard e API de estatísticas anônimos em 307, somente `prova-tri-dev` reiniciado, logs limpos e auditoria de produção em zero; inspeção autenticada pendente |
| 20/07/2026 | `40db3eb` | DEV interno `192.168.1.218:3011` | Aprovado | Fase 6 publicada por candidato isolado e troca atômica; login em 200, desempenho e API protegidos em 307 para anônimos; sessão de coordenação acessou a tela e o recorte válido em 200; filtro inválido respondeu 400; somente `prova-tri-dev` foi reiniciado e o rollback ficou em `/home/eduardo/prova-tri-dev-rollback-pre-fase6` |
| 20/07/2026 | `d25c13d` | Produção `prova.colegioharmonia.com.br` | Aprovado com limite | release v0.6.4 da Fase 6 passou em candidato isolado antes do corte atômico; HTTPS `/login` respondeu 200 e `/desempenho` respondeu 307 sem sessão; PM2 online, log sem erro novo e rollback em `/home/eduardo/prova-tri-rollback-pre-v0.6.4-20260720-1709`. A credencial de teste do DEV não autenticou no banco de produção, portanto não há aceite autenticado de produção nesta evidência. |
| 20/07/2026 | `d441bd4` | DEV interno `192.168.1.218:3011` | Aprovado | extensões 6.8 a 6.11 publicadas por candidato isolado e troca atômica; visão geral, Bloom, DOK, BNCC, perfis, relatório individual e simulador ENEM protegidos para anônimos e validados com sessão de coordenação; rollback em `/home/eduardo/prova-tri-dev-rollback-pre-fase6-advanced-20260720-1740`; produção preservada. |
| 20/07/2026 | `db12cfe` | DEV interno `192.168.1.218:3011` | Aprovado | matriz ENEM-SAE publicada por candidato isolado e troca atômica; os dois arquivos reais foram enviados autenticadamente ao candidato e processados apenas em memória; página/API protegidas para anônimos, rollback em `/home/eduardo/prova-tri-dev-rollback-pre-enem-sae-20260720-1810` e produção preservada. |
| 20/07/2026 | `d16471c` | Produção `prova.colegioharmonia.com.br` | Aprovado com limite | release v0.6.5 publicada por candidato isolado e corte atômico; HTTPS login em 200, novas rotas de desempenho protegidas em 307, PM2 online e log sem erro novo; rollback em `/home/eduardo/prova-tri-rollback-pre-v0.6.5-20260720-1744`. A validação de sessão autenticada foi executada no DEV, não no banco de produção. |
| 23/07/2026 | `c7a5630` | DEV interno `192.168.1.218:3011` | Aprovado | Fase 11.1 promovida após PR #170 e workflow Quality verde. Candidata isolada passou instalação limpa, cobertura Vitest, regressão, lint, TypeScript, build e orçamento; após a troca atômica, login respondeu 200 e dashboard anônimo 307. Produção não foi alterada; rollback em `/home/eduardo/prova-tri-dev-rollback-pre-fase11-20260723-1034`. |
| 23/07/2026 | `8b83b56` | Produção `prova.colegioharmonia.com.br` | Aprovado | Fase 11.1 promovida pelo PR #172 após workflow Quality verde. Candidata isolada passou instalação limpa, cobertura Vitest, regressão, lint, TypeScript, build e orçamento; após o corte atômico, login local e público responderam 200 e dashboard sem sessão 307. Configuração preservada; rollback em `/home/eduardo/prova-tri-rollback-pre-fase11-20260723-1455`. |
| 23/07/2026 | `e59fefe` | DEV interno `192.168.1.218:3011` | Aprovado | Fase 11.2 promovida após PR #175 e workflow Quality verde. A candidata isolada passou `npm ci`, cobertura Vitest (16 testes), regressão, lint, TypeScript, build de 36 rotas e orçamento; após a troca atômica, login respondeu 200 e dashboard anônimo 307. PM2 ficou online, `.env.local` preservou o hash e o rollback está em `/home/eduardo/prova-tri-dev-rollback-pre-fase11-2-20260723-1523`. |
| 23/07/2026 | `4c9fce3` | Produção `prova.colegioharmonia.com.br` | Aprovado | Fase 11.2 promovida pelo PR #177 após dois workflows Quality verdes. A candidata isolada passou `npm ci`, cobertura Vitest (16 testes), regressão, lint, TypeScript, build de 36 rotas e orçamento; após o corte atômico, login local e público responderam 200 e dashboard anônimo 307. PM2 ficou online, `.env.local` preservou o hash e o rollback está em `/home/eduardo/prova-tri-rollback-pre-fase11-2-20260723-1604`. |
| 23/07/2026 | `858f592` | DEV interno `192.168.1.218:3011` | Aprovado | Bibliotecas curriculares (13 dependências para geração de prova) promovidas após PR #183 e workflow Quality verde. Diff vs `develop`: apenas `package.json` + `package-lock.json`, sem código de aplicação. Candidata isolada passou `npm ci` e build; após a troca atômica, `/login` respondeu 200 e `/dashboard`/`/desempenho` anônimos 307. `.env.local` preservou o hash, apontando para `prova_tri_dev`; somente `prova-tri-dev` foi reiniciado e a produção permaneceu intocada. Rollback em `/home/eduardo/prova-tri-dev-rollback-pre-bibliotecas-20260723-165448`. |
| 23/07/2026 | `8ae726b` | Produção `prova.colegioharmonia.com.br` | Aprovado | Bibliotecas curriculares promovidas pelo PR #184 após workflow Quality verde, validadas antes em DEV. Candidata isolada a partir de `main` passou `npm ci` e build (`DkqoGK9l-vlYBEtX6fDgB`); após o corte atômico, HTTPS `/login` respondeu 200 e `/dashboard` anônimo 307 (local 200/307/307), com `Ready in 347ms` e log sem erro novo. `.env.local` de produção preservou o hash, nunca sincronizado; DEV mantido online. Rollback em `/home/eduardo/prova-tri-rollback-pre-bibliotecas-20260723-170624`. |
| 24/07/2026 | `d1f8d92` | DEV interno `192.168.1.218:3011` | Aprovado | Robustez da geração de documento promovida após PR #187 e workflow Quality verde. Corrige crash real do exam #31: questão do banco ENEM com alternativa em imagem chega com `text: null` e derrubava a geração dos 3 documentos (`Cannot read properties of null (reading 'matchAll')`), prendendo a prova em `revisao_concluida`. Funções de LaTeX/markdown passaram a ser null-safe, `collectTexts` filtra nullish e a alternativa-imagem vira marcador honesto na prova e na revisão; teste de regressão com 5 casos. Candidata isolada passou `npm ci`, 31 testes, lint, build (`aFkAMyvNV6q3PGozj4Sil`); após a troca atômica, `/login` respondeu 200 e `/dashboard` anônimo 307, sem erro novo no log. Rollback em `/home/eduardo/prova-tri-dev-rollback-pre-fixA-20260723-181857`. |
| 24/07/2026 | `059b4fb` | Produção `prova.colegioharmonia.com.br` | Aprovado | Robustez da geração de documento promovida pelo PR #188 após dois workflows Quality verdes, validada antes em DEV. Candidata isolada a partir de `main` passou `npm ci` e build (`AvmGGkJNUwh47XALwyixR`); após o corte atômico, HTTPS `/login` respondeu 200, `/dashboard` e `/gerar/31/revisar` anônimos 307 (local 200/307/307), com `Ready in 338ms` e log sem erro novo. `.env.local` de produção preservou o hash, nunca sincronizado; DEV mantido online. Rollback em `/home/eduardo/prova-tri-rollback-pre-fixA-20260724-063351`. |
| 24/07/2026 | `cb0d19e` | DEV interno `192.168.1.218:3011` | Aprovado | Ordem do texto de apoio na prova promovida após PR #191 e workflow Quality verde. Corrige bug relatado no exam #31: o documento imprimia o enunciado ANTES do texto de apoio, tornando incompreensíveis as questões do banco ENEM, cujo enunciado é continuação direta do apoio ("Ao abaixar o fogo, reduz-se a chama, pois assim evita-se o(a)"). A tela de revisão sempre teve a ordem correta, então o professor aprovava vendo certo e recebia o documento invertido. `buildProvaOps` passou a emitir número (negrito) → texto de apoio → enunciado → imagem → alternativas. Candidata isolada passou `npm ci`, 34 testes, lint e build (`sPSYtwPv_tRHDklnCMZkM`); após a troca atômica, `/login` respondeu 200 e `/status` anônimo 307, com produção intocada. Rollback em `/home/eduardo/prova-tri-dev-rollback-pre-ordem-20260724-064934`. |
| 24/07/2026 | `fc4fdf1` | Produção `prova.colegioharmonia.com.br` | Aprovado | Ordem do texto de apoio promovida pelo PR #192 após dois workflows Quality verdes, validada antes em DEV. Candidata isolada a partir de `main` passou `npm ci` e build (`aFv5tvlk77s0LF1lGG7gl`); após o corte atômico, HTTPS `/login` respondeu 200 e `/dashboard`/`/gerar/31/revisar` anônimos 307 (local 200), com `Ready in 340ms` e log sem erro novo. `.env.local` de produção preservou o hash. **Validado end-to-end em dado real**: o exam #31 foi revertido para `revisao_concluida`, reaprovado pela coordenação e gerou 3 documentos novos (prova `1L3xnkyh…`, gabarito `1pmDlikY…`, mapa `1LUaGjfN…`) com a ordem correta confirmada na leitura. Os documentos antigos ficaram órfãos no Drive, sem remoção automática. Rollback em `/home/eduardo/prova-tri-rollback-pre-ordem-20260724-074735`. |
| 24/07/2026 | `57e8450` | DEV interno `192.168.1.218:3011` | Aprovado | Expansão do Sistema de Avaliação promovida pelo PR #195 (fila assíncrona de geração, pontuação Percentual × TRI, Reforço ENEM por habilidade INEP com publicação no Classroom, e Adaptação Inclusiva para alunos laudados), mais os PRs #196/#197 de correção de gate de rota. Migrations 0015-0018 aplicadas em `prova_tri_dev`; o processo `prova-tri` de produção não foi reiniciado nem teve código trocado — `prova-tri` seguiu online no mesmo PID com `:3010/login` em 200. Processo novo `prova-tri-dev-worker` iniciado a partir de `ecosystem.dev.config.js` e salvo no PM2 (consome a fila lendo o `.env.local` do diretório DEV; não abre porta, logo não disputa 3010/3011). Validação: `/login` 200 e `/reforco`, `/status`, `/gerar`, `/dashboard`, `/api/generation-jobs`, `/api/reinforcement/*` todos 307 anônimos; smoke tests `test:generation-queue` e `test:scoring` verdes contra `prova_tri_dev`; `validate-pedagogical-engine` em 7 pass / 7 warn / 0 fail. **Dois achados corrigidos durante a validação**: (1) `/reforco` respondia 200 sem sessão — o gate são DUAS listas irmãs (`matcher` em `middleware.ts` e `PROTECTED_PATHS` em `auth.config.ts`) e as rotas novas ficaram fora de ambas; as APIs já barravam com `auth()` próprio (401), então não houve exposição de dado. (2) O catálogo de taxonomias pedagógicas nunca havia sido semeado em `prova_tri_dev` (`FAIL` pré-existente do ambiente, não do PR) — resolvido com `npm run seed-pedagogical-taxonomies`, idempotente. Pendências conhecidas: `test:reinforcement` retorna SKIP porque o banco ENEM não está importado no DEV, e `import-tri-params` ainda não foi executado (simulado TRI exibe percentual com aviso até lá). Rollback: `git reset --hard cb0d19e` em `/home/eduardo/prova-tri-dev` + rebuild, e `pm2 delete prova-tri-dev-worker`. |
| 24/07/2026 | `58806fb` | Produção `prova.colegioharmonia.com.br` | **Schema aplicado, código pendente** | ⚠️ **Correção de registro.** As migrations 0015-0018 foram aplicadas ao banco de produção `prova_tri` **durante o desenvolvimento**, não apenas em DEV: o diretório de trabalho ficava dentro de `/home/eduardo/prova-tri`, cujo `.env.local` aponta para `prova_tri` — o que foi tratado como "banco local de dev" era, de fato, o banco de produção. Efeito verificado: **nenhum**, porque as quatro migrations são estritamente aditivas (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` com default) e o código publicado (`fc4fdf1`) ignora tabelas e colunas novas; `:3010/login` respondeu 200 durante toda a sessão. Os smoke tests (`test:generation-queue`, `test:scoring`) também rodaram contra `prova_tri`, criando usuários/provas/correções temporários — todos removidos pelos blocos `finally`, com resíduo **zero** confirmado por consulta (0 usuário `@test.invalid`, 0 job, 0 batch, 0 adaptação, 0 questão fake ano 1901, 0 `score_result`, 0 prova criada no dia). Dados reais intactos: 27 provas (mais recente 23/07), 30 correções, 6 usuários ativos, 2.689 questões do banco ENEM; colunas novas com default correto em 27/27 provas (`prova`/`padrao`/`percentual`). **Lição para o projeto:** desenvolver dentro de `/home/eduardo/prova-tri` significa trabalhar contra o banco de produção — usar `/home/eduardo/prova-tri-dev` (banco `prova_tri_dev`) para qualquer execução de script ou teste que escreva. A troca de código de produção **não** foi executada; candidata montada e validada fora do diretório ativo, aguardando janela aprovada. |
| 24/07/2026 | `58806fb` | Produção `prova.colegioharmonia.com.br` | Aprovado | Expansão do Sistema de Avaliação promovida pelos PRs #199/#200 (fila assíncrona de geração, pontuação Percentual × TRI, Reforço ENEM por habilidade INEP com publicação no Classroom, Adaptação Inclusiva) após validação em DEV (registro anterior) e correção de gate de rota (#196/#197). Candidata clonada isoladamente de `main`, `npm ci`, 75/75 testes e build (`_EXpxIuzydQDPgtP5OUJq`) gerados fora do diretório ativo; `.env.local` copiado com permissão `600` e hash idêntico ao original (`0808ca09…`) antes e depois. Corte atômico via `mv` (mesmo filesystem): `prova-tri` parado, diretórios trocados, reiniciado — `Ready in 340ms`, sem erro novo no log. Processo novo `prova-tri-worker` iniciado a partir de `ecosystem.config.js` e salvo no PM2 (não abre porta, não disputa a 3010). **Validação pós-corte**: `/login` 200 (local e HTTPS); `/dashboard`, `/gerar`, `/status`, `/reforco`, `/desempenho`, `/turmas`, `/usuarios`, `/api/generation-jobs`, `/api/reinforcement/suggest-skills`, `/api/exams`, `/api/analytics/performance` todos 307 anônimos — confirma que o achado de gate corrigido em DEV (#196/#197) também vale em produção; dados reais intactos (27 provas, 30 correções, 6 usuários ativos, 2.689 questões do banco ENEM), idênticos à contagem pré-corte. Migrations 0015-0018 já estavam aplicadas em `prova_tri` desde a preparação (ver registro de correção anterior) — nenhuma aplicada durante este corte. Rollback preservado em `/home/eduardo/prova-tri-rollback-pre-58806fb-20260724-112452` (parents: `main`@`58806fb` também tem `4a8c2c1`/PR#194 como ancestral, então reverter não perde histórico de produção). **Incidente durante a preparação, sem impacto real**: um comando de registro de deploy foi disparado por engano dentro do diretório de produção ativo (`/home/eduardo/prova-tri`, já apontando pro código novo pós-corte) e trocou o branch local do working tree de `main` para `develop` por alguns segundos; como o processo Next.js serve do build `.next` já carregado em memória e não relê o working tree por requisição, `/login` respondeu 200 durante todo o intervalo — corrigido imediatamente com `git switch main && git reset --hard 58806fb`, sem gerar commit nem push. Fica registrado porque reforça a mesma lição do registro anterior: comandos `git`/de escrita precisam ser conferidos contra `pwd` antes de rodar, nunca assumidos pelo histórico do terminal. **Pendências que seguem a promoção**: `npm run import-tri-params` ainda não executado (simulado TRI exibe percentual com aviso até lá); Reforço ENEM não teve execução ponta a ponta real ainda (primeira vez será em produção, onde o banco ENEM existe — acompanhar a primeira geração de perto); as 6 vulnerabilidades pré-existentes da auditoria (`@auth/core`/`next-auth`, `next`, `sharp`) permanecem em aberto, não introduzidas por este deploy. |

| 24/07/2026 | `cf988c6` | DEV interno `192.168.1.218:3011` | Aprovado com limite | Correção visual do Reforço ENEM promovida após o PR #203 e workflow Quality verde. O candidato isolado passou `npm ci`, lint, TypeScript, regressão, build das 38 rotas e orçamento. A troca atômica preservou o hash de `.env.local`; `/login` respondeu `200`, `/reforco` anônimo respondeu `307`, `prova-tri-dev` ficou online e os workers DEV/produção não foram reiniciados. Rollback em `/home/eduardo/prova-tri-dev-rollback-pre-reforco-theme-20260724-142306`. A validação visual autenticada no tema escuro é pendente; produção não foi alterada. |

## Release de produção de 19/07/2026

- **Origem:** `develop` em `ae4ca71`, promovido para `main` pelo PR #19.
- **Commit publicado:** `ad5a388`.
- **Commit anterior:** `797f919`.
- **Rollback imediato:** instalação anterior preservada em
  `/home/eduardo/prova-tri-rollback-797f919`.
- **Estratégia:** a nova release foi instalada, testada e compilada em
  diretório separado. O processo `prova-tri` foi interrompido apenas durante a
  troca dos diretórios e reiniciado após o corte.
- **Proteção de configuração:** `.env.local` não participou do `rsync`; foi
  copiado dentro do servidor com permissão `600`, e o hash antes/depois
  permaneceu idêntico.
- **Banco:** nenhuma migração, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** login e sessão anônima, proteção de rotas, handler dinâmico,
  assets Next, logs PM2 e layout desktop/mobile foram verificados após o
  deploy.

## Release de produção v0.2.0 de 20/07/2026

- **Origem:** release/v0.2.0, promovida para `main` pelo PR #30.
- **Commit publicado:** `ecd005c`.
- **Escopo:** Fases 2.7 a 2.10: TanStack Query, formulário tipado, Lucide e
  Framer Motion com redução de movimento.
- **Commit anterior:** `327c711`.
- **Rollback imediato:** instalação anterior preservada em
  `/home/eduardo/prova-tri-rollback-pre-ecd005c`.
- **Estratégia:** candidato montado em diretório separado e validado em 3012;
  após aprovação, o processo foi interrompido apenas durante a troca atômica
  de diretórios e reiniciado sobre a nova instalação.
- **Proteção de configuração:** `.env.local` ficou fora do rsync, foi copiado
  apenas dentro do servidor com permissão 600 e manteve o mesmo hash antes e
  depois do corte.
- **Banco:** nenhuma migration, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** HTTPS público de login em 200; login e sessão locais em 200;
  dashboard anônimo em 307; PM2 online; auditoria de produção em zero; log de
  erro sem nova entrada após o corte. Validação autenticada e visual permanece
  manual.

## Release de produção v0.3.0 de 20/07/2026

- **Origem:** `release/v0.3.0`, promovida para `main` pelo PR #38.
- **Commit publicado:** `17f44d0`.
- **Escopo:** Fase 3.1: marca Harmonia, shell responsivo, sidebar, menu
  mobile, breadcrumb e rodapé.
- **Commit anterior:** `1342be2`.
- **Rollback imediato:** `/home/eduardo/prova-tri-rollback-pre-17f44d0`.
- **Estratégia:** candidato compilado e testado em diretório e porta isolados,
  seguido por troca atômica do diretório ativo.
- **Proteção de configuração:** `.env.local` ficou fora do rsync, foi
  copiado somente no servidor com permissão 600 e manteve o mesmo hash.
- **Banco:** nenhuma migration, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** build de 26 páginas; HTTPS público de login em 200,
  dashboard anônimo em 307, asset público de marca em PNG/200, sessão anônima
  local nula, PM2 online e log de erro sem nova entrada após o corte.

## Release de produção v0.3.3 de 20/07/2026

- **Origem:** `main` no commit `f939d83`, promovido pelo PR #49.
- **Escopo:** Fases 3.4 e 3.5: fluxo de geração responsivo e menu móvel com
  anúncio de estado, `Escape` e restauração de foco.
- **Rollback imediato:** `/home/eduardo/prova-tri-rollback-pre-f939d83`.
- **Estratégia:** candidato compilado em diretório isolado e validado em
  `3012`, seguido por troca atômica do diretório ativo. A primeira compilação
  encontrou um chunk transitório ausente durante a coleta de dados; a
  repetição com `.next` limpo concluiu as 26 páginas antes do corte.
- **Proteção de configuração:** `.env.local` permaneceu fora do rsync, foi
  copiado apenas dentro do servidor com permissão 600 e manteve o mesmo hash.
- **Banco:** nenhuma migração, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** login local e HTTPS público em 200; sessão anônima nula;
  dashboard local e público em 307; PM2 online e log de erro sem nova entrada.
  O aceite visual autenticado da Fase 3 foi confirmado pelo responsável.

## Release de produção v0.4.0 de 20/07/2026

- **Origem:** `main` no commit `3da7328`, promovido pelo PR #58.
- **Escopo:** Fase 4.1: tipos e seletores puros do dashboard de gestão. A
  interface visual da Fase 4.2 permanece exclusivamente em DEV.
- **Rollback imediato:** `/home/eduardo/prova-tri-rollback-pre-3da7328`.
- **Estratégia:** candidato compilado e testado em `3012`, seguido por troca
  atômica do diretório ativo.
- **Proteção de configuração:** `.env.local` permaneceu fora do rsync e
  manteve o mesmo hash antes e depois do corte.
- **Banco:** nenhuma migração, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** login local e HTTPS público em 200; sessão anônima nula;
  dashboard e API de estatísticas anônimos em 307; PM2 online e log sem erro
  novo.

## Release de produção v0.5.0 de 20/07/2026

- **Origem:** `main` no commit `37c0fd6`, promovido pelo PR #68.
- **Escopo:** conclusão da Fase 4: composição da produção, qualidade
  pedagógica, Banco ENEM com consulta tipada, ações do professor e checklist
  de regressão.
- **Rollback imediato:** `/home/eduardo/prova-tri-rollback-pre-37c0fd6`.
- **Estratégia:** candidato compilado em diretório isolado e validado em
  `3012`; a troca atômica preservou o diretório anterior para rollback.
- **Proteção de configuração:** `.env.local` foi mantido exclusivamente no
  servidor e estava presente antes da promoção, sem cópia para o repositório.
- **Banco:** nenhuma migração, alteração de schema ou comando de escrita foi
  executado.
- **Validação:** candidato e produção responderam login em 200; sessão
  anônima retornou `null`; dashboard e API de estatísticas ficaram protegidos
  com 307; a URL HTTPS pública de login respondeu 200; PM2 permaneceu online
  e o log de erro não recebeu entradas após o corte.

## Release de produção v0.6.6 de 20/07/2026

- **Origem:** `main` no commit `7041f84`, promovido pelo PR #93.
- **Escopo:** Fase 6.12 a 6.15: importação em memória de matrizes XLSX
  ENEM-SAE, comparativo entre bimestres, áreas prioritárias, itens com maior
  erro e evolução individual exportável por impressão/PDF.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.6.6-20260720-1820`.
- **Estratégia:** candidato isolado compilado e validado em `3012`, seguido
  por troca atômica do diretório ativo. Arquivos enviados não foram copiados
  para o servidor nem persistidos pelo importador.
- **Proteção de configuração:** `.env.local` permaneceu exclusivamente no
  servidor durante a promoção.
- **Banco:** nenhuma migração, alteração de schema ou escrita de resultados
  externos foi executada.
- **Validação:** instalação limpa, lint, TypeScript, build e auditoria de
  produção passaram no candidato; `/login` respondeu 200 e as rotas ENEM-SAE
  responderam 307 sem sessão. Após o corte, os mesmos smoke tests passaram,
  PM2 permaneceu online e o log de erro não recebeu entrada nova. O upload
  autenticado dos dois arquivos foi validado no DEV, não em produção.

## Deploy DEV da Fase 6.16 a 6.19 de 20/07/2026

- **Origem:** `develop` no commit `34b6636`, promovido pelo PR #95.
- **Escopo:** diagnóstico ENEM-SAE por competência, habilidade, tópico e
  disciplina, com pareamento obrigatório entre respostas e matriz de itens.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-dev-rollback-pre-diagnostic-6-19-20260720-1835`.
- **Estratégia:** candidato isolado compilado em `3012` e validado antes da
  troca atômica do diretório DEV.
- **Banco:** nenhuma migração, alteração de schema ou persistência dos
  arquivos e resultados externos foi executada.
- **Validação:** os dois pares reais foram enviados em sessão autenticada ao
  candidato e ao DEV ativo. Cada bimestre retornou 13 alunos, 2.340 respostas,
  180 vínculos pedagógicos e 120 habilidades. Página autenticada em 200, PM2
  online e log de erro vazio após o corte.

## Release de produção v0.6.7 de 20/07/2026

- **Origem:** `main` no commit `d758bc2`, promovido pelo PR #97.
- **Escopo:** Fase 6.16 a 6.19: importação pareada de respostas e matriz de
  itens, diagnóstico individual por competência, habilidade, tópico e
  disciplina, comparação com a turma e evolução por habilidade.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.6.7-20260720-1845`.
- **Estratégia:** candidato isolado compilado e validado em `3012`, seguido
  por troca atômica do diretório ativo. Nenhum arquivo enviado foi persistido.
- **Banco:** nenhuma migração, alteração de schema ou escrita de resultados
  externos foi executada.
- **Validação:** o candidato passou lint, TypeScript, build e auditoria sem
  vulnerabilidades; os dois pares reais passaram em sessão autenticada, e um
  par incompatível foi recusado com 400. Após o corte, login local e HTTPS
  público responderam 200; página/API protegidas responderam 307; o processo
  PM2 ficou online sem reinício e o log de erro ficou vazio.

## Release de produção v0.6.8 de 20/07/2026

- **Origem:** `main` no commit `f9c488a`, promovido pelos PRs #101 e #102.
- **Escopo:** snapshots persistentes do diagnóstico ENEM-SAE por ano, série e
  bimestre; resultados em `Desempenho > Simulado ENEM`; importação separada
  em `Desempenho > Simulado ENEM > SAE`.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.6.8-20260720-214337`.
- **Estratégia:** candidato isolado compilado em `3012`, validado e promovido
  por troca atômica. O diretório anterior foi preservado para rollback.
- **Banco:** a migration aditiva criou `enem_sae_imports`, com integridade
  referencial para o importador. A tabela estava vazia no momento da promoção;
  nenhuma planilha ou resultado SAE foi carregado na produção durante o deploy.
- **Validação:** o candidato compilou 31 rotas com lint e TypeScript; `/login`
  respondeu 200 e as rotas SAE protegidas responderam 307 sem sessão no
  candidato e na produção ativa. O processo PM2 `prova-tri` ficou online sem
  reinícios. A conta de teste disponível no DEV não existe na base de produção,
  portanto não foi feita importação autenticada produtiva.

## Deploy DEV da Fase 7 de 22/07/2026

- **Origem:** `codex/fase-7-administracao`, antes da promoção para `develop`.
- **Escopo:** painel operacional de contas, manutenção de RBAC e trilha de
  auditoria para cadastro, alteração de cargo, ativação e desativação.
- **Banco:** a migração `0009_administrative_audit.sql` foi aplicada somente
  no banco DEV antes do corte.
- **Candidato:** compilação completa de 32 páginas e `BUILD_ID`
  `QWxbioMxgCD0jrniyrSuH` em diretório isolado, com login em `200`, rota de
  usuários anônima em `307` e smoke autenticado aprovado.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-dev-rollback-pre-fase7-20260722-103038`.
- **Validação após corte:** `prova-tri-dev` online em `3011`; login em `200`;
  coordenação de teste criou, desativou e reativou conta, com os três eventos
  presentes na API; professor recebeu `403` nas rotas de auditoria e lista
  completa de usuários.

## Release de produção v0.7.0 de 22/07/2026

- **Origem:** `main` no commit `d35aa4f`, promovido pelo PR #110.
- **Escopo:** Fase 7: painel operacional de contas, RBAC preservado e
  auditoria de cadastro, alteração de cargo, ativação e desativação.
- **Banco:** `administrative_audit` foi criado de modo aditivo antes do corte;
  a tabela iniciou sem eventos e não houve alteração dos dados SAE.
- **Candidato:** compilação completa de 32 páginas em diretório isolado;
  `/login` em `200`, `/usuarios` anônimo em `307` e
  `/api/admin/audit` anônimo em `401`.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.7.0-20260722-103945`.
- **Validação após corte:** processo PM2 `prova-tri` online em `3010`, login
  local e HTTPS público em `200`, usuários anônimo em `307` e auditoria
  anônima em `401`; o log de erro não recebeu entrada nova.

## Deploy DEV da Fase 8.2 de 22/07/2026

- **Origem:** `develop` no commit `cd01506`, promovido pelo PR #113.
- **Escopo:** telemetria privada de operações DeepSeek em `ai_operations`.
- **Banco:** migration aditiva `0010_ai_operations.sql` aplicada somente no
  banco DEV; a tabela iniciou vazia e não contém conteúdo pedagógico.
- **Candidato:** build completo de 32 páginas, lint, TypeScript e teste puro
  de telemetria aprovados; login em `200`, dashboard e geração anônimos em
  `307`.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-dev-rollback-pre-fase8-20260722-121532`.
- **Validação após corte:** `prova-tri-dev` online em `3011`; login em `200`;
  nenhuma chamada de IA foi feita porque a chave permanece desabilitada no DEV.

## Release de produção v0.8.0 de 22/07/2026

- **Origem:** `main` no commit `0150e76`, promovido pelo PR #115.
- **Escopo:** Fase 8.2: telemetria privada de IA para tokens retornados,
  duração, tentativas, reparos e falhas categorizadas.
- **Banco:** migration aditiva `0010_ai_operations.sql` aplicada antes do
  corte; a tabela iniciou vazia e não armazena prompt, resposta ou dados de
  aluno.
- **Candidato:** build completo de 32 páginas; login em `200`, dashboard e
  geração anônimos em `307`, sem chamada ao DeepSeek.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.8.0-20260722-122145`.
- **Validação após corte:** login local e HTTPS público em `200`, dashboard
  anônimo em `307`, PM2 `prova-tri` online e log de erro sem entrada nova.

## Release de produção v0.8.3 de 22/07/2026

- **Origem:** `main` no commit `32f5a54`, promovido pelo PR #128.
- **Escopo:** extensão da Fase 8 para selecionar perfis de texto, imagem e
  validação visual, registrar tokens/custos estimados e manter credenciais
  somente no ambiente.
- **Banco:** migration aditiva `0011_ai_model_governance.sql` aplicada antes
  do corte; `ai_model_profiles` contém quatro perfis iniciais, sem prompt,
  resposta ou dado de aluno.
- **Candidato:** teste de telemetria, lint, TypeScript e build aprovados;
  login em `200`, dashboard e `/ia` anônimos em `307` e API de modelos anônima
  em `403`.
- **Rollback imediato:**
  `/home/eduardo/prova-tri-rollback-pre-v0.8.3-20260722-140006`.
- **Validação após corte:** PM2 `prova-tri` online em `3010`, login local e
  HTTPS público em `200`, e tabela com quatro perfis. Não houve chamada de IA
  fabricada para gerar telemetria ou custo.

## Limitações deliberadas do DEV inicial

- O banco começa apenas com schema e contas de equipe para permitir login por
  credenciais; não contém provas, correções, alunos ou classificações.
- `DEEPSEEK_API_KEY` fica desabilitada no DEV, evitando geração/custo de IA.
- Google OAuth não é um teste válido na URL por IP interno, pois o callback
  não está registrado no cliente Google. Login por credenciais é o fluxo
  suportado até existir um domínio DEV autorizado.
- O processo de produção continua na porta `3010`; o DEV não usa Caddy nem
  recebe tráfego público.

## Fase 9 - Performance, 23/07/2026

- **Origem:** `main` no merge `ffde2b3` (PR #143), com entrega funcional no
  commit `30f1b28`.
- **DEV:** candidato isolado passou `npm ci`, lint, TypeScript, build das 36
  rotas e o orçamento gzip. Após o corte, login retornou `200`, dashboard
  anônimo `307`, a API autenticada retornou `200` com `Server-Timing`, PM2
  `prova-tri-dev` ficou online e o rollback ficou em
  `/home/eduardo/prova-tri-dev-rollback-pre-fase9-20260723-065347`.
- **Produção:** candidato isolado passou o mesmo conjunto de verificações;
  login local e HTTPS público retornaram `200`, dashboard anônimo retornou
  `307`, PM2 `prova-tri` ficou online e o rollback ficou em
  `/home/eduardo/prova-tri-rollback-pre-fase9-20260723-065622`.
- **Banco e configuração:** nenhuma migration foi executada; `.env.local`
  foi copiado somente dentro de cada servidor, com permissão `600`.
- **Observação:** os builds emitiram avisos transitivos do NextAuth para
  runtime Edge. A aplicação continua em runtime Node/PM2; o acompanhamento
  está registrado como TD-010.

## Fase 10 - Acessibilidade, 23/07/2026

- **Origem DEV:** `develop` no merge `7633375` (PR #150), contendo a entrega
  funcional `517620e`.
- **Origem produção:** `main` no merge `b8aab47` (PR #151).
- **Escopo:** filtros e navegação de desempenho, campos de correção e de
  administração, tabela de status, estados anunciados e contrato automatizado
  de acessibilidade. Não houve migration, alteração de API, banco ou `.env`.
- **DEV:** candidato isolado passou `npm ci`, contrato de acessibilidade, lint,
  TypeScript, build, orçamento e regressão de tabelas. Após a troca, login por
  credenciais e as rotas autenticadas de dashboard, desempenho, status,
  geração, IA e API analítica responderam `200`; rollback em
  `/home/eduardo/prova-tri-dev-rollback-pre-fase10-20260723-072407`.
- **Produção:** candidato isolado passou a mesma bateria. Após a troca, login
  local e HTTPS público responderam `200`, e dashboard, desempenho e status
  sem sessão responderam `307`; rollback em
  `/home/eduardo/prova-tri-rollback-pre-fase10-20260723-072835`.
- **Limite:** a credencial de teste do DEV recebeu `CredentialsSignin` no
  banco de produção. A validação de teclado e leitor de tela autenticada em
  produção deve ser feita com uma conta real autorizada, conforme
  `docs/fase-10-acessibilidade.md`.

## Hotfix de ativação privada do Google Chat, 23/07/2026

- **Origem DEV:** `develop` no merge `9e2575c` (PR #154).
- **Origem produção:** `main` no merge `2a20f45` (PR #155).
- **Escopo:** uma mensagem direta ao app retoma o onboarding pendente de uma
  instalação anterior; conversas já vinculadas não são desconectadas. Espaços
  e grupos continuam fora do fluxo.
- **Validação:** contrato privado do Chat, lint, TypeScript e build passaram
  nos candidatos DEV e produção. Login respondeu `200`; o endpoint sem bearer
  respondeu `401` nos dois ambientes, e PM2 permaneceu online.
- **Rollback:** DEV em `/home/eduardo/prova-tri-dev-rollback-pre-chat-fix-20260723-085440` e produção em
  `/home/eduardo/prova-tri-rollback-pre-chat-fix-20260723-085753`.
- **Teste real pendente:** a pessoa deve enviar uma nova mensagem direta após
  o deploy, abrir o cartão **Conectar minha conta** e concluir o login. Só
  então a instalação pode receber uma notificação de prova atribuída.

## Correção de evento do complemento Google Chat, 23/07/2026

- **Origem DEV:** `develop` no merge `9c224c0` (PR #158).
- **Origem produção:** `main` no merge `5f6474d` (PR #159).
- **Causa corrigida:** o projeto foi configurado como complemento do Google
  Workspace. Esse tipo de app envia eventos em `chat.messagePayload`, e exige
  uma ação de criação de mensagem como resposta, em vez do formato direto do
  app Chat independente.
- **Validação:** o contrato cobre os dois formatos, inclusive mensagem direta
  e remoção. Nos candidatos DEV e produção, contrato, lint, TypeScript e build
  passaram; login respondeu `200` e o endpoint sem bearer respondeu `401`.
- **Rollback:** DEV em
  `/home/eduardo/prova-tri-dev-rollback-pre-chat-addon-20260723-090721` e
  produção em
  `/home/eduardo/prova-tri-rollback-pre-chat-addon-20260723-091056`.
- **Teste real pendente:** Daniela deve enviar `Teste` novamente ao app,
  clicar no cartão **Conectar minha conta** e autenticar-se. O vínculo e a
  primeira notificação só podem ser confirmados após esse evento assinado pelo
  próprio Google Chat.

## Validação real e origem pública do Google Chat, 23/07/2026

- **Origens:** `develop` no merge `27548eb` (PR #164) e `main` no merge
  `0a79def` (PR #165).
- **Validação real:** Daniela concluiu o vínculo privado; a instalação ativa
  ficou associada a `secretaria@colegioharmonia.com.br`. O envio técnico pela
  API Google Chat criou a mensagem individual
  `spaces/_ZE6OKAAAAE/messages/iEUiMjVNDYE.iEUiMjVNDYE`.
- **Correção de URL:** confirmações de vínculo agora usam sempre
  `GOOGLE_CHAT_PUBLIC_BASE_URL`, evitando redirecionamento para `localhost`
  quando a aplicação está atrás do proxy.
- **Publicação:** DEV e produção passaram contrato do Chat, lint, TypeScript,
  build, login em `200`, endpoint sem bearer em `401` e PM2 online. Rollbacks:
  `/home/eduardo/prova-tri-dev-rollback-pre-chat-public-origin-20260723-094901`
  e
  `/home/eduardo/prova-tri-rollback-pre-chat-public-origin-20260723-095123`.

## Correção de contraste: Reforço ENEM e Adaptação, 24/07/2026

- **Origens:** Reforço ENEM em `develop` pelo PR #203; Adaptação em `develop`
  pelo PR #205 (`ffc9c6c`); promoção conjunta em `main` pelo PR #206
  (`d6252f9`).
- **Escopo:** superfícies, textos, campos, estados e revisão lado a lado usam
  somente tokens semânticos; o cartão de perfis da Adaptação deixou de usar
  `fieldset`/`legend`, removendo a sobreposição de título.
- **DEV:** a candidata isolada passou `npm ci`, lint, TypeScript, regressão e
  build. Após a troca atômica, `/login` respondeu `200`,
  `/gerar/35/adaptar` sem sessão respondeu `307`, `prova-tri-dev` ficou online
  e o hash de `.env.local` foi preservado. Rollback em
  `/home/eduardo/prova-tri-dev-rollback-pre-adaptacao-theme-20260724-144313`.
- **Produção:** a candidata isolada passou a mesma bateria. Depois da troca,
  login local e público responderam `200`; `/gerar/35/adaptar` local e público
  sem sessão responderam `307`; `prova-tri` ficou online. Apenas o processo
  web foi reiniciado, mantendo `prova-tri-worker` ativo. Rollback em
  `/home/eduardo/prova-tri-rollback-pre-reforco-adaptacao-theme-20260724-145021`.
- **Limite:** a conferência visual autenticada em tema escuro continua manual;
  validar Reforço ENEM e Adaptação com uma sessão real após limpar o cache.

## Separação Provas × Atividades, 24/07/2026

- **Origens:** PR #208 promoveu a implementação para `develop` (`1add47e`);
  PR #209 promoveu o mesmo conteúdo para `main` (`439befc`).
- **Escopo:** provas e atividades formativas possuem listas, filas, badges e
  notificações distintos. Reforço ENEM não integra indicadores institucionais
  nem o seletor de lançamento de notas do Classroom. A nova rota
  `/atividades` entrou nas duas listas de proteção de autenticação.
- **DEV:** candidato isolado compilou com `npm ci`, lint, TypeScript,
  regressão e build. A troca atômica preservou o hash do `.env.local`; login
  retornou `200` e `/status`, `/atividades`, `/reforco` e APIs internas
  retornaram `307` sem sessão. Rollback:
  `/home/eduardo/prova-tri-dev-rollback-pre-atividades-20260724-2015`.
- **Produção:** candidato isolado repetiu a bateria no commit `439befc`.
  Após a troca atômica, login local e público retornaram `200`; a URL pública
  `/atividades` retornou `307` sem sessão; `prova-tri` ficou online. O hash
  do `.env.local` permaneceu idêntico; não houve migration e
  `prova-tri-worker` não foi reiniciado. Rollback:
  `/home/eduardo/prova-tri-rollback-pre-atividades-20260724-2220`.

## TRI INEP e banco oficial 2024-2025, 26/07/2026

- **Origem:** PR #211 promoveu o feature commit `c8f3f67` para `develop`
  (`6a1cac1`); PR #212 o promoveu para `main` (`05376fc`).
- **Candidato:** diretório isolado, com `npm ci`, 15 testes de scoring,
  TypeScript, lint, extração dos PDFs oficiais e build completo das 41 rotas.
  O hash de `.env.local` foi igual antes e depois (`0808ca09…`); a instalação
  de `pdfplumber` ocorreu somente no ambiente do servidor para a extração.
- **Banco:** backup recuperável anterior em
  `/home/eduardo/backups/prova-tri-before-tri-inep-20260726-095941.dump`
  (1,9 MB). A migration `0019_tri_inep_eligibility.sql` foi aplicada de
  forma aditiva. Foram gravadas 238 questões textuais (2024-2025), 41
  recortes visuais revisados de 2025 e 275 parâmetros 3PL oficiais. Totais
  após o import: 2024 = 122 itens, 121 calibrados; 2025 = 157 itens, 154
  calibrados e 41 com imagem.
- **Corte:** troca atômica do diretório compilado e reinício conjunto dos
  processos `prova-tri` e `prova-tri-worker`; ambos ficaram online. Rollback
  de código em
  `/home/eduardo/prova-tri-rollback-pre-tri-inep-20260726-100143`; o dump
  anterior preserva recuperação de dados se um rollback de banco for
  excepcionalmente necessário.
- **Smoke pós-corte:** `/login` local e público retornaram `200`; sem sessão,
  `/dashboard`, `/atividades`, `/reforco`, `/gerar` e `/desempenho`
  retornaram `307`. O thumbnail de um recorte oficial retornou `200 image/png`.
  A validação visual autenticada da primeira atividade com imagem continua
  manual e deve usar uma questão de 2025 revisada.

## Correção de integridade do texto ENEM no DEV, 26/07/2026

- **Origem:** PR #216 (`daefb41` em `develop`). O extrator anterior separava
  questões depois de ler uma coluna inteira do PDF; em alguns cadernos, isso
  incorporava o rodapé e o começo da questão seguinte na alternativa E.
- **Candidato e corte:** a candidata isolada passou `npm ci`, TypeScript,
  lint e build. Após backup de `prova_tri_dev` em
  `/home/eduardo/backups/prova-tri-dev-before-enem-pdf-sanitize-20260726-172000.dump`,
  houve troca atômica no `:3011`, com rollback em
  `/home/eduardo/prova-tri-dev-rollback-pre-enem-pdf-sanitize-20260726-172000`.
- **Dados:** o reimport preservou os 122 itens de 2024 e os 157 de 2025,
  inclusive os 41 recortes oficiais. A consulta de integridade devolveu zero
  alternativas contendo cabeçalho/rodapé `ENEM` ou `CADERNO`; a opção E da
  questão 3 de 2025 agora termina em “conexão entre o tempo real e o tempo
  imaginário.”
- **Proteção:** itens detectados como visuais só são elegíveis quando já têm
  recorte oficial associado. As atividades geradas antes do reimport mantêm
  seu snapshot antigo e precisam ser geradas de novo para testar a correção.
