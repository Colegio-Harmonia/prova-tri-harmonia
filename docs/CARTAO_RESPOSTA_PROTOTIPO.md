# Cartão-Resposta — Protótipo 1.1

## Propósito

Este PDF é um artefato físico de teste da descoberta de correção escaneada.
Ele não integra banco, QR assinado, Drive, n8n, OMR ou HTR. Usa dados
fictícios e QR demonstrativo para validar a geometria antes de qualquer fluxo
com aluno real.

## Conteúdo

- página 1: cartão A4 com 15 questões objetivas, cinco alternativas, QR e
  quatro marcadores de canto;
- página 2: folha discursiva com três áreas delimitadas, QR próprio e os
  mesmos marcadores;
- identificação fictícia e nenhum dado de aluno real.

## Gerar

Use o Python empacotado para esta área de trabalho:

```bash
/Users/earsani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/generate-scan-card-prototype.py
```

O arquivo é criado em `output/pdf/cartao-resposta-piloto-omr-v2-logo.pdf`.
O PDF anterior, sem logo, foi preservado somente como evidência do primeiro
scan físico.

## Evidência da primeira leitura física

Em 27/07/2026, as duas páginas foram impressas, preenchidas e digitalizadas
em JPEG A4 de 2480 × 3508 px a 300 dpi. Os arquivos brutos não foram copiados
para o repositório.

- os dois QR foram decodificados com o payload PTR1 esperado;
- a página objetiva estava na orientação correta; a página discursiva chegou
  invertida em 180°, confirmando que o pipeline precisa normalizar orientação
  por QR antes da leitura;
- os quatro marcadores foram encontrados mesmo com escala desigual e pequena
  inclinação introduzidas pelo conjunto impressão + scanner;
- após retificação pelos marcadores, as 15 bolhas preenchidas na página
  objetiva foram lidas com uma separação de intensidade entre 112,5 e 145,3
  para a segunda alternativa mais escura do respectivo item.

O verificador técnico está em
`scripts/analyze-scan-card-prototype.py`. Ele é específico do layout PTR1 e
serve para validar a geometria; ainda não é o serviço de produção, não recebe
upload e não grava resposta em banco.

## Versão com logo

A emissão seguinte usa o ícone institucional em `public/brand/harmonia-icon.png`
no cabeçalho, sem invadir QR, marcadores ou a área de bolhas. A renderização e
os QR das duas páginas da versão com logo foram novamente verificados.

## Checklist da validação física 1.2

1. Imprimir em A4 com escala de 100%, sem opção “ajustar à página”.
2. Preencher bolhas de teste, incluindo uma vazia e uma dupla.
3. Escrever uma resposta curta em cada área discursiva.
4. Digitalizar a 300 dpi e preservar QR e os quatro marcadores.
5. Entregar os scans ao time técnico. Nenhuma leitura é considerada válida
   antes de comparar QR, geometria e marcações com a folha física.

## Limites conhecidos

- O token do QR é apenas visual/demonstrativo; não identifica prova ou aluno.
- As questões 10–12 da segunda página são apenas referências de layout.
- O PDF é estático e não substitui os documentos Google Docs da prova atual.
