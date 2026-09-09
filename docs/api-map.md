# Mapa de APIs e Contratos Preservados

**Fonte:** handlers em `src/app/api`, inventariados em 18/07/2026.
**Regra:** este mapa descreve a superfície que o novo front-end deve consumir; não é autorização para alterá-la.

## Convenções comuns

- Rotas protegidas retornam `401` sem sessão; as rotas com privilégio retornam `403` para papel insuficiente.
- Entradas de comando são validadas com Zod nas rotas que recebem corpo.
- Falhas de validação usam `400`; recurso ausente, `404`; conflito ou transição inválida, `409`; integrações/IA indisponíveis usam `5xx` conforme o handler.
- Professor fica restrito às próprias provas/turmas; coordenação e direção compartilham visão de superusuário.

## Autenticação, usuários e turma

| Método | Rota | Consumidor atual | Contrato/limite |
| --- | --- | --- | --- |
| Auth | `/api/auth/[...nextauth]` | login e sessão | Auth.js, credenciais e Google institucional |
| GET | `/api/users` | desempenho | lista usuários ativos; `?all=1` exige superusuário |
| POST | `/api/users` | usuários | cria conta institucional; superusuário |
| PATCH | `/api/users/[id]` | usuários | altera cargo/ativo; preserva trava anti-lockout |
| GET | `/api/classroom/courses` | turmas | lista cursos Google; distingue reautorização e conexão ausente |

## Currículo e banco ENEM

| Método | Rota | Consumidor atual | Contrato/limite |
| --- | --- | --- | --- |
| POST | `/api/curriculum/preview` | gerar | segmento, ano, disciplina e bimestre; retorna seleção curricular ou erro de aba |
| GET | `/api/enem-bank/search` | gerar | exige `area`; aceita filtros de ano, Bloom, habilidade, eixo e limite |
| GET | `/api/enem-bank/skills` | gerar | opções de habilidade por área |

## Provas e revisão

| Método | Rota | Consumidor atual | Contrato/limite |
| --- | --- | --- | --- |
| GET | `/api/exams` | dashboard, status, turmas | lista paginada/filtrada; restringe professor no servidor |
| GET | `/api/exams/filters` | status | valores possíveis de filtros |
| POST | `/api/exams/generate` | gerar | gera e persiste prova com IA; retorna `examId`, prova, avisos e metadados pedagógicos |
| GET | `/api/exams/[examId]` | revisão | detalhe de prova; exige `authorizeExamAccess` |
| POST | `/api/exams/[examId]/status` | revisão | ações de transição de status; valida estado e papel no servidor |
| POST | `/api/exams/[examId]/review-note` | revisão | persiste observações de revisão |
| POST | `/api/exams/[examId]/regenerate` | revisão | regenera a prova preservando regras existentes |
| POST | `/api/exams/[examId]/regenerate-question` | revisão | regenera somente questão gerada por IA |
| POST | `/api/exams/[examId]/toggle-image` | revisão | habilita/desabilita imagem de questão |
| POST | `/api/exams/[examId]/request-image` | revisão | busca/gera imagem por fallback controlado |
| POST | `/api/exams/[examId]/import-image` | revisão | importa imagem por URL com validações de segurança |
| POST | `/api/exams/[examId]/link-course` | turmas/correção | vincula prova a curso Classroom |

## Correções e lançamento de nota

| Método | Rota | Consumidor atual | Contrato/limite |
| --- | --- | --- | --- |
| GET | `/api/exams/[examId]/corrections` | correção, turma | lista correções autorizadas |
| POST | `/api/exams/[examId]/corrections` | correção | cria registro de aluno; só após prova aplicada |
| POST | `/api/exams/[examId]/corrections/import` | turma | importa roster do Classroom para a prova vinculada |
| PATCH | `/api/exams/[examId]/corrections/[correctionId]` | correção | atualiza respostas e revisão |
| DELETE | `/api/exams/[examId]/corrections/[correctionId]` | correção | remove correção autorizada |
| POST | `/api/exams/[examId]/corrections/[correctionId]/suggest` | correção | sugestão IA para resposta discursiva; não decide nota automaticamente |
| POST | `/api/exams/[examId]/return-grades` | turma | cria/reutiliza atividade e lança notas; requer confirmação da UI |

## Indicadores e motor pedagógico

| Método | Rota | Consumidor atual | Contrato/limite |
| --- | --- | --- | --- |
| GET | `/api/stats/dashboard` | dashboard gestão | resumo de provas e distribuição |
| GET | `/api/stats/enem` | dashboard gestão | estatísticas do banco ENEM |
| GET | `/api/analytics/performance` | desempenho | agregados por nota, Bloom, DOK, BNCC, INEP e SOLO; filtra por papel |
| GET, POST | `/api/pedagogical/classifications` | motor/admin futuro | consulta e cria classificação |
| GET | `/api/pedagogical/classifications/review-queue` | motor/admin futuro | fila de revisão |
| POST | `/api/pedagogical/classifications/[classificationId]/review` | motor/admin futuro | inicia/atualiza revisão |
| POST | `/api/pedagogical/classifications/[classificationId]/approve` | motor/admin futuro | aprova classificação |
| POST | `/api/pedagogical/classifications/[classificationId]/reject` | motor/admin futuro | rejeita classificação |
| POST | `/api/pedagogical/classifications/[classificationId]/supersede` | motor/admin futuro | substitui mantendo histórico |
| GET | `/api/pedagogical/classifications/[classificationId]/history` | motor/admin futuro | trilha de auditoria |
| POST | `/api/pedagogical/classifications/outdated` | motor/admin futuro | marca desatualizadas |

## Regras de compatibilidade para a nova UI

1. Criar tipos de borda para respostas, mas não renomear campos do servidor no transporte.
2. Centralizar erro HTTP em adaptadores por feature, preservando `error`, `issues`, `availableTabs` e demais campos já consumidos.
3. Invalidar/refazer leitura após comandos bem-sucedidos; não assumir que o estado local substitui o estado final do servidor.
4. Tratar explicitamente `401`, `403`, `409`, `422` e `5xx` com mensagens e ações diferentes.
