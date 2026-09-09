# Correção Escaneada — Descoberta 0.1 a 0.6

**Status:** descoberta concluída em 27/07/2026. As migrations e as etapas de
roster, emissão QR/PDF e ingestão privada começaram em entregas posteriores;
este documento preserva o contrato e as decisões de escopo originais.

**Objetivo:** permitir que uma prova formal tenha folhas físicas individuais,
seja digitalizada e chegue à tela de correção atual como leitura sugerida,
nunca como nota definitiva sem conferência docente.

## Contexto e decisão de escopo

O sistema já corrige uma prova por aluno em `exam_corrections`: objetiva é
comparada deterministicamente ao gabarito e discursiva recebe sugestão de nota
editável. A captura ainda é manual. Esta descoberta acrescenta a ponte entre o
papel e esse fluxo, sem substituir a confirmação do professor.

O plano antigo menciona n8n, OMR e OCR, mas o próprio repositório registra que
ele não foi reconciliado com a correção manual via Classroom. A escola agora
confirmou que já dispõe de n8n e o escolheu como orquestrador do piloto. A
reconciliação passa a ser requisito explícito: o scan preenche a mesma
correção que hoje pode ser preenchida manualmente, sem criar um segundo fluxo
de notas.

O n8n não executa a leitura óptica por conta própria. Ele observa/recebe o
arquivo, separa o trabalho em etapas, chama os serviços de QR, OMR e HTR,
envia o resultado ao endpoint interno idempotente do Prova-TRI e notifica a
fila de exceções. A escolha e validação dos serviços de OMR/HTR continuam
posteriores à validação física do layout.

### Decisões operacionais confirmadas em 27/07/2026

1. O scan entra pelo servidor do Prova-TRI, associado explicitamente à prova
   na tela de importação. O disco do servidor é apenas área privada de staging:
   valida tamanho/tipo, calcula hash, separa páginas e permite o primeiro
   processamento, mas não é o arquivo durável da folha.
2. Depois da importação válida, o original é arquivado em pasta privada da
   prova no Google Drive. O banco guarda o `driveFileId`, hash, data e versão;
   nunca uma URL pública. Original, página normalizada e recortes são objetos
   distintos e rastreáveis, não revisões implícitas de um único arquivo.
3. A sincronização com o Google Classroom é a fonte da lista de alunos para
   emissão. O professor conecta a conta, vincula a turma, confere o roster e
   gera uma folha por aluno presente naquele snapshot.
4. A lista é congelada no momento da emissão. Entrada, saída ou mudança de
   nome no Classroom depois disso não altera uma folha já impressa; novo aluno
   recebe emissão adicional e reimpressão gera token novo, ambos auditáveis.

### 0.1 — Escopo proposto para o piloto

O piloto cobre uma única prova do tipo `prova`, uma única turma já vinculada
ao Google Classroom e folhas emitidas depois de o professor confirmar o
snapshot do roster. Ele usa o limite
atual de até 15 questões e aceita:

- um cartão-resposta A4 por aluno, com até 15 questões objetivas e quatro ou
  cinco alternativas por questão;
- até duas páginas A4 discursivas por aluno, com área delimitada e numerada
  para cada questão;
- scan feito por equipamento da escola, não por foto de celular;
- revisão humana de toda leitura ambígua e de toda nota discursiva.

Ficam fora do piloto: reconhecimento de rasura livre, redação longa sem área
delimitada, duas provas no mesmo cartão, anexos fora do A4, leitura offline e
lançamento automático de nota no Classroom.

**Critério de aceite de 0.1:** a escola confirma que o piloto pode usar uma
turma, A4, até 15 questões e scanner institucional. Caso algum desses limites
não sirva, o layout precisa ser refeito antes da emissão de qualquer folha.

## 0.2 — Contrato do QR

Cada página carrega seu próprio QR. A primeira página não identifica as demais
sozinha: isso evita que uma folha discursiva seja associada ao aluno errado
quando páginas forem separadas no scanner.

O conteúdo é um token opaco e assinado, conceitualmente:

```text
PTR1.<identificador-publico-aleatorio>.<pagina>.<versao-layout>.<assinatura>
```

Regras obrigatórias:

- não contém nome, e-mail, matrícula, `examCorrectionId` sequencial, gabarito
  nem nota;
- o identificador é aleatório, único e verificável no servidor; a assinatura
  HMAC usa segredo exclusivamente do servidor e admite rotação de chave;
- o servidor guarda somente o digest do token de emissão e o estado da folha;
- reimpressão gera uma nova emissão vinculada à anterior; a leitura de uma
  folha anulada ou de versão de layout desconhecida vai para exceção;
- QR válido apenas identifica a página. Ele não autoriza upload, leitura nem
  acesso à imagem.

**Critério de aceite de 0.2:** dois QR de folhas/páginas distintas nunca têm o
mesmo token; uma alteração de um caractere, uma assinatura inválida ou uma
página de outra prova é rejeitada sem alterar respostas.

## 0.3 — Especificação visual inicial

O cartão e as páginas discursivas serão PDFs A4 de geometria fixa, não Google
Docs. Google Docs continua sendo a fonte dos documentos pedagógicos atuais,
mas seu reflow impede coordenadas confiáveis para leitura óptica.

Todos os layouts terão:

- margem livre mínima de 12 mm;
- quatro marcadores pretos quadrados, um em cada canto útil, reservados para
  correção de perspectiva e controle de corte;
- QR de pelo menos 22 mm, com zona silenciosa, repetido em cada página;
- texto de versão do layout e número legível da página;
- bolhas circulares de alto contraste, com rótulo da questão e letra, espaço
  entre colunas e instrução para preencher completamente com caneta escura;
- zona exclusiva para cada resposta discursiva, identificada pelo número da
  questão, sem invadir QR ou marcadores.

O nome pode aparecer apenas como conferência visual no cartão, em tamanho
discreto. A identificação funcional é o QR. Não serão impressos e-mail ou
matrícula completos por padrão.

Uma página com bolhas precisa aceitar apenas uma marca inequívoca por questão.
Marca vazia, dupla, muito fraca, fora da bolha ou próxima do limiar cria uma
exceção revisável; não recebe letra presumida.

**Critério de aceite de 0.3:** um PDF de teste mantém QR, marcadores e bolhas
nas mesmas coordenadas depois de imprimir e digitalizar, inclusive com pequena
inclinação da página.

## 0.4 — Regras de impressão e digitalização

O piloto aceita PDF multipágina, PNG ou JPEG produzidos pelo scanner. HEIC e
fotos de celular não entram na primeira validação, pois variam iluminação,
foco e geometria. Cada página será separada e processada individualmente.

Requisitos mínimos propostos:

| Item | Regra do piloto |
| --- | --- |
| Papel | A4 branco, sem redução, ampliação ou corte |
| Impressão | 100% de escala; preto e branco ou escala de cinza de alto contraste |
| Preenchimento | caneta preta ou azul escura; não usar lápis no piloto |
| Scan | 300 dpi, escala de cinza ou cor, sem compressão agressiva |
| Arquivo | PDF, PNG ou JPEG; até o limite que será definido na implementação do upload |
| Frente e verso | permitido apenas se cada lado tiver QR e marcadores próprios |

O processador deve distinguir: QR ausente/ilegível, página cortada, marcadores
ausentes, baixa resolução, versão desconhecida, folha anulada, marca ambígua,
marca múltipla e área discursiva sem conteúdo legível. Cada caso cria motivo
explicável para reprocessar, revisar ou solicitar novo scan.

**Critério de aceite de 0.4:** a equipe consegue produzir uma amostra de scans
conformes e uma amostra de cada exceção acima sem usar dados reais de aluno.

## 0.5 — Desenho de dados proposto

`exam_corrections.answers` permanece a fonte de verdade da correção aprovada.
Uma leitura do scanner nunca grava diretamente nela como resultado final. As
tabelas abaixo são aditivas e ainda não existem.

| Entidade proposta | Finalidade e campos mínimos |
| --- | --- |
| `exam_sheet_assignments` | emissão individual antes da aplicação: `exam_id`, `exam_correction_id`, `classroom_student_id`, snapshot de nome, identificador público, digest do token, versão do layout, total de páginas, estado, emissão, anulação e reimpressão |
| `exam_scan_uploads` | arquivo recebido: referência temporária privada no servidor, hash SHA-256, tipo, tamanho, quantidade de páginas, autor, data, estado de processamento e referência ao arquivo arquivado no Drive |
| `exam_scan_pages` | página separada: upload, índice, atribuição obtida pelo QR, tipo de página, resultado do QR, qualidade, transformação geométrica e referência privada ao original/canônico |
| `exam_scan_readings` | leitura por questão: página, número, tipo, letra ou transcrição sugerida, confiança, referência ao recorte, modelo/versão quando houver IA, estado de revisão e decisão do professor |
| `exam_scan_audit_events` | eventos de emissão, upload, leitura, reprocessamento, aprovação, rejeição, acesso e expurgo, sem duplicar a imagem ou texto bruto |

Para emitir folha antes da aplicação, a atribuição deve ser criada antes do
estado `aplicado`. Isso exige separar a criação da identidade de correção do
ato de concluir a correção. A transição para `revisado` e a pontuação existente
continuam ocorrendo somente após aprovação docente.

O fluxo de interface proposto é:

```text
Vincular turma -> importar e conferir roster -> congelar snapshot ->
emitir lote de folhas -> aplicar -> importar scan para a prova ->
arquivar original no Drive privado -> enfileirar n8n -> revisar exceções
```

`classroomStudentId` já existente em `exam_corrections` é a identidade estável
de integração. Nome e e-mail são somente snapshot exibível, não chave do QR
nem critério de casamento. A emissão exigirá uma rota pré-aplicação própria;
a importação atual de correções, restrita a provas aplicadas, não é suficiente.

A implementação deverá preservar compatibilidade com o JSONB histórico de
`exam_corrections.answers`; migrações são aditivas e as leituras de scan serão
copiadas para esse JSONB apenas quando aprovadas.

O endpoint interno consumido pelo n8n deve ser autenticado, idempotente por
`upload + página + tentativa`, limitar o payload à referência privada do
arquivo e ao resultado estruturado, e nunca aceitar uma nota final. Falha ou
repetição no workflow só pode gerar novo evento de processamento, não duplicar
resposta aprovada.

**Critério de aceite de 0.5:** o modelo permite rastrear qual página originou
cada letra/transcrição, manter o original para conferência e reimprimir uma
folha sem aceitar silenciosamente uma versão anulada.

## 0.6 — Privacidade, acesso e retenção

Scans contêm letra manuscrita e, possivelmente, identificação do aluno. São
dados sensíveis ao contexto escolar e não podem usar o fluxo atual de imagens
de questão, que cria permissão pública de leitura no Drive para prévias.

Regras propostas:

- armazenar arquivo e recortes em pasta privada, sem link público e sem URL de
  preview persistida no banco; a aplicação entrega o arquivo por rota
  autenticada e autorizada;
- apagar a cópia de staging no servidor após confirmar o arquivamento no Drive
  e a integridade pelo hash; se for necessária uma janela de reprocessamento,
  ela deve ter prazo operacional curto e expurgo automático configurado;
- aplicar a mesma autorização de correção: professor atribuído, coordenação e
  direção; nunca aluno ou usuário apenas autenticado sem acesso à prova;
- registrar acesso, download, aprovação, reprocessamento e expurgo com usuário
  e data, sem registrar imagem ou transcrição completa na telemetria de IA;
- configurar as credenciais do n8n como segredos e impedir que execuções,
  alertas ou logs do workflow retenham URL pública, imagem, QR ou transcrição;
- enviar à IA somente o recorte da resposta, nunca a página inteira com nome
  ou QR, e somente depois de confirmar base legal, contrato do provedor e
  política institucional aplicável;
- manter a transcrição confirmada no fluxo pedagógico existente; a imagem bruta
  deve ter prazo de retenção e expurgo configuráveis, aprovados pela escola;
- bloquear a exclusão automática enquanto houver revisão, contestação ou
  obrigação institucional ativa; após o prazo, apagar original, canônico e
  recortes de forma verificável.

**Decisão pendente da escola:** prazo de retenção dos scans após o fechamento
da nota e responsável formal por autorizar acesso excepcional. A recomendação
inicial é definir uma janela curta, alinhada ao período de revisão/recursos,
antes de qualquer upload real.

**Critério de aceite de 0.6:** nenhum scan pode ser aberto sem sessão e
autorização; nenhum QR ou log de IA expõe dados pessoais; o ciclo de retenção
tem responsável, prazo e evidência de expurgo definidos antes do piloto real.

## Saídas desta fase e próximos bloqueios

As subtarefas 0.1–0.6 produzem contrato, limites e critérios; elas não provam
que um scanner específico funciona nem escolhem biblioteca/serviço de OMR ou
HTR. A próxima subtarefa é 1.1, gerar um PDF com dados fictícios para validar
fisicamente o layout. Ela só deve iniciar após aprovação dos limites do piloto
e da decisão de retenção.
