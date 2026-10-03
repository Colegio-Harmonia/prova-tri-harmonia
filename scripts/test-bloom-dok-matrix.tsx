import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BloomDokMatrix, { type BloomDokMatrixData, type MatrixTypeStats } from '../src/app/(app)/desempenho/BloomDokMatrix'

// tsx compila JSX no modo clássico; o Next usa o automático, por isso o componente não importa React.
;(globalThis as { React?: typeof React }).React = React

const none: MatrixTypeStats = { itemCount: 0, questionCount: 0, accuracyPercent: null, averageScore: null, confidence: 'baixa', insufficientSample: true }

// Números reais de História 7º ano (provas #266 e #270): 14 objetivas respondidas 217 vezes
// (média 93%) e 10 discursivas respondidas 155 vezes (média ~35%), tudo em Analisar x DOK 3.
const data: BloomDokMatrixData = {
  summary: { itemCount: 372, questionCount: 24 },
  rows: [{
    bloomLevel: 'analisar',
    cells: [{
      bloomLevel: 'analisar',
      dokLevel: 'DOK_3',
      itemCount: 372,
      equivalentCorrect: 256.7,
      accuracyPercent: 69,
      sampleSize: 372,
      confidence: 'alta',
      insufficientSample: false,
      byType: {
        objetiva: { itemCount: 217, questionCount: 14, accuracyPercent: 93, averageScore: 9.3, confidence: 'alta', insufficientSample: false },
        descritiva: { itemCount: 155, questionCount: 10, accuracyPercent: 35, averageScore: 3.5, confidence: 'alta', insufficientSample: false },
      },
    }],
  }],
}

const markup = renderToStaticMarkup(<BloomDokMatrix data={data} />)

// Objetivas e discursivas lado a lado, cada uma com a própria nota, questões e respostas.
assert.match(markup, /93%/)
assert.match(markup, /35%/)
assert.match(markup, /14 questões/)
assert.match(markup, /217 respostas/)
assert.match(markup, /10 questões/)
assert.match(markup, /155 respostas/)
assert.match(markup, /24 questões · 372 respostas classificadas/)
// A média única misturada (69%) não pode mais aparecer como desempenho da célula.
assert.doesNotMatch(markup, /69%/)
assert.doesNotMatch(markup, /item\(ns\)/)
// 4 DOKs x 2 tipos no cabeçalho.
assert.equal((markup.match(/>Objetivas</g) ?? []).length, 4)
assert.equal((markup.match(/>Discursivas</g) ?? []).length, 4)

// Filtro "só objetivas": a metade discursiva fica vazia, sem inventar nota.
const onlyObjective: BloomDokMatrixData = {
  ...data,
  rows: [{ bloomLevel: 'analisar', cells: [{ ...data.rows[0].cells[0], byType: { objetiva: data.rows[0].cells[0].byType.objetiva, descritiva: none } }] }],
}
const filtered = renderToStaticMarkup(<BloomDokMatrix data={onlyObjective} />)
assert.match(filtered, /93%/)
assert.doesNotMatch(filtered, /35%/)
assert.match(filtered, /sem respostas/)

// Amostra baixa (menos de 3 respostas) é sinalizada.
const lowSample: BloomDokMatrixData = {
  ...data,
  rows: [{ bloomLevel: 'analisar', cells: [{ ...data.rows[0].cells[0], byType: { objetiva: { itemCount: 2, questionCount: 1, accuracyPercent: 100, averageScore: 10, confidence: 'baixa', insufficientSample: true }, descritiva: none } }] }],
}
assert.match(renderToStaticMarkup(<BloomDokMatrix data={lowSample} />), /amostra baixa/)

// Sem nenhum item classificado: mensagem vazia em vez de tabela.
assert.match(renderToStaticMarkup(<BloomDokMatrix data={{ summary: { itemCount: 0, questionCount: 0 }, rows: [] }} />), /Nenhum item com Bloom e DOK/)

console.log('Bloom x DOK matrix render check passed.')
