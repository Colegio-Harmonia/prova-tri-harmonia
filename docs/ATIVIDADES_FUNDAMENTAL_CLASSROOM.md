# Atividades para Fundamental I e II com Google Classroom

## Objetivo e escopo

`/atividades` passou a ser o criador de atividades formativas para `anos-iniciais` (2º–5º) e `anos-finais` (6º–9º). Ele não substitui `Provas` nem `Reforço ENEM`:

- **Provas** continuam com aplicação/correção própria e fluxo formal.
- **Reforço ENEM** continua exclusivo do Ensino Médio e das habilidades INEP.
- **Atividades** usam o currículo da série, exigem ao menos uma habilidade BNCC e são corrigidas no Google Classroom.

## Fluxo docente

1. Em **Atividades → Criar atividade**, selecionar segmento, série, disciplina, recorte opcional de bimestre, habilidades BNCC e, se desejar, a turma do Classroom.
2. A geração roda na fila `gerar_atividade`; o professor acompanha em **Acompanhar atividades** e revisa o rascunho normalmente.
3. A aprovação gera Atividade, Gabarito da atividade e Mapa da atividade.
4. Em revisão, criar o rascunho no Classroom. Para uma atividade BNCC o ProvaTRI cria um Google **Quiz** com as questões, o anexa à atividade em **rascunho** para todos os alunos e distribui **100 pontos** entre as questões. A professora responsável recebe acesso de edição ao Formulário, revisa os pesos nele e define categoria, prazo e agendamento no Classroom. Na primeira publicação após esta mudança, quem publica precisa reconectar a conta Google para autorizar esse compartilhamento.
5. As objetivas têm gabarito e são corrigidas automaticamente pelo Quiz. As discursivas permanecem para correção docente. A consolidação das respostas discursivas e o lançamento automático da nota final no Classroom são uma etapa posterior; uma atividade com Form anexado como link não permite importar notas do Forms diretamente pelo Classroom.

## Formulário e análise pedagógica

As habilidades BNCC selecionadas definem o recorte de geração e são incluídas na descrição da atividade publicada. Questões objetivas viram alternativas únicas com chave de resposta e pontuação; questões descritivas viram campos de resposta longa com pontuação reservada para correção docente. O total do Quiz é sempre 100, sem estimativa automática por habilidade.

O ProvaTRI registra as habilidades BNCC selecionadas no payload da atividade e na sua descrição. **Não envia o código BNCC como Learning Goal nativo do Classroom.** A API de Learning Goals exige um GUID CASE/Satchel Rosetta Exchange verificado; não há mapeamento oficial BNCC→CASE cadastrado nesta entrega.

## Requisitos do Google

- O projeto OAuth precisa ter a **Google Forms API** habilitada.
- A conta deve ser reconectada ao Google para conceder o escopo `forms.body`; se a API retornar `reauth_required`, use o botão de reconexão.
- A publicação não cria rubrica automaticamente.
- Se a publicação falhar, a interface informa a etapa e somente os identificadores seguros da resposta do Google.
- Antes de publicar, o ProvaTRI confirma que a conta conectada é professora da turma.

## Dados e migration

Aplicar `drizzle/0028_activities_fundamental_classroom.sql` e `drizzle/0029_activity_classroom_form.sql` antes de publicar o código. Elas criam:

- `activity_classroom_syncs`: vínculo com turma, coursework, formulário e histórico da última importação. O campo `rubric_id` permanece apenas para atividades legadas já publicadas com rubrica.
- `activity_classroom_results`: resultado por aluno, incluindo nota e, em registros legados, os níveis de rubrica retornados pelo Classroom.

Rollback de dados: não excluir resultados para "desfazer" uma importação. A importação seguinte atualiza o mesmo aluno pelo par `(exam_id, classroom_student_id)` e preserva a rastreabilidade temporal com `imported_at`/`updated_at`.
