# Cartão-resposta - emissão QR/PDF

**Status:** emissão por turma disponível na tela de revisão para provas
`aprovado` ou `impresso`. A primeira validação visual em DEV ainda é necessária
antes da emissão com uma turma real em produção.

## Fluxo na interface

No painel **Folhas de resposta** da revisão, o professor:

1. conecta a conta Google, se necessário;
2. vincula a turma do Google Classroom;
3. escolhe **Preparar fichas da turma**, que congela o roster naquele momento;
4. escolhe **Baixar fichas em ZIP** e imprime os PDFs em escala de 100%.

O snapshot também cria as correções vazias necessárias para cada aluno. Depois
da emissão, uma folha não é recriada silenciosamente: uma reimpressão deve ser
um fluxo explícito, para preservar a trilha do QR emitido.

## Fluxo técnico

Depois de congelar o roster, a aplicação chama:

```text
POST /api/exams/:examId/sheet-assignments/emit
```

O corpo pode ser `{}` para emitir todas as atribuições `pronta`, ou conter
`{ "assignmentIds": [12, 13] }` para um subconjunto. A resposta é um ZIP
privado, sem cache, com um PDF por aluno. Os nomes internos usam apenas o
identificador aleatório (`folha-<publicId>.pdf`), nunca nome ou e-mail.

A rota exige a mesma autorização de correção e aceita somente a prova
`aprovado` ou `impresso`. Ao concluir a montagem do ZIP, cada atribuição passa
de `pronta` para `emitida` e recebe o digest SHA-256 do conjunto de QR.
Ela não reemite folhas já emitidas: reimpressão terá rota própria, que anula a
emissão anterior e cria novo `publicId` e novo QR auditável.

## Contrato do QR

Cada página contém um token independente:

```text
PTR1.<publicId>.<numeroPagina>.<layoutVersion>.<keyId>.<hmac-base64url>
```

O token não leva nome, e-mail, ID sequencial da correção, gabarito ou nota. A
assinatura é HMAC-SHA256 sobre a versão, identificador público, página, layout
e `keyId`. Qualquer alteração do token é rejeitável no leitor futuro; o banco
guarda apenas o digest do conjunto emitido, não os tokens legíveis.

Configure no ambiente do servidor, nunca no repositório, browser, PDF de
exemplo, logs ou n8n:

```text
SHEET_QR_SIGNING_KEYS="jul-2026=<segredo-base64url-com-pelo-menos-32-bytes>"
```

Para rotação, a primeira chave assina novas folhas e as demais permanecem
apenas para validar folhas já impressas:

```text
SHEET_QR_SIGNING_KEYS="jul-2026=<chave-atual>,jan-2026=<chave-anterior>"
```

`keyId` aceita letras, números, `_` e `-`; a chave é base64url e tem no mínimo
32 bytes depois de decodificada. Sem configuração válida, a rota responde
`503 sheet_qr_not_configured` sem tentar emitir uma folha.

## Layout PTR1

O PDF é A4 fixo, com logo institucional, quatro marcadores, QR de 27 mm e uma
identificação textual do aluno para conferência humana. Cada QR é gerado
novamente para sua página; a página objetiva aceita até 15 questões com quatro
ou cinco alternativas e cada página discursiva contém até três áreas.

O gerador rejeita uma prova fora desses limites, em vez de improvisar uma
geometria que o leitor OMR não reconheça. A identificação impressa é só para
conferência; a associação técnica é sempre o QR assinado.

## Validação local realizada

- testes de assinatura: token válido, alteração de caractere rejeitada,
  digest sem token legível e chave curta rejeitada;
- teste do PDF: duas páginas carregadas novamente por `pdf-lib`;
- exemplo fictício: [cartao-resposta-emissao-exemplo.pdf](/Users/earsani/Desktop/prova-tri/output/pdf/cartao-resposta-emissao-exemplo.pdf),
  renderizado a 150 dpi e inspecionado visualmente;
- os dois QR renderizados foram decodificados no macOS Vision, cada um com sua
  página (`1` e `2`) e assinatura diferente.

O script [generate-scan-sheet-emission-sample.ts](/Users/earsani/Desktop/prova-tri/scripts/generate-scan-sheet-emission-sample.ts)
gera somente o artefato fictício acima. Sua chave é determinística de teste e
não serve para configuração real.

## Limites do piloto PTR1

O ZIP contém somente as folhas de resposta. A correção automática cobre a
parte objetiva; respostas discursivas ainda exigem conferência humana e não
recebem nota automática por OCR/HTR nesta etapa.
