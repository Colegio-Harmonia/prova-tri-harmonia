# Processamento de scans

## Fluxo atual

1. A rota `POST /api/exams/:examId/scans` valida o arquivo, arquiva-o no
   storage privado e cria `exam_scan_uploads`.
2. `enqueueLocalScanProcessing` cria as páginas lógicas, uma tentativa em
   `exam_scan_processing_attempts` e **um job `processar_scan` por página** em
   `generation_jobs`.
3. O serviço `scan-worker` consome exclusivamente `processar_scan` com
   `FOR UPDATE SKIP LOCKED`. A configuração possui **duas réplicas**: elas
   leem provas diferentes em paralelo e evitam pegar duas folhas da mesma
   prova enquanto houver outras provas aguardando. O container `worker` fica
   reservado para geração, adaptação e pontuação.
4. `processLocalScan` baixa o upload e trabalha somente na página do job.
   JPEG/PNG passam ao leitor em um intermediário PNG sem perdas; PDFs são
   rasterizados em PNG a 300 DPI. O leitor local PTR1 tenta o QR no original,
   retifica somente marcadores geometricamente válidos e grava a JPEG canônica
   já orientada. Jobs antigos sem `pageId` continuam compatíveis.
5. Para páginas discursivas identificadas, são criados jobs
   `transcrever_scan`.
6. O serviço `ocr-worker` possui **duas réplicas** no Docker Compose. Elas
   também usam `FOR UPDATE SKIP LOCKED`; por isso duas transcrições podem rodar
   em paralelo, sem duas réplicas tomarem a mesma leitura.

## Falhas e retries

- Cada job tem `max_attempts = 2` por padrão.
- Ao falhar, volta para `pendente` enquanto ainda houver tentativa; depois
  passa a `erro`, com a mensagem preservada em `generation_jobs.error_message`.
- Na subida e a cada cinco minutos, os workers recuperam jobs em `gerando`
  há mais de 15 minutos: reenfileiram quando ainda há tentativa ou marcam erro
  definitivo.
- Erros por página são persistidos em `exam_scan_pages.exception_code`; eles
  não devem tornar desconhecido qual upload, página ou aluno está em revisão.
- `POST /api/exams/:examId/scans/:uploadId/retry` reenfileira apenas páginas
  que não foram concluídas, usando a mesma imagem arquivada. O backend recusa
  duplicidade enquanto já existir job ativo para o envio.
- O leitor PTR1 v5 usa ZXing-C++ 3.1.1 com formato restrito a QR, leitura do
  original antes de qualquer warp, marcadores restritos ao canto esperado,
  validação do quadrilátero, retificação somente quando a geometria é válida,
  recortes controlados, ampliação somente do recorte do QR, binarização local,
  fallback limitado do OpenCV e suporte às quatro orientações. Cada leitura
  tem orçamento rígido de 4,5 s; heurísticas internas de rotação/escala do
  ZXing ficam desligadas porque o pipeline controla essas tentativas.
  Resultados com erro de checksum nunca são aceitos como token.
  Falha técnica vira revisão explícita; nunca é convertida silenciosamente em
  resposta válida.
- A associação só aceita um candidato cuja assinatura corresponda a uma folha
  emitida da prova atual. Texto parcial ou token de outra prova não pode criar
  associação automática.
- A página canônica é substituída quando o pipeline muda ou produz uma imagem
  diferente. Leituras pendentes criadas antes de o QR ser identificado são
  reconciliadas e não podem permanecer ligadas à página errada.
- O mesmo upload não é reprocessado indefinidamente com a mesma versão do
  pipeline. Uma nova tentativa exige mudança de versão, arquivo ou regra de
  processamento.
- Quando o QR é localizado mas não confirmado, a página recebe um diagnóstico
  específico (`QR_CHECKSUM_FAILED`). Quando nenhuma leitura é encontrada, usa
  `QR_NOT_FOUND`. O arquivo original continua arquivado para conferência.
- Uma página com QR/marcadores inválidos não recebe qualidade máxima e a tela
  de conferência prioriza o upload original em vez de uma canônica suspeita.
- Workers renovam um heartbeat a cada 20 segundos durante trabalhos longos;
  um job saudável não é reenfileirado apenas por demorar mais que o esperado.

## Identificadores de diagnóstico

O log do processamento local deve conter `examId`, `uploadId`, `attemptId`,
`pageId`, `pageIndex`, modelo, versão do pipeline, motor do QR, orientação,
quantidade de tentativas, duração e código da exceção. A UI da fila deve
mostrar scan, página, horário de envio e aluno quando conhecido.

Para diagnosticar o primeiro estágio em produção:

```bash
docker compose ps scan-worker
docker compose logs --tail=100 scan-worker
```
