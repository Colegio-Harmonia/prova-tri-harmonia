# Cartão-resposta - retorno do worker e exceções

**Status:** callback estruturada e fila de exceções implementadas. O worker
privado em `services/scan-worker` normaliza a primeira versão do cartão PTR1,
decodifica o QR, lê respostas objetivas e envia página/recortes privados para
conferência. A ativação exige publicar o serviço no servidor n8n e incluir a
etapa HTTP do workflow; até essa ativação o webhook apenas recebe o despacho.

## Callback autenticada

O n8n chama:

```text
POST /api/internal/scan-attempts/:attemptId/result
```

Usa o mesmo HMAC da entrega do arquivo, agora assinado sobre o corpo JSON
exato. O body é estrito: não aceita imagem, base64, URL, campo extra ou nota.
Exemplo reduzido:

```json
{
  "uploadSha256": "<sha256-do-upload>",
  "pages": [
    {
      "pageIndex": 1,
      "qrToken": "PTR1.<token-da-pagina>",
      "pageType": "objective",
      "qualityScore": 0.97,
      "readings": [
        {
          "questionNumber": 1,
          "kind": "objective",
          "suggestedLetter": "B",
          "confidence": 0.96
        }
      ]
    }
  ]
}
```

Para cada página, o Prova-TRI:

1. confirma HMAC, tentativa e SHA-256 do upload;
2. valida assinatura do QR e confere se ela corresponde a uma folha `emitida`;
3. confere número e tipo de página contra o layout da prova;
4. confere que as questões retornadas são exatamente as previstas naquela
   página;
5. grava sugestões em `exam_scan_readings`, nunca em `exam_corrections.answers`.

QR ausente/inválido, folha anulada, página de tipo errado, qualidade abaixo de
0,65, questão inesperada ou leitura faltante tornam a página `needs_review`.
Resultado repetido não duplica leitura e nunca sobrescreve uma decisão docente
que já esteja `accepted` ou `rejected`.

## Fila docente

```text
GET /api/exams/:examId/scan-review-queue
```

A rota exige a mesma autorização de correção e devolve página, aluno quando o
QR foi validado, código de exceção e sugestões. Ela não devolve URL pública de
Drive nem dados de staging. A interface visual deve consumir esta fila depois
que o worker armazenar páginas canônicas privadas, pois mostrar a página bruta
inteira agora contrariaria a separação de origem/recorte definida no piloto.

## Dados persistidos

Migration `0023` adiciona vínculo de página com folha e QR digest, qualidade e
tipo de página em `exam_scan_pages`, além de `exam_scan_readings`. Cada leitura
guarda letra ou transcrição sugerida, confiança, referência do modelo e estado
de revisão; não guarda imagem.

## Testes realizados

- body com campo de imagem/URL é rejeitado;
- índice de página ou questão repetida é rejeitado;
- letra em leitura discursiva é rejeitada;
- o worker não tem como enviar nota final neste contrato.

## Worker PTR1 objetivo

O worker é um container independente do n8n. Ele recebe somente identificadores
opacos, estrutura do layout (número da questão e quantidade de alternativas) e
o caminho interno do conteúdo. Ele usa o HMAC já configurado para baixar o
arquivo e enviar o resultado, página normalizada e recortes. Não grava arquivos
localmente, não recebe texto da questão, gabarito ou dados do aluno no
despacho.

O despacho HTTP precisa aguardar até 120 segundos: antes de responder, o worker
grava o resultado estruturado e arquiva de modo privado a página normalizada e
os recortes usados na conferência. Um timeout menor pode registrar uma tentativa
como falha mesmo quando a leitura já foi recebida.

A leitura inicial cobre JPG/PNG/PDF de uma página com quatro marcadores PTR1,
QR decodificável e até 15 questões objetivas. Cada página gerada pelo scanner
deve ser enviada como um arquivo próprio: o worker escolhe o layout pelo número
assinado no QR, não pela ordem de upload. Duas bolhas, bolha vazia, QR ou
marcador ausente retornam exceção e exigem conferência docente. Discursivas e
OCR/HTR continuam fora deste recorte.

Para ativar, configurar no servidor do worker `PROVATRI_INTERNAL_BASE_URL`,
`N8N_SCAN_SHARED_SECRET` e `SCAN_WORKER_TOKEN`; no n8n, usar uma credencial de
cabeçalho privada para chamar `http://provatri_scan_worker:8000/jobs`. A URL
nunca deve ser publicada pelo proxy.
