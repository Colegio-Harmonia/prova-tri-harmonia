# Implementação — Planejamento e geração de ilustrações

## Objetivo

Toda questão deve decidir, **antes de o enunciado ser escrito**, se um recurso visual é necessário para que o aluno responda corretamente ou para tornar a avaliação pedagogicamente adequada.

Quando precisar de imagem, o sistema deve:

1. identificar o tipo exato de recurso;
2. reunir apenas os dados verificáveis necessários;
3. escolher automaticamente a melhor forma de criar esse recurso;
4. criar e validar a imagem antes de permitir que a questão dependa dela;
5. substituir ou reescrever a questão caso o visual obrigatório não possa ser entregue.

O objetivo não é colocar imagens em todas as questões. É garantir que toda imagem necessária exista, seja correta e seja útil para aquela questão.

---

## Novo estágio: planejamento visual

### Posição no fluxo

O estágio visual deve entrar depois da definição da fonte de verdade da questão e antes da criação de alternativas e enunciado.

```text
Estágio 0  → estratégia de verdade e domínio/regra/fonte
Estágio 1  → dados, cálculo ou evidência verificável
Estágio V  → planejamento visual  ← novo estágio obrigatório
Estágio 2  → alternativas
Estágio 3  → enunciado
Estágio 4  → metadados pedagógicos
Estágio 5  → auditoria final
Renderização → criação e validação do recurso visual
```

O estágio V recebe somente fatos já validados: valores de cálculo, equações, coordenadas, evidências, trecho curricular e tipo de questão. Ele não pode inventar dados.

### Contrato de saída

```ts
type VisualPlan = {
  required: boolean
  purpose:
    | 'nenhum'
    | 'interpretar_dados'
    | 'representar_relacao'
    | 'localizar_elemento'
    | 'comparar_elementos'
    | 'identificar_estrutura'
    | 'analisar_documento'
    | 'apoiar_contexto'

  visualType:
    | 'none'
    | 'blank_coordinate_plane'
    | 'coordinate_plane'
    | 'function_graph'
    | 'statistical_chart'
    | 'geometric_diagram'
    | 'chemical_structure'
    | 'map'
    | 'timeline'
    | 'flowchart'
    | 'phylogeny'
    | 'historical_document'
    | 'illustration'

  // Dados que podem ser desenhados e conferidos por código.
  data?: Record<string, unknown>

  // Explicação curta, armazenada para revisão e auditoria.
  rationale: string
}
```

Exemplos:

```json
{
  "required": true,
  "purpose": "representar_relacao",
  "visualType": "function_graph",
  "data": { "expression": "2*x + 1", "domain": [-5, 5] },
  "rationale": "A leitura do crescimento da função faz parte da habilidade avaliada."
}
```

```json
{
  "required": true,
  "purpose": "representar_relacao",
  "visualType": "blank_coordinate_plane",
  "data": { "axisRange": 10 },
  "rationale": "O aluno deve representar a reta; mostrar a solução entregaria a resposta."
}
```

```json
{
  "required": false,
  "purpose": "nenhum",
  "visualType": "none",
  "rationale": "O enunciado contém todos os dados necessários e a imagem não é parte da habilidade avaliada."
}
```

---

## Regra central: IA sugere; código decide como renderizar

A IA pode identificar a necessidade pedagógica e preencher o plano visual estruturado. Ela não escolhe diretamente uma biblioteca, site ou modelo de imagem.

O roteador do sistema lê `visualType` e os dados validados, então escolhe o produtor da imagem.

| Tipo de visual | Produtor escolhido pelo sistema | Condição |
|---|---|---|
| Plano cartesiano vazio | SVG próprio / JSXGraph | Sempre determinístico |
| Pontos, segmentos, retas e sistemas | JSXGraph | Coordenadas ou equações completas |
| Gráfico de função | JSXGraph ou renderer de função | Expressão e domínio válidos |
| Gráfico estatístico | Chart.js / QuickChart | Rótulos e valores numéricos válidos |
| Diagrama geométrico | JSXGraph ou SVG próprio | Medidas, ângulos e relações suficientes |
| Estrutura química | RDKit | SMILES válido |
| Mapa temático | GeoJSON + biblioteca de mapas | GeoJSON ou recorte geográfico autorizado |
| Linha do tempo e fluxograma | SVG/Mermaid | Eventos e relações estruturados |
| Cladograma | Renderer filogenético | Newick ou estrutura taxonômica válida |
| Documento, foto, obra ou paisagem real | Fonte licenciada pesquisada | Fonte e licença verificáveis |
| Ilustração conceitual sem dados determinísticos | IA geradora de imagem | Brief visual específico e validável |

O GeoGebra não é necessário para a produção de imagens estáticas da prova. Ele só deve ser reconsiderado se houver uma atividade em que o aluno precise manipular objetos matemáticos na tela.

---

## Regras de decisão

### Quando uma ilustração é obrigatória

O plano deve marcar `required: true` quando:

- a habilidade mede leitura ou construção de gráfico, mapa, diagrama, estrutura ou documento visual;
- o enunciado precisa referenciar explicitamente uma figura;
- a relação avaliada é visual e perde sentido quando descrita somente em texto;
- a matriz da prova marcou recurso visual como obrigatório.

### Quando uma ilustração não deve ser usada

O plano deve marcar `required: false` quando:

- a imagem só enfeita a página e não altera a resolução;
- todos os dados necessários já estão no enunciado;
- o visual mostraria a resposta que o aluno deveria produzir;
- não existem dados suficientes para desenhar o recurso sem inventar informação.

### Regra contra inconsistência

O enunciado não pode conter frases como “observe o gráfico”, “na figura”, “no mapa” ou “na imagem abaixo” se `required` for falso ou se a imagem ainda não tiver sido produzida e validada.

---

## Gates de validação do novo estágio

### Gate V1 — coerência do plano

- `required: false` exige `visualType: none`.
- `required: true` proíbe `visualType: none`.
- `purpose` precisa ser compatível com o tipo de visual.
- Nenhum dado do plano pode contrariar o objeto de verdade da questão.

### Gate V2 — dados renderizáveis

- Plano cartesiano: eixos, pontos e coordenadas numéricos e dentro de limites seguros.
- Função: expressão permitida e domínio numérico válido.
- Gráfico estatístico: listas de rótulos e valores com mesmo tamanho.
- Química: SMILES validado pelo RDKit.
- Mapa: GeoJSON válido e sem dependência de URL externa não autorizada.
- Documento/foto: fonte e licença disponíveis.

### Gate V3 — disponibilidade

O renderizador deve devolver uma imagem válida antes de a questão poder mencionar o visual.

### Gate V4 — validação da imagem

- Imagem abre e possui tamanho mínimo apropriado para documento e tela.
- Diagramas determinísticos são comparados com os dados de origem.
- Imagens por IA passam por validação visual: legibilidade, ausência de texto inventado e aderência ao brief.
- Recursos visuais ainda aguardam aprovação humana na revisão, mas não podem estar ausentes quando forem obrigatórios.

---

## Comportamento diante de falha

| Situação | Ação automática |
|---|---|
| Dados do plano visual incompletos | Reparo do estágio V com a mensagem exata do campo faltante |
| Visual determinístico não renderiza | Revalidar dados; se necessário, refazer somente a questão |
| Imagem por IA é rejeitada | Nova tentativa com brief corrigido; depois substituição da questão |
| Recurso visual obrigatório indisponível | Reescrever ou substituir a questão para não depender de imagem |
| Recurso visual opcional indisponível | Gerar a questão sem imagem e registrar aviso interno |

Uma prova não pode ser concluída com uma questão que depende de uma ilustração ausente.

---

## Mudanças no prompt

O prompt do estágio V deve instruir:

> Decida se o aluno precisa de um recurso visual para responder corretamente ou para demonstrar a habilidade avaliada. Não use imagem decorativa. Quando a imagem for necessária, escolha um tipo da lista e informe somente dados presentes no objeto de verdade ou no material curricular. Nunca invente coordenadas, valores, estruturas químicas, eventos, mapas ou documentos. Se a questão exigir que o aluno construa um gráfico, escolha um plano vazio; nunca desenhe a resposta.

O prompt do estágio de enunciado deve receber o plano já validado e obedecer a estas regras:

> Se o plano visual for obrigatório, escreva a referência à figura de forma neutra, como “No gráfico apresentado”. Não descreva a solução. Se não houver plano visual validado, não mencione gráfico, imagem, figura, mapa ou diagrama.

---

## Alterações técnicas previstas

1. Criar `VisualPlan` e incluí-lo no contexto e no resultado da questão.
2. Criar o estágio V no orquestrador, entre os estágios 1 e 2.
3. Criar `gateVisualPlan` para validar a coerência e os dados renderizáveis.
4. Criar um roteador `renderVisualPlan(plan)` que seleciona o renderer por regras de código.
5. Substituir a decisão tardia de `needsImage/imageQuery` por dados derivados do `VisualPlan`.
6. Ajustar `attachImagesToExam` para renderizar visuais obrigatórios antes da auditoria final.
7. Atualizar a validação do enunciado para impedir referências visuais sem imagem validada.
8. Salvar no banco o plano visual, a origem da imagem, os dados usados e a versão do renderer.
9. Exibir na revisão: tipo do visual, dados de origem, motivo pedagógico, imagem e ação “regenerar visual”.

---

## Plano de entrega

### Fase 1 — fundação

- Criar tipos, schemas e gates do `VisualPlan`.
- Cobrir plano cartesiano vazio, pontos/retas, gráfico de função, gráfico estatístico e estrutura química.
- Garantir que referências no enunciado dependam de um plano válido.

### Fase 2 — integração da geração

- Inserir o estágio V no pipeline.
- Fazer o enunciado consumir o plano visual pronto.
- Produzir e validar imagens obrigatórias antes de concluir a questão.

### Fase 3 — ampliação por disciplina

- Geografia e História: mapas e documentos históricos licenciados.
- Biologia: cladogramas, ciclos e diagramas estruturais.
- Química: ampliar estruturas e esquemas de laboratório verificáveis.
- Línguas e Humanas: linhas do tempo, infográficos e documentos-fonte.

### Fase 4 — operação e melhoria contínua

- Medir uso, falha e tempo de renderização por tipo visual.
- Alertar quando um mesmo capítulo exige visuais ainda sem renderer confiável.
- Criar novos renderizadores somente quando houver recorrência comprovada.

---

## Critérios de aceite

- Uma questão que depende de visual nunca é entregue sem imagem válida.
- Uma questão que não precisa de visual não recebe imagem apenas para decoração.
- Nenhum visual determinístico usa dado inventado pela IA.
- O sistema registra como cada imagem foi produzida e consegue recriá-la.
- A revisão mostra claramente por que a imagem foi usada e permite regenerá-la.
- Falha em uma imagem obrigatória refaz ou substitui apenas a questão afetada; não derruba a prova inteira.
