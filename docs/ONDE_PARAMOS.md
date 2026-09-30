# Onde paramos — leia isto primeiro

> Documento vivo. **Toda sessão (humana, Claude, Codex/GPT) que terminar um
> bloco de trabalho atualiza a seção "Frentes em andamento" antes de sair.**
> Última atualização: 30/09/2026 (consolidação do repositório).

## 1. Fonte da verdade

| O quê | Onde |
| --- | --- |
| Repositório oficial | `https://github.com/Colegio-Harmonia/prova-tri-harmonia` |
| Branch de produção | `main` |
| Árvore que roda em produção | servidor `192.168.1.218`, `/home/eduardo/prova-tri` (git com `origin` = repositório oficial) |
| Deploy | Docker Compose (`docker compose up -d --build`); a imagem é construída a partir da árvore de trabalho do servidor |
| Banco | container `prova-tri-postgres`; migrations em `drizzle/`, aplicadas à mão (`psql -f`), ver CLAUDE.md |

**Repositório antigo `Colegio-Harmonia/prova-tri`: somente arquivo histórico.**
Não tem histórico em comum com o oficial e parou por volta de agosto/2026
(migration 0029). Não abrir PR nem fazer deploy a partir dele. O trabalho não
commitado que existia no Mac foi preservado no branch
`arquivo/wip-mac-2026-09-30` desse repositório antigo.

## 2. Regras para não perder trabalho de novo

1. **Nada fica rodando em produção sem commit.** Até 30/09/2026 havia 186
   arquivos (inclusive migrations já aplicadas) só na árvore do servidor.
2. Mudou alguma coisa no servidor? Faça commit em branch `feature/*` ou `fix/*`,
   dê push e abra um PR para `main` no mesmo dia.
3. Antes de mexer no servidor, rode `git status --short` e
   `git log --oneline -5`: mais de um agente de IA trabalha nessa árvore.
4. Cópias locais da árvore de produção, como a antiga
   `.prod-reporting-candidate/` no Mac, **não são fonte de verdade**. Se for
   preciso trabalhar localmente, clone o repositório oficial.
5. Migration nova precisa entrar no mesmo commit/PR que o código que depende dela.

## 3. Estado verificado em 30/09/2026

- Branch `feature/consolidacao-producao-2026-09-30`: versiona tudo o que já
  estava em produção (geração, correção/scans, auth, migrations 0033-0045,
  relatórios/planejamento). O PR para `main` precisa ser mergeado.
- Suíte de testes: 71 arquivos / 337 testes passando. `tsc --noEmit` limpo.
- Produção: `prova-tri-web` saudável; migrations 0044 e 0045 aplicadas; 3
  registros em `curriculum_plans`.

## 4. Frentes em andamento

### 4.1 Relatórios pedagógicos + planejamento curricular — EM ANDAMENTO (Codex/GPT, 29-30/09)

Especificação: [`docs/AUDITORIA_RELATORIOS_2026-09-29.md`](AUDITORIA_RELATORIOS_2026-09-29.md)
(achados P0-P2 e plano em 4 etapas).

**Entregue e no ar:**
- Intervenções pedagógicas (ação, responsável, prazo, status) por
  série/disciplina: `drizzle/0044_*`, `src/app/api/analytics/interventions/`,
  bloco em `src/app/(app)/desempenho/DesempenhoPanel.tsx`.
- Planejamento curricular versionado (rascunho → em_revisao → aprovado →
  encerrado): `drizzle/0045_*`, `src/lib/curriculum/planningPolicy.ts`.
- Página `/planejamento` (só coordenação/direção): importação da planilha e
  painel de cobertura BNCC (`src/app/(app)/planejamento/`,
  `src/app/api/curriculum/{plans/import,coverage}`).
- Domínio por habilidade no relatório individual
  (`src/lib/curriculum/studentMastery.ts`, `api/curriculum/student-mastery`).
- P0 da auditoria já tratados no código: perfil identificado por
  `classroomStudentId` (fallback: nome), link do relatório individual levando o
  recorte do painel, validação de correção incompleta
  (`src/lib/corrections/{examCompletion,gradeValidation}.ts`).

**Próximos passos (em ordem):**
1. `/planejamento`: tela de revisão/aprovação das versões e atribuição de
   responsáveis. As tabelas e a política já existem; falta a UI e a API de
   transição.
2. Etapa 1 da auditoria (confiabilidade): conferir os aceites com dados reais
   (2/2 = 100%, homônimos separados, PDF reproduz o recorte, motivo correto
   para ausência de ENEM).
3. Etapa 2 (turma e aluno): filtros para professor, chave segmento+série,
   manter os filtros quando o recorte fica vazio, contagens honestas
   (alunos/questões/respostas).
4. Etapas 3 e 4 (coordenação/escola, ENEM ampliado): ainda não iniciadas.

### 4.2 Branches do repositório antigo com trabalho não mergeado

Consultar antes de reimplementar qualquer coisa. Pode ser que o código já
exista no oficial, que foi copiado da árvore do servidor.

| Branch (repo `prova-tri`) | Assunto |
| --- | --- |
| `codex/ai-governance` | governança de IA |
| `codex/enem-text-integrity` | integridade de texto ENEM |
| `codex/security-first5` | correções de segurança |
| `codex/fase-8-transparencia` | transparência de IA |
| `codex/batch-all-scan-transcriptions` | transcrição de scans em lote |
| `claude/prova-tri-enem-filters-1b1c86`, `claude/peaceful-austin-3a95f4` | filtros/rótulos ENEM no reforço |
| `hotfix/question-image-proxy` | proxy de imagem de questão |
| `arquivo/wip-mac-2026-09-30` | snapshot do WIP do Mac (21/09 + auditoria) |

## 5. Como atualizar este documento

Ao terminar uma sessão: mova o que ficou pronto para "Entregue", atualize
"Próximos passos", ajuste a data no topo e faça commit junto com o código.
