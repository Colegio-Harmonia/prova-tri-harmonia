# Conferência visual privada do cartão-resposta

**Estado:** implementado no código; requer aplicar a migration `0024` e configurar o worker antes de uso real.

Esta etapa fecha a trilha de evidência da leitura: toda sugestão do worker pode ser confrontada com a página normalizada e, quando houver, com o recorte que originou a resposta. Ela **não aprova respostas, não altera `exam_corrections` e não calcula nota**.

## Armazenamento e acesso

- O original continua no Drive privado do scan.
- A página normalizada e cada recorte entram por endpoint interno HMAC, são guardados brevemente no staging privado (`0600`) e depois arquivados na mesma raiz privada do Drive.
- O arquivo no Drive recebe somente nomes opacos e `appProperties` operacionais; não ganha permissão pública nem URL de preview.
- A cópia é baixada novamente e tem SHA-256 conferido antes de o registro ser marcado como arquivado. Em falha, a cópia recém-criada é excluída e o staging é preservado para retry.
- O professor só recebe os bytes pelas rotas autenticadas do ProvaTRI, com `Cache-Control: private, no-store`. Cada abertura gera auditoria sem guardar imagem, texto manuscrito ou URL.

## Contrato adicional do n8n/worker

O despacho `PTR1_SCAN_DISPATCH_V1` passa a incluir:

```json
{ "pages": [{ "id": 481, "pageIndex": 1 }] }
```

O `id` é opaco e serve para anexar o derivado. O webhook não leva imagem, QR, aluno ou texto manuscrito.

Depois de baixar o original por `contentPath`, o worker pode enviar somente PNG/JPEG para:

```text
PUT /api/internal/scan-pages/:pageId/canonical?attemptId=:attemptId
PUT /api/internal/scan-readings/:readingId/crop?attemptId=:attemptId
```

Os pedidos assinam os **bytes exatos** usando os cabeçalhos HMAC já definidos:

```text
X-ProvaTri-Timestamp: unix-seconds
X-ProvaTri-Signature: base64url(HMAC-SHA256)
```

O hash canônico usa `METHOD + "\n" + PATH_AND_QUERY + "\n" + TIMESTAMP + "\n" + SHA256(bytes)`. O `Content-Type` deve ser `image/png` ou `image/jpeg`; o servidor não confia nele e valida magic bytes/decodificação.

O recorte só pode ser enviado após o callback de resultados ter criado a leitura e só se a leitura pertencer à página e à tentativa informadas. Por isso o workflow deve executar nesta ordem:

1. Baixar e normalizar o arquivo.
2. Enviar o callback estruturado de resultado.
3. Ler `readingRefs` no retorno do callback e enviar os recortes com o `id` correspondente.

O callback retorna `readingRefs` com `id`, `pageId`, `pageIndex` e `questionNumber`. São identificadores internos opacos, sem Drive ID, URL, QR, aluno ou transcrição.

## Tela docente

`/gerar/:examId/corrigir/scans` lista somente páginas com exceção (`needs_review`), mostra a página normalizada e os recortes disponíveis, sem expor IDs do Drive ao navegador. Acesso usa a mesma autorização da correção da prova.

## Próxima microtarefa

Adicionar decisão explícita do professor por leitura (aceitar/rejeitar/editar), persistir a proveniência e só então copiar a resposta confirmada para a correção formal. Para questões discursivas, a sugestão de nota deverá continuar separada da transcrição e da decisão humana.
