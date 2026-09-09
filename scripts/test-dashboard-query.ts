import assert from 'node:assert/strict'
import { dashboardStatsQueryKey, dashboardStatsQueryOptions } from '../src/features/analytics/queries/dashboard-stats'
import { createQueryClient, QUERY_STALE_TIME_MS } from '../src/lib/query/client'

async function run() {
  const queryClient = createQueryClient()
  const defaults = queryClient.getDefaultOptions().queries

  assert.deepEqual(dashboardStatsQueryOptions.queryKey, dashboardStatsQueryKey)
  assert.deepEqual(dashboardStatsQueryKey, ['stats', 'dashboard'])
  assert.equal(defaults?.staleTime, QUERY_STALE_TIME_MS)
  assert.equal(defaults?.retry, false)
  assert.equal(defaults?.refetchOnWindowFocus, false)

  const originalFetch = globalThis.fetch
  let receivedInput: RequestInfo | URL | undefined
  let receivedAccept: string | null = null

  globalThis.fetch = async (input, init) => {
    receivedInput = input
    receivedAccept = new Headers(init?.headers).get('accept')

    return new Response(
      JSON.stringify({
        total: 0,
        byStatus: {},
        bySegment: {},
        byGrade: {},
        bySubject: {},
        bloomCounts: {},
        totalQuestions: 0,
        bnccMappedPct: 0,
        questionsNeedingImage: 0,
        imagesApproved: 0,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  try {
    const result = await queryClient.fetchQuery(dashboardStatsQueryOptions)
    assert.equal(receivedInput, '/api/stats/dashboard')
    assert.equal(receivedAccept, 'application/json')
    assert.equal(result.total, 0)
  } finally {
    globalThis.fetch = originalFetch
    queryClient.clear()
  }
}

run()
  .then(() => {
    console.log('Dashboard query contract checks passed.')
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
