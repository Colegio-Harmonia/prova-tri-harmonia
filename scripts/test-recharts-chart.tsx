import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RechartsBarChart } from '../src/app/(app)/dashboard/charts/RechartsBarChart'

const markup = renderToStaticMarkup(
  <RechartsBarChart
    title="Por segmento"
    categories={['Anos finais', 'Ensino médio']}
    values={[3, 2]}
    colors="#008649"
  />,
)

assert.match(markup, /Por segmento/)
assert.match(markup, /Anos finais/)
assert.match(markup, /Ensino médio/)
assert.match(markup, /Anos finais: 3/)
assert.match(markup, /Ensino médio: 2/)

console.log('Recharts bar chart render check passed.')
