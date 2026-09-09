# OCR de respostas discursivas

## Objetivo do piloto

O OCR/HTR reduz a digitação do professor, mas não corrige uma resposta sozinho.
Ele só pode ser disparado a partir da correção do aluno e retorna uma
**transcrição sugerida** acompanhada do recorte privado que a originou.

## Fluxo

```text
scan normalizado no worker -> página canônica privada no Drive ->
recorte da área PTR1 da questão -> OCR/HTR -> sugestão + confiança ->
professor confere/edita no aluno -> transcrição formal -> sugestão de nota ->
professor define nota final
```

Os dois últimos passos são separados: uma sugestão de nota nunca é enviada ao
modelo antes de o professor confirmar a transcrição.

## Privacidade e auditoria

- Não há URL do Drive, QR ou identificação do aluno no pedido ao provedor.
- O provedor recebe só o recorte da resposta manuscrita, em memória.
- A página canônica e o recorte ficam em armazenamento privado; o navegador os
  acessa apenas pelas rotas autenticadas do Prova-TRI.
- A operação é registrada como `scans/transcribe-discursive`, sem armazenar o
  texto da resposta na telemetria de IA.
- Aceite, edição e rejeição continuam registrados em `exam_scan_readings` e
  `exam_scan_audit_events`.

## Configuração

Em **Operações de IA**, a gestão escolhe o perfil **Leitura de respostas**.
Neste piloto, os adaptadores visuais suportados são Gemini e Anthropic. Sem uma
chave do provedor no ambiente, o botão retorna um aviso de configuração e não
altera a correção.

O fallback local usa `GEMINI_SCAN_TRANSCRIPTION_MODEL` (por padrão,
`gemini-3.5-flash-lite`), separado de `GEMINI_VISION_MODEL` para que a troca
de um serviço não interrompa o outro. O uso conta no orçamento diário de
operações de IA. Na tela de correção, o professor pode
pedir a leitura de todas as respostas discursivas pendentes da folha: o sistema
as processa sequencialmente, sempre pelo número da questão previsto no layout
PTR1 (por exemplo, a resposta da 11 vai apenas para a 11).

As alternativas objetivas usam o mesmo princípio. A leitura OMR é apresentada
na questão correspondente e pode ser aplicada em lote somente por ação
explícita do professor. Isso copia A–E para a correção formal e recalcula o
acerto daquela questão, mantendo o registro de revisão.

Quando há sugestão de OCR, ela aparece diretamente no campo de resposta da
questão correspondente como rascunho. O texto não é salvo como resposta formal
até que o professor clique em **Confirmar e usar na correção**. O recorte da
resposta é mostrado junto à questão; a página completa fica recolhida para
consulta, evitando a repetição da mesma imagem em várias questões.

## Limites conhecidos

- OCR manuscrito é uma sugestão e pode errar, sobretudo em cursiva ou imagens
  mal orientadas; confiança não equivale a certeza pedagógica.
- O recorte é calculado para o layout `PTR1` e pressupõe que o worker tenha
  normalizado corretamente a orientação da página.
- A leitura em lote não atribui notas, não conclui a correção e não confirma
  respostas por conta própria.
