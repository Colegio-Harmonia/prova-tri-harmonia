# Fluxo de Git e Governança de Branches

Este documento define como o repositório `prova-tri` é organizado a partir de
18/07/2026, quando o remoto Git (privado) foi configurado pela primeira vez e
os 130+ commits locais foram preservados via backup. O repositório foi criado
em `eduarsani/prova-tri` e, no mesmo dia, transferido para a organização
`Colegio-Harmonia` — URL atual:
`https://github.com/Colegio-Harmonia/prova-tri.git` (a URL antiga continua
funcionando como redirect do GitHub). A transferência habilitou proteção de
branch real em `main`/`develop` via plano Team da organização (repositórios
privados em conta pessoal exigem GitHub Pro/Team para essa funcionalidade).
Para regras de execução de subtarefas por sessões de IA, `.ai/` continua
sendo a entrada obrigatória (ver `.ai/CLAUDE.md`); este documento é a
referência de Git/branches especificamente.

## 1. Função de cada branch

| Branch | Função |
| --- | --- |
| `main` | Produção estável. Reflete exatamente o que está (ou deveria estar) publicado. |
| `develop` | Integração e homologação. Ponto de encontro de todo trabalho concluído antes de ir para produção. |
| `feature/*` | Uma funcionalidade nova, isolada, criada a partir de `develop`. |
| `fix/*` | Correção não urgente, criada a partir de `develop`. |
| `hotfix/*` | Correção urgente de produção, criada a partir de `main`. |
| `release/*` | Preparação/estabilização de uma versão antes de promover para `main`. |

**Regra permanente:** nenhum desenvolvimento cotidiano ocorre diretamente em
`main`. Nenhuma subtarefa começa diretamente na `main`.

## 2. Convenção de nomes

- `feature/<descrição-curta-kebab-case>` — ex.: `feature/frontend-reconstruction`.
- `fix/<descrição-curta-kebab-case>`.
- `hotfix/<descrição-curta-kebab-case>`.
- `release/vMAJOR.MINOR.PATCH` — ex.: `release/v1.2.0`.
- Sem maiúsculas, sem espaço, sem acento. Descrição curta o suficiente para
  entender o escopo sem abrir a branch.

## 3. Fluxo feature → develop → main

1. Branch nova a partir de `develop`: `git switch -c feature/nome develop`.
2. Commits atômicos dentro da feature, push regular para o remoto.
3. Pull Request de `feature/nome` para `develop`.
4. Validação em ambiente DEV/staging antes do merge.
5. Merge em `develop` (squash ou merge commit, conforme granularidade dos
   commits — nunca rebase de commits já publicados).
6. Quando `develop` estiver estável e aprovado, uma `release/*` (ou PR direto
   de `develop` para `main`, para o estágio atual do projeto, ainda sem
   cadência de release formal) promove para `main`.

## 4. Política de Pull Request

- Toda mudança que chega em `develop` ou `main` passa por Pull Request —
  nunca push direto (ver regra 5).
- PR descreve o que mudou, por quê, e como foi validado (qual ambiente).
- PR de `feature/*`/`fix/*` aponta para `develop`.
- PR de `hotfix/*` aponta para `main` (e depois é replicado em `develop`,
  regra 8).
- PR de `release/*` aponta para `main`.

## 5. Proibição de push direto em `main`

`main` é branch protegida: sem push direto, sem force push, sem exceção
informal. Toda mudança chega via merge de Pull Request aprovado. Regras de
proteção configuradas no GitHub em 18/07/2026 (`enforce_admins`, sem force
push, sem deleção) tanto em `main` quanto em `develop`, validado com um push
direto de teste rejeitado (`GH006: Protected branch update failed`).

## 6. Política de commits atômicos

- Um commit representa uma única intenção verificável (mesma regra já em
  `.ai/GIT_RULES.md`).
- Não misturar mudança visual, mudança de contrato/API/banco e ajuste de
  infraestrutura no mesmo commit.
- Mensagem no imperativo, curta na primeira linha, corpo opcional explicando
  o porquê quando não for óbvio.

## 7. Conventional Commits

Prefixos usados neste projeto (mesmos já adotados em `.ai/GIT_RULES.md` e no
histórico existente):

`feat:`, `fix:`, `refactor:`, `style:`, `docs:`, `test:`, `perf:`, `build:`,
`chore:`.

Exemplo: `feat(dashboard): adiciona filtro por período`.

## 8. Processo de hotfix

1. Branch `hotfix/*` a partir de `main` (nunca de `develop`, que pode estar
   à frente ou atrás de produção).
2. Corrigir o mínimo necessário, com teste/validação.
3. PR direto para `main`; após merge e deploy de produção autorizado, mergear
   a mesma branch (ou cherry-pick do commit) de volta em `develop`, para que
   a correção não se perca na próxima promoção.

## 9. Processo de release

1. Branch `release/*` a partir de `develop`, quando o conteúdo acumulado for
   suficiente/estável para ir a produção.
2. Só correções pontuais na branch de release (sem features novas entrando
   no meio da estabilização).
3. Merge para `main` (gera a versão) e, em seguida, merge de volta para
   `develop` (garante que `develop` não perca nenhuma correção feita durante
   a estabilização).

## 10. Processo de rollback

- Preferir `git revert` do(s) commit(s) problemático(s) em vez de
  `git reset --hard` em branch compartilhada — mantém histórico e não exige
  force push.
- Rollback de **deploy** (aplicação rodando) é independente de rollback de
  **código**: redeploy do commit/tag anterior estável enquanto o revert é
  preparado, se a urgência exigir.
- Cada deploy relevante deve ser identificável por commit/tag, para que o
  rollback tenha um alvo claro (ver checklist de deploy, item 14).

## 11. Relação entre branches e ambientes

| Branch | Ambiente | Observação |
| --- | --- | --- |
| `feature/*`, `fix/*` | `local` (máquina de desenvolvimento) | Sem deploy compartilhado. |
| `develop` | `development` / DEV interno atual | Hoje: servidor `192.168.1.218:3011`, processo PM2 `prova-tri-dev`, banco `prova_tri_dev` — ver `docs/deployment.md`. |
| `release/*` | `staging` | Ambiente de staging formal ainda não existe (pendência — ver `docs/deployment.md`). |
| `main` | `production` | Hoje: servidor `192.168.1.218:3010` (legado temporário) + `prova.colegioharmonia.com.br`. Destino futuro: VPS externa, ainda não definida — ver seção "Infraestrutura: legado atual e destino futuro" abaixo. |

**Regra permanente:** produção nunca é alterada a partir de `feature/*`. Todo
merge em `main` exige validação prévia em DEV. Cada subtarefa deve gerar
commit, push e deploy somente em DEV — deploy de produção exige autorização
expressa do responsável humano.

## 12. Checklist obrigatório antes de push

- [ ] `git status` limpo (nada esquecido sem commitar/stash).
- [ ] Nenhum arquivo `.env*`, credencial, chave privada ou dump de banco
      no commit (`git diff --check`, revisão manual do `git status`).
- [ ] Nenhuma URL de remoto com token embutido (`https://TOKEN@...`).
- [ ] Testes aplicáveis à subtarefa executados localmente.
- [ ] Mensagem de commit segue Conventional Commits (item 7).

## 13. Checklist obrigatório antes de merge

- [ ] PR aberto, com descrição do que mudou e por quê.
- [ ] Validado em DEV (ou ambiente correspondente à branch de destino).
- [ ] Nenhuma mudança de contrato de API, banco ou autenticação sem decisão
      registrada e aprovação humana (mesma regra de `docs/project-rules.md`).
- [ ] Documentação/roadmap atualizados quando a mudança afeta escopo,
      arquitetura ou decisões documentadas.
- [ ] Sem force push envolvido para viabilizar o merge.

## 14. Checklist obrigatório antes de deploy

- [ ] Commit/tag de origem identificado (para permitir rollback, item 10).
- [ ] Ambiente de destino confirmado (`development`/`staging`/`production`)
      e coerente com a branch (item 11).
- [ ] Se produção: autorização expressa do responsável humano obtida.
- [ ] `.env` do ambiente de destino não é sobrescrito pelo `.env` de outro
      ambiente (regra 15).
- [ ] Smoke test pós-deploy planejado (rotas/autenticação críticas).

## 15. Regra de proteção dos arquivos `.env`

- `.env`, `.env.local` e variantes nunca são versionados (confirmado: nunca
  estiveram em nenhum commit do histórico, auditoria de 18/07/2026) nem
  transferidos entre ambientes por sync/rsync — cada ambiente tem sua própria
  configuração, criada localmente nele.
- `rsync` de deploy sempre exclui `.git`, `node_modules`, `.next` e todos os
  arquivos `.env*` (mesma regra já registrada no `CLAUDE.md` raiz, incidente
  real de 15/07/2026 documentado lá).
- Segredos reais (senha de banco, chaves de API) nunca ficam hardcoded em
  código-fonte, nem como valor "default"/fallback — devem vir exclusivamente
  de variável de ambiente. (Achado da auditoria de 18/07/2026 em `scripts/`,
  tratado como subtarefa própria de remediação, não incluído neste commit de
  governança.)

## 16. Regra de nunca incluir tokens em URLs Git

- URL de remoto sempre limpa: `https://github.com/Colegio-Harmonia/prova-tri.git` —
  nunca `https://TOKEN@github.com/...`.
- Autenticação via credential helper (`gh auth login` + `gh auth setup-git`),
  nunca colando token na URL do remoto ou em texto plano em comando de shell
  que fique salvo no histórico.

## 17. Regra de nunca usar force push em branches protegidas

- `main` e `develop` nunca recebem `push --force` ou `push --force-with-lease`.
- Histórico do repositório nunca é reescrito (`rebase` de commits já
  publicados, `filter-repo`, `reset --hard` seguido de push) em branch
  compartilhada.
- Se um erro precisar ser desfeito depois de publicado, usar `git revert`
  (item 10), nunca reescrever o passado.

---

## Infraestrutura: legado atual e destino futuro

A infraestrutura em `192.168.1.218` é **legado temporário**. Está prevista
migração futura da aplicação para uma **VPS externa, ainda não definida**.
Consequências práticas, válidas a partir de 18/07/2026:

- Código-fonte não deve gravar IP, porta, domínio ou caminho de diretório de
  forma hardcoded — tratar host, porta, URL, diretório e nome de banco como
  configuração por ambiente (variável de ambiente), nunca como constante no
  código.
- Ambientes previstos: `local` (máquina de desenvolvimento) → `development`
  (hoje: DEV interno em `192.168.1.218:3011`) → `staging` (ainda não existe)
  → `production` (hoje: `192.168.1.218:3010` + `prova.colegioharmonia.com.br`;
  destino futuro: VPS externa a definir).
- Compatibilidade com o servidor atual deve ser preservada até a migração
  acontecer — nenhuma mudança deste documento ou desta subtarefa altera
  produção, DNS, ou infraestrutura.
- A migração para VPS **não** é executada como parte deste documento nem da
  subtarefa que o criou; é trabalho futuro, a ser planejado e aprovado
  separadamente.

## Pendências desta governança

- Rotação da senha do Postgres (fallback hardcoded removido do código em
  18/07/2026, mas a senha antiga em si ainda não foi trocada no servidor —
  ela ficou exposta no histórico do repositório).
- Revogar tokens do GitHub antigos, não relacionados a este projeto,
  encontrados expostos em texto puro no histórico do shell durante a
  auditoria de 18/07/2026.
- Ambiente `staging` formal ainda não existe — hoje só há `development`
  (DEV interno) e `production` (legado `192.168.1.218`).
- `.ai/GIT_RULES.md` ainda descreve um fluxo anterior (branch única com
  prefixo `codex/`, sem menção a `develop`/proteção de branch) — reconciliar
  com este documento é uma pendência, não resolvida nesta subtarefa para
  não misturar escopo de documentação de governança com mudança de regras
  operacionais de IA.
