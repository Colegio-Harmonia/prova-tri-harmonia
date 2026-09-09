# Processamento de scans

## Fluxo atual

1. A rota `POST /api/exams/:examId/scans` valida o arquivo, arquiva-o no
   storage privado e cria `exam_scan_uploads`.
2. `enqueueLocalScanProcessing` cria as páginas lógicas, uma tentativa em
   `exam_scan_processing_attempts` e um job `processar_scan` em
   `generation_jobs`.
3. O container `worker` consome a fila com `FOR UPDATE SKIP LOCKED`. A
   configuração atual executa **um job por vez** nesse worker, portanto a
   identificação do QR, retificação e leitura OMR são sequenciais.
4. `processLocalScan` baixa apenas o upload daquele job, atualiza cada página
   para `processing`, executa o leitor local PTR1 e persiste imagem canônica,
   QR, associação de folha e leituras OMR.
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

## Identificadores de diagnóstico

O log do processamento local deve conter `examId`, `uploadId`, `attemptId`,
`pageId`, `pageIndex`, modelo e código da exceção. A UI da fila deve mostrar
scan, página, horário de envio e aluno quando conhecido.
