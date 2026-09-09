type ApiError = { error?: string; message?: string }

function errorMessage(body: ApiError) {
  return body.message ?? body.error ?? 'Não foi possível emitir as fichas.'
}

export async function downloadSheetAssignments(examId: number, assignmentIds: number[], action: 'emit' | 'download' = 'emit') {
  const response = await fetch(`/api/exams/${examId}/sheet-assignments/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignmentIds, action }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError
    throw new Error(errorMessage(body))
  }

  const archive = await response.blob()
  const url = URL.createObjectURL(archive)
  const link = document.createElement('a')
  link.href = url
  link.download = `cartoes-resposta-${examId}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
