# Decisão docente sobre leitura escaneada

**Estado:** implementado no código; exige a migration `0025` após a `0024`.

## Regra de negócio

Uma leitura tem sempre três níveis separados:

1. **Sugestão do worker:** letra ou transcrição extraída do scan.
2. **Decisão humana:** aceita ou rejeitada, com valor confirmado e usuário/data da decisão.
3. **Correção formal:** recebe somente a resposta aceita e identificada por QR/folha.

O professor pode confirmar a sugestão ou editá-la no momento do aceite. A sugestão original nunca é apagada. Ao rejeitar uma resposta antes aceita, a correção formal é desfeita somente se ela ainda contém exatamente o valor confirmado por esta leitura; uma alteração manual posterior não é apagada.

Para objetiva, o aceite recalcula o acerto e a nota daquele item (0/10), mas **não** marca a correção como revisada nem dispara a consolidação da prova. Para discursiva, o aceite copia exclusivamente a transcrição: nota e feedback permanecem nulos até a etapa específica de conferência pedagógica.

## Uso visual em DEV

Depois de aplicar `0024` e `0025`, com uma prova aplicada e um scan cujo worker já tenha retornado pelo menos uma página `needs_review`:

1. Abra `/gerar/:examId/corrigir` e expanda o aluno. A evidência de cada questão discursiva aparece na própria correção, sem exigir troca de tela.
2. Em **Ler com OCR**, o servidor recorta somente a área manuscrita PTR1, arquiva o recorte no Drive privado e pede uma transcrição sugerida ao modelo de leitura configurado.
3. Confira a imagem, a transcrição e a confiança. Em **Confirmar ou editar transcrição**, ajuste o texto se necessário; o status muda para `accepted` e só então o texto é copiado à correção formal.
4. Em **Sugerir notas (IA)**, a aplicação usa exclusivamente a transcrição já confirmada. A nota continua sendo sugestão e precisa de decisão explícita do professor.
5. A tela `/gerar/:examId/corrigir/scans` continua disponível para importação, diagnóstico do processamento e páginas com exceção.

Sem página normalizada, a tela também é testável: exibe o aviso de que o worker ainda não enviou o artefato. Isso não expõe o original ou o Drive.

## Limites desta etapa

- Não há aprovação automática por OCR/IA. OCR só cria uma transcrição sugerida e nunca escreve a nota final.
- Não há nota discursiva automática ou final.
- Páginas com QR inválido permanecem sem vínculo com uma correção formal.
- A página continua na fila de exceção até a futura regra explícita de encerramento de página/lote.
