# Matriz da Avaliação Pedagógica

## Escopo

Antes da geração, o professor consulta o planejamento escolar já existente e, para uma disciplina, define quais capítulos entram na avaliação, a quantidade de questões por capítulo, a prioridade e a regra de recurso visual. A matriz é gravada no payload do job e no payload da prova; não altera tabela, cartão-resposta, gabarito, exportação ou processamento de scans.

## Regras

- A matriz só aceita `rowIndex` de capítulos retornados pelo planejamento selecionado (série, disciplina e bimestre).
- A soma de questões da matriz deve ser igual à quantidade de itens gerados por IA.
- A prioridade orienta geração e substituições, mas a quantidade é a composição obrigatória.
- `auto` analisa o conteúdo: Geometria, gráficos, tabelas, mapas e diagramas exigem recurso visual; `obrigatorio` sempre exige; `sem_imagem` proíbe.
- Se uma questão exige imagem, a prova não é salva sem que o recurso seja obtido e validado. A imagem fica no conteúdo da questão, isolada das áreas de marcação do cartão-resposta.

## Pipeline robusto de geração

Quando há matriz, a composição não é delegada a uma única resposta de IA. O sistema calcula primeiro os slots finais (capítulo, número, tipo objetivo/discursivo e regra visual), gera cada item no contexto exclusivo do seu capítulo e valida cada resposta antes de montar a prova. Assim, a IA não pode alterar a quantidade por conteúdo nem a proporção 60/40 da prova final.

## Compatibilidade

O recurso é aditivo e opcional. Provas e jobs antigos, sem `contentPlan`, continuam usando o recorte curricular anterior. A estrutura dos itens, alternativas, gabarito, numeração, exportação e leitura por scanner não é modificada.
## Montagem e validação global

Quando a prova usa matriz pedagógica, a geração não confia apenas na qualidade isolada de cada item. O motor cria candidatos extras nos pontos de maior risco de repetição, monta a melhor combinação por similaridade textual, valida as quotas determinísticas da matriz e faz uma auditoria editorial da prova completa. A auditoria apenas aponta números de questões problemáticas; o motor regenera somente esses itens uma vez, usando um contexto compacto dos demais. Imagens são criadas depois da seleção final. Esse processo não modifica o formato persistido de `questions`, gabarito, documentos ou scanner.
