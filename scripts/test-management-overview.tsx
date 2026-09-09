import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManagementOverview } from '../src/features/analytics/components/management/ManagementOverview'

const markup = renderToStaticMarkup(
  <ManagementOverview
    stats={{
      total: 12,
      byStatus: { revisao_concluida: 2 },
      bySegment: {},
      byGrade: {},
      bySubject: {},
      bloomCounts: {},
      totalQuestions: 96,
      bnccMappedPct: 75,
      questionsNeedingImage: 0,
      imagesApproved: 0,
    }}
  />,
)

assert.match(markup, /Visão institucional/)
assert.match(markup, /Dados acumulados de todas as provas geradas/)
assert.match(markup, /2 revisões aguardando aprovação/)
assert.match(markup, /href="\/status"/)

console.log('Management overview render check passed.')
