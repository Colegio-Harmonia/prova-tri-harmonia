# Criptografia de dados pessoais de aluno

Estado: **código pronto, NÃO ativado**. Preparado em 14/11/2026 para ser
publicado só depois do período de provas (pedido do usuário). Enquanto a chave
`STUDENT_DATA_KEY` não for configurada, o sistema grava e lê em texto puro,
exatamente como antes.

## O que fica cifrado

| Tabela | Colunas cifradas | Índice cego |
| --- | --- | --- |
| `exam_corrections` | `classroom_student_id`, `student_name`, `student_email` | `classroom_student_hash`, `student_name_hash` |
| `activity_classroom_results` | `classroom_student_id`, `student_name`, `student_email` | `classroom_student_hash` |
| `exam_sheet_assignments` | `classroom_student_id`, `student_name_snapshot`, `student_email_snapshot` | `classroom_student_hash` |
| `adapted_exams` | `target_student_label` | — |
| `enem_sae_imports` | `analysis` (JSON inteiro, traz nome por aluno) | — |

Série, turma, disciplina e notas **não** são cifradas, de propósito: sozinhas
não identificam o aluno, e filtros e painéis dependem delas.

## O que protege e o que não protege

- **Protege:** vazamento do banco ou de um backup feito depois da conversão.
  Quem tiver só o banco vê notas e respostas, sem saber de quem são.
- **Não protege:** acesso com login válido (a aplicação decifra para o
  professor; isso é das permissões por perfil).
- **Fora do alcance desta mudança** (continuam com dado legível):
  - backups do banco feitos ANTES da conversão;
  - imagens e PDFs de cartões-resposta e scans, que trazem o nome impresso;
  - o texto das respostas dos alunos (`exam_corrections.answers`), se o aluno
    escrever o próprio nome nele;
  - documentos gerados no Google Drive e o que está no Google Classroom;
  - a tabela `users` (professores e gestão, não alunos).

## Como funciona

- `src/lib/security/fieldCrypto.ts`: AES-256-GCM com IV aleatório por valor;
  valor gravado como `enc:v1:…`. Chave de cifra e chave de índice derivadas de
  `STUDENT_DATA_KEY` por HKDF.
- `src/db/encryptedColumn.ts`: tipos de coluna `encryptedText` e
  `encryptedJson`. Quem usa o Drizzle grava e lê normalmente.
- **Regra para quem mexer no código:** nunca usar `eq`, `inArray` ou `orderBy`
  numa coluna cifrada. Para achar o aluno, `matchesEncrypted(coluna, colunaHash,
  valor)`; para ordenar por nome, `byStudentName` depois de ler
  (`src/lib/security/studentIdentity.ts`). Toda gravação preenche o `*_hash`
  com `hashOrNull`.
- Linhas antigas em texto puro continuam sendo lidas e encontradas; a conversão
  pode ser feita com o sistema no ar.

## A chave

- 32 bytes em base64: `openssl rand -base64 32`.
- Fica em `.env.local` do servidor (`STUDENT_DATA_KEY=…`), nunca no Git nem no
  banco.
- **Perder a chave é perder nomes, e-mails e o vínculo com o Classroom.** Antes
  de converter, guardar uma cópia da chave em local seguro e SEPARADO dos
  backups do banco (um backup do banco junto com a chave não protege nada).
- Sem a chave, o sistema recusa ler dado cifrado (erro explícito), em vez de
  mostrar dado errado.

## Roteiro de ativação (depois do período de provas)

1. **Backup** completo do banco e conferência de que ele restaura.
2. **Estrutura:** aplicar `drizzle/0055_student_data_encryption.sql` com `psql`.
   É aditiva; a versão em produção ignora as colunas novas.
3. **Código:** mesclar o PR e publicar com `npm run deploy:production`. Sem
   chave configurada, nada muda no comportamento.
4. **Chave:** gerar, guardar a cópia de segurança, acrescentar
   `STUDENT_DATA_KEY` ao `.env.local` do servidor e recriar os serviços
   (web e workers) para que todos leiam a chave. A partir daí, o que for
   gravado já sai cifrado.
5. **Ensaio:** `npm run encrypt-student-data` (não grava; mostra quantos valores
   seriam convertidos).
6. **Conversão:** `APPLY=true npm run encrypt-student-data`. Roda numa
   transação; ao fim deve informar `Valores ainda em texto puro: 0`.
7. **Conferir no sistema:** lista de alunos numa correção (nomes e ordem
   alfabética), página de um aluno em Turmas, relatório do aluno em Desempenho,
   emissão de cartão-resposta, resultados de atividade do Classroom e o painel
   do simulado SAE.
8. Rodar o passo 5 de novo alguns dias depois: se a versão anterior do sistema
   tiver gravado algo no intervalo, a conversão pega o resto.

Fazer os passos 4 a 6 em sequência, numa janela sem correção em andamento:
entre configurar a chave e converter, a unicidade "um resultado por aluno" de
linhas antigas depende só da verificação feita pela aplicação.

## Reversão

- **Antes do passo 6:** remover `STUDENT_DATA_KEY` e recriar os serviços só é
  seguro se nada tiver sido gravado cifrado no intervalo; do contrário, manter a
  chave.
- **Depois do passo 6:** não existe "descriptografar" pronto. Voltar ao texto
  puro exige restaurar o backup do passo 1 (perdendo o que foi lançado depois)
  ou escrever um script de reversão com a chave. Por isso o backup e o ensaio.
- A migration tem as instruções de `DROP` no fim do arquivo; elas removem só a
  estrutura nova.

## Pendências conhecidas

- Os índices únicos antigos sobre o texto
  (`activity_classroom_results_exam_student_unique`,
  `exam_sheet_assignments_active_student_unique`) foram mantidos por
  compatibilidade; podem ser removidos numa migration futura, depois da
  conversão.
- Rotação de chave não está implementada (o prefixo `enc:v1:` reserva espaço
  para isso).
- Registro acadêmico não existe no sistema; se entrar, deve nascer como
  `encryptedText` com índice cego.
