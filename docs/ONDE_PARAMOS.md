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
- CI `Quality` (lint, typecheck, vitest com cobertura, regressão, build e
  orçamento de bundle): verde. Foi preciso atualizar 2 contratos de teste
  desatualizados (TD-015) e migrar cores fixas para tokens em 5 telas.
- Dívida aberta nova: **TD-018**, orçamento de bundle excedido em 3 rotas,
  com limites elevados temporariamente (ver `docs/tech-debt.md`).
- **Ainda não publicado no container:** os commits `ce58b21` (aria-label na
  resposta discursiva) e `46833f0` (cores → tokens em 5 telas) estão no git,
  mas a imagem `prova-tri:local` em execução é anterior. Entram no próximo
  `docker compose up -d --build`; são mudanças só visuais/acessibilidade.
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

- Conferência das descrições com o Jev (TypeSafe) na prévia de
  `/planejamento`: para cada habilidade com descrição na planilha, pergunta ao
  Jev se o texto corresponde à habilidade oficial do código e marca
  "Confere", "Conferir" ou "Não confere". Não bloqueia a importação.
  Código em `src/lib/curriculum/skillDescriptionCheck.ts`, rota
  `POST /api/curriculum/plans/preview`. **Requer `TYPESAFE_API_KEY` no
  `.env.local` de produção**; sem ela, a tela avisa que a conferência está
  indisponível.
- Pendente de aplicar: preenchimento das 45 habilidades já salvas sem
  descrição (SQL gerado em 30/09/2026, aguardando execução manual).
- **Bloco 4 — domínio individual das habilidades** (branch
  `feature/bloco-4-dominio-individual`, 30/09/2026). API
  `GET /api/curriculum/student-mastery` (mesmo endereço, contrato novo):
  - aproveitamento por habilidade = pontos obtidos ÷ pontos possíveis,
    com peso da questão e nota parcial das discursivas;
  - por habilidade: `itemCount` (questões distintas) e `assessmentCount`
    (provas distintas);
  - níveis `sem_evidencia`, `evidencia_insuficiente`, `em_desenvolvimento`,
    `proximo_do_dominio`, `dominio`; regras em `MASTERY_RULES`
    (`src/lib/curriculum/studentMastery.ts`): menos de 3 itens =
    evidência insuficiente; domínio exige ≥ 80%, ≥ 4 itens e ≥ 2 avaliações,
    senão fica "próximo do domínio" com `limitedBySample: true`;
  - `consolidated.bySubjectBimester` e `consolidated.bySubject`.
  - Relatório individual (`/desempenho/relatorio`) atualizado para os
    níveis novos e a tabela consolidada.
  - **Falta validar com dados reais** em DEV/produção (pesos distintos,
    questão com dois códigos, correção parcial).

- **Validação do Bloco 4 com dados reais (30/09/2026, só leitura):** 1.786
  correções, 322 alunos, 14.563 respostas com BNCC, 0 linhas inválidas.
  ⚠️ **Decisão pendente:** só 9 de 8.795 habilidades por bimestre chegam a
  "domínio", porque a regra exige 2 avaliações *no mesmo bimestre* e em
  geral há uma prova por disciplina/bimestre (780 ficam "próximo do
  domínio — limitado pela amostra"). Na visão anual do Bloco 5 a regra fica
  alcançável. Opções: manter; exigir 2 avaliações só na visão anual; ou
  aceitar 1 avaliação com ≥ 6 itens no bimestre.
- **Bloco 5 — gráficos no relatório individual** (branch
  `feature/bloco-5-graficos-relatorio`): teia geral por disciplina, meta de
  100% tracejada, teia por habilidade, marcadores por formato (círculo
  cheio = dominada, triângulo = em desenvolvimento, círculo vazado = não
  avaliada, tracejado = preliminar), evidências (itens/avaliações) ao lado,
  filtro ano/bimestre, mapa de calor habilidade × bimestre para teias com
  mais de 12 eixos ou visão anual, interpretação textual e impressão com
  todas as disciplinas. SVG próprio, sem biblioteca, carregado sob demanda
  (`MasterySection`/`MasteryCharts`). Corrigido: o botão "Imprimir / Salvar
  em PDF" do relatório individual gerava página em branco (regra global de
  impressão só liberava o relatório SAE; agora `.print-report` também).

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
