# Cartão-resposta - fila privada do n8n

**Status:** despacho DEV autenticado e contrato de entrada no n8n validados em
27/07/2026. A normalização física de páginas, OMR/HTR, callback e a tela visual
com recortes ainda são próximas microtarefas.

## Despacho manual e idempotência

Depois que um upload estiver `archived`, o professor autorizado pode chamar:

```text
POST /api/exams/:examId/scans/:uploadId/dispatch
```

O Prova-TRI baixa o original privado apenas para contar as páginas de um PDF
(imagem é uma página), registra `exam_scan_pages` e cria uma
`exam_scan_processing_attempts` monotônica. Em seguida, envia ao webhook do
n8n apenas:

```json
{
  "schemaVersion": "PTR1_SCAN_DISPATCH_V1",
  "attemptId": 17,
  "uploadId": 42,
  "examId": 31,
  "sha256": "...",
  "pageCount": 12,
  "contentPath": "/api/internal/scan-uploads/42/content?attemptId=17"
}
```

Não seguem no webhook imagem, URL pública, QR, nome, e-mail, transcrição ou
nota. Falha de webhook vira `delivery_failed`; as páginas retornam a `pending`
e um novo despacho cria uma tentativa nova, sem duplicar os índices de página.

## Acesso do n8n ao original

O n8n busca `contentPath` no host interno do Prova-TRI. O endpoint aceita
somente `GET`, uma tentativa `queued`/`delivered` correspondente ao upload e
HMAC com validade de cinco minutos. Ele entrega o stream vindo do Drive sem
criar URL de preview e registra `n8n_content_opened` na auditoria.

O acesso futuro do n8n ao conteúdo original e o callback de resultado usam o
formato HMAC abaixo:

```text
canonical = METHOD + "\n" + PATH_E_QUERY + "\n" + UNIX_SECONDS + "\n" + SHA256(CORPO_UTF8)
assinatura = base64url(HMAC-SHA256(N8N_SCAN_SHARED_SECRET, canonical))
```

Cabeçalhos:

```text
X-ProvaTri-Timestamp: <unix-seconds>
X-ProvaTri-Signature: <hmac-base64url>
```

Para buscar conteúdo, o corpo é vazio e `PATH_E_QUERY` precisa incluir
`?attemptId=...` exatamente como recebido. Alterar um caractere da query,
corpo, método ou timestamp invalida a assinatura.

## Configuração necessária

No Prova-TRI DEV:

```text
N8N_SCAN_WEBHOOK_URL=https://n8n.interno/webhook/prova-tri-scan
N8N_SCAN_SHARED_SECRET=<segredo-base64url-de-ao-menos-32-bytes>
N8N_SCAN_WEBHOOK_TOKEN=<token-aleatorio-com-no-minimo-32-caracteres>
```

O webhook de despacho usa a autenticação nativa **Header Auth** do n8n: o
`X-ProvaTri-Webhook-Token` é comparado antes de qualquer nó do workflow e fica
em uma credencial criptografada do n8n, não em variável comum, código ou
histórico de execução. O HMAC continua reservado às chamadas n8n → Prova-TRI,
nas quais o executor do Code node não precisa ler segredo algum.

O workflow deve desativar o salvamento de dados de execução com scans e não
registrar cabeçalhos, QR, transcrição ou corpo do arquivo nos nós de erro.

O `N8N_SCAN_SHARED_SECRET` é distinto de `SHEET_QR_SIGNING_KEYS`: um autentica
comunicação entre servidores; o outro assina as folhas impressas. Nenhum deles
vai para browser, Drive, PDF, histórico de execução ou logs.

## Dados e limites desta etapa

Migration `0022` adiciona:

- `exam_scan_pages`: páginas lógicas por upload, estado e exceção futura;
- `exam_scan_processing_attempts`: tentativas ordenadas de entrega ao n8n.

O Prova-TRI cataloga a contagem antes do despacho. O worker retorna resultado
estruturado por callback HMAC, validado contra QR, layout e emissão original;
as sugestões ficam separadas da correção final. Conversão em páginas canônicas
e recortes privados continuam pendentes. Nenhuma nota é aceita nessa callback.

## Validação local

Os testes locais cobrem assinatura HMAC válida, alteração de corpo/query,
expiração e presença do token nativo. Em DEV, o webhook respondeu `200` para
um despacho sintético autenticado e `403` para o mesmo corpo sem token. Ainda
falta o teste visual de um upload real, o download por `contentPath`, zero URL
pública e a confirmação de que o n8n não retém bytes antes de conectar OMR/HTR.

## Rascunho criado no n8n

Em 27/07/2026 foi criado, pela API do n8n, o workflow
`ProvaTRI - Scanner privado (DEV)`, ID `6mBp79m6jvfzxQlj`. Ele está **ativo**
e contém o gatilho `POST /webhook/prova-tri-scan`, protegido pela credencial
Header Auth, seguido da validação estrita do contrato `PTR1_SCAN_DISPATCH_V1`.
Ele ainda não baixa o scan, não executa OMR/HTR, não tem credencial do Drive e
não faz callback: esta ativação valida somente a entrada segura na fila.
